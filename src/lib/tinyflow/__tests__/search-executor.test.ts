import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchEngineExecutor } from '../executors/SearchEngineExecutor';
import type { FlowNode, FlowContext } from '../types';
import { GraphParser } from '../engine/GraphParser';
import { ParameterResolver } from '../engine/ParameterResolver';
import { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

// mock 搜索服务（DB 层 + provider 工厂）
vi.mock('@/lib/search/db-providers', () => ({
  getSearchProviderById: vi.fn(async (id: string) => ({
    id,
    provider: 'tavily',
    apiKey: 'test-key',
    enabled: true,
    capabilities: ['web'],
  })),
}));

vi.mock('@/lib/search/providers', () => ({
  createSearchProvider: vi.fn(() => ({
    type: 'tavily',
    search: vi.fn(async (query: string, opts?: { maxResults?: number }) => ({
      results: Array.from({ length: Math.min(opts?.maxResults ?? 5, 3) }, (_, i) => ({
        title: `R${i + 1}`,
        url: `https://r${i + 1}.com`,
        content: `C${i + 1}`,
      })),
    })),
  })),
}));

function makeContext(inputs: Record<string, unknown> = {}): FlowContext {
  const flowData = {
    nodes: [{ id: 'start', type: 'startNode', data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as never;
  const parser = new GraphParser(flowData);
  return {
    flowId: 'test',
    inputs,
    nodeOutputs: new Map(),
    variables: {},
    parser,
  } as unknown as FlowContext;
}

function makeNode(data: Record<string, unknown>): FlowNode {
  return {
    id: 'search1',
    type: 'searchEngineNode',
    position: { x: 0, y: 0 },
    data,
  } as unknown as FlowNode;
}

function makeExecutor(): SearchEngineExecutor {
  return new SearchEngineExecutor(
    new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
    new ExpressionEvaluator(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearchEngineExecutor 字段优先级', () => {
  it('画布内置面板的 limit 优先于旧字段 maxResults', async () => {
    const executor = makeExecutor();
    // maxResults=2（旧字段残留）但面板写了 limit=10 → 应取 10
    const result = await executor.execute(
      makeNode({ engine: 'tavily-main', keyword: 'hello', limit: 10, maxResults: 2 }),
      makeContext(),
    );
    expect(result.results).toHaveLength(3); // mock 上限 3，证明用的是 10 而非 2
  });

  it('limit 缺省时回退 maxResults', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makeNode({ engine: 'tavily-main', keyword: 'hello', maxResults: 3 }),
      makeContext(),
    );
    expect(result.results).toHaveLength(3);
  });

  it('keyword 优先于旧字段 query（空字符串不遮蔽）', async () => {
    const executor = makeExecutor();
    // query='' 残留 + 面板填了 keyword → 应使用 keyword
    const result = await executor.execute(
      makeNode({ engine: 'tavily-main', keyword: 'new-keyword', query: '' }),
      makeContext(),
    );
    expect(result.keyword).toBe('new-keyword');
  });

  it('keyword 缺省时回退 query', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makeNode({ engine: 'tavily-main', query: '{{var1}}' }),
      makeContext({ var1: 'resolved-query' }),
    );
    expect(result.keyword).toBe('resolved-query');
  });

  it('keyword 支持 {{var}} 插值', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makeNode({ engine: 'tavily-main', keyword: '查询 {{topic}}' }),
      makeContext({ topic: 'LoomFlow' }),
    );
    expect(result.keyword).toBe('查询 LoomFlow');
  });

  it('engine 优先于旧字段 provider', async () => {
    const executor = makeExecutor();
    const { getSearchProviderById } = await import('@/lib/search/db-providers');
    const result = await executor.execute(
      makeNode({ engine: 'engine-a', provider: 'provider-b', keyword: 'x', limit: 1 }),
      makeContext(),
    );
    expect(getSearchProviderById).toHaveBeenCalledWith('engine-a');
    expect(result.results).toHaveLength(1);
  });

  it('未知搜索服务抛明确错误', async () => {
    vi.mocked(
      (await import('@/lib/search/db-providers')).getSearchProviderById,
    ).mockResolvedValueOnce(undefined);
    const executor = makeExecutor();
    await expect(
      executor.execute(makeNode({ engine: 'ghost', keyword: 'x' }), makeContext()),
    ).rejects.toThrow('未知搜索服务');
  });

  it('validate 缺 keyword/query 时报错', () => {
    const executor = makeExecutor();
    expect(executor.validate(makeNode({ engine: 'a' }))).toContain('搜索关键词');
    expect(executor.validate(makeNode({ engine: 'a', keyword: 'x' }))).toBeNull();
  });
});
