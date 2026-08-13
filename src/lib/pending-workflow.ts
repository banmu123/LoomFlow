export interface PendingWorkflow {
  data: unknown;
  /** 已有工作流 id（从列表打开画布时携带；AI 生成的新工作流无 id） */
  id?: string;
}

let pendingWorkflow: PendingWorkflow | null = null;

export function setPendingWorkflow(data: unknown, id?: string): void {
  pendingWorkflow = { data, id };
}

export function getPendingWorkflow(): PendingWorkflow | null {
  return pendingWorkflow;
}

export function clearPendingWorkflow(): void {
  pendingWorkflow = null;
}
