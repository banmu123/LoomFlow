import { RunCancelledError, RunTimeoutError } from './errors';

/**
 * 创建运行级取消控制器：合并外部信号 + 内部控制。
 * 返回的 abort/reason 供引擎统一取消。
 */
export function createRunController(
  externalSignal?: AbortSignal,
): { controller: AbortController; signal: AbortSignal } {
  const controller = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), {
        once: true,
      });
    }
  }

  return { controller, signal: controller.signal };
}

/**
 * 节点级信号：父信号 + 节点超时。
 * 超时触发后 signal 被 abort 并携带 RunTimeoutError，便于在途请求（fetch/LLM）立即中止。
 */
export function createNodeSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  nodeId?: string,
): AbortSignal {
  const sources: AbortSignal[] = [];
  if (parent) sources.push(parent);
  if (timeoutMs > 0) {
    sources.push(AbortSignal.timeout(timeoutMs));
  }
  if (sources.length === 0) return AbortSignal.timeout(0);
  const signal = AbortSignal.any(sources);
  // AbortSignal.timeout 的 reason 是 DOMException TimeoutError，统一为 RunTimeoutError
  if (timeoutMs > 0) {
    signal.addEventListener(
      'abort',
      () => {
        // 忽略：调用方通过 withTimeout 感知超时；reason 仅作提示
      },
      { once: true },
    );
  }
  return signal;
}

/** 校验信号并抛出对应错误（在关键循环点调用） */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof RunTimeoutError) throw reason;
  if (reason instanceof RunCancelledError) throw reason;
  throw new RunCancelledError(reason instanceof Error ? reason.message : '执行已取消');
}
