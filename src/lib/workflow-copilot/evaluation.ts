/**
 * 确定性 Output Evaluation（Part 2）
 *
 * 不依赖 LLM judge，先实现纯确定性规则：
 * - exact_match      精确相等（对象/数组深比较）
 * - partial_match    部分字段相等（path 指定的子集相等）
 * - contains         字符串包含指定 value
 * - json_path        按 JSONPath 提取后与 value 比较（支持 $ 点 / 数组下标）
 * - numeric_tolerance 数值容差（绝对值 / 百分比）
 * - array_contains   数组包含指定元素
 * - json_schema      JSON schema 校验（path 指向对象；required 字段）
 */

export type EvaluationType =
  | 'exact_match'
  | 'partial_match'
  | 'contains'
  | 'json_path'
  | 'numeric_tolerance'
  | 'array_contains'
  | 'json_schema';

/** 单条评估规则（对应需求中的声明式 JSON） */
export interface EvaluationRule {
  id?: string;
  /** 规则类型 */
  type: EvaluationType;
  /** 从「最终输出」提取的路径，如 "$.summary" / "$.text" / "$"；缺省 "$"（整体） */
  path?: string;
  /** 期望值（exact/contains/json_path/numeric_tolerance/array_contains 用） */
  value?: unknown;
  /** json_schema：必填字段路径列表 */
  required?: string[];
  /** json_schema：目标必须为对象 */
  requiredObject?: boolean;
  /** numeric_tolerance 容差 */
  tolerance?: number;
  /** numeric_tolerance：容差为百分比（默认绝对值） */
  tolerancePercent?: boolean;
  /** 期望数组（array_contains 用 value 即可，这里兼容） */
  expected?: unknown[];
  /** 取反（期望「不匹配」） */
  negate?: boolean;
}

export interface EvaluationResult {
  ruleId?: string;
  type: EvaluationType;
  path: string;
  success: boolean;
  /** 实际提取到的值（脱敏/截断后写入） */
  actual?: unknown;
  expected?: unknown;
  message: string;
}

export interface EvaluationSummary {
  overall: 'pass' | 'fail';
  total: number;
  passed: number;
  failed: number;
  results: EvaluationResult[];
}

/** 从 finalOutput 对象按路径取值 */
export function getByPath(root: unknown, path?: string): unknown {
  const p = path?.trim();
  if (!p || p === '$') return root;
  const expr = p.startsWith('$') ? p.slice(1) : p;
  const segments = expr
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (Number.isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if ((a as unknown[]).length !== (b as unknown[]).length) return false;
    return (a as unknown[]).every((el, i) => deepEqual(el, (b as unknown[])[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.join(',') !== bKeys.join(',')) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}

function extractIds(rule: EvaluationRule): string {
  return rule.id ? `[${rule.id}] ` : '';
}

function stringify(v: unknown): string {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(v: unknown, max = 200): unknown {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…` : v;
  if (v && typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > max ? `${s.slice(0, max)}…` : v;
    } catch {
      return v;
    }
  }
  return v;
}

/** 单条规则评估 */
export function evaluateRule(actualRoot: unknown, rule: EvaluationRule): EvaluationResult {
  const path = rule.path?.trim() || '$';
  const actual = getByPath(actualRoot, path);
  const type = rule.type;
  let success = false;
  let message = '';

  switch (type) {
    case 'exact_match':
      success = deepEqual(actual, rule.value);
      message = success
        ? '精确匹配'
        : `期望 ${stringify(rule.value)}，实际 ${stringify(actual)}`;
      break;
    case 'partial_match': {
      // 仅比较实际输出中与期望共有的字段（部分匹配）
      if (rule.value && typeof rule.value === 'object' && actual && typeof actual === 'object') {
        const exp = rule.value as Record<string, unknown>;
        const acc = actual as Record<string, unknown>;
        success = Object.keys(exp).every((k) => deepEqual(acc[k], exp[k]));
        message = success ? '部分字段匹配' : `部分字段不匹配（实际 ${stringify(actual)}）`;
      } else {
        success = deepEqual(actual, rule.value);
        message = success ? '匹配' : `期望 ${stringify(rule.value)}`;
      }
      break;
    }
    case 'contains':
      success = typeof actual === 'string' && actual.includes(String(rule.value ?? ''));
      message = success
        ? `包含 "${rule.value}"`
        : `期望包含 "${rule.value}"，实际 ${stringify(actual)}`;
      break;
    case 'json_path':
      success = deepEqual(actual, rule.value);
      message = success
        ? `路径 ${path} 匹配`
        : `路径 ${path} 期望 ${stringify(rule.value)}，实际 ${stringify(actual)}`;
      break;
    case 'numeric_tolerance': {
      const target = Number(rule.value);
      const got = Number(actual);
      if (Number.isNaN(target) || Number.isNaN(got)) {
        success = false;
        message = `数值无法比较（实际 ${stringify(actual)}）`;
      } else {
        const tol = Number(rule.tolerance ?? 0);
        const diff = Math.abs(got - target);
        const allowed = rule.tolerancePercent ? (target / 100) * tol : tol;
        success = diff <= allowed;
        message = success
          ? `数值在容差内（${got} ≈ ${target} ±${allowed}）`
          : `数值超出容差（实际 ${got}，期望 ${target} ±${allowed}）`;
      }
      break;
    }
    case 'array_contains': {
      if (Array.isArray(actual)) {
        const arr = actual as unknown[];
        success = arr.some((el) => deepEqual(el, rule.value));
        message = success
          ? `数组包含 ${stringify(rule.value)}`
          : `数组不包含 ${stringify(rule.value)}（长度 ${arr.length}）`;
      } else {
        success = false;
        message = `路径 ${path} 不是数组（实际 ${stringify(actual)}）`;
      }
      break;
    }
    case 'json_schema': {
      if (rule.requiredObject && (!actual || typeof actual !== 'object' || Array.isArray(actual))) {
        success = false;
        message = `路径 ${path} 不是对象`;
      } else {
        const required = rule.required ?? [];
        const missing = required.filter((r) => getByPath(actual, r) === undefined);
        success = missing.length === 0;
        message = success
          ? `schema 校验通过`
          : `schema 校验失败：缺少字段 ${missing.join(', ')}`;
      }
      break;
    }
    default:
      message = `未知规则类型: ${type}`;
  }

  if (rule.negate) {
    success = !success;
    message = success ? message : `（取反后不通过）${message}`;
  }

  return {
    ruleId: rule.id,
    type,
    path,
    success,
    actual: truncate(actual),
    expected: rule.value,
    message,
  };
}

/** 用一组规则评估最终输出 */
export function evaluateOutput(
  actualOutput: Record<string, unknown>,
  rules: EvaluationRule[],
): EvaluationSummary {
  const results = rules.map((r) => evaluateRule(actualOutput, r));
  const passed = results.filter((r) => r.success).length;
  return {
    overall: passed === results.length && results.length > 0 ? 'pass' : 'fail',
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

/** （可选）对最终输出的根引用：users 常指向 endNode 的输出，这里保留整体输出对象 */
export function fieldLabel(field?: string): string {
  return field?.trim() || '$';
}
