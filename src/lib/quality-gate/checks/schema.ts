/**
 * Quality Gate — Schema Check
 *
 * 复用 tinyflow/schema.ts 的 validateWorkflow。
 * 不重复 cycle / singleton / node validity 检查。
 */

import { validateWorkflow } from '@/lib/tinyflow/schema';
import type { GateCheckResult } from '../evaluator';

export function checkSchema(data: unknown): GateCheckResult {
  const start = Date.now();
  const result = validateWorkflow(data);
  const durationMs = Date.now() - start;

  if (!result.valid) {
    return {
      name: 'schema',
      level: 'required',
      status: 'fail',
      message: `Schema 校验失败：${result.errors.map((e) => e.message).join('；')}`,
      details: result.errors,
      durationMs,
    };
  }

  return {
    name: 'schema',
    level: 'required',
    status: 'pass',
    message: 'Schema 校验通过',
    durationMs,
  };
}
