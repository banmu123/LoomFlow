// ===== Brew Notes 共享定义（纯类型/常量，client 组件可安全引用）=====

export const NOTE_TYPES = [
  'general',
  'decision',
  'problem',
  'solution',
  'optimization',
  'usage',
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

export interface WorkflowNote {
  id: string;
  workflow_id: string;
  user_id: string;
  version: number | null;
  type: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export const NOTE_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  decision: 'Decision',
  problem: 'Problem',
  solution: 'Solution',
  optimization: 'Optimization',
  usage: 'Usage',
};

export function isValidNoteType(type: string): type is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(type);
}
