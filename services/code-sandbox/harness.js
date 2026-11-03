'use strict';
/**
 * 沙箱子进程入口（由 runner.js 以 `node --permission harness.js` 启动）。
 *
 * 安全模型分层：
 *   1. 进程级：Node Permission Model 关闭 fs / child_process / worker / addon；
 *   2. 容器级：非 root、只读根文件系统、cap_drop ALL、内部网络（无外网出口）；
 *   3. 语言级：vm 上下文仅暴露 JSON 数据与安全工具，禁用 eval / new Function。
 *
 * vm 不是安全边界——它只负责「代码语义隔离」，真正的边界是上面的进程与容器。
 */

const vm = require('node:vm');

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;

let done = false;

function emit(payload) {
  if (done) return;
  done = true;
  try {
    process.stdout.write(JSON.stringify(payload));
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: { code: 'result_not_serializable', message: String(err) } }),
    );
  }
}

function fail(code, message) {
  emit({ ok: false, error: { code, message: String(message).slice(0, 2000) } });
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
  if (raw.length > MAX_INPUT_BYTES) {
    fail('payload_too_large', 'input exceeds 1MB');
    process.stdin.destroy();
  }
});

process.stdin.on('end', () => {
  if (!done) void run();
});

async function run() {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    fail('invalid_request', 'invalid JSON payload');
    return;
  }

  const code = typeof payload.code === 'string' ? payload.code : '';
  if (!code.trim()) {
    fail('invalid_request', 'code is empty');
    return;
  }

  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 5000, 100), 10000);

  try {
    const result = await execute(code, payload.inputs, timeoutMs);
    const serialized = JSON.stringify(result ?? null);
    if (typeof serialized === 'string' && serialized.length > MAX_RESULT_BYTES) {
      fail('result_too_large', 'result exceeds 1MB');
      return;
    }
    emit({ ok: true, result: result === undefined ? null : result });
  } catch (err) {
    if (err && err.code === 'timeout') {
      fail('timeout', err.message);
      return;
    }
    fail('execution_error', (err && err.message) || String(err));
  }
}

async function execute(code, inputs, timeoutMs) {
  // 只传纯数据：不注入任何宿主对象（宿主函数的 constructor 链可逃逸回全局）
  const sandbox = Object.create(null);
  sandbox.inputs = JSON.parse(JSON.stringify(inputs ?? {}));

  vm.createContext(sandbox, {
    name: 'loomflow-code-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  sandbox.utils = vm.runInContext(
    '({ JSON, Math, String, Number, Boolean, Array, Object, Date, Promise, RegExp })',
    sandbox,
  );

  const wrapped = `(function(inputs, utils){ "use strict";\n${code}\n})(inputs, utils)`;

  let value;
  try {
    value = vm.runInContext(wrapped, sandbox, { timeout: timeoutMs });
  } catch (err) {
    if (err && (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out/i.test(String(err.message)))) {
      throw timeoutError(timeoutMs);
    }
    const e = new Error(String((err && err.message) || err));
    e.code = 'execution_error';
    throw e;
  }

  if (value && typeof value.then === 'function') {
    // 注意：vm 里返回的 Promise 属于另一个 realm，instanceof Promise 为 false，
    // 必须按 thenable 处理，否则会直接返回一个未决 Promise 对象。
    value = await withDeadline(Promise.resolve(value), timeoutMs);
  }

  return value;
}

function timeoutError(timeoutMs) {
  const e = new Error(`代码执行超时（${Math.round(timeoutMs / 1000)}s 限制）`);
  e.code = 'timeout';
  return e;
}

function withDeadline(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
