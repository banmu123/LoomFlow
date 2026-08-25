/**
 * Skill 领域模型
 *
 * Workflow = How to execute
 * Skill    = What this automation can do
 *
 * Skill 复用 Workflow Runtime（不建第二套执行引擎），
 * 可回溯到 workflowVersion；发布前须经过 Validation + Test。
 */

export type SkillFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'select'
  | 'textarea';

export interface SkillField {
  /** 字段名（inputs.key / outputs.key / UI 渲染键） */
  name: string;
  type: SkillFieldType;
  required?: boolean;
  description?: string;
  /** UI schema：label / placeholder / 选项 / 默认值 */
  label?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: Array<{ value: string | number; label: string }>;
  /** JSON schema 补充 */
  items?: { type?: SkillFieldType };
}

export interface SkillInputSchema {
  fields: SkillField[];
}

export interface SkillOutputSchema {
  fields: SkillField[];
}

export interface SkillExample {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  description?: string;
}

export interface SkillDefinitionV1 {
  schemaVersion: 1;
  name: string;
  description: string;
  inputs: SkillInputSchema;
  outputs: SkillOutputSchema;
  examples: SkillExample[];
  /** 使用说明 */
  usageInstructions?: string;
  /** 约束（AI 生成时明确） */
  constraints?: string[];
}

export interface SkillPublic {
  id: string;
  userId: string;
  workflowId: string;
  /** 当前绑定的工作流版本号 */
  workflowVersion: number | null;
  title: string;
  definition: SkillDefinitionV1;
  /** 执行策略 */
  executionPolicy: {
    timeoutMs: number;
    maxConcurrency?: number;
    rateLimitPerMin?: number;
    requireApproval?: boolean;
  };
  /** 评估规则（复用 copilot EvaluationRule） */
  evaluationRules?: Array<Record<string, unknown>>;
  publishedTargets: {
    webUi: boolean;
    api: boolean;
    share: boolean;
    /** share link token */
    shareToken?: string | null;
  };
  status: 'draft' | 'published' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  version: number;
  workflowId: string;
  workflowVersion: number | null;
  title: string;
  definition: SkillDefinitionV1;
  evaluationRules?: Array<Record<string, unknown>>;
  status: 'candidate' | 'published';
  createdAt: string;
}

export interface SkillQuality {
  successRate: number;      // 0-100
  latencyMs: number;        // 平均耗时
  tokenUsage: number;       // 平均 token
  estimatedCost: number;    // 平均成本（估）
  testPassRate: number;     // 测试通过率 0-100
  errorRate: number;        // 0-100
  qualityScore: number;     // 0-100 综合
  risk: 'low' | 'medium' | 'high';
  totalRuns: number;
  improvements?: string[];
}

export interface SkillRunLog {
  runId: string;
  skillId: string;
  skillVersion: number | null;
  workflowVersion: number | null;
  inputs: Record<string, unknown>;
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCost: number;
  rateLimited?: boolean;
  ranAt: string;
}
