import { supabase } from '@/lib/supabase/server';

// ===== Brew Notes：工作流设计笔记（server 服务）=====
// 类型/常量见 workflow-notes-shared.ts（client 组件复用）
// 记录 Workflow 为什么这样设计（决策/问题/方案/优化/用途），
// AI 可总结设计意图、基于运行记录建议新笔记、助手可读取笔记回答问题。

import {
  NOTE_TYPES,
  isValidNoteType,
  NOTE_TYPE_LABELS,
} from './workflow-notes-shared';
import type { NoteType, WorkflowNote } from './workflow-notes-shared';

export {
  NOTE_TYPES,
  isValidNoteType,
  NOTE_TYPE_LABELS,
};
export type { NoteType, WorkflowNote } from './workflow-notes-shared';

/** 校验工作流归属（note 必须属于本人工作流） */
export async function ensureWorkflowOwnership(
  workflowId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('workflow_history')
    .select('id')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: '工作流不存在或无权访问' };
  }
  return { ok: true };
}

/** 查询工作流的全部笔记（本人） */
export async function listWorkflowNotes(
  workflowId: string,
  userId: string,
): Promise<WorkflowNote[]> {
  const { data } = await supabase
    .from('workflow_notes')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? []) as WorkflowNote[];
}

/** 创建笔记 */
export async function createWorkflowNote(
  workflowId: string,
  userId: string,
  input: { type: string; content: string; version?: number | null },
): Promise<{ error?: string; note?: WorkflowNote }> {
  const content = (input.content || '').trim();
  if (!content) return { error: '笔记内容不能为空' };
  if (!isValidNoteType(input.type)) return { error: '笔记类型不合法' };

  const ownership = await ensureWorkflowOwnership(workflowId, userId);
  if (!ownership.ok) return { error: ownership.error };

  const { data, error } = await supabase
    .from('workflow_notes')
    .insert({
      workflow_id: workflowId,
      user_id: userId,
      version: typeof input.version === 'number' ? input.version : null,
      type: input.type,
      content,
    })
    .select()
    .single();
  if (error || !data) return { error: error?.message || '创建失败' };
  return { note: data as WorkflowNote };
}

/** 更新笔记（仅本人） */
export async function updateWorkflowNote(
  id: string,
  userId: string,
  patch: { type?: string; content?: string; version?: number | null },
): Promise<{ error?: string; note?: WorkflowNote }> {
  if (patch.type !== undefined && !isValidNoteType(patch.type)) {
    return { error: '笔记类型不合法' };
  }
  if (patch.content !== undefined && !patch.content.trim()) {
    return { error: '笔记内容不能为空' };
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.type !== undefined) updates.type = patch.type;
  if (patch.content !== undefined) updates.content = patch.content.trim();
  if (patch.version !== undefined) updates.version = patch.version;

  const { data, error } = await supabase
    .from('workflow_notes')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '更新失败' };
  return { note: data as WorkflowNote };
}

/** 删除笔记（仅本人） */
export async function deleteWorkflowNote(
  id: string,
  userId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('workflow_notes')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return { error: error.message };
  return {};
}

/** 笔记 → 注入 AI 助手的文本块 */
export function notesToPromptText(notes: WorkflowNote[]): string {
  if (notes.length === 0) return '（该工作流暂无笔记）';
  return notes
    .map(
      (n) =>
        `- [${NOTE_TYPE_LABELS[n.type] ?? n.type}]${n.version != null ? ` (v${n.version})` : ''} ${n.content}`,
    )
    .join('\n');
}
