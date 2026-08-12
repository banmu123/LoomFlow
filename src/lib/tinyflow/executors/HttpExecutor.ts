import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class HttpExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.url) return 'HTTP 节点缺少 url';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const method = (data.method || 'GET').toUpperCase();
    const url = data.url ? this.paramResolver.interpolateTemplate(data.url, context) : '';

    if (!url) throw new Error('HTTP 节点缺少 URL');

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

    const response = await fetch(url, { method, headers, body });

    let result: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      result = await response.json();
    } else {
      result = await response.text();
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
