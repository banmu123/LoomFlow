'use strict';
/**
 * LoomFlow Code Sandbox Runner
 *
 * 独立的、不暴露公网的执行服务：接收 JSON 代码执行请求，在受限子进程中运行后返回结果。
 * 业务应用（Next.js / Worker）通过内部网络调用，不接触 Docker Socket。
 */

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8090);
const TOKEN = process.env.SANDBOX_RUNNER_TOKEN || '';
const MAX_BODY_BYTES = Number(process.env.SANDBOX_MAX_BODY_BYTES || 512 * 1024);
const MAX_CONCURRENCY = Math.max(1, Number(process.env.SANDBOX_MAX_CONCURRENCY || 2));
const MAX_TIMEOUT_MS = Math.min(Math.max(Number(process.env.SANDBOX_MAX_TIMEOUT_MS || 10000), 100), 30000);
const HARNESS = path.join(__dirname, 'harness.js');

let running = 0;
const children = new Set();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function isAuthorized(req) {
  // 未配置密钥时一律拒绝（失败关闭），避免裸奔的沙箱被内部网络任意调用
  if (!TOKEN) return false;
  const provided = req.headers['x-loomflow-sandbox-token'];
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(TOKEN));
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ tooLarge: false, body: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ tooLarge: false, body: '' }));
  });
}

/**
 * 在受限子进程中执行代码。
 * --permission 关闭 fs / child_process / worker_threads / addon；
 * env 为空，避免宿主环境变量（含服务凭证）泄漏。
 */
function runInChild(payloadText, timeoutMs) {
  return new Promise((resolve) => {
    const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || '' } : {};
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${HARNESS}`,
        '--max-old-space-size=192',
        '--no-warnings',
        HARNESS,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: process.platform === 'win32' ? process.cwd() : '/tmp',
      },
    );

    children.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const hardKill = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs + 500);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 200_000) stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(hardKill);
      children.delete(child);
      resolve({ ok: false, error: { code: 'sandbox_failure', message: err.message } });
    });

    child.on('close', (code, signal) => {
      clearTimeout(hardKill);
      children.delete(child);

      if (timedOut) {
        resolve({
          ok: false,
          error: {
            code: 'timeout',
            message: `代码执行超时（${Math.round(timeoutMs / 1000)}s 限制）`,
          },
        });
        return;
      }
      if (signal) {
        resolve({
          ok: false,
          error: { code: 'sandbox_failure', message: `沙箱进程被信号终止: ${signal}` },
        });
        return;
      }

      const text = stdout.trim();
      if (text) {
        try {
          resolve(JSON.parse(text));
          return;
        } catch {
          /* fallthrough */
        }
      }
      resolve({
        ok: false,
        error: {
          code: 'sandbox_failure',
          message: (stderr || `沙箱进程退出码 ${code}`).slice(0, 500),
        },
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(payloadText);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (req.method === 'GET' && url === '/health') {
    send(res, 200, {
      status: 'ok',
      service: 'loomflow-code-sandbox',
      running,
      maxConcurrency: MAX_CONCURRENCY,
    });
    return;
  }

  if (req.method !== 'POST' || url !== '/execute') {
    send(res, 404, { ok: false, error: { code: 'not_found', message: 'not found' } });
    return;
  }

  if (!isAuthorized(req)) {
    send(res, 401, { ok: false, error: { code: 'unauthorized', message: 'invalid sandbox token' } });
    return;
  }

  if (running >= MAX_CONCURRENCY) {
    send(res, 429, {
      ok: false,
      error: { code: 'sandbox_busy', message: 'sandbox is at capacity, retry later' },
    });
    return;
  }

  const { tooLarge, body } = await readBody(req);
  if (tooLarge) {
    send(res, 413, { ok: false, error: { code: 'payload_too_large', message: 'body exceeds limit' } });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    send(res, 400, { ok: false, error: { code: 'invalid_request', message: 'invalid JSON body' } });
    return;
  }

  if (typeof payload.code !== 'string' || !payload.code.trim()) {
    send(res, 400, { ok: false, error: { code: 'invalid_request', message: 'code is required' } });
    return;
  }

  const timeoutMs = Math.min(
    Math.max(Number(payload.timeoutMs) || 5000, 100),
    MAX_TIMEOUT_MS,
  );

  running += 1;
  try {
    const result = await runInChild(
      JSON.stringify({ code: payload.code, inputs: payload.inputs ?? {}, timeoutMs }),
      timeoutMs,
    );
    send(res, result.ok ? 200 : result.error.code === 'timeout' ? 504 : 400, result);
  } catch (err) {
    send(res, 500, { ok: false, error: { code: 'sandbox_failure', message: String(err) } });
  } finally {
    running -= 1;
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[sandbox] listening on :${PORT} (maxConcurrency=${MAX_CONCURRENCY})`);
});

function shutdown(signal) {
  console.log(`[sandbox] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  for (const child of children) child.kill('SIGKILL');
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
