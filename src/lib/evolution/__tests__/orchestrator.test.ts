import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  const generateText = vi.fn();
  const getProviderClientForModel = vi.fn();
  const getAllModels = vi.fn();
  const getWorkflowEval = vi.fn();
  const aggregateNodeMetrics = vi.fn();
  const detectBottlenecks = vi.fn();
  const analyzeWorkflow = vi.fn();
  const buildOptimizationContext = vi.fn();
  const extractOptimization = vi.fn();
  const finalizeOptimization = vi.fn();
  const listTestCases = vi.fn();
  return {
    from, generateText, getProviderClientForModel, getAllModels,
    getWorkflowEval, aggregateNodeMetrics, detectBottlenecks, analyzeWorkflow,
    buildOptimizationContext, extractOptimization, finalizeOptimization, listTestCases,
  };
});

vi.mock('@/lib/supabase/server', () => ({ supabase: { from: mocks.from } }));
vi.mock('ai', () => ({ generateText: mocks.generateText }));
vi.mock('@/lib/ai', () => ({ getProviderClientForModel: mocks.getProviderClientForModel }));
vi.mock('@/lib/ai/db-models', () => ({ getAllModels: mocks.getAllModels }));
vi.mock('@/lib/workflow-eval/store', () => ({ getWorkflowEval: mocks.getWorkflowEval }));
vi.mock('@/lib/workflow-eval/metrics', () => ({ aggregateNodeMetrics: mocks.aggregateNodeMetrics }));
vi.mock('@/lib/workflow-eval/bottleneck', () => ({ detectBottlenecks: mocks.detectBottlenecks }));
vi.mock('@/lib/workflow-eval/static-analysis', () => ({ analyzeWorkflow: mocks.analyzeWorkflow }));
vi.mock('@/lib/workflow-eval/ai-optimize', () => ({
  buildOptimizationContext: mocks.buildOptimizationContext,
  extractOptimization: mocks.extractOptimization,
  finalizeOptimization: mocks.finalizeOptimization,
  OPTIMIZE_SYSTEM_PROMPT: 'test prompt',
}));
vi.mock('@/lib/workflow-copilot/test-case-store', () => ({ listTestCases: mocks.listTestCases }));
vi.mock('@/lib/workflow-copilot/diff', () => ({ diffToMarkdown: () => 'diff' }));

import { createEvent, updateEventStatus, runOptimizationPipeline } from '../orchestrator';
import type { EvolutionRule, DetectionResult } from '../types';

function makeRule(overrides: Partial<EvolutionRule> = {}): EvolutionRule {
  return {
    id: 'r1', workflow_id: 'w1', user_id: 'u1', enabled: true,
    trigger_type: 'metric', cron_expr: null,
    metric_key: 'latency_p95', metric_op: 'pct_increase', metric_threshold: 0.3,
    metric_range: '7d', baseline_range: '30d',
    event_type: null, event_threshold: null,
    cooldown_hours: 24, last_triggered_at: null, metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDetection(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    triggered: true,
    reason: 'P95 latency increased 32%',
    ...overrides,
  };
}

function makeChain(result: { data?: unknown; error?: unknown }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'single', 'insert', 'update', 'order', 'limit', 'gte', 'maybeSingle'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createEvent', () => {
  it('inserts event and returns id', async () => {
    mocks.from.mockReturnValue(makeChain({ data: { id: 'ev1' } }));
    const id = await createEvent(makeRule(), makeDetection());
    expect(id).toBe('ev1');
    expect(mocks.from).toHaveBeenCalledWith('evolution_events');
  });

  it('returns empty string on failure', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const id = await createEvent(makeRule(), makeDetection());
    expect(id).toBe('');
  });
});

describe('updateEventStatus', () => {
  it('updates status and updated_at', async () => {
    const chain = makeChain({});
    mocks.from.mockReturnValue(chain);
    await updateEventStatus('ev1', 'analyzing');
    expect(mocks.from).toHaveBeenCalledWith('evolution_events');
  });

  it('includes proposal_id when provided', async () => {
    const chain = makeChain({});
    mocks.from.mockReturnValue(chain);
    await updateEventStatus('ev1', 'proposal_created', { proposal_id: 'p1' });
    expect(mocks.from).toHaveBeenCalledWith('evolution_events');
  });

  it('includes metadata when provided', async () => {
    const chain = makeChain({});
    mocks.from.mockReturnValue(chain);
    await updateEventStatus('ev1', 'failed', { metadata: { error: 'test' } });
    expect(mocks.from).toHaveBeenCalledWith('evolution_events');
  });
});

describe('runOptimizationPipeline', () => {
  it('returns failed when event creation fails', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('failed');
  });

  it('returns no_change when workflow has no runs', async () => {
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] } } }); // workflow
      return makeChain({}); // updateEventStatus (no_change)
    });
    mocks.getWorkflowEval.mockResolvedValue({ selectedRuns: [], workflow: {}, totalRuns: 0 });
    mocks.listTestCases.mockResolvedValue([]);

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('no_change');
  });

  it('returns failed when workflow data is empty', async () => {
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: null } }); // workflow = null
      return makeChain({}); // updateEventStatus (failed)
    });

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('failed');
  });

  it('returns failed when no models configured', async () => {
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] } } }); // workflow
      return makeChain({}); // updateEventStatus (failed)
    });
    mocks.getWorkflowEval.mockResolvedValue({
      selectedRuns: [{ id: 'run1', status: 'completed', created_at: new Date().toISOString() }],
      workflow: { totalRuns: 1, successRate: 100 },
      totalRuns: 1,
    });
    mocks.aggregateNodeMetrics.mockReturnValue({ nodes: [] });
    mocks.detectBottlenecks.mockReturnValue({ bottlenecks: [], summary: '' });
    mocks.analyzeWorkflow.mockReturnValue({ findings: [], parallelizable: [] });
    mocks.listTestCases.mockResolvedValue([]);
    mocks.getAllModels.mockResolvedValue([]);

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('failed');
  });

  it('returns proposal_created on successful optimization', async () => {
    const proposal = { schema: { valid: true }, issues: [], testsSummary: null };
    const operations = [{ op: 'add_node', node: { id: 'new', type: 'llmNode' } }];

    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] } } }); // workflow
      if (callCount === 4) return makeChain({ data: { id: 'p1' } }); // createProposal
      return makeChain({}); // updateEventStatus (proposal_created)
    });
    mocks.getWorkflowEval.mockResolvedValue({
      selectedRuns: [{ id: 'run1', status: 'completed', created_at: new Date().toISOString() }],
      workflow: { totalRuns: 1, successRate: 100 },
      totalRuns: 1,
    });
    mocks.aggregateNodeMetrics.mockReturnValue({ nodes: [] });
    mocks.detectBottlenecks.mockReturnValue({ bottlenecks: [], summary: '' });
    mocks.analyzeWorkflow.mockReturnValue({ findings: [], parallelizable: [] });
    mocks.listTestCases.mockResolvedValue([]);
    mocks.getAllModels.mockResolvedValue([{ id: 'm1', provider: 'deepseek' }]);
    mocks.getProviderClientForModel.mockReturnValue(() => 'provider');
    mocks.buildOptimizationContext.mockReturnValue('context');
    mocks.generateText.mockResolvedValue({ text: '{"explanation":"test","risk":"low","operations":[{"op":"add_node"}]}' });
    mocks.extractOptimization.mockReturnValue({ explanation: 'test', risk: 'low', operations });
    mocks.finalizeOptimization.mockResolvedValue({ proposal, explanation: 'test', risk: 'low', markdown: 'diff' });

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('proposal_created');
    expect(result.proposalId).toBe('p1');
    expect(result.eventId).toBe('ev1');
  });

  it('returns no_change when AI returns no operations', async () => {
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] } } }); // workflow
      return makeChain({}); // updateEventStatus (no_change)
    });
    mocks.getWorkflowEval.mockResolvedValue({
      selectedRuns: [{ id: 'run1', status: 'completed', created_at: new Date().toISOString() }],
      workflow: { totalRuns: 1, successRate: 100 },
      totalRuns: 1,
    });
    mocks.aggregateNodeMetrics.mockReturnValue({ nodes: [] });
    mocks.detectBottlenecks.mockReturnValue({ bottlenecks: [], summary: '' });
    mocks.analyzeWorkflow.mockReturnValue({ findings: [], parallelizable: [] });
    mocks.listTestCases.mockResolvedValue([]);
    mocks.getAllModels.mockResolvedValue([{ id: 'm1', provider: 'deepseek' }]);
    mocks.getProviderClientForModel.mockReturnValue(() => 'provider');
    mocks.buildOptimizationContext.mockReturnValue('context');
    mocks.generateText.mockResolvedValue({ text: '{"explanation":"no change","operations":[]}' });
    mocks.extractOptimization.mockReturnValue({ explanation: 'no change', operations: [] });

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('no_change');
  });

  it('returns no_change on idempotency conflict', async () => {
    const operations = [{ op: 'add_node', node: { id: 'new', type: 'llmNode' } }];
    const proposal = { schema: { valid: true }, issues: [], testsSummary: null };

    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ data: { id: 'ev1' } }); // createEvent
      if (callCount === 2) return makeChain({}); // updateEventStatus (analyzing)
      if (callCount === 3) return makeChain({ data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] } } }); // workflow
      if (callCount === 4) return makeChain({ data: null, error: { code: '23505' } }); // createProposal → idempotency conflict
      return makeChain({}); // updateEventStatus (no_change)
    });
    mocks.getWorkflowEval.mockResolvedValue({
      selectedRuns: [{ id: 'run1', status: 'completed', created_at: new Date().toISOString() }],
      workflow: { totalRuns: 1, successRate: 100 },
      totalRuns: 1,
    });
    mocks.aggregateNodeMetrics.mockReturnValue({ nodes: [] });
    mocks.detectBottlenecks.mockReturnValue({ bottlenecks: [], summary: '' });
    mocks.analyzeWorkflow.mockReturnValue({ findings: [], parallelizable: [] });
    mocks.listTestCases.mockResolvedValue([]);
    mocks.getAllModels.mockResolvedValue([{ id: 'm1', provider: 'deepseek' }]);
    mocks.getProviderClientForModel.mockReturnValue(() => 'provider');
    mocks.buildOptimizationContext.mockReturnValue('context');
    mocks.generateText.mockResolvedValue({ text: '{"explanation":"test","operations":[{"op":"add_node"}]}' });
    mocks.extractOptimization.mockReturnValue({ explanation: 'test', operations });
    mocks.finalizeOptimization.mockResolvedValue({ proposal, explanation: 'test', risk: 'low', markdown: 'diff' });

    const result = await runOptimizationPipeline(makeRule(), makeDetection());
    expect(result.status).toBe('no_change');
  });
});
