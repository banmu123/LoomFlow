import { createHash } from 'crypto';

// 递归排序对象键，保证相同内容的工作流 hash 一致
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeHash(data: unknown): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}
