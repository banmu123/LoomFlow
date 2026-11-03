/** 网关指标：进程内聚合，可直接挂到 Workflow Execution Trace。 */

export interface GatewayMetricSample {
  modelId: string;
  provider: string;
  success: boolean;
  latencyMs: number;
  fallbackUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  costAmount: number | null;
  costKnown: boolean;
}

export interface GatewayMetricsSnapshot {
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  failureRate: number;
  fallbackRequests: number;
  fallbackRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: { total: number; knownSamples: number; unknownSamples: number };
}

const MAX_SAMPLES = 2_000;

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

export class GatewayMetrics {
  private samples: GatewayMetricSample[] = [];
  private counters = { requests: 0, successes: 0, failures: 0, fallbacks: 0 };

  record(sample: GatewayMetricSample): void {
    this.counters.requests += 1;
    if (sample.success) this.counters.successes += 1;
    else this.counters.failures += 1;
    if (sample.fallbackUsed) this.counters.fallbacks += 1;

    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
  }

  snapshot(): GatewayMetricsSnapshot {
    const latencies = this.samples.map((s) => s.latencyMs);
    const inputTokens = this.samples.reduce((sum, s) => sum + s.inputTokens, 0);
    const outputTokens = this.samples.reduce((sum, s) => sum + s.outputTokens, 0);
    const known = this.samples.filter((s) => s.costKnown);
    const totalCost = known.reduce((sum, s) => sum + (s.costAmount ?? 0), 0);
    const { requests, successes, failures, fallbacks } = this.counters;

    return {
      requests,
      successes,
      failures,
      successRate: requests > 0 ? successes / requests : 0,
      failureRate: requests > 0 ? failures / requests : 0,
      fallbackRequests: fallbacks,
      fallbackRate: requests > 0 ? fallbacks / requests : 0,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: {
        total: Math.round(totalCost * 1_000_000) / 1_000_000,
        knownSamples: known.length,
        unknownSamples: this.samples.length - known.length,
      },
    };
  }

  reset(): void {
    this.samples = [];
    this.counters = { requests: 0, successes: 0, failures: 0, fallbacks: 0 };
  }
}

export const gatewayMetrics = new GatewayMetrics();
