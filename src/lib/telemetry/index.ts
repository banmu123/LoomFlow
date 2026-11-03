import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  metrics,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

/**
 * OpenTelemetry 初始化与轻量封装。
 *
 * 原则：
 * - 未配置 OTEL_ENABLED=true 时是彻底的 no-op（不产生额外开销、不尝试连接）；
 * - 只导出到 OTLP（Collector 由部署方决定，不绑定商业平台）；
 * - Span 属性白名单化：绝不写入 API Key / Authorization / 用户正文。
 */

let sdk: NodeSDK | null = null;
let enabled = false;
let serviceName = 'loomflow';

const SENSITIVE_KEY = /(api[-_]?key|authorization|token|secret|password|cookie|set-cookie)/i;
const MAX_ATTRIBUTE_LENGTH = 512;

export function isTelemetryEnabled(): boolean {
  return enabled;
}

function resolveEndpoints(): { trace?: string; metric?: string } {
  const base = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim().replace(/\/+$/, '');
  const trace =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    (base ? `${base}/v1/traces` : undefined);
  const metric =
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    (base ? `${base}/v1/metrics` : undefined);
  return { trace, metric };
}

export function initTelemetry(name = 'loomflow'): boolean {
  serviceName = name;
  if (process.env.OTEL_ENABLED !== 'true') return false;
  if (sdk) return true;

  const { trace: traceUrl, metric: metricUrl } = resolveEndpoints();
  if (!traceUrl && !metricUrl) {
    console.warn('[telemetry] OTEL_ENABLED=true 但未配置 OTLP endpoint，已跳过初始化');
    return false;
  }

  const ratio = Number(process.env.OTEL_SAMPLING_RATIO ?? '0.1');
  const samplerRatio = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0.1;

  try {
    sdk = new NodeSDK({
      serviceName: name,
      sampler: new TraceIdRatioBasedSampler(samplerRatio),
      traceExporter: new OTLPTraceExporter(traceUrl ? { url: traceUrl } : {}),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(metricUrl ? { url: metricUrl } : {}),
          exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 30_000),
        }),
      ],
    });

    sdk.start();
    enabled = true;
    console.log(`[telemetry] started service=${name} sampler=${samplerRatio}`);
    return true;
  } catch (err) {
    console.warn('[telemetry] 初始化失败，降级为 no-op：', (err as Error).message);
    sdk = null;
    enabled = false;
    return false;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // 关闭失败不影响进程退出
  } finally {
    sdk = null;
    enabled = false;
  }
}

/** 属性清洗：丢弃敏感键、截断长字符串、过滤不可序列化值 */
export function sanitizeAttributes(attributes: Record<string, unknown>): Attributes {
  const output: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined || value === null) continue;

    if (typeof value === 'string') {
      output[key] = value.length > MAX_ATTRIBUTE_LENGTH ? value.slice(0, MAX_ATTRIBUTE_LENGTH) : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      output[key] = value.slice(0, 32);
    }
    // 对象/函数一律丢弃，避免把用户内容或大对象写进 Span
  }

  return output;
}

/**
 * 包裹一段逻辑：成功置 OK，异常记录 exception 并置 ERROR。
 * telemetry 关闭时不创建 Span，直接执行业务逻辑。
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: Span | undefined) => Promise<T> | T,
  options: { kind?: SpanKind; context?: Context } = {},
): Promise<T> {
  if (!enabled) return fn(undefined);

  const tracer = trace.getTracer(serviceName);
  const span = tracer.startSpan(name, {
    kind: options.kind ?? SpanKind.INTERNAL,
    attributes: sanitizeAttributes(attributes),
  });
  const ctx = options.context ?? otelContext.active();

  return otelContext.with(trace.setSpan(ctx, span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

export interface TraceContextInfo {
  traceId: string;
  spanId: string;
  traceparent: string;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function currentTraceContext(): TraceContextInfo | null {
  const span = trace.getActiveSpan();
  if (!span) return null;
  const ctx = span.spanContext();
  if (!ctx.traceId || !ctx.spanId) return null;
  const flags = (ctx.traceFlags & 1) === 1 ? '01' : '00';
  return { traceId: ctx.traceId, spanId: ctx.spanId, traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}` };
}

/** 解析 W3C traceparent；非法输入返回 null（不做兼容性猜测） */
export function parseTraceparent(value: string | null | undefined): TraceContextInfo | null {
  if (!value) return null;
  const match = TRACEPARENT.exec(value.trim());
  if (!match) return null;
  const [, traceId, spanId, flags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-${flags}` };
}

/** 从 traceparent 构造远程父上下文（Worker 恢复链路） */
export function contextFromTraceparent(value: string | null | undefined): Context | null {
  const parsed = parseTraceparent(value);
  if (!parsed) return null;
  const spanContext = {
    traceId: parsed.traceId,
    spanId: parsed.spanId,
    traceFlags: Number.parseInt(parsed.traceparent.slice(-2), 16),
    isRemote: true,
  };
  return trace.setSpan(otelContext.active(), trace.wrapSpanContext(spanContext));
}

/** 把当前 trace 注入出站请求头（W3C 标准） */
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  const current = currentTraceContext();
  if (current && !headers.traceparent) headers.traceparent = current.traceparent;
  return headers;
}

// ===== Metrics（低基数标签：只允许 method/route/status/model/provider/result）=====

const meter = () => metrics.getMeter(serviceName);

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  if (!enabled) return;
  const m = meter();
  m.createHistogram('http.server.duration', { unit: 'ms' }).record(input.durationMs, {
    'http.method': input.method,
    'http.route': input.route,
    'http.status_code': input.status,
  });
  m.createCounter('http.server.requests').add(1, {
    'http.method': input.method,
    'http.route': input.route,
    'http.status_code': input.status,
  });
}

export function recordModelCall(input: {
  modelId: string;
  provider: string;
  success: boolean;
  durationMs: number;
  fallbackUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}): void {
  if (!enabled) return;
  const m = meter();
  const attrs = {
    'gen_ai.request.model': input.modelId,
    'gen_ai.provider.name': input.provider,
    'gen_ai.request.fallback': input.fallbackUsed,
    outcome: input.success ? 'success' : 'failure',
  };
  m.createHistogram('gen_ai.client.duration', { unit: 'ms' }).record(input.durationMs, attrs);
  m.createCounter('gen_ai.client.requests').add(1, attrs);
  if (input.inputTokens > 0 || input.outputTokens > 0) {
    m.createHistogram('gen_ai.client.tokens').record(input.inputTokens, {
      ...attrs,
      'gen_ai.token.type': 'input',
    });
    m.createHistogram('gen_ai.client.tokens').record(input.outputTokens, {
      ...attrs,
      'gen_ai.token.type': 'output',
    });
  }
  if (input.cost !== null) {
    m.createHistogram('gen_ai.client.cost', { unit: 'USD' }).record(input.cost, attrs);
  }
}

export function recordJobEvent(input: {
  event: 'claimed' | 'succeeded' | 'failed' | 'retried' | 'reaped';
  durationMs?: number;
}): void {
  if (!enabled) return;
  const m = meter();
  m.createCounter('workflow.jobs').add(1, { event: input.event });
  if (typeof input.durationMs === 'number') {
    m.createHistogram('workflow.job.duration', { unit: 'ms' }).record(input.durationMs, {
      event: input.event,
    });
  }
}
