'use client';

import { useCallback, useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { Bot, CheckCircle2, Wand2, Loader2, Bug } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { SimpleChatInput } from '@/components/SimpleChatInput';
import { SimpleChatMessage } from '@/components/SimpleChatMessage';
import { uploadFileToOSS } from '@/lib/oss-upload-client';
import { extractWorkflowJson } from '@/lib/agent/workflow-extract';
import { toast } from 'sonner';

// ===== 画布 AI 助手 =====
// 在画布编辑器内协助用户分析/修改当前工作流：
// - 消息随画布数据发送（每次发送取最新画布状态）
// - 消息展示复用 SimpleChatMessage（与新聊天对话样式一致）
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

function getMessageReasoning(msg: UIMessage): string {
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p.type === 'reasoning')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('');
  }
  return '';
}

export function CanvasAssistant({
  open,
  onClose,
  getCanvasData,
  onApplyWorkflow,
  workflowId,
}: {
  open: boolean;
  onClose: () => void;
  /** 获取当前画布数据（发送消息时取最新） */
  getCanvasData: () => unknown;
  /** 应用 AI 返回的工作流 JSON 到画布 */
  onApplyWorkflow: (data: { nodes: unknown[]; edges: unknown[]; [key: string]: unknown }) => void;
  /** 当前工作流 id（Debug 分析按工作流过滤运行历史） */
  workflowId?: string | null;
}) {
  const t = useT();

  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/canvas-assistant',
      // 发送请求时注入最新画布数据/图片/模型/工作流 id（transport 随渲染重建，闭包始终是最新 state）
      prepareSendMessagesRequest: (options) => ({
        ...options,
        body: {
          ...options.body,
          canvasData: getCanvasData(),
          images: images.map((img) => img.url),
          model,
          workflowId,
        },
      }),
    }),
  });

  const [input, setInput] = useState('');
  const [images, setImages] = useState<Array<{ url: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [appliedKey, setAppliedKey] = useState('');

  // 加载模型列表（与聊天页一致的模型选择器）
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ai/models');
        const data = await res.json();
        if (Array.isArray(data)) {
          const options = data.map((m: { id: string; label: string | null }) => ({
            value: m.id,
            label: m.label || m.id,
          }));
          setModelOptions(options);
          setModel((prev) => (options.some((o) => o.value === prev) ? prev : options[0]?.value || ''));
        }
      } catch {
        // 拉取失败保持空列表
      }
    })();
  }, []);

  // 图片上传（与聊天页一致：上传 OSS 后附加 URL）
  const handleAttachImage = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadFileToOSS(file, { prefix: 'chat' });
      const url = result.data?.url;
      if (result.success && url) {
        setImages((prev) => [...prev, { url, name: file.name }]);
      } else {
        toast.error(result.message || t('canvas.uploadFailed'));
      }
    } catch {
      toast.error(t('canvas.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [t]);

  const onSubmit = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || status === 'streaming' || status === 'submitted') return;
      setAppliedKey('');
      setInput('');
      setImages([]);
      sendMessage({ text: content });
    },
    [input, status, sendMessage],
  );

  // 检测最后一条 assistant 消息中的工作流 JSON
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastAssistantText = lastAssistant ? getMessageText(lastAssistant) : '';
  const extracted = lastAssistantText ? extractWorkflowJson(lastAssistantText) : null;
  const busy = status === 'streaming' || status === 'submitted';

  // Debug 快捷按钮：分析最近运行失败（配合后端注入的运行历史摘要）
  const debugAnalyze = () => {
    if (busy) return;
    setAppliedKey('');
    setInput('');
    sendMessage({ text: t('canvas.debugRunPrompt') });
  };

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

      {/* 消息区（复用 SimpleChatMessage，与新聊天对话样式一致） */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {t('canvas.assistantHint')}
              </p>
              {workflowId && (
                <button
                  onClick={debugAnalyze}
                  className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Bug className="h-3.5 w-3.5 shrink-0 text-[#b77945]" />
                  {t('canvas.debugRun')}
                </button>
              )}
            </div>
          )}
          {messages.map((msg, idx) => {
            const text = getMessageText(msg);
            const isLast = idx === messages.length - 1;
            const msgStatus = msg.role === 'assistant' && isLast && busy ? 'streaming' : 'done';
            return (
              <SimpleChatMessage
                key={msg.id}
                role={msg.role as 'user' | 'assistant'}
                content={text}
                reasoning={getMessageReasoning(msg)}
                status={msgStatus}
              />
            );
          })}
          {busy && messages.length === 0 && (
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

      {/* 输入区（复用 SimpleChatInput：模型选择 / 图片上传 / 语音输入，与聊天页一致） */}
      <div className="border-t border-border p-3">
        <SimpleChatInput
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          isGenerating={busy}
          onStop={stop}
          placeholder={t('canvas.assistantPlaceholder')}
          images={images}
          onRemoveImage={(url) => setImages((prev) => prev.filter((img) => img.url !== url))}
          onAttachImage={handleAttachImage}
          uploading={uploading}
          modelOptions={modelOptions}
          model={model}
          onModelChange={setModel}
        />
      </div>
    </div>
  );
}
