import { describe, it, expect } from 'vitest';
import {
  rangeToMs,
  buildRegressionWindows,
  isInWindow,
} from '../time-window';

describe('time-window 统一时间窗口工具', () => {
  describe('rangeToMs', () => {
    it('24h / 7d / 30d 正确转换', () => {
      expect(rangeToMs('24h')).toBe(24 * 3600 * 1000);
      expect(rangeToMs('7d')).toBe(7 * 24 * 3600 * 1000);
      expect(rangeToMs('30d')).toBe(30 * 24 * 3600 * 1000);
    });

    it('未知 range fallback 7d', () => {
      expect(rangeToMs('invalid')).toBe(rangeToMs('7d'));
      expect(rangeToMs('')).toBe(rangeToMs('7d'));
    });
  });

  describe('buildRegressionWindows', () => {
    const NOW = new Date('2026-09-04T00:00:00Z').getTime();

    it('7d + 30d：current 与 baseline 不重叠', () => {
      const w = buildRegressionWindows('7d', '30d', NOW);

      // current = [T-7d, T)
      expect(w.current.startMs).toBe(NOW - 7 * 86400_000);
      expect(w.current.endMs).toBe(NOW);

      // baseline = [T-7d-30d, T-7d)
      expect(w.baseline.startMs).toBe(NOW - 37 * 86400_000);
      expect(w.baseline.endMs).toBe(NOW - 7 * 86400_000);

      // 不重叠：baseline.end === current.start
      expect(w.baseline.endMs).toBe(w.current.startMs);
      // baseline 完全在 current 之前
      expect(w.baseline.endMs).toBeLessThanOrEqual(w.current.startMs);
    });

    it('24h + 30d', () => {
      const w = buildRegressionWindows('24h', '30d', NOW);
      expect(w.current.startMs).toBe(NOW - 86400_000);
      expect(w.current.endMs).toBe(NOW);
      expect(w.baseline.endMs).toBe(w.current.startMs);
      expect(w.baseline.startMs).toBe(NOW - 86400_000 - 30 * 86400_000);
    });

    it('ISO 字符串正确（start inclusive, end exclusive 语义）', () => {
      const w = buildRegressionWindows('7d', '30d', NOW);
      // startIso 可被 new Date 解析且时间戳匹配
      expect(new Date(w.current.startIso).getTime()).toBe(w.current.startMs);
      expect(new Date(w.baseline.endIso).getTime()).toBe(w.baseline.endMs);
    });
  });

  describe('isInWindow', () => {
    const window = {
      startIso: '2026-08-28T00:00:00Z',
      endIso: '2026-09-04T00:00:00Z',
      startMs: new Date('2026-08-28T00:00:00Z').getTime(),
      endMs: new Date('2026-09-04T00:00:00Z').getTime(),
    };

    it('窗口内的时间戳返回 true', () => {
      expect(isInWindow('2026-09-01T12:00:00Z', window)).toBe(true);
    });

    it('恰好在 start（inclusive）返回 true', () => {
      expect(isInWindow('2026-08-28T00:00:00Z', window)).toBe(true);
    });

    it('恰好在 end（exclusive）返回 false', () => {
      expect(isInWindow('2026-09-04T00:00:00Z', window)).toBe(false);
    });

    it('窗口之前返回 false', () => {
      expect(isInWindow('2026-08-27T23:59:59Z', window)).toBe(false);
    });

    it('窗口之后返回 false', () => {
      expect(isInWindow('2026-09-04T00:00:01Z', window)).toBe(false);
    });
  });
});
