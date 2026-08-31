/**
 * Quality Gate — Evaluator
 *
 * 纯确定性决策：Policy + Evidence → Gate Result。
 * AI 不参与 ALLOW / WARNING / BLOCK 判定。
 *
 * 复用：
 *   - tinyflow/schema.ts (validateWorkflow)
 *   - workflow-eval/static-analysis.ts (analyzeWorkflow)
 *   - workflow-copilot/test-case.ts (runTestCase)
 *   - workflow-eval/regression.ts (detectRegression)
 *   - workflow-eval/regression-policy.ts (MetricSnapshot)
 *
 * 不修改上述模块。
 */

import { supabase } from '@/lib/supabase/server';
import { computeHash } from '@/lib/workflow-hash';
import type { TinyflowData } from '@/lib/tinyflow/types';
import type { RegressionReport } from '@/lib/workflow-eval/regression';
import type { MetricSnapshot } from '@/lib/workflow-eval/regression-policy';
import type { WorkflowTestCase } from '@/lib/workflow-copilot/test-case';
import type { QualityGatePolicy, GateCheckStatus, GateLevel, GateDecision } from './policy';
import { DEFAULT_POLICY, GATE_EVALUATION_TTL_MS } from './policy';
import { checkSchema } from './checks/schema';
import { checkStaticAnalysis } from './checks/static';
import { checkTests } from './checks/tests';
import { checkRegression } from './checks/regression';
import { checkCost } from './checks/cost';
import { checkSecurity } from './checks/security';

// ===== Types =====

export interface GateCheckResult {
  name: string;
  level: GateLevel;
  status: GateCheckStatus;
  message: string;
  details?: unknown;
  durationMs: number;
}

export interface QualityGateReport {
  gateEvaluationId: string;
  workflowId: string;
  candidateVersion: number;
  dataHash: string;
  decision: GateDecision;
  checks: GateCheckResult[];
  blockingReasons: string[];
  warnings: string[];
  summary: string;
  policy: QualityGatePolicy;
  evaluatedAt: string;
  durationMs: number;
}

export interface GateEvaluationRequest {
  workflowId: string;
  candidateVersion: number;
  dataHash: string;
}

export interface GateEvaluationRecord {
  id: string;
  workflow_id: string;
  candidate_version: number;
  data_hash: string;
  decision: string;
  report: QualityGateReport;
  policy_snapshot: QualityGatePolicy;
  created_by: string;
  created_at: string;
  expires_at: string;
}

// ===== Evaluator =====

/**
 * 执行 Quality Gate 检查。纯确定性。
 */
export async function evaluateQualityGate(
  request: GateEvaluationRequest,
  workflowData: TinyflowData,
  userId: string,
  options: {
    policy?: QualityGatePolicy;
    regressionReport?: RegressionReport | null;
    baselineMetrics?: MetricSnapshot | null;
    testCases?: WorkflowTestCase[];
  } = {},
): Promise<QualityGateReport> {
  const policy = options.policy ?? DEFAULT_POLICY;
  const start = Date.now();
  const checks: GateCheckResult[] = [];

  // 1. Schema (required, 固定)
  if (policy.schema.enabled) {
    checks.push(checkSchema(workflowData));
  }

  // 2. Security (required, 固定)
  if (policy.security.enabled) {
    checks.push(checkSecurity(workflowData));
  }

  // 3. Static Analysis (required)
  if (policy.staticAnalysis.enabled) {
    checks.push(checkStaticAnalysis(workflowData, policy.staticAnalysis.maxErrors));
  }

  // 4. Tests (required)
  if (policy.tests.enabled) {
    const testResult = await checkTests(
      workflowData,
      options.testCases ?? [],
      { minPassRate: policy.tests.minPassRate, requireAtLeastOne: policy.tests.requireAtLeastOne },
    );
    checks.push(testResult);
  }

  // 5. Regression (advisory)
  if (policy.regression.enabled) {
    checks.push(checkRegression(options.regressionReport ?? null, { blockOnCritical: policy.regression.blockOnCritical }));
  }

  // 6. Cost (advisory)
  if (policy.cost.enabled) {
    const candidateMetrics: MetricSnapshot = options.regressionReport?.candidate.metrics
      ?? { successRate: 100, failureRate: 0, p95Latency: 0, costPerRun: 0, testScore: 100 };
    checks.push(checkCost(candidateMetrics, options.baselineMetrics, policy.cost.maxCostPerRun));
  }

  // 7. 聚合决策
  const { decision, blockingReasons, warnings } = aggregateDecision(checks);
  const durationMs = Date.now() - start;

  const report: QualityGateReport = {
    gateEvaluationId: '', // 由持久化层填充
    workflowId: request.workflowId,
    candidateVersion: request.candidateVersion,
    dataHash: request.dataHash,
    decision,
    checks,
    blockingReasons,
    warnings,
    summary: buildSummary(decision, blockingReasons, warnings),
    policy,
    evaluatedAt: new Date().toISOString(),
    durationMs,
  };

  return report;
}

// ===== Decision Aggregation =====

function aggregateDecision(checks: GateCheckResult[]): {
  decision: GateDecision;
  blockingReasons: string[];
  warnings: string[];
} {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  for (const check of checks) {
    if (check.status === 'fail' && check.level === 'required') {
      blockingReasons.push(check.message);
    } else if (check.status === 'fail' && check.level === 'advisory') {
      warnings.push(check.message);
    } else if (check.status === 'warn') {
      warnings.push(check.message);
    }
    // pass / skip → 不影响决策
  }

  let decision: GateDecision = 'allow';
  if (warnings.length > 0) decision = 'warning';
  if (blockingReasons.length > 0) decision = 'block';

  return { decision, blockingReasons, warnings };
}

function buildSummary(decision: GateDecision, blockingReasons: string[], warnings: string[]): string {
  switch (decision) {
    case 'allow':
      return '所有检查通过，允许发布。';
    case 'warning':
      return `发现 ${warnings.length} 个警告，建议关注后确认发布。`;
    case 'block':
      return `发布被阻止：${blockingReasons.join('；')}`;
  }
}

// ===== Persistence =====

/**
 * 持久化 Quality Gate Evaluation。
 * 返回带 gateEvaluationId 的完整 report。
 */
export async function saveGateEvaluation(
  report: QualityGateReport,
  userId: string,
): Promise<QualityGateReport> {
  const expiresAt = new Date(Date.now() + GATE_EVALUATION_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from('quality_gate_evaluations')
    .insert({
      workflow_id: report.workflowId,
      candidate_version: report.candidateVersion,
      data_hash: report.dataHash,
      decision: report.decision,
      report,
      policy_snapshot: report.policy,
      created_by: userId,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`保存 Gate Evaluation 失败: ${error?.message ?? 'unknown'}`);
  }

  return { ...report, gateEvaluationId: data.id as string };
}

/**
 * 读取并校验 Gate Evaluation。
 * 校验：存在、未过期、created_by、workflowId、version、dataHash。
 */
export async function loadAndValidateGateEvaluation(
  gateEvaluationId: string,
  userId: string,
  workflowId: string,
  candidateVersion: number,
  dataHash: string,
): Promise<{ valid: boolean; report?: QualityGateReport; error?: string }> {
  const { data } = await supabase
    .from('quality_gate_evaluations')
    .select('*')
    .eq('id', gateEvaluationId)
    .maybeSingle();

  if (!data) return { valid: false, error: 'Gate Evaluation 不存在' };

  const record = data as unknown as GateEvaluationRecord;

  // 过期检查
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { valid: false, error: 'Gate Evaluation 已过期，请重新执行 Quality Gate' };
  }

  // 用户绑定
  if (record.created_by !== userId) {
    return { valid: false, error: 'Gate Evaluation 不属于当前用户' };
  }

  // 版本绑定
  if (record.workflow_id !== workflowId) {
    return { valid: false, error: 'Gate Evaluation 与工作流不匹配' };
  }
  if (record.candidate_version !== candidateVersion) {
    return { valid: false, error: 'Gate Evaluation 与版本不匹配' };
  }
  if (record.data_hash !== dataHash) {
    return { valid: false, error: '版本数据已变更，请重新执行 Quality Gate' };
  }

  // 决策检查
  if (record.decision === 'block') {
    return { valid: false, error: 'Quality Gate 阻止了发布', report: record.report };
  }

  return { valid: true, report: record.report };
}

// ===== TOCTOU =====

/**
 * 发布前 TOCTOU 校验：重新读取版本 dataHash，确认未变化。
 */
export async function verifyVersionDataHash(
  workflowId: string,
  candidateVersion: number,
  expectedDataHash: string,
): Promise<{ consistent: boolean; currentHash?: string }> {
  const { data } = await supabase
    .from('workflow_versions')
    .select('data')
    .eq('workflow_id', workflowId)
    .eq('version', candidateVersion)
    .maybeSingle();

  if (!data) return { consistent: false };

  const currentHash = computeHash((data as { data: unknown }).data);
  return { consistent: currentHash === expectedDataHash, currentHash };
}
