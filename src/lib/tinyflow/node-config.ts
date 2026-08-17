import type { NodeConfigField } from './node-definition';

// ===== configSchema 工具：默认值 / 校验 / 动态选项（供属性面板与执行器共用）=====

/** 解析 configSchema 中的动态选项（optionsProvider → 静态 options）；返回无 provider 的 schema */
export async function resolveConfigOptions(
  schema: NodeConfigField[],
): Promise<NodeConfigField[]> {
  const resolved: NodeConfigField[] = [];
  for (const field of schema) {
    if (field.type === 'select' && field.optionsProvider) {
      try {
        const options = await field.optionsProvider();
        resolved.push({ ...field, options, optionsProvider: undefined });
      } catch {
        resolved.push({ ...field, optionsProvider: undefined });
      }
    } else {
      resolved.push(field);
    }
  }
  return resolved;
}

/** 根据 configSchema 生成节点配置默认值 */
export function getConfigDefaults(schema?: NodeConfigField[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of schema ?? []) {
    if (field.default !== undefined) {
      defaults[field.name] = field.default;
    }
  }
  return defaults;
}

/** 校验配置值（按 configSchema 字段约束）——返回错误信息列表 */
export function validateConfig(
  schema: NodeConfigField[],
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const field of schema) {
    const value = values[field.name];

    // 必填
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field.label} 不能为空`);
      continue;
    }
    if (value === undefined || value === null) continue;

    // 类型与范围
    switch (field.type) {
      case 'number': {
        const num = Number(value);
        if (Number.isNaN(num)) {
          errors.push(`${field.label} 必须是数字`);
        } else {
          if (field.min !== undefined && num < field.min) {
            errors.push(`${field.label} 不能小于 ${field.min}`);
          }
          if (field.max !== undefined && num > field.max) {
            errors.push(`${field.label} 不能大于 ${field.max}`);
          }
        }
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push(`${field.label} 必须是布尔值`);
        }
        break;
      }
      case 'select': {
        if (field.options && !field.options.some((o) => o.value === value)) {
          errors.push(`${field.label} 选项不合法`);
        }
        break;
      }
      default:
        break;
    }
  }
  return errors;
}

/** 将表单值合并进节点配置（只写 schema 声明过的字段，保留未声明字段） */
export function mergeConfig(
  original: Record<string, unknown>,
  schema: NodeConfigField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...original };
  for (const field of schema) {
    if (values[field.name] !== undefined) {
      merged[field.name] = values[field.name];
    }
  }
  return merged;
}
