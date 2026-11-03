import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { McpError } from './types';
import { nextRequestId, unwrapResult } from './jsonrpc';

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  /** 仅允许这些可执行文件名（部署级配置） */
  allowedCommands: string[];
}

const DEFAULT_TIMEOUT_MS = 20_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * MCP STDIO 传输：以子进程方式运行 MCP Server，newline-delimited JSON-RPC。
 *
 * 安全边界：
 * - 命令必须命中部署级 allowlist（不允许普通用户随意执行系统命令）
 * - 子进程只继承最小环境变量（PATH/HOME + 配置项）
 * - 超时即终止子进程，避免僵死进程堆积
 */
export class StdioTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private stderr = '';
  private closed = false;

  constructor(private readonly options: StdioTransportOptions) {}

  async start(): Promise<void> {
    if (this.child) return;

    const commandName = this.options.command.split(/[\\/]/).pop() ?? '';
    if (!this.options.allowedCommands.includes(commandName)) {
      throw new McpError(
        'unsafe_url',
        `STDIO 命令未在允许列表中：${commandName || this.options.command}`,
      );
    }
    if ((this.options.args ?? []).length > 32) {
      throw new McpError('invalid_config', 'STDIO 参数过多');
    }

    const child = spawn(this.options.command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
        ...this.options.env,
      } as unknown as NodeJS.ProcessEnv,
    });

    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (this.stderr.length < 20_000) this.stderr += chunk;
    });

    child.on('error', (err) => this.failAll(`MCP 进程启动失败：${err.message}`));
    child.on('exit', (code, signal) => {
      const detail = this.stderr.slice(-500);
      this.failAll(
        `MCP 进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）${detail ? `：${detail}` : ''}`,
      );
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // 防止恶意/异常服务端无限输出
    if (this.buffer.length > 4_000_000) {
      this.failAll('MCP 输出超过上限，已断开');
      return;
    }

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: { id?: number; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return; // 非 JSON 行（日志）忽略
    }
    if (typeof message.id !== 'number') return; // 服务端通知

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    try {
      pending.resolve(unwrapResult(message, 'stdio'));
    } catch (err) {
      pending.reject(err as Error);
    }
  }

  private failAll(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError('transport_error', reason));
    }
    this.pending.clear();
    this.child?.kill('SIGKILL');
    this.child = null;
  }

  private write(body: unknown): void {
    if (!this.child || this.closed) {
      throw new McpError('not_connected', 'MCP 进程未运行');
    }
    this.child.stdin.write(`${JSON.stringify(body)}\n`);
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    await this.start();
    const id = nextRequestId();
    const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时视为进程不可用：直接终止，避免后续请求排在一个卡死的服务后面
        this.failAll(`MCP 请求超时（${limit}ms，method=${method}）`);
        reject(new McpError('timeout', `MCP 请求超时（${limit}ms）`));
      }, limit);

      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.start();
    this.write({ jsonrpc: '2.0', method, params });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError('not_connected', 'MCP 连接已关闭'));
    }
    this.pending.clear();

    const child = this.child;
    this.child = null;
    if (!child) return;

    child.stdin.end();
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
