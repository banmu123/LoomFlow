/**
 * 统一执行状态机：
 *   created → running → completed
 *                     → waiting（人工确认）→ paused（持久化）
 *                     → failed
 *                     → cancelled
 *                     → timeout
 *   waiting/paused → running（resume）
 */
export type RunState =
  | 'created'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/** 终态：进入后不再允许执行节点 */
export function isTerminalState(state: RunState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'timeout';
}

/** 运行中（可继续执行）状态 */
export function isActiveState(state: RunState): boolean {
  return state === 'running';
}

/** 合法的状态转移（防「cancel 后又写 completed」等乱序写库） */
const TRANSITIONS: Record<RunState, RunState[]> = {
  created: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'cancelled', 'timeout', 'waiting'],
  waiting: ['running', 'paused', 'cancelled', 'failed'],
  paused: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 运行状态 → 落库 status（向后兼容现有 flow_runs.status 语义） */
export function runStateToPersistedStatus(
  state: RunState,
): 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'timeout' {
  switch (state) {
    case 'waiting':
    case 'paused':
      return 'paused';
    case 'created':
    case 'running':
      return 'running';
    default:
      return state;
  }
}
