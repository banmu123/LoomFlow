import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { isSafeHttpUrl } from '@/lib/url-security';

// 请求超时与响应体上限（SSRF 防护 + 资源限制）
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024; // 1MB
const MAX_REDIRECTS = 5;

export class HttpExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.url) return 'HTTP 节点缺少 url';
    return null;
  }

  async execute(
    node: FlowNode,
    context: FlowContext,
    _subFlowRunner?: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const data = node.data;
    const method = (data.method || 'GET').toUpperCase();
    const url = data.url ? this.paramResolver.interpolateTemplate(data.url, context) : '';

    if (!url) throw new Error('HTTP 节点缺少 URL');

    // 超时从节点配置读取（configSchema 字段）；必须为正数，非法值回退默认
    const timeout = Number(data.timeout);
    const requestTimeoutMs = Number.isFinite(timeout) && timeout > 0
      ? Math.min(timeout, 60) * 1000
      : REQUEST_TIMEOUT_MS;

    // 解析 headers
    const headers: Record<string, string> = {};
    for (const h of data.headers || []) {
      const key = h.name || '';
      const val = this.paramResolver.resolve(h, context);
      if (key) headers[key] = String(val);
    }

    // 解析 body
    let body: BodyInit | undefined;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const bodyType = data.bodyType || 'json';
      if (bodyType === 'json' && data.bodyJson) {
        const interpolated = this.paramResolver.interpolateTemplate(data.bodyJson, context);
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        body = interpolated;
      } else if (bodyType === 'raw' && data.bodyRaw) {
        body = this.paramResolver.interpolateTemplate(data.bodyRaw, context);
      } else if (bodyType === 'form-data' && data.formData) {
        const formData = new FormData();
        for (const field of data.formData) {
          const key = field.name || '';
          const val = this.paramResolver.resolve(field, context);
          if (key) formData.append(key, String(val));
        }
        body = formData;
      } else if (bodyType === 'form-urlencoded' && data.formUrlencoded) {
          const params = new URLSearchParams();
          for (const field of data.formUrlencoded) {
            const key = field.name || '';
            const val = this.paramResolver.resolve(field, context);
            if (key) params.append(key, String(val));
          }
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body = params.toString();
        }
    }

    // ===== SSRF 防护：逐跳校验 URL（含 DNS 解析后校验内网地址）=====
    let currentUrl = url;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const check = await isSafeHttpUrl(currentUrl);
      if (!check.ok) {
        throw new Error(`HTTP 节点请求被拒绝：${check.reason}`);
      }

      response = await fetch(currentUrl, {
        method,
        headers,
        body,
        redirect: 'manual',
        // 合并运行时取消信号 + 节点超时信号：取消/超时可立即中止在途请求
        signal: signal
          ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([
              signal,
              AbortSignal.timeout(requestTimeoutMs),
            ])
          : AbortSignal.timeout(requestTimeoutMs),
      });

      // 手动跟随重定向（每跳重新校验，防重定向到内网）
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        if (!location) break;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    if (!response) {
      throw new Error('HTTP 请求无响应');
    }

    // 限制响应体大小（读流截断，防内网服务大响应耗尽内存）
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`响应体超过 ${MAX_BODY_BYTES / 1024 / 1024}MB 限制`);
        }
        chunks.push(value);
      }
    }
    const buffer = Buffer.concat(chunks);

    let result: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        result = JSON.parse(buffer.toString('utf8'));
      } catch {
        result = buffer.toString('utf8');
      }
    } else {
      result = buffer.toString('utf8');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: result,
    };
  }
}
