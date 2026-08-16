'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
  Loader2,
  CheckCircle2,
  XCircle,
  Menu,
  PanelRightClose,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SimpleChatMessage, type ChatMessageStatus } from './SimpleChatMessage';
import { SimpleChatInput } from './SimpleChatInput';
import { ModelConfigDialog } from './ModelConfigDialog';
import { uploadFileToOSS } from '@/lib/oss-upload-client';
import { useT } from '@/lib/i18n';
import { ChevronsLeft } from 'lucide-react';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { normalizeWorkflowModels } from '@/lib/workflow-templates';
import { LocaleSwitcher } from './LocaleSwitcher';

const CHAT_PANEL_WIDTH = 440;

type MessageRole = 'user' | 'assistant';

// 新建对话的模板推荐
const RECOMMENDATIONS = [
  '📰 每日资讯助手',
  '✍️ 内容助手',
  '👤 客户助手',
  '📝 周报助手',
  '🌐 翻译助手',
];

// 工具名 → 可读标签（对话中的执行日志展示）
const TOOL_LABELS: Record<string, string> = {
  list_workflows: '查询工作流列表',
  get_workflow: '查看工作流详情',
  list_workflow_versions: '查询版本历史',
  list_models: '查询模型配置',
  get_api_key_status: '查询 API Key 状态',
  get_execution_history: '查询执行记录',
  get_api_call_logs: '查询调用日志',
  list_knowledge_bases: '查询知识库列表',
  search_knowledge: '检索知识库',
  get_oss_config_status: '查询 OSS 配置状态',
  create_knowledge_base: '创建知识库',
  delete_knowledge_base: '删除知识库',
  create_model: '配置模型',
  list_users: '查询用户列表',
  get_stats: '查询用量统计',
  get_audit_logs: '查询审计日志',
  get_admin_api_logs: '查询 API 调用日志',
  get_publish_status: '查询发布状态',
};

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

export function ChatPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: nextId(), title: '新建对话', messages: [] },
  ]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Array<{ url: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  // 无模型时的配置引导弹窗
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  // 对话中的工具执行日志（显示 AI 正在查什么/做什么）
  const [toolLogs, setToolLogs] = useState<Array<{ toolName: string; status: 'running' | 'done' | 'error' }>>([]);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  // 模型列表是否已加载完成（避免加载中误判为未配置）
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // 加载已配置模型（从模型配置页返回或切回标签页时自动刷新）
  const loadModels = useCallback(async () => {
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
        setModel((prev) => (options.some((o) => o.value === prev) ? prev : options[0]?.value || ''));
      }
    } catch {
      // ignore
    } finally {
      // 模型加载完成标记（避免加载中误判为"未配置模型"）
      setModelsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels, pathname]); // 路由变化（如从模型配置返回）时刷新

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadModels();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadModels]);

  // 接收首页引导页的"开始"请求（chat-send 事件 → 直接发送消息）
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) handleSendRef.current?.(text);
    };
    window.addEventListener('chat-send', handler);
    return () => window.removeEventListener('chat-send', handler);
  }, []);
  // 供 chat-send 事件调用的最新 handleSend（避免闭包过期）
  const handleSendRef = useRef<(text?: string) => void>(() => {});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // 未配置模型：加载完成且为空时弹窗引导（仅 admin；避免刷新闪现）
  useEffect(() => {
    if (modelsLoaded && modelOptions.length === 0 && isAdmin) {
      setModelConfigOpen(true);
    }
  }, [modelsLoaded, modelOptions.length, isAdmin]);

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
  // 加载全部对话（挂载与侧边栏切换时复用）
  const loadAllConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();

      // 数据库没有对话时不自动创建——只有真正发送消息才创建历史（保留本地占位会话）
      if (!Array.isArray(data) || data.length === 0) {
        setLoadingHistory(false);
        return;
      }

      // Load messages for each conversation
      const convs: Conversation[] = await Promise.all(
        data.map(async (dbConv: { id: string; title: string }) => {
          try {
            const msgsRes = await fetch(`/api/conversations/${dbConv.id}/messages`);
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

      setConversations(convs);
      setActiveId((prev) => prev || convs[0]?.id || '');
      setLoadingHistory(false);
    } catch {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadAllConversations();
  }, [loadAllConversations]);

  const activeConversation = conversations.find((c) => c.id === activeId);
  const messages = activeConversation?.messages ?? [];

  // auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSend = async (overrideText?: string) => {
    // 语音输入：识别文本直接传入（避免 React 状态异步导致读旧值）
    const text = (overrideText ?? input).trim();
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

    // 首条消息：以第一句话作为对话标题（持久化到数据库）
    if (isFirstMessage) {
      fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text.slice(0, 20) }),
      })
        .then(() => {
          // 标题已更新，通知侧边栏刷新显示第一句话
          window.dispatchEvent(new Event('conversations-updated'));
        })
        .catch(() => {});
    }

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
              toolName?: string;
              toolCallId?: string;
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

            // 处理工具执行日志（AI 调用工具时实时显示过程）
            if (data.type === 'tool-input-start' && data.toolName) {
              setToolLogs((prev) => [
                ...prev.filter((l) => l.toolName !== data.toolName),
                { toolName: data.toolName as string, status: 'running' },
              ]);
            }
            if (data.type === 'tool-output-available' && data.toolName) {
              const output = (data as { output?: { error?: string } }).output;
              setToolLogs((prev) => [
                ...prev.filter((l) => l.toolName !== data.toolName),
                {
                  toolName: data.toolName as string,
                  status: output?.error ? 'error' : 'done',
                },
              ]);
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
              // 防御：AI 可能幻觉出未配置的模型 id，统一替换为第一个可用模型
              await normalizeWorkflowModels(workflowData);
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
      // 回复结束，清空工具执行日志（过程已展示完毕）
      setToolLogs([]);
    }
  };
  // 同步最新 handler（供 chat-send 事件使用）
  handleSendRef.current = handleSend;

  // ===== 空状态（新建对话）：标题 + 对话输入框 + 模板推荐（一体）=====
  const startEmptyChat = async (text?: string) => {
    const content = (text ?? '').trim();
    if (!content || isGenerating) return;
    await handleNewConversation();
    // 新会话创建后 conversations[0] 即新会话（handleSend 有兜底）
    handleSend(content);
  };

  // 侧边栏选择/新建对话事件
  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) {
        if (!conversations.some((c) => c.id === id)) {
          // 本地没有该对话（如其它会话创建）：重新加载
          loadAllConversations();
        }
        setActiveId(id);
      }
    };
    const onNew = () => {
      setActiveId('');
    };
    // 侧边栏删除对话请求 → 统一走 handleDeleteConversation（状态切换 + API + 通知刷新）
    const onDeleteRequest = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) handleDeleteConversation(id);
    };
    window.addEventListener('chat-select', onSelect);
    window.addEventListener('chat-new', onNew);
    window.addEventListener('chat-delete-request', onDeleteRequest);
    return () => {
      window.removeEventListener('chat-select', onSelect);
      window.removeEventListener('chat-new', onNew);
      window.removeEventListener('chat-delete-request', onDeleteRequest);
    };
  }, [conversations]);

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
      // 通知侧边栏刷新对话历史（空态首条消息创建的对话立即可见）
      window.dispatchEvent(new Event('conversations-updated'));
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
      // 通知侧边栏刷新对话历史
      window.dispatchEvent(new Event('conversations-updated'));
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

    // 异步从 Supabase 删除；删除完成后再通知侧边栏刷新（否则列表仍显示）
    fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      .then(() => window.dispatchEvent(new Event('conversations-updated')))
      .catch(() => window.dispatchEvent(new Event('conversations-updated')));
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-indigo-50 via-background to-violet-50 dark:from-indigo-950/40 dark:via-background dark:to-violet-950/40">
      {/* 品牌光晕：铺满整个对话页（空态与消息态统一背景） */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-violet-500/15 blur-3xl" />
      {/* === Chat Main Area === */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* header：仅已有对话时显示（空态不显示"新建对话"行） */}
        {activeConversation && (
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="truncate text-sm font-medium text-foreground">
              {activeConversation.title}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(activeConversation)}
                title={t('chat.deleteConversation')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* error alert */}
        {error && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* messages or empty state */}
        {messages.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8">
            <div className="w-full max-w-2xl">
              {/* 标题 + 输入框一体（同一容器） */}
              <div className="flex flex-col items-center gap-2">
                <div className="bg-brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-indigo-500/30">
                  <Sparkles className="h-6 w-6 text-white" />
                </div>
                <p className="text-brand-gradient text-xl font-bold">{t('app.name')}</p>
                <p className="text-sm text-muted-foreground">{t('home.subtitle')}</p>
              </div>

              {/* 对话输入框（直接复用，标题下方） */}
              <div className="mx-auto mt-6 w-full max-w-2xl">
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
                  placeholder={t('home.placeholder')}
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
                    onClick={() => startEmptyChat(rec.replace(/^[^\s]+\s*/, ''))}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {rec}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
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

        {/* 工具执行日志（AI 调用工具时实时显示过程） */}
        {toolLogs.length > 0 && (
          <div className="border-b border-border px-4 py-2">
            <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <p className="font-medium text-muted-foreground">{t('chat.toolLogTitle')}</p>
              {toolLogs.map((log) => (
                <div key={log.toolName} className="flex items-center gap-2">
                  {log.status === 'running' ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                  ) : log.status === 'done' ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                  )}
                  <span className="truncate">{TOOL_LABELS[log.toolName] ?? log.toolName}</span>
                  {log.status === 'running' && (
                    <span className="text-muted-foreground">{t('chat.toolLogRunning')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 底部输入框：居中圆角卡片（ChatGPT 风格，非空态显示） */}
        {messages.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-4">
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
        )}

        {/* 模型配置引导弹窗 */}
        <ModelConfigDialog
          open={modelConfigOpen}
          onOpenChange={setModelConfigOpen}
          onConfigured={loadModels}
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
