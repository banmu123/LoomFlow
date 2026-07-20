let pendingWorkflowData: unknown = null;

export function setPendingWorkflow(data: unknown): void {
  pendingWorkflowData = data;
}

export function getPendingWorkflow(): unknown {
  return pendingWorkflowData;
}

export function clearPendingWorkflow(): void {
  pendingWorkflowData = null;
}
