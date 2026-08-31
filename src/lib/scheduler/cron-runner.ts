import { supabase } from '@/lib/supabase/server';
import { executeSchedule } from '@/lib/scheduler';
import { scanAllRules } from '@/lib/evolution/scheduler';

interface ScheduleRecord {
  id: string;
  workflow_id: string;
  user_id: string | null;
  cron_expr: string;
  inputs: Record<string, unknown> | null;
  webhook_url: string | null;
  enabled: boolean;
  last_run_at: string | null;
}

type Frequency = 'every_10_minutes' | 'every_30_minutes' | 'hourly' | 'daily' | 'unknown';

function parseFrequency(cronExpr: string): Frequency {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return 'unknown';

  const [minute, hour] = parts;

  if (minute === '*/10') return 'every_10_minutes';
  if (minute === '*/30') return 'every_30_minutes';
  if (minute === '0' && hour === '*') return 'hourly';
  if (minute === '0' && hour === '0') return 'daily';

  return 'unknown';
}

function shouldExecute(frequency: Frequency, lastRunAt: string | null): boolean {
  if (!lastRunAt) return true;

  const now = new Date();
  const lastRun = new Date(lastRunAt);
  const diffMs = now.getTime() - lastRun.getTime();
  const diffMinutes = diffMs / (1000 * 60);

  switch (frequency) {
    case 'every_10_minutes':
      return diffMinutes >= 10;
    case 'every_30_minutes':
      return diffMinutes >= 30;
    case 'hourly':
      return diffMinutes >= 60;
    case 'daily':
      return diffMinutes >= 24 * 60;
    default:
      return false;
  }
}

export async function runScheduledTasks(): Promise<{
  executed: number;
  skipped: number;
}> {
  const { data: schedules } = await supabase
    .from('scheduled_runs')
    .select('*')
    .eq('enabled', true);

  if (!schedules?.length) {
    await runEvolutionChecks();
    return { executed: 0, skipped: 0 };
  }

  let executed = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    const record = schedule as ScheduleRecord;
    const frequency = parseFrequency(record.cron_expr);

    if (frequency === 'unknown') {
      skipped++;
      continue;
    }

    if (!shouldExecute(frequency, record.last_run_at)) {
      skipped++;
      continue;
    }

    try {
      await executeSchedule(record);
      executed++;
    } catch {
      skipped++;
    }
  }

  await runEvolutionChecks();

  return { executed, skipped };
}

async function runEvolutionChecks(): Promise<void> {
  try {
    await scanAllRules();
  } catch {
    // Evolution check failure should not block scheduler
  }
}
