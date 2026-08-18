import type {
  ConnectionTestResult,
  SearchProvider,
  SearchProviderDefinition,
  SearchResponse,
  SearchResult,
} from '../capabilities';

// ===== Tavily Provider =====
// API: POST {baseURL}/search
// 文档: https://docs.tavily.com/documentation/api-reference/endpoint/search

const DEFAULT_BASE_URL = 'https://api.tavily.com';
const TIMEOUT_MS = 15_000;

interface TavilyItem {
  title?: string;
  url?: string;
  content?: string;
}

export class TavilyProvider implements SearchProvider {
  readonly type = 'tavily';

  constructor(private def: SearchProviderDefinition) {}

  private get baseURL(): string {
    return this.def.baseURL?.replace(/\/$/, '') || DEFAULT_BASE_URL;
  }

  private async request(
    body: Record<string, unknown>,
  ): Promise<{ answer?: string; results: TavilyItem[] }> {
    const apiKey = this.def.apiKey;
    if (!apiKey) throw new Error('Tavily 未配置 API Key');

    const res = await fetch(`${this.baseURL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Tavily 请求失败 (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      answer?: string;
      results?: TavilyItem[];
    };
    return { answer: data.answer, results: Array.isArray(data.results) ? data.results : [] };
  }

  async search(query: string, options?: { maxResults?: number }): Promise<SearchResponse> {
    const maxResults = options?.maxResults ?? 5;
    const { results } = await this.request({
      query,
      max_results: Math.max(1, Math.min(20, maxResults)),
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    });

    const normalized: SearchResult[] = results.map((r) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || '',
    }));

    return { results: normalized };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { results } = await this.request({ query: 'test', max_results: 1 });
      return { ok: true, message: `连接成功（返回 ${results.length} 条结果）` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '连接失败',
      };
    }
  }
}
