/**
 * Skill Schema 校验与输入规范化（Part 一 / 七）
 *
 * - skillDefinition 合法性校验
 * - 按 input schema 校验并规范化运行入参
 * - 生成 API 文档 / UI 渲染所需的 schema 描述
 */

import type {
  SkillDefinitionV1,
  SkillField,
  SkillFieldType,
  SkillInputSchema,
  SkillOutputSchema,
} from './skill-types';

export function validateSkillDefinition(def: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!def || typeof def !== 'object') return { valid: false, errors: ['定义不是对象'] };

  const d = def as Partial<SkillDefinitionV1>;
  if (!d.name || !String(d.name).trim()) errors.push('缺少 name');
  if (!d.description || !String(d.description).trim()) errors.push('缺少 description');
  if (!d.inputs || !Array.isArray(d.inputs.fields)) errors.push('inputs.fields 必须是数组');
  if (!d.outputs || !Array.isArray(d.outputs.fields)) errors.push('outputs.fields 必须是数组');
  if (d.examples !== undefined && !Array.isArray(d.examples)) errors.push('examples 必须是数组');

  const validTypes: SkillFieldType[] = ['string', 'number', 'boolean', 'array', 'object', 'select', 'textarea'];
  const checkField = (f: unknown, scope: string): void => {
    const field = f as Partial<SkillField>;
    if (!field?.name) errors.push(`${scope} 字段缺少 name`);
    if (field?.type && !validTypes.includes(field.type)) errors.push(`${scope}.${field.name} 类型非法: ${field.type}`);
  };
  d.inputs?.fields?.forEach((f) => checkField(f, 'inputs'));
  d.outputs?.fields?.forEach((f) => checkField(f, 'outputs'));

  return { valid: errors.length === 0, errors };
}

/** 按 input schema 校验并规范化运行入参 */
export function resolveSkillInputs(
  inputs: Record<string, unknown>,
  schema: SkillInputSchema,
): { ok: boolean; resolved: Record<string, unknown>; errors: string[] } {
  const resolved: Record<string, unknown> = {};
  const errors: string[] = [];
  const raw = inputs ?? {};

  const coerce = (field: SkillField, value: unknown): unknown => {
    switch (field.type) {
      case 'number': {
        const n = Number(value);
        return Number.isNaN(n) ? value : n;
      }
      case 'boolean': {
        if (value === 'true' || value === true) return true;
        if (value === 'false' || value === false) return false;
        return value;
      }
      case 'array': {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            return [value];
          }
        }
        return value;
      }
      case 'object': {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        }
        return value;
      }
      default:
        return value;
    }
  };

  for (const field of schema.fields) {
    const present = raw[field.name] !== undefined && raw[field.name] !== null && raw[field.name] !== '';
    if (!present) {
      if (field.required) errors.push(`缺少必填输入: ${field.name}`);
      else if (field.defaultValue !== undefined) resolved[field.name] = field.defaultValue;
      continue;
    }
    resolved[field.name] = coerce(field, raw[field.name]);
  }

  return { ok: errors.length === 0, resolved, errors };
}

/** 输出 schema → 字段清单（API 文档用） */
export function outputFieldList(schema: SkillOutputSchema): SkillField[] {
  return schema.fields;
}

/** 输入 schema → JSON Schema（API 调用方文档） */
export function inputsToJsonSchema(schema: SkillInputSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of schema.fields) {
    properties[f.name] = {
      type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string',
      description: f.description ?? f.label ?? f.name,
    };
    if (f.required) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

/** 生成 UI 渲染 schema（Skill Run 页表单） */
export function uiFormSchema(schema: SkillInputSchema): SkillField[] {
  return schema.fields.map((f) => ({
    ...f,
    label: f.label ?? f.name,
    placeholder: f.placeholder,
    defaultValue: f.defaultValue,
  }));
}
