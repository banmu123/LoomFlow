import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeInContainerSandbox } from '../client';
import {
  CodeExecutionError,
  CodeSandboxUnavailableError,
  CodeTimeoutError,
} from '../types';

const baseInput = {
  url: 'http://sandbox:8090',
  token: 'secret',
  code: 'return 1',
  inputs: {},
  timeoutMs: 5000,
};

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('容器沙箱客户端', () => {
  it('成功时返回结果', async () => {
    mockFetch(() => Response.json({ ok: true, result: { sum: 3 } }));
    await expect(executeInContainerSandbox(baseInput)).resolves.toEqual({ sum: 3 });
  });

  it('携带内部密钥与超时预算', async () => {
    const fetchMock = vi.fn(() => Response.json({ ok: true, result: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    await executeInContainerSandbox(baseInput);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://sandbox:8090/execute');
    expect((init.headers as Record<string, string>)['x-loomflow-sandbox-token']).toBe('secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('沙箱超时 → CodeTimeoutError', async () => {
    mockFetch(() =>
      Response.json({ ok: false, error: { code: 'timeout', message: '代码执行超时（5s 限制）' } }),
    );
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(CodeTimeoutError);
  });

  it('鉴权失败 → 沙箱不可用（失败关闭）', async () => {
    mockFetch(() => new Response('unauthorized', { status: 401 }));
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(
      CodeSandboxUnavailableError,
    );
  });

  it('容量已满 → 沙箱不可用', async () => {
    mockFetch(() => new Response('busy', { status: 429 }));
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(
      CodeSandboxUnavailableError,
    );
  });

  it('网络错误 → 沙箱不可用（不回退 vm）', async () => {
    mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(
      CodeSandboxUnavailableError,
    );
  });

  it('执行错误 → CodeExecutionError（保留原始信息）', async () => {
    mockFetch(() =>
      Response.json({ ok: false, error: { code: 'execution_error', message: 'x is not defined' } }),
    );
    await expect(executeInContainerSandbox(baseInput)).rejects.toThrow('x is not defined');
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(CodeExecutionError);
  });

  it('非 JSON 响应 → 沙箱不可用', async () => {
    mockFetch(() => new Response('<html>bad gateway</html>', { status: 200 }));
    await expect(executeInContainerSandbox(baseInput)).rejects.toBeInstanceOf(
      CodeSandboxUnavailableError,
    );
  });
});
