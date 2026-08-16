'use client';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, ChevronDown, ChevronUp, Copy, RefreshCw, ArrowRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus = 'pending' | 'thinking' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface SimpleChatMessageProps {
  role: ChatMessageRole;
  content: string;
  reasoning?: string;
  status?: ChatMessageStatus;
  error?: string;
  images?: string[];
  /** 重新生成（assistant 消息） */
  onRegenerate?: () => void;
  /** children only used by streaming placeholders */
  children?: ReactNode;
}

// 复制文本
function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
    </div>
  );
}

function StreamingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 align-bottom">
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]" />
      <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground/40" />
    </span>
  );
}

// 渲染 AI 回复中的 [去往：页面名](/路径) 导航链接为可点击跳转按钮
function NavLinkRenderer({ text }: { text: string }) {
  const router = useRouter();
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m && m[2].startsWith('/')) {
          return (
            <button
              key={i}
              onClick={() => router.push(m[2])}
              className="mx-1 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              {m[1]}
              <ArrowRight className="h-3 w-3" />
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function SimpleChatMessage({
  role,
  content,
  reasoning,
  status = 'done',
  error,
  images,
  onRegenerate,
  children,
}: SimpleChatMessageProps) {
  const t = useT();
  const isUser = role === 'user';
  const [showReasoning, setShowReasoning] = useState(true);

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        {images && images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`图片 ${idx + 1}`}
                className="h-24 w-24 rounded-lg border border-border object-cover"
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="max-w-[320px] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            {content}
          </span>
          <Avatar className="h-7 w-7 shrink-0 border border-border">
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              我
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="group flex flex-col items-start gap-1">
      <div className="flex items-start gap-2">
        <Avatar className="h-7 w-7 shrink-0 border border-border">
          <AvatarFallback className="bg-brand-gradient text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {status === 'pending' ? (
            <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2">
              <ThinkingDots />
            </div>
          ) : status === 'error' ? (
            <div className="flex items-center gap-2 rounded-lg rounded-tl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error ?? '发生错误，请重试'}</span>
            </div>
          ) : status === 'cancelled' ? (
            <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2">
              {content && (
                <div className="whitespace-pre-wrap text-sm text-foreground">{content}</div>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground">{t('chat.stopped')}</div>
            </div>
          ) : (
            <>
              {/* 思考过程 */}
              {reasoning && (
                <div className="mb-2 max-w-[320px]">
                  <button
                    onClick={() => setShowReasoning(!showReasoning)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showReasoning ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {status === 'streaming' ? t('chat.thinking') : t('chat.thinkingProcess')}
                  </button>
                  {showReasoning && (
                    <div className="mt-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                      {reasoning}
                      {status === 'streaming' && <StreamingDots />}
                    </div>
                  )}
                </div>
              )}

              {/* 正式回答（支持 [去往：xxx](/path) 导航链接） */}
              <div
                className={cn(
                  'max-w-[320px] whitespace-pre-wrap rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm text-foreground',
                  status === 'streaming' && 'min-h-[36px]',
                )}
              >
                <NavLinkRenderer text={content} />
                {status === 'streaming' && !reasoning && <StreamingDots />}
                {children}
              </div>
            </>
          )}
          {status === 'done' && (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {t('chat.generated')}
              </span>
              {content && (
                <button
                  onClick={() => copyText(content)}
                  className="flex items-center gap-0.5 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title={t('chat.copyReply')}
                >
                  <Copy className="h-3 w-3" />
                  {t('chat.copyReply')}
                </button>
              )}
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-0.5 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  title={t('chat.regenerate')}
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('chat.regenerate')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
