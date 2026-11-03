import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * 真实 PostgreSQL 集成测试（默认跳过，需显式提供 TEST_DATABASE_URL）。
 *
 * 覆盖单元测试无法证明的部分：
 *   - loomflow_claim_flow_jobs 的 SKIP LOCKED 语义：两个并发 Worker 不会拿到同一任务
 *   - 租约过期回收：running 且 lease 过期 → retrying / dead_letter
 *
 * 运行方式（需先对目标库执行 scripts/supabase-updates.sql）：
 *   TEST_DATABASE_URL=postgres://postgres:pass@127.0.0.1:5432/loomflow pnpm test
 *
 * 为什么默认跳过：CI 与本地开发不一定有可写数据库；
 * 用 Mock 冒充「并发领取不重复」会产生虚假的安全感（SKIP LOCKED 行为由数据库保证）。
 */

const connectionString = process.env.TEST_DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

describeIfDb('flow_jobs 原子领取（真实 PostgreSQL）', () => {
  const workflowId = randomUUID();
  let clientA: Client;
  let clientB: Client;

  beforeAll(async () => {
    clientA = new Client({ connectionString });
    clientB = new Client({ connectionString });
    await clientA.connect();
    await clientB.connect();

    await clientA.query(
      `INSERT INTO workflow_history (id, title, data, saved) VALUES ($1, $2, $3::jsonb, false)`,
      [workflowId, 'integration-test', JSON.stringify({ nodes: [], edges: [] })],
    );
  });

  afterAll(async () => {
    await clientA?.query('DELETE FROM flow_jobs WHERE workflow_id = $1', [workflowId]);
    await clientA?.query('DELETE FROM workflow_history WHERE id = $1', [workflowId]);
    await clientA?.end();
    await clientB?.end();
  });

  async function seedJobs(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const { rows } = await clientA.query(
        `INSERT INTO flow_jobs (workflow_id, status, inputs)
         VALUES ($1, 'queued', '{}'::jsonb) RETURNING id`,
        [workflowId],
      );
      ids.push(rows[0].id);
    }
    return ids;
  }

  it('两个 Worker 并发领取不会重复', async () => {
    const seeded = await seedJobs(5);

    const [a, b] = await Promise.all([
      clientA.query('SELECT * FROM loomflow_claim_flow_jobs($1, $2, $3)', ['worker-a', 3, 60]),
      clientB.query('SELECT * FROM loomflow_claim_flow_jobs($1, $2, $3)', ['worker-b', 3, 60]),
    ]);

    const idsA = a.rows.map((r) => r.id);
    const idsB = b.rows.map((r) => r.id);

    expect(idsA.length + idsB.length).toBe(5);
    expect(new Set([...idsA, ...idsB]).size).toBe(5);
    expect(idsA.filter((id) => idsB.includes(id))).toHaveLength(0);
    expect(idsA.length).toBeLessThanOrEqual(3);
    expect(new Set(seeded)).toEqual(new Set([...idsA, ...idsB]));
  });

  it('租约过期后任务被回收为 retrying', async () => {
    const [jobId] = await seedJobs(1);
    await clientA.query('SELECT * FROM loomflow_claim_flow_jobs($1, $2, $3)', ['worker-a', 1, 10]);
    await clientA.query(
      `UPDATE flow_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [jobId],
    );

    const { rows } = await clientA.query('SELECT * FROM loomflow_reap_expired_flow_jobs(300)');
    expect(rows.map((r) => r.job_id)).toContain(jobId);
    expect(rows.find((r) => r.job_id === jobId)?.new_status).toBe('retrying');

    const { rows: after } = await clientA.query('SELECT status FROM flow_jobs WHERE id = $1', [jobId]);
    expect(after[0].status).toBe('retrying');
  });

  it('租约过期且次数耗尽进入死信', async () => {
    const [jobId] = await seedJobs(1);
    await clientA.query(`UPDATE flow_jobs SET max_attempts = 1 WHERE id = $1`, [jobId]);
    await clientA.query('SELECT * FROM loomflow_claim_flow_jobs($1, $2, $3)', ['worker-a', 1, 10]);
    await clientA.query(
      `UPDATE flow_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [jobId],
    );

    await clientA.query('SELECT * FROM loomflow_reap_expired_flow_jobs(300)');

    const { rows } = await clientA.query('SELECT status FROM flow_jobs WHERE id = $1', [jobId]);
    expect(rows[0].status).toBe('dead_letter');
  });

  it('同一工作流下的幂等键不会创建重复任务', async () => {
    const key = `idem-${randomUUID()}`;
    const first = await clientA.query(
      `INSERT INTO flow_jobs (workflow_id, status, idempotency_key) VALUES ($1,'queued',$2) RETURNING id`,
      [workflowId, key],
    );

    await expect(
      clientA.query(
        `INSERT INTO flow_jobs (workflow_id, status, idempotency_key) VALUES ($1,'queued',$2)`,
        [workflowId, key],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const { rows } = await clientA.query(
      `SELECT count(*)::int AS n FROM flow_jobs WHERE workflow_id = $1 AND idempotency_key = $2`,
      [workflowId, key],
    );
    expect(rows[0].n).toBe(1);
    expect(first.rows[0].id).toBeTruthy();
  });
});
