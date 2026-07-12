import type {
  TinyflowData,
  FlowContext,
  FlowNode,
  ExecuteOptions,
  NodeResult,
  FlowError,
  ConfirmRequest,
  SubFlowRunner,
} from '../types';

type ExecuteFn = (
  node: FlowNode,
  context: FlowContext,
  subFlowRunner?: SubFlowRunner
) => Promise<Record<string, unknown>>;
import { GraphParser } from './GraphParser';
import { ParameterResolver } from './ParameterResolver';
import { ExpressionEvaluator } from './ExpressionEvaluator';

export class FlowEngine {
  private parser: GraphParser;
  private paramResolver: ParameterResolver;
  private exprEvaluator: ExpressionEvaluator;
  private flowData: TinyflowData;
  private options: ExecuteOptions;
  private context: FlowContext;
  private aborted = false;

  constructor(flowData: TinyflowData, options: ExecuteOptions) {
    this.flowData = flowData;
    this.options = options;
    this.parser = new GraphParser(flowData);
    this.paramResolver = new ParameterResolver(this.parser);
    this.exprEvaluator = new ExpressionEvaluator();

    this.context = options.resumeContext || {
      flowId: crypto.randomUUID(),
      inputs: options.inputs || {},
      nodeOutputs: new Map(),
      nodeStatuses: new Map(),
      variables: new Map(),
    };
  }

  getParamResolver(): ParameterResolver {
    return this.paramResolver;
  }

  getExprEvaluator(): ExpressionEvaluator {
    return this.exprEvaluator;
  }

  getContext(): FlowContext {
    return this.context;
  }

  /** 中止流程 */
  abort(): void {
    this.aborted = true;
  }

  /** 运行整个流程 */
  async run(): Promise<void> {
    try {
      const startNode = this.parser.getStartNode();
      await this.executeFromNode(startNode.id);
      this.options.onFlowComplete?.(this.getEndOutputs());
    } catch (err) {
      if (this.aborted) {
        this.options.onFlowError?.(new Error('流程已被中止'));
        return;
      }
      throw err;
    }
  }

  /** 从指定节点开始执行 */
  async executeFromNode(startNodeId: string): Promise<void> {
    // 从开始节点做 BFS 遍历执行
    const visited = new Set<string>();
    const queue: string[] = [startNodeId];

    while (queue.length > 0) {
      if (this.aborted) return;

      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.parser.getNode(currentId);
      if (!node) continue;

      // 跳过 LoopNode 的子节点 (由 LoopExecutor 内部处理)
      if (node.parentId) continue;

      // 执行当前节点
      const result = await this.executeNode(node);
      if (result.status === 'failed') {
        throw new Error(`节点 [${node.data.title}] 执行失败: ${result.error}`);
      }
      if (result.status === 'waiting_confirm') {
        // 暂停执行，等待用户确认
        throw this.createConfirmError(node, result);
      }

      // 获取后继节点
      const nextNodeIds = this.getNextNodes(currentId, result);
      queue.push(...nextNodeIds);
    }
  }

  /** 执行单个节点 */
  async executeNode(node: FlowNode): Promise<NodeResult> {
    if (this.aborted) {
      return {
        nodeId: node.id,
        status: 'skipped',
        outputs: {},
      };
    }

    this.options.onNodeStart?.(node.id);
    this.context.nodeStatuses.set(node.id, 'running');
    const startTime = Date.now();

    try {
      const executor = await this.getExecutor(node.type);
      // 传入子流程执行器回调 (用于 LoopNode)
      const subFlowRunner: SubFlowRunner = async (childNodes, childContext, childOptions) => {
        for (const childNode of childNodes) {
          if (childOptions?.signal?.aborted) return;
          const childResult = await this.executeNode(childNode);
          if (childResult.status === 'failed') {
            throw new Error(`子节点 [${childNode.data.title}] 执行失败: ${childResult.error}`);
          }
        }
      };
      const outputs = await executor.execute(node, this.context, subFlowRunner);

      const duration = Date.now() - startTime;
      const result: NodeResult = {
        nodeId: node.id,
        status: 'success',
        outputs,
        duration,
      };

      this.context.nodeOutputs.set(node.id, outputs);
      this.context.nodeStatuses.set(node.id, 'success');
      this.options.onNodeComplete?.(node.id, result);
      return result;
    } catch (err) {
      const error = err as FlowError;
      const duration = Date.now() - startTime;

      // 如果是确认请求，不视为错误
      if (error.code === 'confirm_required') {
        this.context.nodeStatuses.set(node.id, 'waiting_confirm');
        return {
          nodeId: node.id,
          status: 'waiting_confirm',
          outputs: {},
          duration,
        };
      }

      const result: NodeResult = {
        nodeId: node.id,
        status: 'failed',
        outputs: {},
        error: error.message,
        duration,
      };
      this.context.nodeStatuses.set(node.id, 'failed');
      this.options.onNodeComplete?.(node.id, result);
      return result;
    }
  }

  /** 根据边条件获取下一跳节点 */
  private getNextNodes(nodeId: string, result: NodeResult): string[] {
    const outEdges = this.flowData.edges.filter((e) => e.source === nodeId);
    const nextNodes: string[] = [];

    for (const edge of outEdges) {
      if (!edge.data?.condition) {
        nextNodes.push(edge.target);
        continue;
      }

      const conditionMet = this.exprEvaluator.evaluate(
        edge.data.condition,
        this.context
      );
      if (conditionMet) {
        nextNodes.push(edge.target);
      }
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

  /** 恢复执行 (用户确认后) */
  async resume(confirmData: Record<string, unknown>): Promise<void> {
    // 将 confirmData 合并到 inputs
    this.context.inputs = {
      ...this.context.inputs,
      _confirmData: confirmData,
    };

    // 找到等待确认的节点
    let resumeNodeId: string | undefined;
    for (const [nodeId, status] of this.context.nodeStatuses) {
      if (status === 'waiting_confirm') {
        resumeNodeId = nodeId;
        break;
      }
    }

    if (!resumeNodeId) {
      await this.run();
      return;
    }

    // 重新执行该节点
    const node = this.parser.getNode(resumeNodeId);
    if (!node) throw new Error('找不到待确认节点');

    const result = await this.executeNode(node);
    if (result.status === 'success') {
      // 继续执行后续节点
      this.context.nodeStatuses.set(resumeNodeId, 'success');
      await this.executeFromNode(resumeNodeId);
      this.options.onFlowComplete?.(this.getEndOutputs());
    }
  }

  /** 获取 End 节点输出 */
  private getEndOutputs(): Record<string, unknown> {
    const endNode = this.parser
      .getAllNodes()
      .find((n) => n.type === 'endNode');
    if (!endNode) return {};

    const endOutputs = this.context.nodeOutputs.get(endNode.id);
    return endOutputs || {};
  }

  /** 动态加载执行器 */
  private executorCache = new Map<string, { execute: ExecuteFn }>();

  private async getExecutor(
    nodeType: string
  ): Promise<{ execute: ExecuteFn }> {
    if (this.executorCache.has(nodeType)) {
      return this.executorCache.get(nodeType)! as { execute: ExecuteFn };
    }

    const { ExecutorRegistry } = await import('../executors');
    const ExecutorClass = ExecutorRegistry.get(nodeType);
    if (!ExecutorClass) {
      throw new Error(`不支持的节点类型: ${nodeType}`);
    }

    const instance = new ExecutorClass(this.paramResolver, this.exprEvaluator);
    this.executorCache.set(nodeType, instance as unknown as { execute: ExecuteFn });
    return instance as unknown as { execute: ExecuteFn };
  }
}
