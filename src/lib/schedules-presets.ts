// 定时任务常用频率预设（点选即填 cron 表达式，无需理解 cron 语法）
export interface FrequencyPreset {
  label: string;
  cron: string;
}

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  { label: '每 5 分钟', cron: '*/5 * * * *' },
  { label: '每 10 分钟', cron: '*/10 * * * *' },
  { label: '每 30 分钟', cron: '*/30 * * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每天 9:00', cron: '0 9 * * *' },
  { label: '每天 18:00', cron: '0 18 * * *' },
  { label: '每周一 9:00', cron: '0 9 * * 1' },
];
