/**
 * Quality Gate — Security Check
 *
 * Heuristic 检查：secret leakage / unsafe config。
 * 不重复 validateWorkflow 的 graph/cycle/node 检查。
 *
 * 注意：这是 heuristic 检查，不能保证完全发现所有 secret leakage。
 * 后续可引入 Secret Reference / Secret Manager 增强。
 */

import type { GateCheckResult } from '../evaluator';
import type { TinyflowData } from '@/lib/tinyflow/types';

/** 常见 API key / secret 模式 */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,                    // OpenAI-style
  /ghp_[a-zA-Z0-9]{36}/,                     // GitHub
  /xoxb-[a-zA-Z0-9-]+/,                      // Slack
  /AKIA[0-9A-Z]{16}/,                         // AWS
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, // PEM
];

export function checkSecurity(data: TinyflowData): GateCheckResult {
  const start = Date.now();
  const issues: string[] = [];

  for (const node of data.nodes) {
    const config = (node.data ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue;
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(value)) {
          issues.push(`节点「${node.data?.title ?? node.id}」的 ${key} 字段可能包含密钥`);
        }
      }
    }
  }

  const durationMs = Date.now() - start;

  if (issues.length > 0) {
    return {
      name: 'security',
      level: 'required',
      status: 'fail',
      message: `安全检查发现问题：${issues.join('；')}`,
      details: { issues },
      durationMs,
    };
  }

  return {
    name: 'security',
    level: 'required',
    status: 'pass',
    message: '安全检查通过',
    durationMs,
  };
}
