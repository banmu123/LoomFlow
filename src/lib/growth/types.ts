// ===== Growth System 基础模型（Goal / Journey / Capability）=====

export type GoalStatus = 'active' | 'paused' | 'done';
export type JourneyStatus = 'active' | 'archived';
export type CapabilityStatus = 'locked' | 'exploring' | 'developing' | 'mastered';

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  created_at: string;
  updated_at: string;
}

export interface Journey {
  id: string;
  goal_id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: JourneyStatus;
  created_at: string;
  updated_at: string;
}

export interface Capability {
  id: string;
  journey_id: string;
  user_id: string;
  title: string;
  description: string | null;
  order: number;
  status: CapabilityStatus;
  prerequisites: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const GOAL_STATUSES: GoalStatus[] = ['active', 'paused', 'done'];
export const JOURNEY_STATUSES: JourneyStatus[] = ['active', 'archived'];
export const CAPABILITY_STATUSES: CapabilityStatus[] = [
  'locked',
  'exploring',
  'developing',
  'mastered',
];

// ===== 校验 =====

export function isValidGoalStatus(s: string): s is GoalStatus {
  return (GOAL_STATUSES as readonly string[]).includes(s);
}
export function isValidJourneyStatus(s: string): s is JourneyStatus {
  return (JOURNEY_STATUSES as readonly string[]).includes(s);
}
export function isValidCapabilityStatus(s: string): s is CapabilityStatus {
  return (CAPABILITY_STATUSES as readonly string[]).includes(s);
}

export function validateGoalInput(input: { title?: unknown; description?: unknown }): {
  title?: string;
  description?: string | null;
  error?: string;
} {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { error: '目标标题不能为空' };
  if (title.length > 200) return { error: '目标标题过长（最多 200 字符）' };
  const description =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null;
  return { title, description };
}

export function validateJourneyInput(input: {
  title?: unknown;
  description?: unknown;
}): { title?: string; description?: string | null; error?: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { error: '路径标题不能为空' };
  if (title.length > 200) return { error: '路径标题过长（最多 200 字符）' };
  const description =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null;
  return { title, description };
}

// ===== 默认值 =====

export function defaultCapability(
  order: number,
  overrides: Partial<Omit<Capability, 'id' | 'journey_id' | 'user_id' | 'created_at' | 'updated_at'>> = {},
): Omit<Capability, 'id' | 'journey_id' | 'user_id' | 'created_at' | 'updated_at'> {
  return {
    title: overrides.title ?? `阶段 ${order + 1}`,
    description: overrides.description ?? null,
    order,
    status: overrides.status ?? 'locked',
    prerequisites: overrides.prerequisites ?? [],
    metadata: overrides.metadata ?? {},
  };
}
