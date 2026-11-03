import type { Severity } from '@/lib/workflow-eval/regression-policy';

export type RollbackMode = 'manual' | 'auto';

export interface RollbackPolicy {
  workflowId: string;
  enabled: boolean;
  mode: RollbackMode;
  dryRun: boolean;
  /** 最小样本数：低于该值不做任何判断 */
  minSamples: number;
  cooldownMinutes: number;
  maxAutoRollbacks: number;
  /** 连续失败多少次视为明确退化 */
  maxFailuresStreak: number;
}

export const DEFAULT_ROLLBACK_POLICY: Omit<RollbackPolicy, 'workflowId'> = {
  enabled: false,
  mode: 'manual',
  dryRun: true,
  minSamples: 20,
  cooldownMinutes: 60,
  maxAutoRollbacks: 3,
  maxFailuresStreak: 5,
};

export interface RollbackMetrics {
  sampleCount: number;
  successRate: number;
  failureRate: number;
  p95Latency: number;
  costPerRun: number;
  consecutiveFailures: number;
}

export type RollbackAction =
  | 'noop'
  | 'observe'
  | 'dry_run'
  | 'manual_required'
  | 'auto_apply'
  | 'blocked';

export interface RollbackDecision {
  action: RollbackAction;
  reasons: string[];
  severity: Severity | null;
  confidence: 'low' | 'medium' | 'high';
  targetVersion: number | null;
}

export interface DecideRollbackInput {
  policy: RollbackPolicy;
  current: RollbackMetrics;
  /** 回归检测的总体严重程度（来自 workflow-eval/regression.ts） */
  severity: Severity | null;
  /** 已存在的目标版本（上一个已发布版本） */
  targetVersion: number | null;
  /** 冷却期内已自动回滚的次数 */
  autoRollbacksInCooldown: number;
  /** 最近一次回滚时间（用于冷却判断） */
  lastRollbackAt: string | null;
  minSamples?: number;
  now?: number;
}

/**
 * 回滚决策（纯函数）。
 *
 * 安全默认：
 * - 样本不足 → 只观察；
 * - 没有明确退化（high/critical 或连续失败）→ 只观察；
 * - 冷却中 / 自动次数用尽 → 不自动执行；
 * - manual 模式 → 必须人工确认。
 *
 * 单次模型调用失败永远不会触发回滚：至少需要连续 maxFailuresStreak 次失败，
 * 或回归检测给出 high/critical。
 */
export function decideRollback(input: DecideRollbackInput): RollbackDecision {
  const { policy, current } = input;
  const now = input.now ?? Date.now();
  const minSamples = input.minSamples ?? policy.minSamples;
  const reasons: string[] = [];
  const severity = input.severity;

  if (!policy.enabled) {
    return { action: 'noop', reasons: ['策略未启用'], severity, confidence: 'low', targetVersion: input.targetVersion };
  }

  if (!input.targetVersion) {
    return {
      action: 'observe',
      reasons: ['没有可回退的历史版本'],
      severity,
      confidence: 'low',
      targetVersion: null,
    };
  }

  if (current.sampleCount < minSamples) {
    return {
      action: 'observe',
      reasons: [`样本不足（${current.sampleCount}/${minSamples}）`],
      severity,
      confidence: 'low',
      targetVersion: input.targetVersion,
    };
  }

  const severeRegression = severity === 'high' || severity === 'critical';
  const failingStreak = current.consecutiveFailures >= policy.maxFailuresStreak;

  if (!severeRegression && !failingStreak) {
    return {
      action: 'observe',
      reasons: ['未检测到明确退化（需要 high/critical 或连续失败）'],
      severity,
      confidence: 'low',
      targetVersion: input.targetVersion,
    };
  }

  reasons.push(severeRegression ? `回归严重程度：${severity}` : '');
  reasons.push(failingStreak ? `连续失败 ${current.consecutiveFailures} 次` : '');
  const confidence: RollbackDecision['confidence'] =
    severeRegression && failingStreak ? 'high' : 'medium';

  // 冷却：最近一次回滚在冷却窗口内
  if (input.lastRollbackAt) {
    const elapsed = now - new Date(input.lastRollbackAt).getTime();
    if (elapsed < policy.cooldownMinutes * 60_000) {
      return {
        action: 'blocked',
        reasons: [...reasons, `冷却期内（${Math.ceil((policy.cooldownMinutes * 60_000 - elapsed) / 60000)} 分钟）`],
        severity,
        confidence,
        targetVersion: input.targetVersion,
      };
    }
  }

  if (input.autoRollbacksInCooldown >= policy.maxAutoRollbacks) {
    return {
      action: 'manual_required',
      reasons: [...reasons, `自动回滚次数已达上限（${policy.maxAutoRollbacks}）`],
      severity,
      confidence,
      targetVersion: input.targetVersion,
    };
  }

  if (policy.dryRun) {
    return {
      action: 'dry_run',
      reasons: [...reasons, 'Dry Run 模式：仅记录，不切换版本'],
      severity,
      confidence,
      targetVersion: input.targetVersion,
    };
  }

  if (policy.mode === 'manual') {
    return {
      action: 'manual_required',
      reasons: [...reasons, '人工审批模式'],
      severity,
      confidence,
      targetVersion: input.targetVersion,
    };
  }

  return {
    action: 'auto_apply',
    reasons,
    severity,
    confidence,
    targetVersion: input.targetVersion,
  };
}
