'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { SimpleChatInput } from './SimpleChatInput';
import { RECOMMENDATIONS } from './ChatPanel';
import { useT } from '@/lib/i18n';

// 新聊天欢迎页（/chat）：品牌 + 居中输入框 + 模板推荐
// 与对话界面（/chat/[id] ChatPanel）相互独立；发送首条消息 →
// 创建真实对话 → 跳转 /chat/[id]?q=文本，由对话页加载完成后自动发送
export function ChatLanding() {
  const router = useRouter();
  const t = useT();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);

  // 加载模型列表（输入框内模型选择器）
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
          setModel((prev) =>
            options.some((o) => o.value === prev) ? prev : options[0]?.value || '',
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // 首页引导页的"开始"请求（chat-send 事件 → 直接发送）
  const sendRef = useRef<(text?: string) => void>(() => {});
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) sendRef.current(text);
    };
    window.addEventListener('chat-send', handler);
    return () => window.removeEventListener('chat-send', handler);
  }, []);

  // 发送首条消息：创建对话 → 跳转对话页自动发送
  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 20) }),
        });
        const db = await res.json();
        if (!db?.id) {
          setError('创建对话失败，请重试');
          return;
        }
        // 插入首条用户消息（对话页据此自动触发生成，不依赖 URL 参数传递文本）
        await fetch(`/api/conversations/${db.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: text, status: 'done' }),
        }).catch(() => {});
        // 通知侧边栏刷新对话历史（新对话立即可见）
        window.dispatchEvent(new Event('conversations-updated'));
        router.push(`/chat/${db.id}`);
      } catch {
        setError('创建对话失败，请重试');
      } finally {
        setSubmitting(false);
      }
    },
    [input, submitting, router],
  );
  sendRef.current = handleSend;

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-indigo-50 via-background to-violet-50 dark:from-indigo-950/40 dark:via-background dark:to-violet-950/40">
      {/* 品牌光晕 */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-violet-500/15 blur-3xl" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8">
        <div className="w-full max-w-2xl">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* 标题 + 输入框一体（同一容器） */}
          <div className="flex flex-col items-center gap-2">
            <div className="bg-brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-indigo-500/30">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <p className="text-brand-gradient text-xl font-bold">{t('app.name')}</p>
            <p className="text-sm text-muted-foreground">{t('home.subtitle')}</p>
          </div>

          {/* 对话输入框 */}
          <div className="mx-auto mt-6 w-full max-w-2xl">
            <SimpleChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              isGenerating={submitting}
              placeholder={t('home.placeholder')}
              hideAttach
              modelOptions={modelOptions}
              model={model}
              onModelChange={setModel}
            />
          </div>

          {/* 模板推荐 */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground">{t('home.recommend')}</span>
            {RECOMMENDATIONS.map((rec) => (
              <button
                key={rec}
                onClick={() => handleSend(rec.replace(/^[^\s]+\s*/, ''))}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {rec}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
