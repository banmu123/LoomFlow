/**
 * ChatLanding — 对话欢迎页
 *
 * 与 Web 端 ChatLanding 一致：品牌区 + 居中输入框 + 建议卡片。
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Sparkles, Workflow, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useRepository } from '../../app/repositories';
import { streamChat } from '../../app/ai-service';
import type { AIModelRecord } from '../../app/repositories/workflow-repository';
import { ModelSelector } from './ModelSelector';

export function ChatLanding() {
  const navigate = useNavigate();
  const repo = useRepository();
  const t = useT();
  const [input, setInput] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const suggestions = [
    { icon: Sparkles, label: 'Create a workflow', desc: 'Build an AI workflow from description' },
    { icon: Workflow, label: 'Run a workflow', desc: 'Execute an existing workflow' },
    { icon: MessageSquare, label: 'Ask a question', desc: 'Get help with your workflows' },
  ];

  const handleSend = async () => {
    const text = input.trim();
    if (!text || creating) return;
    if (!modelId) { toast.error(t('chat.selectModelFirst')); return; }

    setCreating(true);
    try {
      const conv = await repo.createConversation(
        text.length > 50 ? text.slice(0, 50) + '...' : text,
        modelId,
      );
      // Save user message
      await repo.createMessage(conv.id, 'user', text);
      window.dispatchEvent(new Event('conversations-updated'));
      navigate(`/chat/${conv.id}`);
    } catch {
      toast.error(t('chat.createConversationFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6 max-w-xl px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <img src="/screenshots/logo.png" alt="LoomFlow" className="h-12 w-12 rounded-xl object-contain shadow-lg shadow-[#b77945]/20" />
          <h1 className="text-2xl font-bold text-brand-gradient">LoomFlow</h1>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {t('chat.welcomeMessage') || 'How can I help you today?'}
        </p>

        {/* Model selector */}
        <ModelSelector value={modelId} onChange={setModelId} />

        {/* Input */}
        <div className="w-full max-w-lg">
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.inputPlaceholder') || 'Describe what you want to build...'}
              rows={3}
              disabled={creating}
              className="w-full resize-none rounded-xl border border-border bg-card p-4 pr-12 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !modelId || creating}
              className="absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Suggestions */}
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
