import { describe, it, expect, vi, afterEach } from 'vitest';
import { TavilyProvider } from '../providers/tavily';
import { ExaProvider } from '../providers/exa';
import { GoogleProvider } from '../providers/google';
import type { SearchProviderDefinition } from '../capabilities';

// ===== fetch mock 工具 =====

function mockFetch(response: { status?: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    return new Response(
      response.status && response.status >= 400
        ? JSON.stringify({ error: 'mock error' })
        : JSON.stringify(response.body),
      {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ) as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeDef(
  provider: string,
  overrides: Partial<SearchProviderDefinition> = {},
): SearchProviderDefinition {
  return {
    id: `${provider}-main`,
    provider,
    apiKey: 'test-key',
    enabled: true,
    capabilities: ['web'],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ===== Tavily =====

describe('TavilyProvider', () => {
  it('发送标准请求并归一化响应', async () => {
    const fetchMock = mockFetch({
      body: {
        results: [
          { title: 'T1', url: 'https://a.com', content: 'C1' },
          { title: 'T2', url: 'https://b.com', content: 'C2' },
        ],
      },
    });

    const provider = new TavilyProvider(makeDef('tavily'));
    const { results } = await provider.search('hello', { maxResults: 2 });

    expect(results).toEqual([
      { title: 'T1', url: 'https://a.com', content: 'C1' },
      { title: 'T2', url: 'https://b.com', content: 'C2' },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe('hello');
    expect(body.max_results).toBe(2);
  });

  it('无 API Key 抛明确错误', async () => {
    const provider = new TavilyProvider(makeDef('tavily', { apiKey: '' }));
    await expect(provider.search('hello')).rejects.toThrow('未配置 API Key');
  });

  it('HTTP 错误抛出含状态码', async () => {
    mockFetch({ status: 401, body: {} });
    const provider = new TavilyProvider(makeDef('tavily'));
    await expect(provider.search('hello')).rejects.toThrow('401');
  });

  it('testConnection 成功返回 ok', async () => {
    mockFetch({ body: { results: [{ title: 'T' }] } });
    const provider = new TavilyProvider(makeDef('tavily'));
    const result = await provider.testConnection?.();
    expect(result?.ok).toBe(true);
  });

  it('testConnection 失败返回 message', async () => {
    mockFetch({ status: 500, body: {} });
    const provider = new TavilyProvider(makeDef('tavily'));
    const result = await provider.testConnection?.();
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain('失败');
  });
});

// ===== Exa =====

describe('ExaProvider', () => {
  it('发送标准请求（x-api-key）并归一化 text → content', async () => {
    const fetchMock = mockFetch({
      body: {
        results: [{ title: 'E1', url: 'https://e.com', text: 'ET1' }],
      },
    });

    const provider = new ExaProvider(makeDef('exa'));
    const { results } = await provider.search('hello', { maxResults: 3 });

    expect(results).toEqual([{ title: 'E1', url: 'https://e.com', content: 'ET1' }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.exa.ai/search');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.numResults).toBe(3);
    expect(body.contents).toEqual({ text: true });
  });

  it('响应缺 results 时返回空数组', async () => {
    mockFetch({ body: {} });
    const provider = new ExaProvider(makeDef('exa'));
    const { results } = await provider.search('hello');
    expect(results).toEqual([]);
  });
});

// ===== Google =====

describe('GoogleProvider', () => {
  it('发送 GET 请求（key/cx/q/num）并归一化 link/snippet', async () => {
    const fetchMock = mockFetch({
      body: {
        items: [{ title: 'G1', link: 'https://g.com', snippet: 'GS1' }],
      },
    });

    const provider = new GoogleProvider(
      makeDef('google', { config: { cx: 'cx-123' } }),
    );
    const { results } = await provider.search('hello', { maxResults: 1 });

    expect(results).toEqual([{ title: 'G1', url: 'https://g.com', content: 'GS1' }]);

    const url = fetchMock.mock.calls[0]?.[0] as string;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://www.googleapis.com/customsearch/v1');
    expect(parsed.searchParams.get('key')).toBe('test-key');
    expect(parsed.searchParams.get('cx')).toBe('cx-123');
    expect(parsed.searchParams.get('q')).toBe('hello');
    expect(parsed.searchParams.get('num')).toBe('1');
  });

  it('未配置 cx 抛明确错误', async () => {
    const provider = new GoogleProvider(makeDef('google'));
    await expect(provider.search('hello')).rejects.toThrow('未配置 cx');
  });

  it('testConnection 无 cx 时返回失败信息', async () => {
    const provider = new GoogleProvider(makeDef('google'));
    const result = await provider.testConnection?.();
    expect(result?.ok).toBe(false);
    expect(result?.message).toContain('cx');
  });
});
