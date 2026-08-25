/**
 * 敏感字段脱敏：写入 trace / inputs / outputs 时，避免 API Key 等明文落库。
 * 注意：不默认记录完整敏感输入。
 */

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|passwd|token|cookie|credential|bearer|private[_-]?key)/i;

const SENSITIVE_VALUE_PATTERN =
  /^(sk-|ffk_|eyJ|Bearer\s)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function isSensitiveValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value.length >= 20 || SENSITIVE_VALUE_PATTERN.test(value))
  );
}

const REDACTED = '[REDACTED]';

/**
 * 递归脱敏：替换敏感 key 的值；对疑似敏感长串也脱敏。
 * maxDepth 防止深层循环结构撑爆。
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }

  if (isSensitiveValue(value)) return REDACTED;
  return value;
}

/** 对顶层 JSON 可序列化对象脱敏（用于 inputs/outputs/events 落库前） */
export function redactForTrace(value: unknown): unknown {
  if (value === undefined) return undefined;
  return redactValue(value);
}
