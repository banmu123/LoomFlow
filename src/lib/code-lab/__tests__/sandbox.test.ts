import { describe, it, expect } from 'vitest';
import { runJsInSandbox, MAX_INPUT_CHARS } from '../sandbox';

describe('Code Lab 沙箱', () => {
  it('正常执行并捕获 console 输出', async () => {
    const r = await runJsInSandbox({ code: `console.log('hello'); console.log(1 + 2);` });
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(['hello', '3']);
  });

  it('测试代码可访问用户代码的顶层声明（assertEq）', async () => {
    const r = await runJsInSandbox({
      code: `function add(a, b) { return a + b; }`,
      tests: `assertEq(add(1, 2), 3); assertEq(add(5, 5), 10); console.log('all pass');`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('all pass');
  });

  it('断言失败 → 执行错误', async () => {
    const r = await runJsInSandbox({
      code: `function add(a, b) { return a + b; }`,
      tests: `assertEq(add(1, 2), 99);`,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('语法错误返回错误信息', async () => {
    const r = await runJsInSandbox({ code: `function {` });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('禁止访问网络/宿主（fetch 不存在）', async () => {
    const r = await runJsInSandbox({
      code: `console.log(typeof fetch + ':' + typeof require + ':' + typeof process);`,
    });
    expect(r.ok).toBe(true);
    expect(r.output[0]).toContain('undefined');
  });

  it('禁止访问 secrets（process.env 不可用）', async () => {
    const r = await runJsInSandbox({ code: `console.log(typeof process)` });
    expect(r.output[0]).toBe('undefined');
  });

  it('同步执行超时', async () => {
    const r = await runJsInSandbox({
      code: `while (true) {}`,
      timeoutMs: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('超时');
  });

  it('异步挂起超时（Promise 永不 resolve）', async () => {
    const r = await runJsInSandbox({
      code: `new Promise(() => {})`,
      timeoutMs: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('超时');
  });

  it('输入长度限制', async () => {
    const r = await runJsInSandbox({ code: 'x'.repeat(MAX_INPUT_CHARS + 10) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('输入过长');
  });
});
