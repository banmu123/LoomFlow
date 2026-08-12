import { Cron } from 'croner';
import { supabase } from './supabase/server';
import { runFlow } from './tinyflow/runFlow';
import type { TinyflowData } from './tinyflow/types';

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

const jobs = new Map<string, Cron>();

// 执行一个定时任务
async function executeSchedule(schedule: ScheduleRecord): Promise<void> {
  console.log('[scheduler] executing:', schedule.id.slice(0, 8), 'cron:', schedule.cron_expr);
  try {
    const { data: wf, error: wfError } = await supabase
      .from('workflow_history')
      .select('data')
      .eq('id', schedule.workflow_id)
      .single();
    console.log('[scheduler] wf data:', wfError ? 'ERR ' + wfError.message : 'OK hasData=' + !!wf?.data);

    if (!wf?.data) return;

    const result = await runFlow(wf.data as TinyflowData, schedule.inputs || {}, {
      source: 'api',
      workflowId: schedule.workflow_id,
      userId: schedule.user_id,
    });
    console.log('[scheduler] runFlow result:', result.status, result.flowId.slice(0, 8));

    await supabase
      .from('scheduled_runs')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', schedule.id);

    // Webhook 回调
    if (schedule.webhook_url) {
      fetch(schedule.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: schedule.workflow_id,
          scheduleId: schedule.id,
          status: result.status,
          outputs: result.outputs || null,
          error: result.error || null,
          executedAt: new Date().toISOString(),
        }),
      }).catch(() => {
        // webhook 失败不阻塞
      });
    }
  } catch {
    // 单次执行失败不阻塞调度器
  }
}

// 重新加载所有启用的定时任务（增删改后调用）
export async function reloadSchedules(): Promise<void> {
  // 停止现有任务
  for (const job of jobs.values()) {
    job.stop();
  }
  jobs.clear();

  const { data } = await supabase
    .from('scheduled_runs')
    .select('*')
    .eq('enabled', true);

  for (const s of data || []) {
    try {
      const job = new Cron(s.cron_expr, () => {
        executeSchedule(s as ScheduleRecord).catch(() => {});
      });
      jobs.set(s.id, job);
    } catch {
      // cron 表达式无效，跳过
    }
  }
}

// 服务启动时初始化
export function initScheduler(): void {
  reloadSchedules().catch(() => {});
  // 每 10 分钟同步一次（防止 DB 变更遗漏）
  setInterval(() => {
    reloadSchedules().catch(() => {});
  }, 10 * 60 * 1000);
}
