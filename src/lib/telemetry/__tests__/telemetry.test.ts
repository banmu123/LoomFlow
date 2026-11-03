import { describe, it, expect } from 'vitest';
import {
  contextFromTraceparent,
  injectTraceContext,
  isTelemetryEnabled,
  parseTraceparent,
  recordJobEvent,
  recordModelCall,
  sanitizeAttributes,
  withSpan,
} from '../index';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

describe('遥测开关', () => {
  it('默认关闭（未配置 OTEL_ENABLED）', () => {
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('关闭时 withSpan 直接执行且不创建 Span', async () => {
    const result = await withSpan('test.span', { 'test.attr': 1 }, (span) => {
      expect(span).toBeUndefined();
      return 42;
    });
    expect(result).toBe(42);
  });

  it('关闭时指标记录不抛错', () => {
    expect(() =>
      recordModelCall({
        modelId: 'm',
        provider: 'p',
        success: true,
        durationMs: 10,
        fallbackUsed: false,
        inputTokens: 1,
        outputTokens: 2,
        cost: null,
      }),
    ).not.toThrow();
    expect(() => recordJobEvent({ event: 'claimed' })).not.toThrow();
  });
});

describe('属性脱敏', () => {
  it('丢弃密钥类字段', () => {
    const attributes = sanitizeAttributes({
      'http.route': '/api/x',
      apiKey: 'sk-secret',
      authorization: 'Bearer abc',
      'model.token': 'secret',
      password: 'p',
    });

    expect(attributes).toEqual({ 'http.route': '/api/x' });
  });

  it('截断超长字符串，丢弃对象', () => {
    const attributes = sanitizeAttributes({
      long: 'x'.repeat(2000),
      nested: { user: 'private' },
      count: 3,
    });

    expect(String(attributes.long)).toHaveLength(512);
    expect(attributes.nested).toBeUndefined();
    expect(attributes.count).toBe(3);
  });
});

describe('Trace Context 传播', () => {
  it('解析合法 traceparent', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    });
  });

  it('拒绝非法/全零 traceparent', () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent('00-abc-def-01')).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${SPAN_ID}-01`)).toBeNull();
    expect(parseTraceparent(`00-${TRACE_ID}-${'0'.repeat(16)}-01`)).toBeNull();
  });

  it('可从 traceparent 构造远程上下文', () => {
    expect(contextFromTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).not.toBeNull();
    expect(contextFromTraceparent('bad')).toBeNull();
  });

  it('无活跃 Span 时不注入 traceparent', () => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    injectTraceContext(headers);
    expect(headers.traceparent).toBeUndefined();
  });

  it('已有 traceparent 时不覆盖', () => {
    const headers = { traceparent: 'custom' };
    injectTraceContext(headers);
    expect(headers.traceparent).toBe('custom');
  });
});
