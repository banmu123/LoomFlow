import { CozeAPI } from '@coze/api';

export const COZE_SPACE_ID = '7595145929213886527';
export const COZE_BASE_URL = 'https://api.coze.cn';

export function createCozeClient(): CozeAPI {
  const isTestMode = process.env.COZE_WORKFLOW_TEST_MODE === 'true';

  return new CozeAPI({
    token: process.env.PAT_TOKEN || process.env.COZE_API_KEY || '',
    baseURL: COZE_BASE_URL,
    ...(isTestMode ? { headers: { 'x-run-mode': 'test_run' } } : {}),
  });
}

export function buildDebugUrl(workflowId: string, executeId: string): string {
  return `https://www.coze.cn/work_flow?execute_id=${executeId}&space_id=${COZE_SPACE_ID}&workflow_id=${workflowId}&execute_mode=2`;
}
