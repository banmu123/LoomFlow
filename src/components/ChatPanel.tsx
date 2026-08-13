'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { setPendingWorkflow } from '@/lib/pending-workflow';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Plus,
  X,
  MessageSquare,
  Search,
  Pencil,
  Trash2,
  Check,
  Sparkles,
  Settings,
  LogOut,
  KeyRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SimpleChatMessage, type ChatMessageStatus } from './SimpleChatMessage';
import { SimpleChatInput } from './SimpleChatInput';
import { uploadFileToOSS } from '@/lib/oss-upload-client';
import { useT } from '@/lib/i18n';
import { ChevronsLeft } from 'lucide-react';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { LocaleSwitcher } from './LocaleSwitcher';

const CHAT_PANEL_WIDTH = 440;
const HISTORY_MIN_WIDTH = 180;
const HISTORY_MAX_WIDTH = 300;
const HISTORY_DEFAULT_WIDTH = 240;

type MessageRole = 'user' | 'assistant';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  status?: ChatMessageStatus;
  error?: string;
  images?: string[];
  createdAt: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

let seq = 0;
const nextId = () => `${Date.now()}-${seq++}`;

export function ChatPanel({
  onClose,
  onCollapse,
}: {
  onClose?: () => void;
  onCollapse?: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: nextId(), title: '新建对话', messages: [] },
  ]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [historyWidth, setHistoryWidth] = useState(HISTORY_DEFAULT_WIDTH);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Array<{ url: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);

  // 加载已配置模型（模型配置页添加后此处自动出现）
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
          // 默认选中第一个
          setModel((prev) => prev || options[0]?.value || '');
        }
      } catch {
        // ignore
      }
    })();
  }, []);
  const dragRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // 修改密码对话框
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old_password: '', new_password: '' });
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  const handleChangePassword = async () => {
    if (pwdForm.new_password !== pwdConfirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setPwdSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pwdForm),
      });
      const data = await res.json();
      if (res.ok) {
        setPwdOpen(false);
        setPwdForm({ old_password: '', new_password: '' });
        setPwdConfirm('');
        setError('密码修改成功，请重新登录');
        // 服务端已清除 cookie，跳转登录页
        setTimeout(() => router.push('/login'), 800);
      } else {
        setError(data?.error || '修改失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setPwdSubmitting(false);
    }
  };

  // ===== 检查当前用户角色（admin 显示管理入口） =====
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data?.authenticated && data?.user?.role === 'admin') {
          setIsAdmin(true);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // ===== Load conversations from Supabase on mount =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/conversations');
        const data = await res.json();

        // 数据库没有对话时，自动创建第一个（保证初始对话有 db id，消息才能保存）
        if (!cancelled && (!Array.isArray(data) || data.length === 0)) {
          try {
            const createRes = await fetch('/api/conversations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: '新建对话' }),
            });
            const dbConv = await createRes.json();
            if (!cancelled && dbConv?.id) {
              setConversations([
                { id: dbConv.id, title: dbConv.title, messages: [] },
              ]);
              setActiveId(dbConv.id);
            }
          } catch {
            // 创建失败则保留本地对话（handleSend 有兜底逻辑）
          }
          setLoadingHistory(false);
          return;
        }

        // Load messages for each conversation
        const convs: Conversation[] = await Promise.all(
          data.map(async (dbConv: { id: string; title: string }) => {
            try {
              const msgsRes = await fetch(
                `/api/conversations/${dbConv.id}/messages`,
              );
              const msgs = await msgsRes.json();
              return {
                id: dbConv.id,
                title: dbConv.title,
                messages: Array.isArray(msgs)
                  ? msgs.map(
                      (m: {
                        id: string;
                        role: MessageRole;
                        content: string;
                        reasoning?: string;
                        status?: ChatMessageStatus;
                        error?: string;
                        images?: string[] | null;
                        created_at: string;
                      }) => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        reasoning: m.reasoning,
                        status: m.status,
                        error: m.error,
                        images: m.images ?? undefined,
                        createdAt: new Date(m.created_at).getTime(),
                      }),
                    )
                  : [],
              };
            } catch {
              return { id: dbConv.id, title: dbConv.title, messages: [] };
            }
          }),
        );

        if (!cancelled) {
          setConversations(convs);
          setActiveId(convs[0].id);
          setLoadingHistory(false);
        }
      } catch {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // init active conversation
  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const messages = activeConversation?.messages ?? [];

  const filteredConversations = searchQuery
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : conversations;

  // auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // drag resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      const panelRect = dragRef.current?.getBoundingClientRect();
      if (!panelRect) return;
      const newWidth = panelRect.right - e.clientX;
      const clamped = Math.min(
        HISTORY_MAX_WIDTH,
        Math.max(HISTORY_MIN_WIDTH, newWidth),
      );
      setHistoryWidth(clamped);
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (dragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  // cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const updateConversation = useCallback(
    (id: string, updater: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
    },
    [],
  );

  // 保存单条消息到 Supabase（fire-and-forget）
  const saveMessage = useCallback(
    (convId: string, msg: Message) => {
      fetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: msg.role,
          content: msg.content,
          reasoning: msg.reasoning || null,
          status: msg.status || 'done',
          error: msg.error || null,
          images: msg.images || null,
        }),
      }).catch(() => {});
    },
    [],
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    setError(null);
    // 确保对话已在数据库存在（本地 id 则同步创建），否则消息无法保存
    let convId = activeId || conversations[0]?.id;
    if (!convId) return;

    try {
      convId = await ensureConversation(convId);
    } catch {
      setError('对话同步失败，请重试');
      return;
    }

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      content: text,
      status: 'done',
      images: images.length > 0 ? images.map((img) => img.url) : undefined,
      createdAt: Date.now(),
    };

    const assistantMsg: Message = {
      id: nextId(),
      role: 'assistant',
      content: '',
      status: 'pending',
      createdAt: Date.now() + 1,
    };

    const isFirstMessage =
      conversations.find((c) => c.id === convId)?.messages.length === 0;

    updateConversation(convId, (c) => ({
      ...c,
      title: isFirstMessage ? text.slice(0, 20) : c.title,
      messages: [...c.messages, userMsg, assistantMsg],
    }));

    // 保存用户消息到 Supabase
    saveMessage(convId, userMsg);

    setInput('');
    setImages([]);
    setIsGenerating(true);

    // build message history (last 20 messages including current)
    const currentMessages =
      conversations.find((c) => c.id === convId)?.messages ?? [];
    const chatHistory = [...currentMessages, { role: 'user' as const, content: text }].map(
      (msg) => ({ role: msg.role, content: msg.content }),
    );

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 提升到 try 外，供 catch 保存部分内容使用
    let assistantContent = '';
    let assistantReasoning = '';
    let streamFailed = false;

    try {
      const apiUrl = '/api/chat-ai';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          images: images.map((img) => img.url),
          model,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `请求失败 (${response.status})`);
      }

      // switch to streaming status
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, status: 'streaming' } : m,
        ),
      }));

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder();
      let buffer = '';
      let workflowData: unknown = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            updateConversation(convId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, status: 'done', content: assistantContent }
                  : m,
              ),
            }));
            break;
          }

          try {
            const data = JSON.parse(payload) as {
              type?: string;
              id?: string;
              delta?: string;
              content?: string;
              error?: string;
              errorText?: string;
              workflow?: unknown;
            };

            // 处理错误（兼容 error 和 errorText 两种字段）
            if (data.error || data.type === 'error') {
              const errMsg = data.error || data.errorText || '请求失败';
              setError(errMsg);
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, status: 'error', error: errMsg }
                    : m,
                ),
              }));
              // 保存错误消息到 Supabase（标记失败，末尾不再重复保存）
              streamFailed = true;
              saveMessage(convId, {
                ...assistantMsg,
                status: 'error',
                content: assistantContent,
                error: errMsg,
              });
              break;
            }

            // 处理工作流
            if (data.workflow) {
              workflowData = data.workflow;
            }

            // 处理 reasoning（思考过程）
            if (data.type === 'reasoning-delta' && data.delta) {
              assistantReasoning += data.delta;
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, reasoning: assistantReasoning }
                    : m,
                ),
              }));
            }

            // 处理 text（正式回答）
            if (data.type === 'text-delta' && data.delta) {
              assistantContent += data.delta;
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: assistantContent }
                    : m,
                ),
              }));
            }

            // 兼容旧格式
            if (data.content) {
              assistantContent += data.content;
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: assistantContent }
                    : m,
                ),
              }));
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }

      // ensure final state
      let finalAssistantMsg: Message | null = null;
      updateConversation(convId, (c) => {
        const updated = c.messages.map((m) => {
          if (m.id === assistantMsg.id && m.status === 'streaming') {
            const final = {
              ...m,
              status: 'done' as ChatMessageStatus,
              content: assistantContent,
            };
            finalAssistantMsg = final;
            return final;
          }
          return m;
        });
        return { ...c, messages: updated };
      });

      // 如果没有直接收到 workflow 数据，尝试从文本中提取
      if (!workflowData && assistantContent) {
        try {
          // 尝试提取 ```json ... ``` 中的内容
          const jsonMatch = assistantContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            workflowData = JSON.parse(jsonMatch[1].trim());
          } else {
            // 尝试找到第一个 { 和最后一个 }
            const start = assistantContent.indexOf('{');
            const end = assistantContent.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
              workflowData = JSON.parse(assistantContent.slice(start, end + 1));
            }
          }
          // 用 Schema 校验工作流；无效则自动调用 AI 修复一次
          if (workflowData && typeof workflowData === 'object' && 'nodes' in workflowData && 'edges' in workflowData) {
            const validation = validateWorkflow(workflowData);
            if (!validation.valid) {
              try {
                const repairRes = await fetch('/api/workflow-ai/repair', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    workflow: workflowData,
                    errors: validation.errors.map((e) => e.message),
                  }),
                });
                const repairData = await repairRes.json();
                if (repairRes.ok && repairData?.workflow && repairData.valid) {
                  workflowData = repairData.workflow; // 修复成功，使用修复后的工作流
                } else {
                  workflowData = null; // 修复失败
                }
              } catch {
                workflowData = null;
              }
            }
            if (workflowData) {
              // 是工作流 JSON，更新消息内容
              assistantContent = '已为你生成工作流，已加载到画布';
              updateConversation(convId, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: assistantContent }
                    : m,
                ),
              }));
            }
          } else {
            workflowData = null; // 不是有效的 workflow
          }
        } catch {
          // 不是 JSON，忽略
          workflowData = null;
        }
      }

      // load workflow data to canvas if received
      if (workflowData) {
        if (!assistantContent) {
          assistantContent = '已为你生成工作流，已加载到画布';
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: assistantContent }
                : m,
            ),
          }));
        }
        setPendingWorkflow(workflowData);
        if (window.location.pathname !== '/workflows/editor') {
          router.push('/workflows/editor');
        }
        window.dispatchEvent(
          new CustomEvent('tinyflow-load-data', { detail: workflowData }),
        );
      }

      // 统一保存助手消息（只保存一次最终内容；流中已出错则跳过）
      if (!streamFailed) {
        saveMessage(convId, {
          ...assistantMsg,
          status: 'done',
          content: assistantContent,
          reasoning: assistantReasoning || undefined,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled — keep partial content
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  status: m.content ? 'done' : 'error',
                  error: m.content ? undefined : '已停止生成',
                }
              : m,
          ),
        }));
        // 保存部分内容到 Supabase
        saveMessage(convId, {
          ...assistantMsg,
          status: assistantContent ? 'done' : 'error',
          content: assistantContent,
          error: assistantContent ? undefined : '已停止生成',
        });
      } else {
        const msg = err instanceof Error ? err.message : '网络错误';
        setError(msg);
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', error: msg }
              : m,
          ),
        }));
        // 保存错误消息到 Supabase
        saveMessage(convId, {
          ...assistantMsg,
          status: 'error',
          content: assistantContent,
          error: msg,
        });
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
  };

  // 重新生成最后一条 AI 回复
  const handleRegenerate = useCallback(
    async (assistantMsgId: string) => {
      if (isGenerating) return;
      const convId = activeId;
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) return;

      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;

      // 截取到该回复之前（不含它）
      const before = conv.messages.slice(0, idx);
      const lastUser = [...before].reverse().find((m) => m.role === 'user');
      if (!lastUser) return;

      // 历史 = 该回复之前的所有消息（最后一条为 user 消息触发）
      const chatHistory = [...before, lastUser].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setError(null);
      setIsGenerating(true);

      // 标记该消息为 pending
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsgId
            ? { ...m, status: 'pending' as ChatMessageStatus, content: '', error: undefined }
            : m,
        ),
      }));

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch('/api/chat-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatHistory, model }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `请求失败 (${res.status})`);
        }

        let content = '';
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;
            try {
              const data = JSON.parse(payload) as {
                type?: string;
                delta?: string;
                error?: string;
                errorText?: string;
              };
              if (data.type === 'text-delta' && data.delta) content += data.delta;
              if (data.error || data.type === 'error') {
                const errMsg = data.error || data.errorText || '请求失败';
                throw new Error(errMsg);
              }
            } catch {
              // skip
            }
          }
          updateConversation(convId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, status: 'streaming', content } : m,
            ),
          }));
        }

        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, status: 'done' as ChatMessageStatus, content }
              : m,
          ),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : '网络错误';
        setError(msg);
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, status: 'error' as ChatMessageStatus, error: msg }
              : m,
          ),
        }));
      } finally {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    },
    [activeId, conversations, isGenerating, model, updateConversation],
  );

  // 上传图片到 OSS
  const handleAttachImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('仅支持上传图片文件');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB');
      return;
    }
    setUploading(true);
    try {
      const result = await uploadFileToOSS(file, { prefix: 'chat' });
      if (result.success && result.data) {
        setImages((prev) => [
          ...prev,
          { url: result.data!.url, name: result.data!.fileName },
        ]);
      } else {
        setError(result.message || '图片上传失败');
      }
    } catch {
      setError('图片上传失败');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  }, [router]);

  // 确保对话已在数据库中存在，返回真实 db id（本地 id 则先创建）
  const ensureConversation = useCallback(
    async (localId: string): Promise<string> => {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          localId,
        );
      if (isUuid) return localId;

      const conv = conversations.find((c) => c.id === localId);
      const title = conv?.title || '新建对话';
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const db = await res.json();
      if (!db?.id) throw new Error('创建对话失败');

      // 本地 id 替换为 db id
      setConversations((prev) =>
        prev.map((c) => (c.id === localId ? { ...c, id: db.id } : c)),
      );
      setActiveId((prev) => (prev === localId ? db.id : prev));
      return db.id;
    },
    [conversations],
  );

  const handleNewConversation = async () => {
    setError(null);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新建对话' }),
      });
      const db = await res.json();
      if (!db?.id) {
        setError('创建对话失败，请重试');
        return;
      }
      const newConv: Conversation = {
        id: db.id,
        title: db.title,
        messages: [],
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(db.id);
    } catch {
      setError('创建对话失败，请重试');
    }
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const newConv: Conversation = {
          id: nextId(),
          title: '新建对话',
          messages: [],
        };
        setActiveId(newConv.id);
        return [newConv];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
    setDeleteTarget(null);

    // 异步从 Supabase 删除
    fetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {});
  };

  const handleStartRename = (conv: Conversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
  };

  const handleConfirmRename = () => {
    if (renamingId && renameValue.trim()) {
      updateConversation(renamingId, (c) => ({
        ...c,
        title: renameValue.trim(),
      }));

      // 异步保存到 Supabase
      fetch(`/api/conversations/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: renameValue.trim() }),
      }).catch(() => {});
    }
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div
      ref={dragRef}
      className="flex shrink-0 border-r border-border bg-card"
      style={{ width: CHAT_PANEL_WIDTH }}
    >
      {/* === Conversation History Panel === */}
      {!historyCollapsed && (
        <div
          className="flex flex-col border-r border-border bg-muted/30"
          style={{ width: historyWidth }}
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-border px-2.5 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('chat.history')}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setHistoryCollapsed(true)}
              title="收起历史"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* search */}
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('chat.searchConversations')}
                className="h-7 bg-background pl-7 text-xs"
              />
            </div>
          </div>

          {/* new conversation button */}
          <div className="px-2 pb-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-1.5"
              onClick={handleNewConversation}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('chat.newConversation')}
            </Button>
          </div>

          {/* conversation list */}
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5 p-1">
              {filteredConversations.length === 0 && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  {t('chat.noConversations')}
                </div>
              )}
              {filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    'group relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                    conv.id === activeId
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => setActiveId(conv.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  {renamingId === conv.id ? (
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      className="h-6 flex-1 bg-background px-1 text-xs"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 truncate">{conv.title}</span>
                  )}

                  {/* hover actions */}
                  {renamingId === conv.id ? (
                    <button
                      className="shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfirmRename();
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded p-0.5 hover:bg-background"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(conv);
                        }}
                        title="重命名"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded p-0.5 hover:bg-background hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(conv);
                        }}
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* === Drag Handle === */}
      {!historyCollapsed && (
        <div
          className="w-px cursor-col-resize bg-border transition-colors hover:bg-primary/30"
          onMouseDown={() => setDragging(true)}
        />
      )}

      {/* === Chat Main Area === */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            {historyCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setHistoryCollapsed(false)}
                title="展开历史"
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </Button>
            )}
            <div className="flex items-center gap-1.5">
            </div>
            {onCollapse && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                onClick={onCollapse}
                title="收起对话"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            )}
          </div>

        </div>

        {/* error alert */}
        {error && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* messages or empty state */}
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <Avatar className="h-12 w-12 border border-border">
              <AvatarFallback className="bg-muted">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t('chat.startNewChat')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('chat.startNewChatHint')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 p-3">
              {messages.map((msg) => (
                <SimpleChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  reasoning={msg.reasoning}
                  status={msg.status}
                  error={msg.error}
                  images={msg.images}
                  onRegenerate={
                    msg.role === 'assistant' && msg.status === 'done'
                      ? () => handleRegenerate(msg.id)
                      : undefined
                  }
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* input area */}
        <SimpleChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          isGenerating={isGenerating}
          onStop={handleStop}
          images={images}
          onRemoveImage={(url) =>
            setImages((prev) => prev.filter((img) => img.url !== url))
          }
          onAttachImage={handleAttachImage}
          uploading={uploading}
          modelOptions={modelOptions}
          model={model}
          onModelChange={setModel}
        />
      </div>

      {/* === Change Password Dialog === */}
      <AlertDialog open={pwdOpen} onOpenChange={(open) => !open && setPwdOpen(false)}>
        <AlertDialogContent className="z-[1200]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.changePassword')}</AlertDialogTitle>
            <AlertDialogDescription>
              修改后需要重新登录（密码至少 8 位，包含字母和数字）
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <PasswordInput
              placeholder={t('chat.oldPassword')}
              value={pwdForm.old_password}
              onChange={(e) => setPwdForm((f) => ({ ...f, old_password: e.target.value }))}
            />
            <PasswordInput
              placeholder={t('chat.newPassword')}
              value={pwdForm.new_password}
              onChange={(e) => setPwdForm((f) => ({ ...f, new_password: e.target.value }))}
            />
            <PasswordInput
              placeholder={t('chat.confirmNewPassword')}
              value={pwdConfirm}
              onChange={(e) => setPwdConfirm(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleChangePassword}
              disabled={pwdSubmitting}
            >
              {pwdSubmitting ? '提交中...' : '确认修改'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* === Delete Confirmation Dialog === */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="z-[1200]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.deleteConversation')}</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.title}」吗？此操作不可撤销，对话中的所有消息将被永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDeleteConversation(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
