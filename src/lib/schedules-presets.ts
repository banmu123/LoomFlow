// 定时任务常用频率预设（点选即填 cron 表达式，无需理解 cron 语法）
// labelKey：i18n key（schedules.presets.*），页面用 t(labelKey) 渲染
export interface FrequencyPreset {
  labelKey: string;
  cron: string;
}

export const FREQUENCY_PRESETS: FrequencyPreset[] = [
  { labelKey: 'schedules.presets.every5', cron: '*/5 * * * *' },
  { labelKey: 'schedules.presets.every10', cron: '*/10 * * * *' },
  { labelKey: 'schedules.presets.every30', cron: '*/30 * * * *' },
  { labelKey: 'schedules.presets.hourly', cron: '0 * * * *' },
  { labelKey: 'schedules.presets.daily9', cron: '0 9 * * *' },
  { labelKey: 'schedules.presets.daily18', cron: '0 18 * * *' },
  { labelKey: 'schedules.presets.monday9', cron: '0 9 * * 1' },
];
