'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { Bot, Send, Square, Loader2, CheckCircle2, Wand2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { extractWorkflowJson } from '@/lib/agent/workflow-extract';
import { toast } from 'sonner';

// ===== 画布 AI 助手 =====
// 在画布编辑器内协助用户分析/修改当前工作流：
// - 消息随画布数据发送（每次发送取最新画布状态）
// - AI 回复含 ```json 工作流时，提供「应用修改」按钮（前端解析后写回画布）
// - 会话在组件内存中，无持久化

function getMessageText(msg: UIMessage): string {
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('');
  }
  return String((msg as { content?: unknown }).content ?? '');
}

export function CanvasAssistant({
  open,
  onClose,
  getCanvasData,
  onApplyWorkflow,
}: {
  open: boolean;
  onClose: () => void;
  /** 获取当前画布数据（发送消息时取最新） */
  getCanvasData: () => unknown;
  /** 应用 AI 返回的工作流 JSON 到画布 */
  onApplyWorkflow: (data: { nodes: unknown[]; edges: unknown[]; [key: string]: unknown }) => void;
}) {
  const t = useT();

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/canvas-assistant',
      // 发送请求时注入最新画布数据（transport 随渲染重建，闭包始终是最新 getCanvasData）
      prepareSendMessagesRequest: (options) => ({
        ...options,
        body: { ...options.body, canvasData: getCanvasData() },
      }),
    }),
  });

  const [input, setInput] = useState('');
  const [appliedKey, setAppliedKey] = useState('');

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || status === 'streaming' || status === 'submitted') return;
      setAppliedKey('');
      setInput('');
      sendMessage({ text });
    },
    [input, status, sendMessage],
  );

  // 检测最后一条 assistant 消息中的工作流 JSON
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant) : '';
  const extracted = lastAssistantText ? extractWorkflowJson(lastAssistantText) : null;
  const busy = status === 'streaming' || status === 'submitted';

  const handleApply = () => {
    if (!extracted) return;
    try {
      onApplyWorkflow(extracted);
      setAppliedKey(lastAssistant?.id ?? 'applied');
      toast.success(t('canvas.assistantApplied'));
    } catch {
      toast.error(t('canvas.workflowInvalid'));
    }
  };

  if (!open) return null;

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-background">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#b77945]" />
          <span className="text-sm font-semibold">{t('canvas.assistant')}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClose}>
          ✕
        </Button>
      </div>

      {/* 消息区 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {t('canvas.assistantHint')}
              </p>
            </div>
          )}
          {messages.map((msg) => {
            const text = getMessageText(msg);
            if (!text) return null;
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  isUser
                    ? 'ml-auto bg-primary/10 text-foreground'
                    : 'border border-border bg-card text-foreground'
                }`}
              >
                {text}
              </div>
            );
          })}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 应用修改（AI 返回工作流 JSON 时） */}
      {extracted && !busy && (
        <div className="border-t border-border px-4 py-2">
          <Button
            size="sm"
            className="h-7 w-full text-xs"
            variant={appliedKey === lastAssistant?.id ? 'outline' : 'default'}
            onClick={handleApply}
          >
            {appliedKey === lastAssistant?.id ? (
              <>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-green-600" />
                {t('canvas.assistantApplied')}
              </>
            ) : (
              <>
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                {t('canvas.assistantApply')}
              </>
            )}
          </Button>
        </div>
      )}

      {/* 输入区 */}
      <form onSubmit={onSubmit} className="border-t border-border p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
          placeholder={t('canvas.assistantPlaceholder')}
          rows={3}
          className="min-h-[70px] resize-none text-xs"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{t('canvas.assistantEnter')}</span>
          <div className="flex gap-1.5">
            {busy ? (
              <Button type="button" size="sm" variant="destructive" className="h-7" onClick={stop}>
                <Square className="mr-1 h-3 w-3" />
                {t('workflows.stopRun')}
              </Button>
            ) : (
              <Button type="submit" size="sm" className="h-7" disabled={!input.trim()}>
                <Send className="mr-1 h-3 w-3" />
                {t('common.save')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
