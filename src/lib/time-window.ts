/**
 * 统一时间窗口工具（Regression Detection / Metrics / Rule Evaluator 共用）
 *
 * 语义约定：
 * - 窗口 = [start, end) —— start inclusive, end exclusive（基于 ISO cutoff: created_at >= start AND created_at < end）
 * - current 窗口：[T - metricRange, T)
 * - baseline 窗口：[T - metricRange - baselineRange, T - metricRange)
 * - 两个窗口**不重叠**，baseline 恰好在 current 之前
 *
 * 时间单位统一为毫秒（Date.now()）。
 */

export type TimeRange = '24h' | '7d' | '30d';

const RANGE_MS: Record<TimeRange, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

/** 字符串 range → 毫秒；未知值 fallback 7d（不静默吞掉，调用方应保证输入合法） */
export function rangeToMs(range: string): number {
  return RANGE_MS[range as TimeRange] ?? RANGE_MS['7d'];
}

export interface TimeWindow {
  /** 窗口起点（inclusive），ISO 字符串 */
  startIso: string;
  /** 窗口终点（exclusive），ISO 字符串 */
  endIso: string;
  /** 起点毫秒时间戳 */
  startMs: number;
  /** 终点毫秒时间戳 */
  endMs: number;
}

export interface RegressionWindows {
  current: TimeWindow;
  baseline: TimeWindow;
}

/**
 * 构建 Regression Detection 的 current / baseline 两个不重叠时间窗口。
 *
 * @param metricRange   current 窗口的范围（如 '7d'）
 * @param baselineRange baseline 窗口的范围（如 '30d'）
 * @param now           参考时间点（ms），默认 Date.now()；测试时可注入
 */
export function buildRegressionWindows(
  metricRange: string,
  baselineRange: string,
  now: number = Date.now(),
): RegressionWindows {
  const metricMs = rangeToMs(metricRange);
  const baselineMs = rangeToMs(baselineRange);

  const currentStart = now - metricMs;
  const currentEnd = now;
  const baselineStart = now - metricMs - baselineMs;
  const baselineEnd = now - metricMs; // 恰好与 currentStart 相同 → 不重叠

  return {
    current: {
      startIso: new Date(currentStart).toISOString(),
      endIso: new Date(currentEnd).toISOString(),
      startMs: currentStart,
      endMs: currentEnd,
    },
    baseline: {
      startIso: new Date(baselineStart).toISOString(),
      endIso: new Date(baselineEnd).toISOString(),
      startMs: baselineStart,
      endMs: baselineEnd,
    },
  };
}

/**
 * 判断一个 ISO 时间戳是否落在 [start, end) 窗口内。
 * 边界：start inclusive, end exclusive。
 */
export function isInWindow(timestampIso: string, window: TimeWindow): boolean {
  const t = new Date(timestampIso).getTime();
  return t >= window.startMs && t < window.endMs;
}
