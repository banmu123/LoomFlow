import vm from 'node:vm';

// ===== Code Lab 沙箱（与生产 Workflow Execution 完全隔离）=====
// 安全边界（与生产 CodeExecutor 同理念，独立实现互不影响）：
//   1. 新 realm 上下文——不注入任何宿主函数/对象（宿主函数的 constructor 链可逃逸）
//   2. 无 fetch / require / process / Buffer / 网络——不可访问宿主、secrets、数据库
//   3. 同步执行超时（vm timeout）+ 异步 Promise 兜底超时
//   4. 输入长度限制（防内存滥用）
// 输出：console 输出在沙箱内收集（新 realm 数组），执行结束后宿主侧读取。

export const CODE_LAB_TIMEOUT_MS = 3000;
export const MAX_INPUT_CHARS = 20_000;

export interface SandboxRunInput {
  code: string;
  /** 测试断言代码（与用户代码同一沙箱，可访问其顶层声明） */
  tests?: string;
  timeoutMs?: number;
}

export interface SandboxRunResult {
  ok: boolean;
  /** console.log/warn/error 输出（按序） */
  output: string[];
  /** 用户代码末尾表达式/返回值（若有） */
  result: unknown;
  error?: string;
  durationMs: number;
}

// 新 realm 内的简易 assert（与外部断言框架隔离，无宿主依赖）
const ASSERT_HELPER = `
const __passes = [];
const __fails = [];
function assert(cond, msg) {
  if (cond) { __passes.push(msg || 'ok'); }
  else { __fails.push(msg || 'assertion failed'); throw new Error(msg || 'assertion failed'); }
}
function assertEq(a, b, msg) {
  assert(String(a) === String(b), msg || 'expected ' + String(b) + ', got ' + String(a));
}
`;

export function runJsInSandbox(
  input: SandboxRunInput,
): Promise<SandboxRunResult> | SandboxRunResult {
  const code = input.code ?? '';
  const tests = input.tests ?? '';
  const timeoutMs = input.timeoutMs ?? CODE_LAB_TIMEOUT_MS;
  const startedAt = Date.now();

  const totalLength = code.length + tests.length;
  if (totalLength > MAX_INPUT_CHARS) {
    return {
      ok: false,
      output: [],
      result: null,
      error: `输入过长（${totalLength} 字符，上限 ${MAX_INPUT_CHARS}）`,
      durationMs: 0,
    };
  }

  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);

  // 新 realm 基础对象（context 化，与宿主隔离）
  sandbox.utils = vm.runInContext(
    '({ JSON, Math, String, Number, Boolean, Array, Object, Date, Promise, RegExp, isNaN, parseFloat, parseInt })',
    sandbox,
  );
  // 输出缓冲：新 realm 数组（不注入宿主函数）
  sandbox.__out = vm.runInContext('[]', sandbox);
  // console：新 realm 内定义，写入 __out
  sandbox.console = vm.runInContext(
    `({
      log: (...a) => __out.push(a.map(String).join(' ')),
      info: (...a) => __out.push(a.map(String).join(' ')),
      warn: (...a) => __out.push('[warn] ' + a.map(String).join(' ')),
      error: (...a) => __out.push('[error] ' + a.map(String).join(' '))
    })`,
    sandbox,
  );

  // 用户代码直接执行（顶层声明全局可见，tests 可访问）；
  // 返回值仅当代码末尾为表达式语句时由 __result 捕获（顶层 return 非法）
  const wrapped = `"use strict";
${ASSERT_HELPER}
${code}
${tests}
`;

  let finalResult: unknown;
  try {
    finalResult = vm.runInContext(wrapped, sandbox, { timeout: timeoutMs });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return {
        ok: false,
        output: sandbox.__out as string[],
        result: null,
        error: `执行超时（${timeoutMs / 1000}s 限制）`,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      ok: false,
      output: sandbox.__out as string[],
      result: null,
      error: err.message || String(e),
      durationMs: Date.now() - startedAt,
    };
  }

  // 异步挂起兜底（防 new Promise(()=>{}) 永久占用）
  // 跨 realm 判断：沙箱 Promise 与宿主 Promise 不同 realm，instanceof 失效 → 鸭子类型
  const isThenable =
    finalResult !== null &&
    typeof finalResult === 'object' &&
    typeof (finalResult as { then?: unknown }).then === 'function';
  if (isThenable) {
    return Promise.race([
      (finalResult as Promise<unknown>).then(
        (v: unknown) => ({
          ok: true,
          output: sandbox.__out as string[],
          result: v,
          durationMs: Date.now() - startedAt,
        }),
        (e: unknown) => ({
          ok: false,
          output: sandbox.__out as string[],
          result: null,
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - startedAt,
        }),
      ),
      new Promise<SandboxRunResult>((resolve) =>
        setTimeout(() => {
          resolve({
            ok: false,
            output: sandbox.__out as string[],
            result: null,
            error: `执行超时（${timeoutMs / 1000}s 限制）`,
            durationMs: Date.now() - startedAt,
          });
        }, timeoutMs),
      ),
    ]);
  }

  return Promise.resolve({
    ok: true,
    output: sandbox.__out as string[],
    result: finalResult,
    durationMs: Date.now() - startedAt,
  });
}
