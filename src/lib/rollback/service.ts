import type { Baseline } from '@/lib/workflow-eval/baseline';
import { aggregateWorkflowMetrics, type RunRecordLike } from '@/lib/workflow-eval/metrics';
import { detectRegression } from '@/lib/workflow-eval/regression';
import { toMetricSnapshot } from '@/lib/workflow-eval/regression-policy';
import { decideRollback, type RollbackDecision, type RollbackMetrics } from './decision';
import { supabaseRollbackStore, type RollbackStore } from './store';

export interface EvaluateRollbackOptions {
  workflowId: string;
  actorId?: string | null;
  /** true = 允许执行（仍需 decision 与审批条件满足） */
  execute?: boolean;
  /** 人工审批标记（manual 模式必须显式提供） */
  approved?: boolean;
  now?: number;
  limit?: number;
}

export interface RollbackEvaluation {
  workflowId: string;
  currentVersion: number | null;
  decision: RollbackDecision;
  metrics: { current: RollbackMetrics; baselineSampleCount: number; currentSampleCount: number };
  regression: { status: string; severity: string; summary: string } | null;
  executed: boolean;
  rollback?: { id: string; fromVersion: number | null; toVersion: number; verified: boolean };
  error?: string;
}

function countConsecutiveFailures(runsNewestFirst: RunRecordLike[]): number {
  let count = 0;
  for (const run of runsNewestFirst) {
    if (run.status === 'completed') break;
    if (run.status === 'running' || run.status === 'paused') break;
    count += 1;
  }
  return count;
}

/**
 * 评估（并可选执行）一次回滚。
 *
 * 只调整 workflow_history 的 published_data / published_version 指针，
 * 不修改历史版本、不触碰数据库 Schema / 应用代码 / 基础设施。
 */
export async function evaluateRollback(
  options: EvaluateRollbackOptions,
  deps: { store?: RollbackStore } = {},
): Promise<RollbackEvaluation> {
  const store = deps.store ?? supabaseRollbackStore;
  const now = options.now ?? Date.now();

  const policy = await store.getPolicy(options.workflowId);
  const workflow = await store.getWorkflow(options.workflowId);
  if (!workflow) {
    throw new Error('工作流不存在');
  }
  if (!workflow.published || !workflow.publishedVersion) {
    return {
      workflowId: options.workflowId,
      currentVersion: workflow.publishedVersion,
      decision: {
        action: 'observe',
        reasons: ['工作流未发布，没有可回滚的版本'],
        severity: null,
        confidence: 'low',
        targetVersion: null,
      },
      metrics: {
        current: emptyMetrics(),
        baselineSampleCount: 0,
        currentSampleCount: 0,
      },
      regression: null,
      executed: false,
    };
  }

  const runs = await store.listRuns(options.workflowId, options.limit ?? 200);
  const half = Math.floor(runs.length / 2);
  const recent = runs.slice(0, half);
  const older = runs.slice(half);

  const currentMetrics = toMetricSnapshot(aggregateWorkflowMetrics(recent));
  const baselineMetrics = toMetricSnapshot(aggregateWorkflowMetrics(older));

  const baseline: Baseline = {
    workflowId: options.workflowId,
    type: 'rolling',
    timeRange: 'window-split',
    sampleCount: older.length,
    status: older.length >= policy.minSamples ? 'ready' : 'insufficient',
    metrics: baselineMetrics,
    source: 'flow_runs (older half)',
    generatedAt: new Date(now).toISOString(),
  };

  const regression = detectRegression(baseline, {
    version: workflow.publishedVersion,
    sampleCount: recent.length,
    metrics: currentMetrics,
  });

  const current: RollbackMetrics = {
    sampleCount: recent.length,
    successRate: currentMetrics.successRate,
    failureRate: currentMetrics.failureRate,
    p95Latency: currentMetrics.p95Latency,
    costPerRun: currentMetrics.costPerRun,
    consecutiveFailures: countConsecutiveFailures(recent),
  };

  const targetVersion = await store.getPreviousVersion(
    options.workflowId,
    workflow.publishedVersion,
  );
  const lastApplied = await store.getLastApplied(options.workflowId);
  const cooldownStart = new Date(now - policy.cooldownMinutes * 60_000).toISOString();
  const autoRollbacksInCooldown = await store.countAutoSince(options.workflowId, cooldownStart);

  const decision = decideRollback({
    policy,
    current,
    severity: regression.overallSeverity,
    targetVersion,
    autoRollbacksInCooldown,
    lastRollbackAt: lastApplied?.applied_at ?? null,
    now,
  });

  const base: RollbackEvaluation = {
    workflowId: options.workflowId,
    currentVersion: workflow.publishedVersion,
    decision,
    metrics: {
      current,
      baselineSampleCount: older.length,
      currentSampleCount: recent.length,
    },
    regression: {
      status: regression.status,
      severity: regression.overallSeverity,
      summary: regression.summary,
    },
    executed: false,
  };

  if (!decision.targetVersion) return base;

  const idempotencyKey = `${options.workflowId}:${workflow.publishedVersion}:${decision.targetVersion}`;
  const reason = decision.reasons.join('；');

  // Dry Run：只落一条记录，不切换版本
  if (decision.action === 'dry_run' && options.execute) {
    const record = await store.insertRollback({
      workflowId: options.workflowId,
      fromVersion: workflow.publishedVersion,
      toVersion: decision.targetVersion,
      status: 'dry_run',
      trigger: policy.mode,
      reason,
      metrics: base.metrics,
      actor: options.actorId ?? null,
      idempotencyKey,
    });
    await store.markDryRun(record.id);
    return { ...base, executed: false, rollback: { id: record.id, fromVersion: workflow.publishedVersion, toVersion: decision.targetVersion, verified: false } };
  }

  const canExecute =
    decision.action === 'auto_apply' ||
    (decision.action === 'manual_required' && options.execute && options.approved === true);

  if (!canExecute || !options.execute) return base;

  const record = await store.insertRollback({
    workflowId: options.workflowId,
    fromVersion: workflow.publishedVersion,
    toVersion: decision.targetVersion,
    status: 'requested',
    trigger: decision.action === 'auto_apply' ? 'auto' : 'manual',
    reason,
    metrics: base.metrics,
    actor: options.actorId ?? null,
    idempotencyKey,
  });

  if (record.duplicate) {
    return {
      ...base,
      executed: false,
      rollback: {
        id: record.id,
        fromVersion: workflow.publishedVersion,
        toVersion: decision.targetVersion,
        verified: true,
      },
    };
  }

  try {
    const applied = await store.applyRollback({
      rollbackId: record.id,
      workflowId: options.workflowId,
      toVersion: decision.targetVersion,
      expectedVersion: workflow.publishedVersion,
    });

    // 验证发布路径：重新读取 published_version，而不是只相信 RPC 返回值
    const after = await store.getWorkflow(options.workflowId);
    const verified = after?.publishedVersion === applied.publishedVersion;

    return {
      ...base,
      executed: true,
      rollback: {
        id: record.id,
        fromVersion: applied.previousVersion,
        toVersion: applied.publishedVersion,
        verified,
      },
    };
  } catch (err) {
    const message = (err as Error).message;
    await store.markFailed(record.id, message);
    return { ...base, executed: false, error: message };
  }
}

function emptyMetrics(): RollbackMetrics {
  return {
    sampleCount: 0,
    successRate: 0,
    failureRate: 0,
    p95Latency: 0,
    costPerRun: 0,
    consecutiveFailures: 0,
  };
}
