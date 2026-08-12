import type { WorkflowExecuteHistory } from '@coze/api';
import { createCozeClient, buildDebugUrl } from './coze-client';

// ===== Types =====

export type ExecuteStatus = 'Running' | 'Success' | 'Fail' | 'Failed' | 'Timeout';

export interface SceneData {
  [key: string]: unknown;
}

export interface WorkflowExecuteResult {
  execute_id: string;
  status: ExecuteStatus;
  output?: string;
  video_url?: string;
  scene_assets?: string[];
  scene_data?: string | SceneData[];
  error_message?: string;
  debug_url?: string;
}

export interface PollOptions {
  initialDelay?: number;
  pollInterval?: number;
  maxAttempts?: number;
  onStatusChange?: (status: ExecuteStatus, attempt: number) => void;
}

interface RawHistoryRecord extends WorkflowExecuteHistory {
  videoUrl?: string;
  sceneAssets?: string[] | string;
  sceneData?: string | SceneData[];
  Output?: string;
}

// ===== Helpers =====

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(status: string): ExecuteStatus {
  if (status === 'Fail') return 'Failed';
  return status as ExecuteStatus;
}

function parseSceneAssets(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.split(/[,\s]+/).filter(Boolean);
}

function parseHistoryRecord(
  record: RawHistoryRecord,
  workflowId: string,
): WorkflowExecuteResult {
  const output = record.Output || record.output;

  let parsedOutput: Record<string, unknown> | null = null;
  if (output) {
    try {
      const parsed = JSON.parse(output);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedOutput = parsed as Record<string, unknown>;
      }
    } catch {
      // output is plain text
    }
  }

  const video_url =
    record.videoUrl ??
    (parsedOutput ? (parsedOutput.videoUrl as string | undefined) : undefined);

  const scene_assets = parseSceneAssets(
    record.sceneAssets ??
      (parsedOutput
        ? (parsedOutput.sceneAssets as string[] | string | undefined)
        : undefined),
  );

  const scene_data =
    record.sceneData ??
    (parsedOutput
      ? (parsedOutput.sceneData as string | SceneData[] | undefined)
      : undefined);

  return {
    execute_id: record.execute_id,
    status: normalizeStatus(record.execute_status),
    output,
    video_url,
    scene_assets,
    scene_data,
    error_message: record.error_message || undefined,
    debug_url: record.debug_url || buildDebugUrl(workflowId, record.execute_id),
  };
}

// ===== Public API =====

export async function startAsyncWorkflow(
  workflowId: string,
  parameters: Record<string, unknown>,
): Promise<{ execute_id: string; debug_url: string }> {
  const client = createCozeClient();
  const result = await client.workflows.runs.create({
    workflow_id: workflowId,
    is_async: true,
    parameters,
  });
  return {
    execute_id: result.execute_id,
    debug_url: result.debug_url,
  };
}

export async function pollWorkflowResult(
  workflowId: string,
  executeId: string,
  options: PollOptions = {},
): Promise<WorkflowExecuteResult> {
  const {
    initialDelay = 2000,
    pollInterval = 30000,
    maxAttempts = 120,
    onStatusChange,
  } = options;

  const client = createCozeClient();

  await sleep(initialDelay);

  let lastStatus: ExecuteStatus = 'Running';
  onStatusChange?.(lastStatus, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const records = await client.workflows.runs.history(workflowId, executeId);
    const record = records[0] as RawHistoryRecord | undefined;

    if (!record) {
      await sleep(pollInterval);
      continue;
    }

    const result = parseHistoryRecord(record, workflowId);

    if (result.status !== lastStatus) {
      lastStatus = result.status;
      onStatusChange?.(result.status, attempt);
    }

    if (result.status === 'Success' || result.status === 'Failed') {
      return result;
    }

    await sleep(pollInterval);
  }

  const maxMinutes = Math.round(
    (initialDelay + maxAttempts * pollInterval) / 60000,
  );
  onStatusChange?.('Timeout', maxAttempts);
  return {
    execute_id: executeId,
    status: 'Timeout',
    error_message: `工作流执行超时，已轮询 ${maxAttempts} 次（约 ${maxMinutes} 分钟）`,
    debug_url: buildDebugUrl(workflowId, executeId),
  };
}

export async function executeAsyncWorkflow(
  workflowId: string,
  parameters: Record<string, unknown>,
  options: PollOptions = {},
): Promise<WorkflowExecuteResult> {
  const { execute_id } = await startAsyncWorkflow(workflowId, parameters);
  return pollWorkflowResult(workflowId, execute_id, options);
}
