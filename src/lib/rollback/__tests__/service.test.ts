import { describe, it, expect, vi } from 'vitest';
import type { RunRecordLike } from '@/lib/workflow-eval/metrics';
import { evaluateRollback } from '../service';
import type { RollbackStore, StoredRollback } from '../store';
import type { RollbackPolicy } from '../decision';

function runs(count: number, status: 'completed' | 'failed'): RunRecordLike[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `run-${status}-${index}`,
    status,
    duration_ms: status === 'completed' ? 800 : 4000,
    created_at: new Date(Date.now() - index * 1000).toISOString(),
    cost: status === 'completed' ? 0.01 : 0.05,
    retry_count: 0,
    token_usage: { totalTokens: 100 },
  }));
}

class FakeStore implements RollbackStore {
  policy: RollbackPolicy = {
    workflowId: 'wf-1',
    enabled: true,
    mode: 'auto',
    dryRun: false,
    minSamples: 10,
    cooldownMinutes: 60,
    maxAutoRollbacks: 3,
    maxFailuresStreak: 3,
  };

  workflow: { published: boolean; publishedVersion: number | null } | null = {
    published: true,
    publishedVersion: 2,
  };
  data: RunRecordLike[] = [...runs(20, 'failed'), ...runs(20, 'completed')];
  previousVersion: number | null = 1;
  lastApplied: StoredRollback | null = null;
  autoCount = 0;
  applied: Array<{ toVersion: number; expectedVersion: number | null }> = [];
  failed: Array<{ id: string; error: string }> = [];
  inserted: Array<{ id: string; status: string; idempotencyKey: string }> = [];
  duplicate = false;

  async getPolicy() {
    return this.policy;
  }
  async getWorkflow() {
    return this.workflow;
  }
  async listRuns() {
    return this.data;
  }
  async getPreviousVersion() {
    return this.previousVersion;
  }
  async getLastApplied() {
    return this.lastApplied;
  }
  async countAutoSince() {
    return this.autoCount;
  }
  async insertRollback(input: { status: 'requested' | 'dry_run'; idempotencyKey: string }) {
    const id = `rb-${this.inserted.length + 1}`;
    this.inserted.push({ id, status: input.status, idempotencyKey: input.idempotencyKey });
    return { id, duplicate: this.duplicate };
  }
  async applyRollback(input: { toVersion: number; expectedVersion: number | null }) {
    this.applied.push(input);
    this.workflow = { published: true, publishedVersion: input.toVersion };
    return { previousVersion: 2, publishedVersion: input.toVersion };
  }
  async markFailed(id: string, error: string) {
    this.failed.push({ id, error });
  }
  async markDryRun() {}
  async listHistory() {
    return [];
  }
}

describe('回滚服务', () => {
  it('严重退化 + auto 模式 → 执行并验证发布版本', async () => {
    const store = new FakeStore();
    const result = await evaluateRollback(
      { workflowId: 'wf-1', execute: true },
      { store },
    );

    expect(result.decision.action).toBe('auto_apply');
    expect(result.executed).toBe(true);
    expect(result.rollback).toMatchObject({ toVersion: 1, verified: true });
    expect(store.applied).toHaveLength(1);
    expect(store.inserted[0].status).toBe('requested');
  });

  it('样本不足时不执行（即使全部失败）', async () => {
    const store = new FakeStore();
    store.policy.minSamples = 50;
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.decision.action).toBe('observe');
    expect(result.executed).toBe(false);
    expect(store.applied).toHaveLength(0);
  });

  it('指标正常时不执行', async () => {
    const store = new FakeStore();
    store.data = [...runs(20, 'completed'), ...runs(20, 'completed')];
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.decision.action).toBe('observe');
    expect(store.applied).toHaveLength(0);
  });

  it('manual 模式未审批时不执行', async () => {
    const store = new FakeStore();
    store.policy.mode = 'manual';
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.decision.action).toBe('manual_required');
    expect(result.executed).toBe(false);
    expect(store.applied).toHaveLength(0);
  });

  it('manual 模式显式审批后执行', async () => {
    const store = new FakeStore();
    store.policy.mode = 'manual';
    const result = await evaluateRollback(
      { workflowId: 'wf-1', execute: true, approved: true, actorId: 'user-1' },
      { store },
    );

    expect(result.decision.action).toBe('manual_required');
    expect(result.executed).toBe(true);
    expect(result.rollback?.verified).toBe(true);
  });

  it('Dry Run 只记录不切换版本', async () => {
    const store = new FakeStore();
    store.policy.dryRun = true;
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.decision.action).toBe('dry_run');
    expect(result.executed).toBe(false);
    expect(store.applied).toHaveLength(0);
    expect(store.inserted[0].status).toBe('dry_run');
  });

  it('重复事件不会重复执行', async () => {
    const store = new FakeStore();
    store.duplicate = true;
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.executed).toBe(false);
    expect(store.applied).toHaveLength(0);
    expect(result.rollback?.verified).toBe(true);
  });

  it('版本冲突时记录失败并返回错误', async () => {
    const store = new FakeStore();
    store.applyRollback = async () => {
      throw new Error('回滚失败：version_conflict');
    };

    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.executed).toBe(false);
    expect(result.error).toContain('version_conflict');
    expect(store.failed).toHaveLength(1);
  });

  it('未发布工作流直接观察', async () => {
    const store = new FakeStore();
    store.workflow = { published: false, publishedVersion: null };
    const result = await evaluateRollback({ workflowId: 'wf-1', execute: true }, { store });

    expect(result.decision.action).toBe('observe');
    expect(result.executed).toBe(false);
  });

  it('工作流不存在时抛错', async () => {
    const store = new FakeStore();
    store.getWorkflow = async () => null;
    await expect(evaluateRollback({ workflowId: 'missing' }, { store })).rejects.toThrow(
      '工作流不存在',
    );
  });
});
