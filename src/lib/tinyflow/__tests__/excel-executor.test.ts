import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExcelExecutor } from '../executors/ExcelExecutor';
import type { FlowNode, FlowContext } from '../types';
import { GraphParser } from '../engine/GraphParser';
import { ParameterResolver } from '../engine/ParameterResolver';
import { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/oss-server', () => ({
  uploadBufferToOSS: uploadMock,
}));

function makeContext(nodeOutputs: Map<string, Record<string, unknown>>): FlowContext {
  const flowData = {
    nodes: [{ id: 'start', type: 'startNode', data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as never;
  const parser = new GraphParser(flowData);
  return {
    flowId: 'test',
    inputs: {},
    nodeOutputs,
    variables: {},
    parser,
  } as unknown as FlowContext;
}

function makeNode(data: Record<string, unknown>): FlowNode {
  return {
    id: 'excel1',
    type: 'excelNode',
    position: { x: 0, y: 0 },
    data,
  } as unknown as FlowNode;
}

function makeExecutor(): ExcelExecutor {
  return new ExcelExecutor(
    new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
    new ExpressionEvaluator(),
  );
}

const PARAMS = [
  { id: 'p1', name: 'data', refType: 'ref', ref: 'node_up.data' },
] as never[];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExcelExecutor', () => {
  it('base64 模式：上游数据生成有效 xlsx', async () => {
    const executor = makeExecutor();
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    nodeOutputs.set('node_up', {
      data: [
        { 名称: '苹果', 数量: 3 },
        { 名称: '香蕉', 数量: 5 },
      ],
    });

    const result = await executor.execute(
      makeNode({ sheetName: '水果', fileName: 'fruit.xlsx', outputType: 'base64', parameters: PARAMS }),
      makeContext(nodeOutputs),
    );

    expect(result.fileName).toBe('fruit.xlsx');
    expect(result.sheetName).toBe('水果');
    expect(result.rowCount).toBe(2);
    // xlsx = zip 容器，base64 解码后以 PK 魔数开头
    const buf = Buffer.from(result.base64 as string, 'base64');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(100);
  });

  it('静态 jsonData：无上游连接也能生成', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makeNode({
        jsonData: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
        parameters: [],
      }),
      makeContext(new Map()),
    );
    expect(result.rowCount).toBe(2);
    expect(result.base64).toBeTruthy();
  });

  it('ref 指向数组字段（如搜索节点 results）也能取到数据', async () => {
    const executor = makeExecutor();
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    nodeOutputs.set('node_up', { results: [{ title: 'R1' }] });
    const result = await executor.execute(
      makeNode({
        parameters: [{ id: 'p1', name: 'data', refType: 'ref', ref: 'node_up.results' }] as never[],
      }),
      makeContext(nodeOutputs),
    );
    expect(result.rowCount).toBe(1);
  });

  it('空数据抛明确错误', async () => {
    const executor = makeExecutor();
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    nodeOutputs.set('node_up', { data: [] });
    await expect(
      executor.execute(makeNode({ parameters: PARAMS }), makeContext(nodeOutputs)),
    ).rejects.toThrow('没有可写入的数据');
  });

  it('oss 模式：上传成功返回 ossKey', async () => {
    uploadMock.mockResolvedValueOnce('workflow/excel/123.xlsx');
    const executor = makeExecutor();
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    nodeOutputs.set('node_up', { data: [{ a: 1 }] });

    const result = await executor.execute(
      makeNode({ outputType: 'oss', parameters: PARAMS }),
      makeContext(nodeOutputs),
    );
    expect(result.ossKey).toContain('workflow/excel/');
    expect(result.fileName).toBe('data.xlsx');
    // 上传的 content-type 应为 xlsx MIME
    expect(uploadMock.mock.calls[0][2]).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('oss 模式：OSS 未配置/上传失败抛明确错误', async () => {
    uploadMock.mockResolvedValueOnce(null);
    const executor = makeExecutor();
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    nodeOutputs.set('node_up', { data: [{ a: 1 }] });
    await expect(
      executor.execute(makeNode({ outputType: 'oss', parameters: PARAMS }), makeContext(nodeOutputs)),
    ).rejects.toThrow('OSS 未配置');
  });

  it('validate：无输入参数且无 jsonData 时报错', () => {
    const executor = makeExecutor();
    expect(executor.validate(makeNode({ sheetName: 'S' }))).toContain('缺少数据');
    expect(executor.validate(makeNode({ jsonData: [] }))).toBeNull();
    expect(executor.validate(makeNode({ parameters: PARAMS }))).toBeNull();
  });
});
