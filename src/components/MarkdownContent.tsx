'use client';

// Markdown 渲染（独立模块 + next/dynamic 按需加载）：
// react-markdown/micromark 体积大，按需加载后各聊天路由共享同一个 async chunk，
// 避免在每个路由的静态图里重复打包（曾导致 /chat、/chat/[id]、editor 首屏各带 ~719KB）
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function MarkdownContent({ text }: { text: string }) {
  const router = useRouter();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 站内路径 → 跳转按钮；外链 → 新窗口
        a: ({ href, children }) => {
          if (href?.startsWith('/')) {
            return (
              <button
                onClick={() => router.push(href)}
                className="mx-1 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                {children}
                <ArrowRight className="h-3 w-3" />
              </button>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          );
        },
        // 代码块（JSON 等）：等宽深色容器，独立于正文
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-background/90 p-3 font-mono text-xs leading-relaxed text-foreground">
            {children}
          </pre>
        ),
        // 行内 code（无 language- 前缀）：浅底小标签
        code: ({ className, children, ...props }) => (
          <code
            className={cn(
              className?.includes('language-')
                ? ''
                : 'rounded bg-muted-foreground/10 px-1 py-0.5 font-mono text-[0.85em]',
              className,
            )}
            {...props}
          >
            {children}
          </code>
        ),
        // 标题 / 列表 / 段落：层次与间距
        h1: ({ children }) => <h1 className="my-2 text-base font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="my-2 text-[15px] font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="my-1.5 text-sm font-semibold">{children}</h3>,
        p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        hr: () => <hr className="my-3 border-border" />,
        // GFM 表格
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>
        ),
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="my-1.5 border-l-2 border-primary/30 pl-3 text-muted-foreground">
            {children}
          </blockquote>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
