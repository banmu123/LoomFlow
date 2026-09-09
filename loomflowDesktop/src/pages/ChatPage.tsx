/**
 * ChatPage — Desktop 对话页面
 *
 * 第一阶段：与 Web 端 ChatLanding 结构一致的欢迎页。
 * 后续接入 AI Provider 后实现完整对话。
 */

import { useState } from 'react';
import { MessageSquare, Sparkles, Workflow, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';

export default function ChatPage() {
  const navigate = useNavigate();
  const t = useT();
  const [input, setInput] = useState('');

  const suggestions = [
    { icon: Sparkles, label: 'Create a workflow', desc: 'Build an AI workflow from description' },
    { icon: Workflow, label: 'Run a workflow', desc: 'Execute an existing workflow' },
    { icon: MessageSquare, label: 'Ask a question', desc: 'Get help with your workflows' },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center">
      {/* 品牌欢迎区 — 与 Web 端 ChatLanding 一致 */}
      <div className="flex flex-col items-center gap-6 max-w-xl px-6">
        <div className="flex items-center gap-3">
          <img src="/screenshots/logo.png" alt="LoomFlow" className="h-12 w-12 rounded-xl object-contain shadow-lg shadow-[#b77945]/20" />
          <h1 className="text-2xl font-bold text-brand-gradient">LoomFlow</h1>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {t('chat.welcomeMessage') || 'How can I help you today?'}
        </p>

        {/* 输入框 — 与 Web 端一致的居中大输入框 */}
        <div className="w-full max-w-lg">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('chat.inputPlaceholder') || 'Describe what you want to build...'}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              className="absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={() => {
                if (input.trim()) {
                  // TODO: Send to AI
                  setInput('');
                }
              }}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 建议卡片 — 与 Web 端一致 */}
        <div className="flex gap-3 flex-wrap justify-center">
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                if (s.label === 'Run a workflow') navigate('/workflows');
                else if (s.label === 'Create a workflow') navigate('/workflows/editor');
              }}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <s.icon className="h-4 w-4 text-primary" />
              <div className="text-left">
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/60 mt-4">
          LoomFlow Desktop — Local-first · No cloud required
        </p>
      </div>
    </div>
  );
}
