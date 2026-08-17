import type { FlowEngine } from './engine/FlowEngine';
import type { FlowContext, ConfirmRequest, NodeStatus } from './types';

export interface FlowRunRecord {
  flowId: string;
  engine: FlowEngine;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  context: FlowContext;
  confirmRequest?: ConfirmRequest;
  /** 发起者用户 id（status/stop/confirm 端点校验归属；null=未登录遗留记录） */
  userId?: string | null;
  createdAt: number;
  updatedAt: number;
}

class FlowRunStore {
  private store = new Map<string, FlowRunRecord>();

  create(flowId: string, record: FlowRunRecord): void {
    this.store.set(flowId, record);
  }

  get(flowId: string): FlowRunRecord | undefined {
    return this.store.get(flowId);
  }

  update(flowId: string, updates: Partial<FlowRunRecord>): void {
    const record = this.store.get(flowId);
    if (record) {
      Object.assign(record, updates, { updatedAt: Date.now() });
    }
  }

  delete(flowId: string): void {
    this.store.delete(flowId);
  }

  getAll(): FlowRunRecord[] {
    return [...this.store.values()];
  }

  /** 清理超过 30 分钟的记录 */
  cleanup(): void {
    const now = Date.now();
    for (const [flowId, record] of this.store) {
      if (now - record.updatedAt > 30 * 60 * 1000) {
        this.store.delete(flowId);
      }
    }
  }

  /** 获取节点状态摘要 */
  getNodeStatuses(flowId: string): Array<{ nodeId: string; status: NodeStatus }> {
    const record = this.store.get(flowId);
    if (!record) return [];
    return [...record.context.nodeStatuses.entries()].map(([nodeId, status]) => ({
      nodeId,
      status,
    }));
  }
}

export const flowRunStore = new FlowRunStore();
