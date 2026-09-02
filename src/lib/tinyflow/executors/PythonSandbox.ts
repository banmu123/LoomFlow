import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

// Python 沙箱（Pyodide / CPython-WASM）
// - 与 JS 沙箱（node:vm）同级的 5s 超时预算
// - Pyodide 跑在独立 worker 线程：WASM 内的死循环无法中断，
//   超时只能整 worker 强杀，下次执行时重新拉起（代价 ~1s 冷启动）
// - 安全边界：与 JS 沙箱一致——纯数据进出（JSON 序列化），
//   无宿主对象注入、无网络（需要网络请用 HTTP 节点）

export const PYTHON_TIMEOUT_MS = 5000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  /** 请求发送到的 worker 实例（worker 被替换后，旧实例的清理不得波及新实例） */
  workerRef: Worker;
}

let worker: Worker | null = null;
let workerBoot: Promise<void> | null = null;
let seq = 0;
const pending = new Map<number, PendingRequest>();

/** 终止当前 worker 并清理状态；stale worker 的事件不得误杀新实例 */
function terminateWorker(reason: string): void {
  const w = worker;
  if (!w) return;
  worker = null;
  workerBoot = null;
  void w.terminate();
  for (const [id, p] of pending) {
    if (p.workerRef !== w) continue;
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

// worker 脚本（eval 模式内联，避免打包器丢文件）：
// 懒加载 pyodide → 逐条处理 run 消息 → 结果 JSON 序列化回传
const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
let py = null;
async function ensurePyodide() {
  if (!py) {
    const mod = require(workerData.pyodideEntry);
    py = await mod.loadPyodide();
  }
  return py;
}
// 用户代码包装为函数体（与 JS 节点一致：支持 return 语义）
function wrap(code) {
  const indented = code.split('\\n').map((l) => (l.trim().length ? '    ' + l : '')).join('\\n');
  return [
    'import json as _json',
    'def __loomflow_main__(inputs):',
    indented,
    '',
  ].join('\\n');
}
parentPort.on('message', async (msg) => {
  if (msg.type !== 'run') return;
  try {
    const py = await ensurePyodide();
    py.globals.set('__loomflow_inputs_json__', msg.inputsJson);
    const script = wrap(msg.code) + [
      '_result = __loomflow_main__(_json.loads(__loomflow_inputs_json__))',
      '_json.dumps(_result, ensure_ascii=False, default=str)',
    ].join('\\n');
    const out = await py.runPythonAsync(script);
    parentPort.postMessage({ id: msg.id, ok: true, result: JSON.parse(out) });
  } catch (e) {
    const raw = String((e && e.message) || e).trim();
    // 只保留 traceback 最后一行（真实异常），避免超长
    const last = raw.split('\\n').pop() || raw;
    parentPort.postMessage({ id: msg.id, ok: false, error: 'Python 执行错误: ' + last.slice(0, 500) });
  }
});
parentPort.postMessage({ type: 'ready' });
`;

function ensureWorker(): Promise<void> {
  if (workerBoot) return workerBoot;
  // 主线程解析 pyodide 入口的绝对路径传给 worker（打包安全：依赖保持 external）
  const nodeRequire = createRequire(import.meta.url);
  const pyodideEntry = nodeRequire.resolve('pyodide');

  const w = new Worker(WORKER_SCRIPT, { eval: true, workerData: { pyodideEntry } });
  worker = w;
  workerBoot = new Promise<void>((resolve, reject) => {
    w.once('message', (msg: { type?: string }) => {
      if (msg.type === 'ready') resolve();
    });
    w.once('error', (err: Error) => reject(new Error(`Python 沙箱启动失败: ${err.message}`)));
    w.once('exit', (code: number) => {
      if (code !== 0) reject(new Error(`Python 沙箱异常退出（code ${code}）`));
    });
  });
  // 生命周期清理：仅当该 worker 仍是"当前实例"时才终止并清空模块状态
  w.on('error', (err: Error) => {
    if (worker === w) terminateWorker(`Python 沙箱崩溃: ${err.message}`);
  });
  w.on('exit', () => {
    if (worker === w) terminateWorker('Python 沙箱已退出');
  });
  // 结果分发
  w.on('message', (msg: { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string }) => {
    if (msg.type === 'ready') return;
    const id = msg.id;
    if (id === undefined) return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || 'Python 执行失败'));
  });
  return workerBoot;
}

/** 执行 Python 代码（函数体语义：inputs 为 dict，支持 return）。返回 JSON 可序列化的返回值 */
export async function runPythonCode(
  code: string,
  inputsJson: string,
  timeoutMs: number = PYTHON_TIMEOUT_MS,
): Promise<unknown> {
  if (!worker) await ensureWorker();
  const w = worker;
  if (!w) throw new Error('Python 沙箱启动失败');
  const id = ++seq;
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      if (worker === w) terminateWorker(`代码执行超时（Python，${timeoutMs / 1000}s 限制）`);
      reject(new Error(`代码执行超时（Python，${timeoutMs / 1000}s 限制）`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, workerRef: w });
    w.postMessage({ type: 'run', id, code, inputsJson });
  });
}
