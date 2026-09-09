/**
 * WorkflowRuntime — 工作流执行抽象层
 *
 * Desktop: LocalWorkflowRuntime（直接在前端进程跑 FlowEngine）
 * Future: RemoteWorkflowRuntime（调 LoomFlow Server API）
 */

import type { TinyflowData, ExecuteOptions } from '@/lib/tinyflow/types';
import type { WorkflowRepository, ExecutionRecord } from './repositories/workflow-repository';

export interface RunWorkflowInput {
  flowData: TinyflowData;
  inputs: Record<string, unknown>;
  workflowId?: string;
}

export interface RunWorkflowResult {
  executionId: string;
  status: ExecutionRecord['status'];
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
}

export interface WorkflowRuntime {
  execute(input: RunWorkflowInput): Promise<RunWorkflowResult>;
  stop(executionId: string): Promise<void>;
}

/**
 * LocalWorkflowRuntime — 在 Desktop 进程内通过 FlowEngine 执行工作流
 *
 * 第一阶段：直接调用 @/lib/tinyflow 的 FlowEngine。
 * 执行记录持久化到 SQLite（通过 repository）。
 */
export class LocalWorkflowRuntime implements WorkflowRuntime {
  private repo: WorkflowRepository;
  private abortControllers = new Map<string, AbortController>();

  constructor(repo: WorkflowRepository) {
    this.repo = repo;
  }

  async execute(input: RunWorkflowInput): Promise<RunWorkflowResult> {
    // Dynamically import to avoid loading the engine until needed
    const { FlowEngine } = await import('@/lib/tinyflow');
    const { validateWorkflow } = await import('@/lib/tinyflow/schema');

    // Validate workflow
    const validation = validateWorkflow(input.flowData);
    if (!validation.valid) {
      return {
        executionId: '',
        status: 'failed',
        error: validation.errors.map((e) => e.message).join('; '),
      };
    }

    // Create execution record
    const execution = input.workflowId
      ? await this.repo.createExecution(input.workflowId, input.inputs)
      : null;

    const abortController = new AbortController();
    if (execution) {
      this.abortControllers.set(execution.id, abortController);
    }

    const startTime = Date.now();

    try {
      const timeoutMs = 300_000; // 5 min default

      const options: ExecuteOptions = {
        flowData: input.flowData,
        inputs: input.inputs,
        workflowId: input.workflowId ?? null,
        signal: abortController.signal,
        timeoutMs,
      };

      const engine = new FlowEngine(input.flowData, options);
      await engine.run();

      const durationMs = Date.now() - startTime;
      const outputs = this.extractOutputs(input.flowData, engine);

      // Update execution record
      if (execution) {
        await this.repo.updateExecution(execution.id, {
          status: 'completed',
          output: outputs,
          completedAt: new Date().toISOString(),
          durationMs,
        });
      }

      return {
        executionId: execution?.id ?? '',
        status: 'completed',
        outputs,
        durationMs,
      };
    } catch (err) {
      const error = err as Error;
      const durationMs = Date.now() - startTime;

      if (execution) {
        await this.repo.updateExecution(execution.id, {
          status: abortController.signal.aborted ? 'cancelled' : 'failed',
          error: error.message,
          completedAt: new Date().toISOString(),
          durationMs,
        });
      }

      return {
        executionId: execution?.id ?? '',
        status: abortController.signal.aborted ? 'cancelled' : 'failed',
        error: error.message,
        durationMs,
      };
    } finally {
      if (execution) {
        this.abortControllers.delete(execution.id);
      }
    }
  }

  async stop(executionId: string): Promise<void> {
    const controller = this.abortControllers.get(executionId);
    if (controller) {
      controller.abort();
    }
  }

  private extractOutputs(flowData: TinyflowData, engine: { getContext: () => { nodeOutputs: Map<string, Record<string, unknown>> } }): Record<string, unknown> {
    const endNode = flowData.nodes.find((n) => n.type === 'endNode');
    if (endNode) {
      const endOutputs = engine.getContext().nodeOutputs.get(endNode.id);
      if (endOutputs && Object.keys(endOutputs).length > 0) {
        return endOutputs;
      }
    }
    // Fallback: aggregate all node outputs
    const summary: Record<string, unknown> = {};
    for (const [nodeId, outputs] of engine.getContext().nodeOutputs) {
      if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
        summary[nodeId] = outputs;
      }
    }
    return summary;
  }
}
