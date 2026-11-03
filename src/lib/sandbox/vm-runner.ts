import vm from 'node:vm';

/**
 * 旧版 JS 沙箱（node:vm）。
 *
 * ⚠️ 不是安全边界：Node.js 官方明确指出 vm 不能用于隔离不可信代码。
 * 仅在显式配置 `LOOMFLOW_CODE_SANDBOX=vm`（本地开发）时使用，
 * 生产部署必须走容器沙箱（见 src/lib/sandbox/client.ts）。
 */

// 深克隆输入（切断原型链：绝不把宿主对象/原型传入 vm 上下文）
function cloneInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>;
  } catch {
    // 含不可序列化值（函数等）时回退为浅拷贝的纯值对象
    return Object.fromEntries(
      Object.entries(inputs).filter(([, v]) => typeof v !== 'function'),
    );
  }
}

export async function runInVm(
  code: string,
  inputs: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const sandbox: Record<string, unknown> = { inputs: cloneInputs(inputs) };
  vm.createContext(sandbox);
  sandbox.utils = vm.runInContext(
    '({ JSON, Math, String, Number, Boolean, Array, Object, Date, Promise })',
    sandbox,
  );

  // code 作为函数体包装（兼容 return 语义），传入沙箱内的 inputs/utils
  const wrapped = `(function(inputs, utils){ "use strict";\n${code}\n})(inputs, utils)`;

  let finalResult: unknown;
  try {
    finalResult = vm.runInContext(wrapped, sandbox, { timeout: timeoutMs });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`代码执行超时（${timeoutMs / 1000}s 限制）`);
    }
    throw new Error(`代码执行错误: ${err.message || String(e)}`);
  }

  // 支持返回 Promise（异步挂起兜底：限时等待，防 `new Promise(()=>{})` 永久占用）
  // 注意：vm 上下文返回的 Promise 属于另一个 realm，`instanceof Promise` 为 false，
  // 必须按 thenable 判断，否则会把未决 Promise 当成结果直接返回。
  if (isThenable(finalResult)) {
    finalResult = await withDeadline(finalResult, timeoutMs);
  }

  return finalResult;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function withDeadline(value: PromiseLike<unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`代码执行超时（${timeoutMs / 1000}s 限制）`)),
      timeoutMs,
    );
    Promise.resolve(value).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
