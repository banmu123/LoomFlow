import type {
  ConnectionTestResult,
  SearchProvider,
  SearchProviderDefinition,
  SearchResponse,
  SearchResult,
} from '../capabilities';

// ===== Exa Provider =====
// API: POST {baseURL}/search（header 认证）
// 文档: https://docs.exa.ai/reference/search

const DEFAULT_BASE_URL = 'https://api.exa.ai';
const TIMEOUT_MS = 15_000;

interface ExaItem {
  title?: string;
  url?: string;
  text?: string;
}

export class ExaProvider implements SearchProvider {
  readonly type = 'exa';

  constructor(private def: SearchProviderDefinition) {}

  private get baseURL(): string {
    return this.def.baseURL?.replace(/\/$/, '') || DEFAULT_BASE_URL;
  }

  private async request(
    body: Record<string, unknown>,
  ): Promise<{ results: ExaItem[] }> {
    const apiKey = this.def.apiKey;
    if (!apiKey) throw new Error('Exa 未配置 API Key');

    const res = await fetch(`${this.baseURL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Exa 请求失败 (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as { results?: ExaItem[] };
    return { results: Array.isArray(data.results) ? data.results : [] };
  }

  async search(query: string, options?: { maxResults?: number }): Promise<SearchResponse> {
    const maxResults = options?.maxResults ?? 5;
    const { results } = await this.request({
      query,
      numResults: Math.max(1, Math.min(20, maxResults)),
      contents: { text: true },
    });

    const normalized: SearchResult[] = results.map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.text || '',
    }));

    return { results: normalized };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { results } = await this.request({
        query: 'test',
        numResults: 1,
        contents: { text: false },
      });
      return { ok: true, message: `连接成功（返回 ${results.length} 条结果）` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '连接失败',
      };
    }
  }
}
