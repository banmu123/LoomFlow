/**
 * Quality Gate — Policy Model
 *
 * 纯类型 + 默认策略。
 * Policy 由服务端决定，客户端不能覆盖。
 */

export type GateLevel = 'required' | 'advisory';
export type GateCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type GateDecision = 'allow' | 'warning' | 'block';

export interface GateCheckPolicy {
  enabled: boolean;
  level: GateLevel;
}

export interface QualityGatePolicy {
  schema: GateCheckPolicy & { level: 'required' };
  security: GateCheckPolicy & { level: 'required' };
  staticAnalysis: GateCheckPolicy & { maxErrors?: number };
  tests: GateCheckPolicy & { minPassRate?: number; requireAtLeastOne?: boolean };
  regression: GateCheckPolicy & { blockOnCritical?: boolean };
  cost: GateCheckPolicy & { maxCostPerRun?: number };
}

export const DEFAULT_POLICY: QualityGatePolicy = {
  schema:         { enabled: true, level: 'required' },
  security:       { enabled: true, level: 'required' },
  staticAnalysis: { enabled: true, level: 'required', maxErrors: 0 },
  tests:          { enabled: true, level: 'required', minPassRate: 1.0, requireAtLeastOne: false },
  regression:     { enabled: true, level: 'advisory', blockOnCritical: false },
  cost:           { enabled: true, level: 'advisory', maxCostPerRun: 0.05 },
};

/** Gate evaluation 有效期（30 分钟） */
export const GATE_EVALUATION_TTL_MS = 30 * 60 * 1000;
