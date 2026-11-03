import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 进程级沙箱测试（真实子进程，非 Mock）。
 *
 * 验证内容：
 *   - Node Permission Model 下 harness 可正常执行
 *   - vm 上下文没有 require / process
 *   - eval / Function 构造被禁用
 *   - 死循环被超时终止
 *
 * 不覆盖：容器边界（只读文件系统、网络隔离、cap_drop），
 * 那部分必须用 services/code-sandbox/security-test.sh 在真实 Docker 环境验证。
 */

const HARNESS = path.resolve(process.cwd(), 'services/code-sandbox/harness.js');

interface HarnessOutput {
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

function runHarness(payload: unknown): HarnessOutput {
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {};
  const result = spawnSync(
    process.execPath,
    ['--permission', `--allow-fs-read=${HARNESS}`, '--max-old-space-size=192', '--no-warnings', HARNESS],
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 15_000,
      // 与 runner 一致：不继承宿主环境变量（避免把进程环境带进沙箱）
      env: env as NodeJS.ProcessEnv,
    },
  );

  const stdout = (result.stdout || '').trim();
  expect(stdout, `stderr: ${result.stderr}`).not.toBe('');
  return JSON.parse(stdout) as HarnessOutput;
}

const run = (code: string, inputs: Record<string, unknown> = {}, timeoutMs = 2000) =>
  runHarness({ code, inputs, timeoutMs });

describe('沙箱 harness（进程级）', () => {
  it('执行用户代码并返回结果', () => {
    const out = run('return { sum: inputs.a + inputs.b };', { a: 20, b: 22 });
    expect(out).toEqual({ ok: true, result: { sum: 42 } });
  });

  it('无法访问 require（宿主模块）', () => {
    const out = run('return require("fs").readdirSync("/");');
    expect(out.ok).toBe(false);
    expect(out.error?.message).toContain('require is not defined');
  });

  it('无法访问 process 与宿主环境变量', () => {
    const out = run('return typeof process;');
    expect(out).toEqual({ ok: true, result: 'undefined' });
  });

  it('constructor 逃逸尝试被拒绝', () => {
    const out = run('const p = this.constructor.constructor("return process")(); return p.env;');
    expect(out.ok).toBe(false);
  });

  it('eval 被禁用（codeGeneration.strings=false）', () => {
    const out = run('return eval("1+1");');
    expect(out.ok).toBe(false);
    expect(out.error?.message).toMatch(/Code generation from strings/);
  });

  it('死循环被超时终止', () => {
    const out = run('while (true) {}', {}, 800);
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('timeout');
  }, 20_000);

  it('异步挂起（未 resolve 的 Promise）被超时终止', () => {
    const out = run('return new Promise(() => {});', {}, 500);
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('timeout');
  }, 20_000);

  it('输入为空时返回 null 而不是崩溃', () => {
    const out = run('return inputs.missing;', {});
    expect(out).toEqual({ ok: true, result: null });
  });
});
