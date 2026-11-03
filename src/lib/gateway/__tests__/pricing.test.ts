import { describe, it, expect } from 'vitest';
import { estimateCost, parsePricing, priceFor } from '../pricing';
import { GatewayMetrics, percentile } from '../metrics';

describe('模型定价', () => {
  it('解析合法配置', () => {
    const table = parsePricing(
      JSON.stringify({ m1: { inputPer1M: 1, outputPer1M: 2, currency: 'CNY' } }),
    );
    expect(table.m1).toEqual({ inputPer1M: 1, outputPer1M: 2, currency: 'CNY' });
    expect(priceFor('m1', table)).not.toBeNull();
  });

  it('非法 JSON 视为未配置，不抛错', () => {
    expect(parsePricing('{not-json')).toEqual({});
  });

  it('缺少必要字段的条目被忽略', () => {
    const table = parsePricing(JSON.stringify({ bad: { inputPer1M: 1 } }));
    expect(table).toEqual({});
  });

  it('未配置价格时成本为未知（不编造数字）', () => {
    const cost = estimateCost(
      { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, source: 'provider' },
      null,
    );
    expect(cost).toEqual({ amount: null, currency: null, known: false });
  });

  it('按每百万 token 计算成本', () => {
    const cost = estimateCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000, source: 'provider' },
      { inputPer1M: 1, outputPer1M: 2, currency: 'USD' },
    );
    expect(cost.amount).toBe(2);
    expect(cost.known).toBe(true);
  });

  it('供应商未返回 token 时不做估算', () => {
    const cost = estimateCost(
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'unknown' },
      { inputPer1M: 1, outputPer1M: 2, currency: 'USD' },
    );
    expect(cost.known).toBe(false);
    expect(cost.amount).toBeNull();
  });
});

describe('网关指标', () => {
  it('统计成功率、回退率、分位延迟与成本', () => {
    const metrics = new GatewayMetrics();
    metrics.record({
      modelId: 'm',
      provider: 'p',
      success: true,
      latencyMs: 100,
      fallbackUsed: false,
      inputTokens: 100,
      outputTokens: 50,
      costAmount: 0.01,
      costKnown: true,
    });
    metrics.record({
      modelId: 'm',
      provider: 'p',
      success: true,
      latencyMs: 300,
      fallbackUsed: true,
      inputTokens: 200,
      outputTokens: 100,
      costAmount: 0.02,
      costKnown: true,
    });
    metrics.record({
      modelId: 'm',
      provider: 'p',
      success: false,
      latencyMs: 500,
      fallbackUsed: true,
      inputTokens: 0,
      outputTokens: 0,
      costAmount: null,
      costKnown: false,
    });

    const snap = metrics.snapshot();
    expect(snap.requests).toBe(3);
    expect(snap.successes).toBe(2);
    expect(snap.successRate).toBeCloseTo(2 / 3);
    expect(snap.fallbackRate).toBeCloseTo(2 / 3);
    expect(snap.p50LatencyMs).toBe(300);
    expect(snap.p95LatencyMs).toBe(500);
    expect(snap.totalTokens).toBe(450);
    expect(snap.cost.total).toBeCloseTo(0.03);
    expect(snap.cost.unknownSamples).toBe(1);
  });

  it('空样本返回零值', () => {
    const snap = new GatewayMetrics().snapshot();
    expect(snap.requests).toBe(0);
    expect(snap.p95LatencyMs).toBe(0);
  });

  it('percentile 处理边界', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });
});
