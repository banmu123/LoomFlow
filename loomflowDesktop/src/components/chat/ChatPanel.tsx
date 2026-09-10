/**
 * ChatPanel — 对话面板
 *
 * 消息列表 + 流式打字 + 输入框 + 模型选择。
 * 复用 Web 端 ChatPanel 的核心交互模式。
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, StopCircle, User, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useRepository } from '../../app/repositories';
import type { MessageRecord, AIModelRecord } from '../../app/repositories/workflow-repository';
import { streamChat, toChatMessages } from '../../app/ai-service';
import { ModelSelector } from './ModelSelector';

interface ChatPanelProps {
  conversationId: string;
}

export function ChatPanel({ conversationId }: ChatPanelProps) {
  const repo = useRepository();
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<AIModelRecord | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load messages
  useEffect(() => {
    setLoading(true);
    repo.listMessages(conversationId)
      .then((msgs) => { setMessages(msgs); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [conversationId, repo]);

  // Load model preference from conversation
  useEffect(() => {
    repo.getConversation(conversationId).then((conv) => {
      if (conv?.modelId) setModelId(conv.modelId);
    }).catch(() => {});
  }, [conversationId, repo]);

  // Load model details when modelId changes
  useEffect(() => {
    if (!modelId) { setCurrentModel(null); return; }
    repo.getModel(modelId).then(setCurrentModel).catch(() => {});
  }, [modelId, repo]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleModelChange = useCallback(async (newModelId: string | null) => {
    setModelId(newModelId);
    if (newModelId) {
      repo.updateConversation(conversationId, { modelId: newModelId }).catch(() => {});
    }
  }, [conversationId, repo]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!currentModel) { toast.error('Please select a model first'); return; }

    setInput('');

    // Save user message
    const userMsg = await repo.createMessage(conversationId, 'user', text);
    setMessages((prev) => [...prev, userMsg]);

    // Update conversation title if first message
    const allMsgs = await repo.listMessages(conversationId);
    if (allMsgs.length <= 2) {
      const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
      repo.updateConversation(conversationId, { title }).catch(() => {});
    }

    // Stream AI response
    setStreaming(true);
    setStreamingText('');

    const abort = new AbortController();
    abortRef.current = abort;

    const chatMessages = toChatMessages(allMsgs);

    await streamChat({
      model: currentModel,
      messages: chatMessages,
      signal: abort.signal,
      onChunk: (chunk) => setStreamingText((prev) => prev + chunk),
      onDone: async (fullText) => {
        setStreaming(false);
        setStreamingText('');
        const assistantMsg = await repo.createMessage(conversationId, 'assistant', fullText, undefined, currentModel.id);
        setMessages((prev) => [...prev, assistantMsg]);
      },
      onError: (err) => {
        setStreaming(false);
        setStreamingText('');
        toast.error(err.message);
      },
    });
  }, [input, streaming, currentModel, conversationId, repo]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamingText('');
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Start a conversation</h2>
              <p className="mt-1 text-sm text-muted-foreground">Send a message to begin chatting with AI</p>
            </div>
          </div>
        )}

        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role !== 'user' && (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming indicator */}
          {streaming && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="max-w-[80%] rounded-xl bg-muted px-4 py-2.5 text-sm">
                {streamingText ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Thinking...
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="border-t border-border bg-card px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2">
            <ModelSelector value={modelId} onChange={handleModelChange} />
          </div>
          <div className="mt-2 flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-primary">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              disabled={streaming}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            {streaming ? (
              <button
                onClick={handleStop}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
                title="Stop"
              >
                <StopCircle className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || !currentModel}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                title="Send (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mt-1 text-center text-xs text-muted-foreground/60">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  );
}
