import type { Parameter, FlowContext, FlowNode } from '../types';

/**
 * 参数解析器
 *
 * 解析规则:
 * - refType = 'ref' → 从上游节点输出或 inputs 解析
 * - refType = 'fixed' → 直接取 value
 * - refType = 'input' → 从 inputs 解析
 * - refType = 'form' → 从用户提交的 confirmData 解析
 */
export class ParameterResolver {
  private graphParser: { getNode: (id: string) => FlowNode | undefined };

  constructor(graphParser: {
    getNode: (id: string) => FlowNode | undefined;
  }) {
    this.graphParser = graphParser;
  }

  resolve(
    param: Parameter,
    context: FlowContext
  ): unknown {
    const refType = param.refType || 'fixed';

    switch (refType) {
      case 'fixed':
        return this.resolveFixed(param);
      case 'ref':
        return this.resolveRef(param, context);
      case 'input':
        return this.resolveInput(param, context);
      case 'form':
        return this.resolveForm(param, context);
      default:
        return param.value ?? '';
    }
  }

  resolveList(
    params: Parameter[] | undefined,
    context: FlowContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (!params) return result;

    for (const param of params) {
      const key = param.name || param.id || 'unknown';
      result[key] = this.resolve(param, context);
    }
    return result;
  }

  private resolveFixed(param: Parameter): unknown {
    const { dataType, value } = param;
    if (!value) return '';

    switch (dataType) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value === 'true' || value === '1';
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      case 'string':
      default:
        return value;
    }
  }

  private resolveRef(param: Parameter, context: FlowContext): unknown {
    const ref = param.ref;
    if (!ref) return param.value ?? '';

    // ref 格式: "nodeId.fieldName" 或 "nodeId.fieldName.subField"
    const parts = ref.split('.');
    if (parts.length < 2) return undefined;

    const [nodeId, ...fieldParts] = parts;
    const field = fieldParts.join('.');

    if (nodeId === 'input' || nodeId === 'inputs') {
      return this.getNestedValue(context.inputs, field);
    }

    const nodeOutput = context.nodeOutputs.get(nodeId);
    if (!nodeOutput) return undefined;

    return this.getNestedValue(nodeOutput, field);
  }

  private resolveInput(param: Parameter, context: FlowContext): unknown {
    const key = param.name || param.ref || param.id || '';
    if (!key) return param.value ?? '';

    if (context.inputs[key] !== undefined) {
      return context.inputs[key];
    }
    // 尝试 ref 路径
    if (param.ref) {
      return this.getNestedValue(context.inputs, param.ref);
    }
    return param.defaultValue ?? param.value ?? '';
  }

  private resolveForm(param: Parameter, context: FlowContext): unknown {
    const key = param.name || param.id || '';
    const formData = context.inputs._confirmData as Record<string, unknown> | undefined;
    if (!formData) return param.defaultValue ?? '';

    return formData[key] ?? param.defaultValue ?? '';
  }

  /** 支持点号路径取值 */
  getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    if (!path) return obj;
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /** 将 `{{var}}` 占位符替换为实际值 */
  interpolateTemplate(
    template: string,
    context: FlowContext
  ): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
      const trimmed = expr.trim();

      // 尝试直接 ref 解析: nodeId.fieldName
      if (trimmed.includes('.')) {
        const parts = trimmed.split('.');
        const nodeId = parts[0];
        const field = parts.slice(1).join('.');

        if (nodeId === 'input' || nodeId === 'inputs') {
          const val = this.getNestedValue(context.inputs, field);
          return val !== undefined ? String(val) : '';
        }

        const nodeOutput = context.nodeOutputs.get(nodeId);
        if (nodeOutput) {
          const val = this.getNestedValue(nodeOutput, field);
          return val !== undefined ? String(val) : '';
        }
      }

      // 尝试从 inputs 中直接取
      const inputVal = context.inputs[trimmed];
      if (inputVal !== undefined) return String(inputVal);

      // 尝试从所有 node outputs 中搜索
      for (const [, outputs] of context.nodeOutputs) {
        const val = this.getNestedValue(outputs, trimmed);
        if (val !== undefined) return String(val);
      }

      return '';
    });
  }
}
