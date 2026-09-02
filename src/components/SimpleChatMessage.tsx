'use client';

import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { type ReactNode, memo, useState } from 'react';
import dynamic from 'next/dynamic';

// react-markdown 体积大：按需异步加载（首次渲染到消息时才拉取，各路由共享同一 chunk）
const MarkdownContent = dynamic(
  () => import('./MarkdownContent').then((m) => m.MarkdownContent),
  { ssr: false },
);

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
    <div className="flex items-center gap-2 py-1">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
      <span className="text-xs text-muted-foreground/60 animate-pulse">思考中...</span>
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

/** 流式输入光标：模拟打字机效果 */
function TypingCursor() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/60" />
  );
}

export const SimpleChatMessage = memo(function SimpleChatMessage({
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
          <span className="max-w-[420px] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
            {content}
          </span>
          <Avatar className="h-7 w-7 shrink-0 border border-border">
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              {isUser ? t('chat.mention').charAt(0).toUpperCase() : ''}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  // assistant：内容宽度撑满 AI 头像 →「我」头像之间的区域
  return (
    <div className="group flex flex-col items-start gap-1">
      <div className="flex w-full items-start gap-2">
        <Avatar className="h-7 w-7 shrink-0 border border-border">
          <AvatarFallback className="bg-brand-gradient text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {status === 'pending' ? (
            <div className="inline-block rounded-lg rounded-tl-sm bg-muted px-3 py-2">
              <ThinkingDots />
            </div>
          ) : status === 'error' ? (
            <div className="inline-flex items-center gap-2 rounded-lg rounded-tl-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error ?? t('chat.networkError')}</span>
            </div>
          ) : status === 'cancelled' ? (
            <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2">
              {content && (
                <div className="text-sm text-foreground">
                  <MarkdownContent text={content} />
                </div>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground">{t('chat.stopped')}</div>
            </div>
          ) : (
            <>
              {/* 思考过程 */}
              {reasoning && (
                <div className="mb-2">
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

              {/* 正式回答（Markdown：正文/JSON 代码块/跳转链接层次分明） */}
              <div
                className={cn(
                  'rounded-lg rounded-tl-sm bg-muted px-4 py-3 text-sm text-foreground',
                  status === 'streaming' && 'min-h-[36px]',
                )}
              >
                <MarkdownContent text={content} />
                {status === 'streaming' && <TypingCursor />}
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
}, (prev, next) =>
  // 流式输出时 messages 数组每次 token 都变：内容未变的消息跳过重渲染
  // （onRegenerate 为父组件内联闭包，但仅捕获消息 id，行为不随渲染变化，可安全忽略）
  prev.role === next.role &&
  prev.content === next.content &&
  prev.reasoning === next.reasoning &&
  prev.status === next.status &&
  prev.error === next.error &&
  prev.images === next.images &&
  prev.children === next.children,
);
