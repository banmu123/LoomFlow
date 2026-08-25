import type {
  TinyflowData,
  FlowContext,
  FlowNode,
  ExecuteOptions,
  NodeResult,
  FlowError,
  ConfirmRequest,
  SubFlowRunner,
  NodeStatus,
} from '../types';
import { GraphParser } from './GraphParser';
import { ParameterResolver } from './ParameterResolver';
import { ExpressionEvaluator } from './ExpressionEvaluator';
import {
  isConfirmError,
  isCancelledError,
  isTimeoutError,
  RunCancelledError,
  RunTimeoutError,
  toErrorMessage,
  RunState,
  createRunController,
  createNodeSignal,
  throwIfAborted,
  retryWithPolicy,
  withTimeout,
  captureContext,
  extractTokenUsage,
  NodeTrace,
  NodeAttemptTrace,
  createRunTrace,
  finalizeRunTrace,
  RunTrace,
} from '../runtime';
import {
  deserializeCheckpoint,
  restoreContext as restoreContextFromData,
} from '../runtime/checkpoint';

type RetryPolicyShape = {
  maxRetries: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
  nonRetryableCodes?: string[];
};

type ExecuteFn = (
  node: FlowNode,
  context: FlowContext,
  subFlowRunner?: SubFlowRunner,
  signal?: AbortSignal
) => Promise<Record<string, unknown>>;

interface ReadyTask {
  nodeId: string;
}

export class FlowEngine {
  private parser: GraphParser;
  private paramResolver: ParameterResolver;
  private exprEvaluator: ExpressionEvaluator;
  private flowData: TinyflowData;
  private options: ExecuteOptions;
  private context: FlowContext;
  private signal: AbortSignal;
  private state: RunState = 'created';
  private startedAt = 0;
  private trace: RunTrace;
  private onRunning = false;

  /** 并行调度相关 */
  private runPromise: Promise<void> | null = null;
  private readyQueue: ReadyTask[] = [];

  constructor(flowData: TinyflowData, options: ExecuteOptions) {
    this.flowData = flowData;
    this.options = options;
    this.parser = new GraphParser(flowData);
    this.paramResolver = new ParameterResolver(this.parser);
    this.exprEvaluator = new ExpressionEvaluator();

    this.context =
      options.resumeContext ||
      (options.resumeCheckpoint
        ? restoreContextFromCheckpoint(options.resumeCheckpoint)
        : {
            flowId: crypto.randomUUID(),
            inputs: options.inputs || {},
            nodeOutputs: new Map(),
            nodeStatuses: new Map(),
            variables: new Map(),
            userId: options.userId ?? null,
          });

    const timeout = options.timeoutMs ?? 0;
    this.trace = createRunTrace(this.context.flowId);
    const { controller, signal } = createRunController(options.signal);
    this.signal = timeout > 0 ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : signal;
    // 监听信号关闭：无需要清理的持久资源；reason 由 throwIfAborted 判断
    this.signal.addEventListener('abort', () => {
      if (this.state === 'running' || this.state === 'created') {
        this.state = isTimeoutError(this.signal.reason) ? 'timeout' : 'cancelled';
      }
    });
    this.abortController = controller;
  }

  private abortController: AbortController;

  getParamResolver(): ParameterResolver {
    return this.paramResolver;
  }

  getExprEvaluator(): ExpressionEvaluator {
    return this.exprEvaluator;
  }

  getContext(): FlowContext {
    return this.context;
  }

  getState(): RunState {
    return this.state;
  }

  getTrace(): RunTrace {
    return this.trace;
  }

  /** 显式中止（用户取消） */
  cancel(): void {
    this.abortController.abort(new RunCancelledError('用户取消执行'));
  }

  /** 兼容旧 API：中止（等价 cancel） */
  abort(): void {
    this.cancel();
  }

  /** 运行整个流程 */
  async run(): Promise<void> {
    if (this.onRunning) return;
    this.onRunning = true;
    if (this.state === 'created') this.state = 'running';
    this.startedAt = this.startedAt || Date.now();
    try {
      for (const node of this.parser.getAllNodes()) {
        if (node.parentId) continue;
        const executor = await this.getExecutor(node.type);
        const configError = (executor as { validate?: (n: FlowNode) => string | null }).validate?.(node);
        if (configError) {
          throw new Error(`节点 ${node.id} 配置错误: ${configError}`);
        }
      }
      const startNode = this.parser.getStartNode();
      await this.executeFromNode(startNode.id);
      if (this.state === 'running') this.state = 'completed';
      this.options.onFlowComplete?.(this.getEndOutputs());
    } catch (err) {
      if (isConfirmError(err)) {
        this.state = 'waiting';
      } else if (isCancelledError(err)) {
        if (this.state !== 'timeout') this.state = 'cancelled';
      } else if (isTimeoutError(err)) {
        this.state = 'timeout';
      } else {
        // 仅当尚未进入终态/等待时才置 failed（避免覆盖 runScheduler 已设的 cancelled/timeout）
        const s = this.state as string;
        if (s !== 'cancelled' && s !== 'timeout' && s !== 'completed' && s !== 'paused') {
          this.state = 'failed';
          this.options.onFlowError?.(err instanceof Error ? err : new Error(toErrorMessage(err)));
        }
      }
      // 保持原语义：失败/确认/取消/超时均向上抛出，供调用方（runFlow/API）区分处理
      throw err;
    } finally {
      this.onRunning = false;
    }
    finalizeRunTrace(this.trace, this.state, this.options.workflowId);
  }

  /** 从指定节点开始执行（依赖感知并行调度） */
  async executeFromNode(startNodeId: string): Promise<void> {
    if (this.runPromise) {
      await this.runPromise;
      return;
    }
    this.runPromise = this.runScheduler(startNodeId);
    try {
      await this.runPromise;
    } finally {
      this.runPromise = null;
    }
  }

  /** 恢复执行（resume）：从等待确认节点继续 */
  async resume(confirmData: Record<string, unknown>): Promise<void> {
    if (this.state !== 'waiting' && this.state !== 'running') {
      throw new Error(`无法恢复：当前状态 ${this.state}`);
    }
    this.context.inputs = { ...this.context.inputs, _confirmData: confirmData };
    this.state = 'running';
    this.startedAt = this.startedAt || Date.now();

    const waitingNodeId = this.findWaitingNode();
    if (!waitingNodeId) {
      await this.executeFromNode(this.parser.getStartNode().id);
    } else {
      const result = await this.executeNode(this.parser.getNode(waitingNodeId)!);
      if (result.status === 'success') {
        await this.executeFromNode(waitingNodeId);
      } else {
        // 再次确认请求等：交给上层处理
      }
    }
    if (this.state === 'running') {
      this.state = 'completed';
      this.options.onFlowComplete?.(this.getEndOutputs());
    }
    finalizeRunTrace(this.trace, this.state, this.options.workflowId);
  }

  private findWaitingNode(): string | undefined {
    for (const [nodeId, status] of this.context.nodeStatuses) {
      if (status === 'waiting_confirm') return nodeId;
    }
    return undefined;
  }

  /**
   * 调度主循环：依赖感知的串行 BFS（保留原始条件/sourcePort 路由语义）。
   * - 每节点先执行成功后才沿钝化的边继续；
   * - 已成功的上游视为依赖已满足（支持 resume/checkpoint 恢复）；
   * - 中止/失败/确认时立即停止，不留下 running 假状态。
   */
  private async runScheduler(startNodeIdInner: string): Promise<void> {
    this.readyQueue = [{ nodeId: startNodeIdInner }];
    const scheduled = new Set<string>([startNodeIdInner]);
    let current: ReadyTask | undefined;

    try {
      while (this.readyQueue.length > 0) {
        throwIfAborted(this.signal);
        current = this.readyQueue.shift()!;
        const node = this.parser.getNode(current.nodeId);
        if (!node) continue;
        if (this.context.nodeStatuses.get(node.id) === 'success') {
          // 已完成节点（resume/checkpoint 恢复场景）：不重跑，但需继续路由其后续
          const out = this.context.nodeOutputs.get(node.id) || {};
          const existingSucc = this.getNextNodes(node.id, {
            nodeId: node.id,
            status: 'success',
            outputs: out,
          });
          for (const nextId of existingSucc) {
            if (scheduled.has(nextId)) continue;
            scheduled.add(nextId);
            this.readyQueue.push({ nodeId: nextId });
          }
          continue;
        }

        const result = await this.executeNode(node);
        if (result.status === 'failed') {
          this.setStateAndAbort('failed');
          throw new Error(`节点 [${node.data.title}] 执行失败: ${result.error}`);
        }
        if (result.status === 'waiting_confirm') {
          this.setStateAndAbort('waiting');
          throw this.createConfirmError(node, result);
        }
        if (result.status === 'cancelled' || result.status === 'timeout') {
          const st = result.status === 'timeout' ? 'timeout' : 'cancelled';
          this.setStateAndAbort(st);
          throw new Error(`节点 [${node.data.title}] 中止: ${st}`);
        }

        // 成功：路由后继（沿用原 getNextNodes 的条件/端口逻辑）
        const nextNodeIds = this.getNextNodes(current.nodeId, result);
        for (const nextId of nextNodeIds) {
          if (scheduled.has(nextId)) continue;
          scheduled.add(nextId);
          this.readyQueue.push({ nodeId: nextId });
        }
      }
    } finally {
      this.readyQueue = [];
      // 校验是否残留 running 假状态（中止/异常兜底）
      for (const [nodeId, status] of this.context.nodeStatuses) {
        if (status === 'running') this.context.nodeStatuses.set(nodeId, 'skipped');
      }
    }
  }

  private async runNodeTask(_node: FlowNode): Promise<void> {
    // 保留占位：串行调度下由 runScheduler 直接执行节点
    throw new Error('runNodeTask 已废弃');
  }

  private setStateAndAbort(state: RunState): void {
    this.state = state;
    // 已进入终态/等待：中止在途并行任务，避免后续继续写副作用
    if (this.signal && !this.signal.aborted && state !== 'waiting') {
      this.abortController.abort(
        state === 'timeout'
          ? new RunTimeoutError('节点超时，流程中止', 0)
          : new RunCancelledError('节点失败，流程中止'),
      );
    }
  }

  /** 执行单个节点（含超时 / 重试 / 取消 / trace / checkpoint） */
  async executeNode(node: FlowNode): Promise<NodeResult> {
    throwIfAborted(this.signal);
    this.options.onNodeStart?.(node.id);
    this.context.nodeStatuses.set(node.id, 'running');
    const startTime = Date.now();

    const nodeTimeoutMs = getNodeTimeoutMs(node, this.options);
    const retryPolicy = buildRetryPolicy(node, this.options);
    const attempts: NodeAttemptTrace[] = [];

    const attemptFn = async (attempt: number): Promise<Record<string, unknown>> => {
      const attemptStartMs = Date.now();
      throwIfAborted(this.signal);
      const nodeSignal = createNodeSignal(this.signal, nodeTimeoutMs, node.id);
      const executor = await this.getExecutor(node.type);
      const subFlowRunner: SubFlowRunner = async (childNodes, childContext, childOptions) => {
        // LoopExecutor 未传入 childNodes 时，由引擎解析当前 loop 节点的子节点
        const children = childNodes.length > 0 ? childNodes : this.parser.getChildren(node.id);
        for (const childNode of children) {
          throwIfAborted(this.signal);
          // 将本次循环变量合并进子执行上下文（不污染外层变量）
          const iterContext: FlowContext = {
            ...childContext,
            inputs: {
              ...(childContext?.inputs || {}),
              ...(childOptions?.inputs || {}),
            },
            nodeOutputs: childContext?.nodeOutputs || this.context.nodeOutputs,
            nodeStatuses: childContext?.nodeStatuses || this.context.nodeStatuses,
            variables: childContext?.variables || this.context.variables,
          };
          const childResult = await this.executeNodeChild(childNode, iterContext);
          if (childResult === 'failed') {
            throw new Error(`子节点 [${childNode.data.title}] 执行失败`);
          }
          if (childResult === 'confirm') {
            throw this.createConfirmError(childNode, { nodeId: childNode.id, status: 'waiting_confirm', outputs: {} });
          }
        }
      };

      const promise = executor.execute(node, this.context, subFlowRunner, nodeSignal);
      const timeoutMs = nodeTimeoutMs > 0 ? nodeTimeoutMs : 0;
      const outputs = await withTimeout(
        promise,
        timeoutMs,
        `节点 [${node.data.title || node.id}] 执行超时（${(timeoutMs / 1000).toFixed(1)}s）`,
        node.id,
      );
      const elapsed = Date.now() - attemptStartMs;
      attempts.push({
        attempt,
        startedAt: attemptStartMs,
        finishedAt: Date.now(),
        durationMs: elapsed,
      });
      return outputs;
    };

    try {
      const actualRetries = { count: 0 };
      const outputs = await retryWithPolicy(
        attemptFn,
        retryPolicy,
        {
          onAttempt: (info) => {
            actualRetries.count += 1;
            attempts.push({
              attempt: info.attempt,
              startedAt: 0,
              finishedAt: 0,
              durationMs: 0,
              error: toErrorMessage(info.error),
            });
          },
          signal: this.signal,
        },
      );

      const duration = Date.now() - startTime;
      const retryCount = actualRetries.count;
      const result: NodeResult = {
        nodeId: node.id,
        status: 'success',
        outputs,
        duration,
        attempt: retryCount + 1,
        retryCount,
      };

      this.context.nodeOutputs.set(node.id, outputs);
      this.context.nodeStatuses.set(node.id, 'success');
      this.recordNodeTrace(node, result, attempts, startTime);
      this.accumulateTokenUsage(outputs);
      this.options.onNodeComplete?.(node.id, result);
      if (this.options.onCheckpoint) {
        const executedNodes: string[] = [];
        for (const [nid, st] of this.context.nodeStatuses) {
          if (st === 'success') executedNodes.push(nid);
        }
        const cp = captureContext(this.context, {
          executedNodes,
          readyNodes: this.readyQueue.map((t) => t.nodeId),
          startedAt: this.startedAt,
        });
        this.options.onCheckpoint(this.context.flowId, cp);
      }
      return result;
    } catch (err) {
      const isConfirm = isConfirmError(err);
      const isTimeout = isTimeoutError(err);
      const isCancelled = isCancelledError(err);

      // 重试期间正确记录每次失败的 attempt
      const duration = Date.now() - startTime;
      let status: NodeStatus;
      if (isConfirm) {
        status = 'waiting_confirm';
      } else if (isCancelled) {
        status = this.state === 'timeout' ? 'timeout' : 'cancelled';
      } else if (isTimeout) {
        status = 'timeout';
      } else {
        status = 'failed';
      }

      if (isConfirm) {
        this.context.nodeStatuses.set(node.id, 'waiting_confirm');
      } else {
        this.context.nodeStatuses.set(node.id, status);
      }

      // 记录最终失败的 attempt（重试耗尽后最后一次尝试也会失败）
      const finalAttempt = attempts.length + 1;
      attempts.push({
        attempt: finalAttempt,
        startedAt: 0,
        finishedAt: 0,
        durationMs: 0,
        error: toErrorMessage(err),
      });

      const result: NodeResult = {
        nodeId: node.id,
        status,
        outputs: {},
        error: toErrorMessage(err),
        duration,
        attempt: finalAttempt,
        retryCount: Math.max(0, attempts.length - 1),
      };
      this.recordNodeTrace(node, result, attempts, startTime);
      this.options.onNodeComplete?.(node.id, result);
      return result;
    }
  }

  /** 执行 loop 子节点（针对迭代上下文；baseExecutor 直接复用，写回共享 nodeOutputs） */
  private async executeNodeChild(
    childNode: FlowNode,
    ctx: FlowContext,
  ): Promise<'success' | 'failed' | 'confirm'> {
    throwIfAborted(this.signal);
    const nodeTimeoutMs = getNodeTimeoutMs(childNode, this.options);
    try {
      const executor = await this.getExecutor(childNode.type);
      const nodeSignal = createNodeSignal(this.signal, nodeTimeoutMs, childNode.id);
      const outputs = await withTimeout(
        executor.execute(childNode, ctx, undefined, nodeSignal),
        nodeTimeoutMs,
        `子节点 [${childNode.data.title || childNode.id}] 执行超时`,
        childNode.id,
      );
      ctx.nodeOutputs.set(childNode.id, outputs);
      ctx.nodeStatuses.set(childNode.id, 'success');
      this.accumulateTokenUsage(outputs);
      return 'success';
    } catch (err) {
      if (isConfirmError(err)) return 'confirm';
      ctx.nodeStatuses.set(childNode.id, isTimeoutError(err) ? 'timeout' : 'failed');
      return 'failed';
    }
  }

  private recordNodeTrace(
    node: FlowNode,
    result: NodeResult,
    attempts: NodeAttemptTrace[],
    startTime: number,
  ): void {
    const existing = this.trace.nodes.find((n) => n.nodeId === node.id);
    const entry: NodeTrace = {
      nodeId: node.id,
      type: node.type,
      title: node.data.title || node.id,
      status: result.status,
      startedAt: startTime,
      finishedAt: Date.now(),
      durationMs: result.duration ?? Date.now() - startTime,
      attempts,
      input: undefined,
      output: result.status === 'success' ? result.outputs : undefined,
      error: result.error,
      retryCount: result.retryCount ?? 0,
    };
    if (existing) {
      this.trace.nodes[this.trace.nodes.indexOf(existing)] = entry;
    } else {
      this.trace.nodes.push(entry);
    }
  }

  private accumulateTokenUsage(outputs: Record<string, unknown>): void {
    const usage = extractTokenUsage(outputs);
    this.trace.tokenUsage.promptTokens += usage.promptTokens;
    this.trace.tokenUsage.completionTokens += usage.completionTokens;
    this.trace.tokenUsage.totalTokens += usage.totalTokens;
  }

  /** 根据边条件获取下一跳节点 */
  private getNextNodes(nodeId: string, result: NodeResult): string[] {
    const outEdges = this.flowData.edges.filter((e) => e.source === nodeId);
    const nextNodes: string[] = [];

    for (const edge of outEdges) {
      const port = edge.data?.sourcePort;
      if (port) {
        if (result.outputs[port]) nextNodes.push(edge.target);
        continue;
      }
      if (!edge.data?.condition) {
        nextNodes.push(edge.target);
        continue;
      }
      const conditionMet = this.exprEvaluator.evaluate(edge.data.condition, this.context);
      if (conditionMet) nextNodes.push(edge.target);
    }
    return nextNodes;
  }

  /** 创建确认请求错误 */
  private createConfirmError(node: FlowNode, _result: NodeResult): FlowError {
    const confirms = node.data.confirms || [];
    const confirmRequest: ConfirmRequest = {
      type: 'confirm_required',
      nodeId: node.id,
      message: node.data.message || '请确认以下信息',
      confirms: confirms.map((c) => ({
        name: c.name,
        formType: c.formType,
        formLabel: c.formLabel,
        formDescription: c.formDescription,
        enums: c.enums,
        contentType: c.contentType,
        required: c.required,
      })),
    };

    const error = new Error('confirm_required') as FlowError;
    error.code = 'confirm_required';
    error.confirmRequest = confirmRequest;
    error.nodeId = node.id;
    error.contextSnapshot = {
      ...this.context,
      nodeOutputs: new Map(this.context.nodeOutputs),
      nodeStatuses: new Map(this.context.nodeStatuses),
      variables: new Map(this.context.variables),
    };
    return error;
  }

  /** 获取 End 节点输出 */
  private getEndOutputs(): Record<string, unknown> {
    const endNode = this.parser.getAllNodes().find((n) => n.type === 'endNode');
    if (!endNode) return {};
    const endOutputs = this.context.nodeOutputs.get(endNode.id);
    return endOutputs || {};
  }

  /** 动态加载执行器 */
  private executorCache = new Map<string, { execute: ExecuteFn }>();

  private async getExecutor(nodeType: string): Promise<{ execute: ExecuteFn }> {
    if (this.executorCache.has(nodeType)) return this.executorCache.get(nodeType)! as { execute: ExecuteFn };

    const { ExecutorRegistry } = await import('../executors');
    const ExecutorClass = ExecutorRegistry.get(nodeType);
    if (!ExecutorClass) throw new Error(`不支持的节点类型: ${nodeType}`);

    const instance = new ExecutorClass(this.paramResolver, this.exprEvaluator);
    this.executorCache.set(nodeType, instance as unknown as { execute: ExecuteFn });
    return instance as unknown as { execute: ExecuteFn };
  }
}

function getNodeTimeoutMs(node: FlowNode, options: ExecuteOptions): number {
  const data = node.data as Record<string, unknown>;
  const configured = Number(data.timeout);
  if (Number.isFinite(configured) && configured > 0) return Math.min(configured, 3600) * 1000;
  const defaultMs = options.defaultNodeTimeoutMs ?? 0;
  if (defaultMs > 0) return defaultMs;
  return 90_000; // 节点默认 90s
}

function buildRetryPolicy(node: FlowNode, options: ExecuteOptions): RetryPolicyShape {
  const data = node.data as Record<string, unknown>;
  const enabled = data.retryEnable !== false;
  const maxRetries = enabled ? Math.max(0, Number(data.maxRetryCount) || 0) : 0;
  return {
    maxRetries,
    retryDelayMs: Math.max(0, Number(data.retryIntervalMs) || 1000),
    exponentialBackoff: data.exponentialBackoff !== false,
    nonRetryableCodes: ['confirm_required', 'invalid_config'],
  };
}

function restoreContextFromCheckpoint(raw: unknown): FlowContext {
  const cp = deserializeCheckpoint(raw);
  if (!cp) {
    return { flowId: crypto.randomUUID(), inputs: {}, nodeOutputs: new Map(), nodeStatuses: new Map(), variables: new Map() };
  }
  return restoreContextFromData(cp);
}
