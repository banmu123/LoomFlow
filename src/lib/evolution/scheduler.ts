/**
 * Evolution Engine — Scheduler
 *
 * 定时扫描 evolution_rules，对每条启用的规则：
 *   1. Rule Evaluator → 是否应触发
 *   2. Trigger Detector → 条件是否满足
 *   3. Orchestrator → 写事件 + 调用 optimize 管线
 *
 * 按 workflow 分组串行执行，避免并发冲突。
 * 30 分钟扫描间隔（与现有 scheduler 的 10 分钟同步错开）。
 */

import { supabase } from '@/lib/supabase/server';
import { evaluateRule } from './rule-evaluator';
import { detectCron, detectMetric, detectEvent } from './trigger-detector';
import { runOptimizationPipeline, updateEventStatus } from './orchestrator';
import type { EvolutionRule, DetectionResult } from './types';

// ===== Scheduler Loop =====

let scanInterval: ReturnType<typeof setInterval> | null = null;

/** 启动演化调度器（在 server.ts 中调用） */
export function initEvolutionScheduler(): void {
  if (scanInterval) return;
  scanInterval = setInterval(() => {
    scanAllRules().catch(() => {});
  }, 30 * 60 * 1000);
  // 启动时延迟 30s 执行首次扫描（等 DB 连接就绪）
  setTimeout(() => {
    scanAllRules().catch(() => {});
  }, 30_000);
}

/** 停止调度器（测试用） */
export function stopEvolutionScheduler(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

// ===== Scan Logic =====

/** 扫描所有启用的规则 */
export async function scanAllRules(): Promise<void> {
  const { data: rules } = await supabase
    .from('evolution_rules')
    .select('*')
    .eq('enabled', true);

  if (!rules?.length) return;

  // 按 workflow 分组，同一工作流的规则串行执行
  const byWorkflow = new Map<string, EvolutionRule[]>();
  for (const r of rules) {
    const rule = r as EvolutionRule;
    const arr = byWorkflow.get(rule.workflow_id) ?? [];
    arr.push(rule);
    byWorkflow.set(rule.workflow_id, arr);
  }

  for (const [, wfRules] of byWorkflow) {
    for (const rule of wfRules) {
      await processRule(rule).catch(() => {});
    }
  }
}

/** 处理单条规则：evaluate → detect → orchestrate */
async function processRule(rule: EvolutionRule): Promise<void> {
  // Step 1: Rule Evaluator
  const evalResult = await evaluateRule(rule);
  if (!evalResult.shouldTrigger) {
    // 记录阻止事件（非 cooldown 和 duplicate_proposal 只跳过不记录）
    return;
  }

  // Step 2: Trigger Detector
  let detection: DetectionResult;
  switch (rule.trigger_type) {
    case 'cron':
      detection = detectCron(rule);
      break;
    case 'metric':
      detection = await detectMetric(rule);
      break;
    case 'event':
      detection = await detectEvent(rule);
      break;
    default:
      return;
  }

  if (!detection.triggered) {
    return;
  }

  // Step 3: 更新冷却时间
  await supabase
    .from('evolution_rules')
    .update({ last_triggered_at: new Date().toISOString() })
    .eq('id', rule.id);

  // Step 4: Orchestrator（写事件 → 调 optimize → 写 proposal）
  await runOptimizationPipeline(rule, detection);
}
