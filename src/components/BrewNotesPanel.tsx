'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  NotebookPen,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { toast } from 'sonner';
import { NOTE_TYPES } from '@/lib/workflow-notes-shared';
import type { WorkflowNote } from '@/lib/workflow-notes-shared';

// ===== Brew Notes 面板（Workflow 设计笔记）=====
// 挂在画布侧边：记录决策/问题/方案/优化/用途 + AI 总结 + AI 建议

const TYPE_BADGE: Record<string, string> = {
  general: 'bg-muted text-muted-foreground',
  decision: 'bg-primary/10 text-primary',
  problem: 'bg-red-500/10 text-red-600',
  solution: 'bg-green-500/10 text-green-600',
  optimization: 'bg-amber-500/10 text-amber-600',
  usage: 'bg-blue-500/10 text-blue-600',
};

export function BrewNotesPanel({
  workflowId,
  workflowVersion,
}: {
  workflowId?: string | null;
  workflowVersion?: number | null;
}) {
  const t = useT();
  const [notes, setNotes] = useState<WorkflowNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('general');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // AI 总结流式
  const summaryChat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/workflow-notes/ai-summary',
    }),
  });
  // AI 建议流式
  const suggestChat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/workflow-notes/ai-suggest',
    }),
  });

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/workflow-notes?workflowId=${workflowId}`);
      const data = await res.json();
      if (Array.isArray(data)) setNotes(data);
      else toast.error(data?.error || t('canvas.notesLoadFailed'));
    } catch {
      toast.error(t('canvas.notesLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [workflowId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!workflowId || !content.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/workflow-notes/${editingId}` : '/api/workflow-notes',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            editingId
              ? { type, content }
              : { workflowId, type, content, version: workflowVersion ?? null },
          ),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(editingId ? t('canvas.notesUpdated') : t('canvas.notesAdded'));
        setAdding(false);
        setEditingId(null);
        setType('general');
        setContent('');
        load();
      } else {
        toast.error(data?.error || t('canvas.notesSaveFailed'));
      }
    } catch {
      toast.error(t('canvas.notesSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/workflow-notes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('canvas.notesDeleted'));
        load();
      } else {
        toast.error(t('canvas.notesDeleteFailed'));
      }
    } catch {
      toast.error(t('canvas.notesDeleteFailed'));
    }
  };

  const startEdit = (note: WorkflowNote) => {
    setEditingId(note.id);
    setType(note.type);
    setContent(note.content);
    setAdding(true);
  };

  // AI 总结 / 建议
  const runAiSummary = () => {
    if (!workflowId) return;
    summaryChat.setMessages([]);
    summaryChat.sendMessage({ text: '请总结这些笔记' });
  };
  const runAiSuggest = () => {
    if (!workflowId) return;
    suggestChat.setMessages([]);
    suggestChat.sendMessage({ text: '请给出笔记建议' });
  };

  const summaryText = summaryChat.messages
    .filter((m) => m.role === 'assistant')
    .map((m) =>
      Array.isArray(m.parts)
        ? m.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as { text?: string }).text ?? '')
            .join('')
        : String((m as { content?: unknown }).content ?? ''),
    )
    .join('\n');
  const suggestText = suggestChat.messages
    .filter((m) => m.role === 'assistant')
    .map((m) =>
      Array.isArray(m.parts)
        ? m.parts
            .filter((p) => p.type === 'text')
            .map((p) => (p as { text?: string }).text ?? '')
            .join('')
        : String((m as { content?: unknown }).content ?? ''),
    )
    .join('\n');

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {/* 添加/编辑表单 */}
          {adding && (
            <div className="space-y-2 rounded-md border border-border bg-card p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('canvas.notesType')}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTE_TYPES.map((nt) => (
                      <SelectItem key={nt} value={nt} className="text-xs">
                        {t(`canvas.notesType${nt.charAt(0).toUpperCase()}${nt.slice(1)}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('canvas.notesContent')}</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  className="text-xs"
                  placeholder={t('canvas.notesContentPlaceholder')}
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => {
                    setAdding(false);
                    setEditingId(null);
                    setType('general');
                    setContent('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button size="sm" className="h-6 text-xs" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {t('common.save')}
                </Button>
              </div>
            </div>
          )}

          {/* 笔记列表 */}
          {loading && (
            <p className="flex items-center gap-2 py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('common.loading')}
            </p>
          )}
          {!loading && notes.length === 0 && !adding && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t('canvas.notesEmpty')}
            </p>
          )}
          {notes.map((note) => (
            <div key={note.id} className="group rounded-md border border-border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[note.type] || TYPE_BADGE.general}`}
                  >
                    {t(`canvas.notesType${note.type.charAt(0).toUpperCase()}${note.type.slice(1)}`)}
                  </span>
                  {note.version != null && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      v{note.version}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => startEdit(note)}
                    title={t('common.edit')}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive"
                    onClick={() => handleDelete(note.id)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-foreground">
                {note.content}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {new Date(note.created_at).toLocaleString()}
              </p>
            </div>
          ))}

          {/* AI 总结 */}
          {(summaryText || summaryChat.status === 'streaming') && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('canvas.notesSummary')}
              </p>
              <div className="whitespace-pre-wrap text-xs text-foreground">
                {summaryText || (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </div>
            </div>
          )}

          {/* AI 建议 */}
          {(suggestText || suggestChat.status === 'streaming') && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-amber-600">
                <Wand2 className="h-3.5 w-3.5" />
                {t('canvas.notesSuggest')}
              </p>
              <div className="whitespace-pre-wrap text-xs text-foreground">
                {suggestText || (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 底部操作 */}
      <div className="flex items-center gap-1.5 border-t border-border p-3">
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 text-xs"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setType('general');
            setContent('');
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('canvas.notesAdd')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 text-xs"
          onClick={runAiSummary}
          disabled={summaryChat.status === 'streaming' || notes.length === 0}
        >
          {summaryChat.status === 'streaming' ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-3.5 w-3.5" />
          )}
          {t('canvas.notesSummarize')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 text-xs"
          onClick={runAiSuggest}
          disabled={suggestChat.status === 'streaming' || !workflowId}
        >
          {suggestChat.status === 'streaming' ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="mr-1 h-3.5 w-3.5" />
          )}
          {t('canvas.notesSuggestBtn')}
        </Button>
      </div>
    </div>
  );
}
