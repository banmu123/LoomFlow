// Skill 前端共享类型（与后端 skill-types 对齐）
export type SkillStatus = 'draft' | 'published' | 'archived';

export interface SkillField {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string | number; label: string }>;
}

export interface SkillDefinition {
  schemaVersion: number;
  name: string;
  description: string;
  inputs: { fields: SkillField[] };
  outputs: { fields: SkillField[] };
  examples?: Array<{ inputs: Record<string, unknown>; outputs: Record<string, unknown>; description?: string }>;
  usageInstructions?: string;
  constraints?: string[];
}

export interface SkillRecord {
  id: string;
  userId: string;
  workflowId: string;
  workflowVersion: number | null;
  title: string;
  definition: SkillDefinition;
  executionPolicy: { timeoutMs: number; maxConcurrency?: number; rateLimitPerMin?: number; requireApproval?: boolean };
  publishedTargets: { webUi: boolean; api: boolean; share: boolean; shareToken?: string | null };
  status: SkillStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRunResult {
  runId: string;
  skillId: string;
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCost: number;
  workflowVersion?: number | null;
}

export interface SkillQualityResult {
  quality: {
    successRate: number;
    latencyMs: number;
    tokenUsage: number;
    estimatedCost: number;
    testPassRate: number;
    errorRate: number;
    qualityScore: number;
    risk: 'low' | 'medium' | 'high';
    totalRuns: number;
  };
  improvements: string[];
}
