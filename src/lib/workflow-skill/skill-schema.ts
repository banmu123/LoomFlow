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

/** 字段类型别名 → 合法 SkillFieldType（AI 生成输出常用变体） */
const FIELD_TYPE_ALIASES: Record<string, SkillFieldType> = {
  text: 'string',
  str: 'string',
  longtext: 'textarea',
  multiline: 'textarea',
  int: 'number',
  integer: 'number',
  float: 'number',
  bool: 'boolean',
  list: 'array',
  enum: 'select',
  map: 'object',
};

/**
 * 宽容规范化 AI 生成的 Skill 定义（幂等）：
 * - inputs/outputs 直接是数组时包装为 {fields: [...]}
 * - 字段 type 常见别名归一（text→string、bool→boolean 等）
 * - 缺 schemaVersion 时补 1
 * 规范化后再走 validateSkillDefinition，可显著提高 NL 生成成功率。
 */
export function normalizeSkillDefinition(def: unknown): unknown {
  if (!def || typeof def !== 'object') return def;
  const d = def as Record<string, unknown>;

  const normalizeFields = (io: unknown): unknown => {
    // LLM 常把 inputs/outputs 直接输出为数组 → 包装成 {fields}
    const rawFields = Array.isArray(io) ? io : (io as Record<string, unknown> | null)?.fields;
    if (!Array.isArray(rawFields)) return io; // 无法理解的结构，留给校验器报错
    return {
      ...(io && typeof io === 'object' && !Array.isArray(io) ? io : {}),
      fields: rawFields.map((f) => {
        if (!f || typeof f !== 'object') return f;
        const field = f as Record<string, unknown>;
        const alias =
          typeof field.type === 'string' ? FIELD_TYPE_ALIASES[field.type.toLowerCase()] : undefined;
        return alias ? { ...field, type: alias } : field;
      }),
    };
  };

  return {
    ...d,
    schemaVersion: (d.schemaVersion as number) ?? 1,
    inputs: normalizeFields(d.inputs),
    outputs: normalizeFields(d.outputs),
  };
}

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
