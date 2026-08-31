import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase for persistence tests
const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/lib/workflow-hash', () => ({ computeHash: () => 'test-hash-abc' }));

import { evaluateQualityGate, saveGateEvaluation, loadAndValidateGateEvaluation } from '../evaluator';
import { DEFAULT_POLICY } from '../policy';
import { checkSchema } from '../checks/schema';
import { checkSecurity } from '../checks/security';
import { checkCost } from '../checks/cost';
import { checkRegression } from '../checks/regression';
import type { TinyflowData } from '@/lib/tinyflow/types';
import type { MetricSnapshot } from '@/lib/workflow-eval/regression-policy';
import type { RegressionReport } from '@/lib/workflow-eval/regression';

// ===== Helpers =====

const BASE_DATA = { description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false };

function makeNode(id: string, type: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, data: { title, ...BASE_DATA, ...extra } };
}

function makeWorkflow(overrides: Partial<TinyflowData> = {}): TinyflowData {
  return {
    nodes: [
      makeNode('start', 'startNode', 'Start'),
      makeNode('end', 'endNode', 'End'),
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

function makeChain(result: { data?: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'maybeSingle', 'single', 'insert'].forEach((k) => { obj[k] = vi.fn(() => obj); });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  return obj;
}

beforeEach(() => {
  mocks.from.mockClear();
});

// ===== Schema Check =====

describe('checkSchema', () => {
  it('passes for valid workflow', () => {
    const result = checkSchema(makeWorkflow());
    expect(result.status).toBe('pass');
    expect(result.name).toBe('schema');
  });

  it('fails for invalid workflow', () => {
    const result = checkSchema({ nodes: 'not-an-array' });
    expect(result.status).toBe('fail');
    expect(result.level).toBe('required');
  });

  it('fails for missing start node', () => {
    const result = checkSchema({
      nodes: [{ id: 'end', type: 'endNode', data: { title: 'End' } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.status).toBe('fail');
  });
});

// ===== Security Check =====

describe('checkSecurity', () => {
  it('passes for clean workflow', () => {
    const result = checkSecurity(makeWorkflow());
    expect(result.status).toBe('pass');
  });

  it('fails when API key found in node config', () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode('start', 'startNode', 'Start'),
        makeNode('llm', 'llmNode', 'LLM', { apiKey: 'sk-abc123def456ghi789jkl012mno' }),
        makeNode('end', 'endNode', 'End'),
      ],
    });
    const result = checkSecurity(wf);
    expect(result.status).toBe('fail');
    expect(result.level).toBe('required');
    expect(result.message).toContain('密钥');
  });

  it('passes when no secrets found', () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode('start', 'startNode', 'Start'),
        makeNode('llm', 'llmNode', 'LLM', { prompt: 'Hello world' }),
        makeNode('end', 'endNode', 'End'),
      ],
    });
    const result = checkSecurity(wf);
    expect(result.status).toBe('pass');
  });
});

// ===== Cost Check =====

describe('checkCost', () => {
  const metrics: MetricSnapshot = { successRate: 95, failureRate: 5, p95Latency: 3000, costPerRun: 0.003, testScore: 85 };

  it('passes when cost within threshold', () => {
    const result = checkCost(metrics, null, 0.05);
    expect(result.status).toBe('pass');
  });

  it('warns when cost exceeds threshold', () => {
    const result = checkCost(metrics, null, 0.001);
    expect(result.status).toBe('warn');
    expect(result.level).toBe('advisory');
  });

  it('skips when cost unavailable (0/0)', () => {
    const zero: MetricSnapshot = { successRate: 100, failureRate: 0, p95Latency: 0, costPerRun: 0, testScore: 100 };
    const result = checkCost(zero, zero);
    expect(result.status).toBe('skip');
  });
});

// ===== Regression Check =====

describe('checkRegression', () => {
  it('skips when no report', () => {
    const result = checkRegression(null);
    expect(result.status).toBe('skip');
  });

  it('warns on regressed report', () => {
    const report = { status: 'regressed', overallSeverity: 'high', summary: 'P95 latency +37%' } as RegressionReport;
    const result = checkRegression(report);
    expect(result.status).toBe('warn');
    expect(result.level).toBe('advisory');
  });

  it('fails on critical regression when blockOnCritical=true', () => {
    const report = { status: 'regressed', overallSeverity: 'critical', summary: 'Critical regression' } as RegressionReport;
    const result = checkRegression(report, { blockOnCritical: true });
    expect(result.status).toBe('fail');
  });

  it('passes on stable report', () => {
    const report = { status: 'stable', overallSeverity: 'info', summary: 'All stable' } as RegressionReport;
    const result = checkRegression(report);
    expect(result.status).toBe('pass');
  });
});

// ===== Evaluator Integration =====

describe('evaluateQualityGate', () => {
  it('ALLOW when all checks pass', async () => {
    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      makeWorkflow(),
      'u1',
      { testCases: [] },
    );
    expect(report.decision).toBe('allow');
    expect(report.checks.every((c) => c.status === 'pass' || c.status === 'skip')).toBe(true);
  });

  it('BLOCK when schema invalid', async () => {
    // Missing end node → schema fail
    const wf = {
      nodes: [makeNode('start', 'startNode', 'Start')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as TinyflowData;
    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      wf,
      'u1',
    );
    expect(report.decision).toBe('block');
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });

  it('BLOCK when security check fails', async () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode('start', 'startNode', 'Start'),
        makeNode('llm', 'llmNode', 'LLM', { key: 'sk-abc123def456ghi789jkl012mno' }),
        makeNode('end', 'endNode', 'End'),
      ],
    });
    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      wf,
      'u1',
    );
    expect(report.decision).toBe('block');
  });

  it('WARNING when regression detected', async () => {
    const regressionReport = {
      workflowId: 'w1',
      status: 'regressed',
      overallSeverity: 'high',
      summary: 'P95 latency +37%',
      metrics: [],
      baseline: { type: 'rolling', sampleCount: 50, metrics: { successRate: 95, failureRate: 5, p95Latency: 3000, costPerRun: 0.003, testScore: 85 } },
      candidate: { sampleCount: 30, metrics: { successRate: 95, failureRate: 5, p95Latency: 4110, costPerRun: 0.003, testScore: 85 } },
      affectedNodes: [],
      generatedAt: new Date().toISOString(),
    } as unknown as RegressionReport;

    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      makeWorkflow(),
      'u1',
      { regressionReport },
    );
    expect(report.decision).toBe('warning');
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('includes policy snapshot in report', async () => {
    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      makeWorkflow(),
      'u1',
    );
    expect(report.policy).toEqual(DEFAULT_POLICY);
  });

  it('BLOCK takes precedence over WARNING', async () => {
    const wf = makeWorkflow({
      nodes: [
        makeNode('start', 'startNode', 'Start'),
        makeNode('llm', 'llmNode', 'LLM', { key: 'sk-abc123def456ghi789jkl012mno' }),
        makeNode('end', 'endNode', 'End'),
      ],
    });
    const regressionReport = {
      workflowId: 'w1',
      status: 'regressed', overallSeverity: 'high', summary: 'regression',
      metrics: [], baseline: { type: 'rolling', sampleCount: 50, metrics: { successRate: 95, failureRate: 5, p95Latency: 3000, costPerRun: 0.003, testScore: 85 } },
      candidate: { sampleCount: 30, metrics: { successRate: 95, failureRate: 5, p95Latency: 4110, costPerRun: 0.003, testScore: 85 } }, affectedNodes: [], generatedAt: '',
    } as unknown as RegressionReport;

    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      wf,
      'u1',
      { regressionReport },
    );
    expect(report.decision).toBe('block');
    expect(report.blockingReasons.length).toBeGreaterThan(0);
  });
});

// ===== Persistence =====

describe('saveGateEvaluation', () => {
  it('persists and returns gateEvaluationId', async () => {
    mocks.from.mockReturnValue(makeChain({ data: { id: 'gate-123' } }));
    const report = await evaluateQualityGate(
      { workflowId: 'w1', candidateVersion: 1, dataHash: 'h1' },
      makeWorkflow(),
      'u1',
      { testCases: [] },
    );
    const saved = await saveGateEvaluation(report, 'u1');
    expect(saved.gateEvaluationId).toBe('gate-123');
  });
});

// ===== Load and Validate =====

describe('loadAndValidateGateEvaluation', () => {
  it('returns invalid when not found', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('returns invalid when expired', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 1,
        data_hash: 'h1',
        decision: 'allow',
        created_by: 'u1',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        report: {},
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('过期');
  });

  it('returns invalid when wrong user', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 1,
        data_hash: 'h1',
        decision: 'allow',
        created_by: 'other-user',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        report: {},
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('用户');
  });

  it('returns invalid when version mismatch', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 2,
        data_hash: 'h1',
        decision: 'allow',
        created_by: 'u1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        report: {},
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('版本');
  });

  it('returns invalid when dataHash mismatch', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 1,
        data_hash: 'different-hash',
        decision: 'allow',
        created_by: 'u1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        report: {},
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('变更');
  });

  it('returns invalid when decision is block', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 1,
        data_hash: 'h1',
        decision: 'block',
        created_by: 'u1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        report: {},
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('阻止');
  });

  it('returns valid when all checks pass', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: {
        id: 'gate-1',
        workflow_id: 'w1',
        candidate_version: 1,
        data_hash: 'h1',
        decision: 'warning',
        created_by: 'u1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        report: { decision: 'warning' },
        policy_snapshot: DEFAULT_POLICY,
      },
    }));
    const result = await loadAndValidateGateEvaluation('gate-1', 'u1', 'w1', 1, 'h1');
    expect(result.valid).toBe(true);
    expect(result.report).toBeDefined();
  });
});
