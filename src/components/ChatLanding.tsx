'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Zap } from 'lucide-react';
import { SimpleChatInput } from './SimpleChatInput';
import { RECOMMENDATIONS } from './chat-recommendations';
import { fetchModelOptions } from '@/lib/ai/models-cache';
import { useT } from '@/lib/i18n';
import { WORKFLOW_TEMPLATES, TEMPLATE_CATEGORIES } from '@/lib/workflow-templates';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// 新聊天欢迎页（/chat）：场景中心 + 对话输入框
// 核心体验：用户打开就看到一排真实场景模板，点进去填参数就能跑（不碰画布）

export function ChatLanding() {
  const router = useRouter();
  const t = useT();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // 加载模型列表（输入框内模型选择器）——走客户端缓存（多组件共享一次请求）
  useEffect(() => {
    (async () => {
      try {
        const options = await fetchModelOptions();
        if (options.length > 0) {
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
          body: JSON.stringify({
            title: text.slice(0, 20),
            content: text,
            model: model || undefined,
          }),
        });
        const db = await res.json();
        if (!db?.id) {
          setError(t('chat.networkError'));
          return;
        }
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

  const filteredTemplates = activeCategory === 'all'
    ? WORKFLOW_TEMPLATES
    : WORKFLOW_TEMPLATES.filter((tp) => tp.category === activeCategory);

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-[#f7efe4] via-background to-[#f3e6d4] dark:from-[#3a2b1e]/40 dark:via-background dark:to-[#4a2e17]/35">
      {/* 品牌光晕 */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-[#b77945]/12 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-[#d9b38c]/18 blur-3xl" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl flex-1 px-6 pb-8 pt-8">
          {error && (
            <div className="mb-4 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* 品牌 + 输入框 */}
          <div className="flex flex-col items-center gap-2">
            <div className="bg-brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-[#b77945]/25">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <p className="text-brand-gradient text-xl font-bold">{t('app.name')}</p>
            <p className="text-sm text-muted-foreground">{t('home.subtitle')}</p>
          </div>

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

          {/* 场景中心标题 */}
          <div className="mt-8 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{t('templates.title')}</h2>
            <span className="text-xs text-muted-foreground">{t('templates.subtitle')}</span>
          </div>

          {/* 分类筛选 */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory('all')}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                activeCategory === 'all'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40',
              )}
            >
              {t('templates.all')}
            </button>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  activeCategory === cat.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* 模板卡片网格 */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => router.push(`/templates/${tpl.id}`)}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{tpl.emoji}</span>
                  <div className="flex gap-1">
                    {tpl.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-foreground">{tpl.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tpl.description}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t('templates.useNow')}
                  <ArrowRight className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>

          {/* 推荐模板（对话方式） */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground">{t('home.recommend')}</span>
            {RECOMMENDATIONS.map((rec) => (
              <button
                key={rec}
                onClick={() => handleSend(t(rec).replace(/^[^\s]+\s*/, ''))}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {t(rec)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
