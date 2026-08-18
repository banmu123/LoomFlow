import type {
  ConnectionTestResult,
  SearchProvider,
  SearchProviderDefinition,
  SearchResponse,
  SearchResult,
} from '../capabilities';

// ===== Google Custom Search Provider =====
// API: GET {baseURL}?key=&cx=&q=&num=
// 文档: https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list

const DEFAULT_BASE_URL = 'https://www.googleapis.com/customsearch/v1';
const TIMEOUT_MS = 15_000;

interface GoogleItem {
  title?: string;
  link?: string;
  snippet?: string;
}

export class GoogleProvider implements SearchProvider {
  readonly type = 'google';

  constructor(private def: SearchProviderDefinition) {}

  private get baseURL(): string {
    return this.def.baseURL?.replace(/\/$/, '') || DEFAULT_BASE_URL;
  }

  private get cx(): string {
    return String(this.def.config?.cx ?? '');
  }

  private async request(query: string, num: number): Promise<{ items: GoogleItem[] }> {
    const apiKey = this.def.apiKey;
    if (!apiKey) throw new Error('Google 未配置 API Key');
    const cx = this.cx;
    if (!cx) throw new Error('Google Custom Search 未配置 cx（自定义搜索引擎 ID）');

    const url = new URL(this.baseURL);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(num));

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Google 请求失败 (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as { items?: GoogleItem[] };
    return { items: Array.isArray(data.items) ? data.items : [] };
  }

  async search(query: string, options?: { maxResults?: number }): Promise<SearchResponse> {
    const maxResults = options?.maxResults ?? 5;
    const { items } = await this.request(query, Math.max(1, Math.min(10, maxResults)));

    const normalized: SearchResult[] = items.map((r) => ({
      title: r.title || '',
      url: r.link || '',
      content: r.snippet || '',
    }));

    return { results: normalized };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const { items } = await this.request('test', 1);
      return { ok: true, message: `连接成功（返回 ${items.length} 条结果）` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '连接失败',
      };
    }
  }
}
