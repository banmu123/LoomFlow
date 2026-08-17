import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import { FREQUENCY_PRESETS } from '../schedules-presets';

describe('定时任务频率预设', () => {
  it('所有预设的 cron 表达式都能被 croner 解析（防止手误写错预设）', () => {
    expect(FREQUENCY_PRESETS.length).toBeGreaterThan(0);
    for (const p of FREQUENCY_PRESETS) {
      expect(() => new Cron(p.cron), `预设「${p.label}」cron 非法: ${p.cron}`).not.toThrow();
    }
  });

  it('预设 label 非空且唯一', () => {
    const labels = FREQUENCY_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    labels.forEach((l) => expect(l.trim().length).toBeGreaterThan(0));
  });

  it('预设 cron 互不重复', () => {
    const crons = FREQUENCY_PRESETS.map((p) => p.cron);
    expect(new Set(crons).size).toBe(crons.length);
  });

  it('包含常见频率（每分钟/每小时/每天）', () => {
    const crons = FREQUENCY_PRESETS.map((p) => p.cron);
    expect(crons).toContain('*/5 * * * *');
    expect(crons).toContain('0 * * * *');
    expect(crons).toContain('0 9 * * *');
  });
});
