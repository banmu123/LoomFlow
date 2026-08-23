'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
import { WorkflowPreviewDrawer } from './WorkflowPreviewDrawer';
import { uploadFileToOSS } from '@/lib/oss-upload-client';
import { extractWorkflowJson } from '@/lib/agent/workflow-extract';
import { useT } from '@/lib/i18n';
import { ChevronsLeft, Boxes } from 'lucide-react';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { normalizeWorkflowModels } from '@/lib/workflow-templates';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { LocaleSwitcher } from './LocaleSwitcher';

const CHAT_PANEL_WIDTH = 440;

type MessageRole = 'user' | 'assistant';

// 新建对话的模板推荐（欢迎页 ChatLanding 复用）——i18n key，页面用 t() 渲染
export const RECOMMENDATIONS = [
  'home.templates.dailyNews',
  'home.templates.content',
  'home.templates.customer',
  'home.templates.weeklyReport',
  'home.templates.translator',
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
  /** 工具执行日志（后端生成执行器写入） */
  toolLogs?: Array<{ toolName: string; status: 'running' | 'done' | 'error' }>;
  createdAt: number;
}

interface Conversation {
  id: string;
  title: string;
  model?: string | null;
  messages: Message[];
}

let seq = 0;
const nextId = () => `${Date.now()}-${seq++}`;

export function ChatPanel({ conversationId = '' }: { conversationId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  // 当前对话由路由决定：/chat（空）→ 新聊天；/chat/[id] → 已生成对话
  const convId = conversationId;
  const [conversations, setConversations] = useState<Conversation[]>([]);
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
  // AI 生成的工作流（预览抽屉）
  const [previewWorkflow, setPreviewWorkflow] = useState<TinyflowData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  // 模型列表是否已加载完成（避免加载中误判为未配置）
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // 加载已配置模型（从模型配置页返回或切回标签页时自动刷新）
  // 优先使用当前对话绑定的模型（创建对话时选择的模型），否则保持当前选择，再回退第一个
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
        // 当前对话绑定的模型优先
        const boundModel = conversations.find((c) => c.id === convId)?.model;
        if (boundModel && options.some((o) => o.value === boundModel)) {
          setModel(boundModel);
        } else {
          // 保持当前选择，不存在时回退第一个
          setModel((prev) => (options.some((o) => o.value === prev) ? prev : options[0]?.value || ''));
        }
      }
    } catch {
      // ignore
    } finally {
      // 模型加载完成标记（避免加载中误判为"未配置模型"）
      setModelsLoaded(true);
    }
  }, [conversations, convId]);

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
  // generate 请求在途标记（轮询跳过中间态；ref 不触发渲染，由请求完成后的 state 更新驱动）
  const generateInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 消息列表滚动容器（自动滚动只操作它，避免 scrollIntoView 连带滚动上层容器）
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  const [loadingHistory, setLoadingHistory] = useState(!!conversationId);
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
        data.map(async (dbConv: { id: string; title: string; model?: string | null }) => {
          try {
            const msgsRes = await fetch(`/api/conversations/${dbConv.id}/messages`);
            const msgs = await msgsRes.json();
            return {
              id: dbConv.id,
              title: dbConv.title,
              model: dbConv.model ?? null,
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
                      tool_logs?: Message['toolLogs'] | null;
                      created_at: string;
                    }) => ({
                      id: m.id,
                      role: m.role,
                      content: m.content,
                      reasoning: m.reasoning,
                      status: m.status,
                      error: m.error,
                      images: m.images ?? undefined,
                      toolLogs: m.tool_logs ?? undefined,
                      createdAt: new Date(m.created_at).getTime(),
                    }),
                  )
                : [],
            };
          } catch {
            return { id: dbConv.id, title: dbConv.title, model: dbConv.model ?? null, messages: [] };
          }
        }),
      );

      setConversations(convs);
      setLoadingHistory(false);
    } catch {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadAllConversations();
  }, [loadAllConversations]);

  // 重新加载单个对话的消息（轮询观察生成进度）；生成状态以数据库消息状态为准
  const loadConversationMessages = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      const msgs = await res.json();
      if (!Array.isArray(msgs)) return;
      const parsed = msgs.map(
        (m: {
          id: string;
          role: MessageRole;
          content: string;
          reasoning?: string;
          status?: ChatMessageStatus;
          error?: string;
          images?: string[] | null;
          tool_logs?: Array<{ toolName: string; status: 'running' | 'done' | 'error' }> | null;
          created_at: string;
        }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          reasoning: m.reasoning,
          status: m.status,
          error: m.error,
          images: m.images ?? undefined,
          toolLogs: m.tool_logs ?? undefined,
          createdAt: new Date(m.created_at).getTime(),
        }),
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, messages: parsed } : c)),
      );
      // 生成状态以数据库为准：有未完成消息 → 生成中；否则结束（进入页面/刷新后据此恢复）
      const stillPending = parsed.some(
        (m) => m.status === 'pending' || m.status === 'streaming',
      );
      setIsGenerating(stillPending);
    } catch {
      // ignore
    }
  }, []);

  // 生成状态观察（轮询）：当前对话存在 pending/streaming 消息（数据库为准）→
  // 每 1.5s 拉取最新进度；全部完成后停止轮询并结束生成态。
  // 页面刷新/切换菜单后重新进入也能恢复 loading。
  useEffect(() => {
    if (!convId) return;
    // generate 请求在途时跳过：避免拉到"user 已插入、assistant 未插入"的中间态
    if (generateInFlightRef.current) return;
    const cur = conversations.find((c) => c.id === convId);
    const hasUnfinished = cur?.messages.some(
      (m) => m.status === 'pending' || m.status === 'streaming',
    );
    if (hasUnfinished) {
      setIsGenerating(true);
      const timer = setInterval(() => {
        loadConversationMessages(convId);
      }, 1500);
      return () => clearInterval(timer);
    }
    setIsGenerating(false);
  }, [convId, conversations, loadConversationMessages]);

  // 工具执行日志：从当前对话最后一条 assistant 消息读取（后端执行器写入 DB tool_logs）
  useEffect(() => {
    const cur = conversations.find((c) => c.id === convId);
    const lastAssistant = [...(cur?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'assistant');
    if (lastAssistant?.toolLogs?.length) {
      setToolLogs(lastAssistant.toolLogs);
    } else {
      setToolLogs([]);
    }
  }, [convId, conversations]);

  // 工作流提取：最后一条 done 的 assistant 消息包含工作流 JSON → 显示「预览工作流」按钮。
  // 不做"仅首次"防重（不自动跳转后重复提取无副作用）；历史工作流也常驻显示按钮
  useEffect(() => {
    const cur = conversations.find((c) => c.id === convId);
    if (!cur) return;
    const lastAssistant = [...cur.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.status === 'done');
    if (!lastAssistant?.content) return;
    // 提取 ```json 代码块并判断是否为工作流结构（{ nodes, edges }）
    const workflow = extractWorkflowJson(lastAssistant.content);
    if (workflow) {
      // 生成工作流 → 预览按钮（不自动跳转画布；AI 输出可能缺 viewport，Tinyflow 会默认处理）
      setPreviewWorkflow(workflow as unknown as TinyflowData);
    }
  }, [convId, conversations]);


  // 路由带对话 id：本地还没有该对话（直达/刷新/他人创建）时单独加载标题+消息
  useEffect(() => {
    if (!convId || conversations.some((c) => c.id === convId)) return;
    setLoadingHistory(true);
    fetch('/api/conversations')
      .then((res) => res.json())
      .then((list) => {
        const meta = Array.isArray(list)
          ? list.find((c: { id: string }) => c.id === convId)
          : null;
        if (!meta) {
          // 对话不存在（如已被删除）：回到新聊天
          router.replace('/chat');
          return null;
        }
        return fetch(`/api/conversations/${convId}/messages`)
          .then((res) => res.json())
          .then((msgs) => ({ title: meta.title, model: meta.model ?? null, msgs }));
      })
      .then((data) => {
        if (!data) return;
        const { title, model, msgs } = data;
        if (!Array.isArray(msgs)) {
          router.replace('/chat');
          return;
        }
        setConversations((prev) => [
          ...prev,
          {
            id: convId,
            title,
            model,
            messages: msgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              reasoning: m.reasoning,
              status: m.status,
              error: m.error,
              images: m.images ?? undefined,
              createdAt: new Date(m.created_at).getTime(),
            })),
          },
        ]);
      })
      .catch(() => {
        // 加载失败也放行（消息区显示空态），避免卡在 loading
      })
      .finally(() => setLoadingHistory(false));
  }, [convId, conversations, router]);

  const activeConversation = conversations.find((c) => c.id === convId);

  // 用户手动切换模型 → 持久化到当前对话（下次进入恢复同一模型）
  const handleModelChange = useCallback(
    (nextModel: string) => {
      setModel(nextModel);
      if (convId) {
        fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: nextModel }),
        }).catch(() => {});
      }
    },
    [convId],
  );
  const messages = activeConversation?.messages ?? [];

  // auto scroll：只滚动消息列表容器本身
  // （scrollIntoView 会连带滚动 ChatPanel 根容器——根容器是 overflow-hidden 的可滚动元素，
  //   被滚走后整页内容上移，底部露出空白）
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // 注意：不在卸载时 abort——切换菜单/跳转后，生成在后台继续完成并落库；
  // 重新挂载时通过 pending 消息恢复 loading 状态

  const updateConversation = useCallback(
    (id: string, updater: (c: Conversation) => Conversation) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
    },
    [],
  );

  // 创建真实对话（发送首条消息时才落库），返回创建结果；失败返回 null
  const createDbConversation = useCallback(async (): Promise<Conversation | null> => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新建对话', model: model || undefined }),
      });
      const db = await res.json();
      if (!db?.id) return null;
      const newConv: Conversation = {
        id: db.id,
        title: db.title,
        model: model || null,
        messages: [],
      };
      setConversations((prev) => [newConv, ...prev]);
      // 通知侧边栏刷新对话历史（新对话立即可见并高亮）
      window.dispatchEvent(new Event('conversations-updated'));
      return newConv;
    } catch {
      return null;
    }
  }, [model]);

  // 自动生成检测：当前对话最后一条是 user 消息且没有 AI 回复 → 触发生成。
  // 以数据库状态驱动（欢迎页发送首条消息后跳转、或生成中断后重进），不依赖 URL 参数；
  // 同一会话内只触发一次（刷新后组件重挂载可重试未完成的生成）
  const autoGenerateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!convId || isGenerating) return;
    const cur = conversations.find((c) => c.id === convId);
    if (!cur || cur.messages.length === 0) return;
    const last = cur.messages[cur.messages.length - 1];
    if (last.role !== 'user' || last.status !== 'done') return;
    if (autoGenerateRef.current === last.id) return;
    autoGenerateRef.current = last.id;

    setIsGenerating(true);
    generateInFlightRef.current = true;
    fetch(`/api/conversations/${convId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: last.content,
        images: last.images ?? [],
        model,
        regenerate: true,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.assistantMessage?.id) {
          setError(data?.error || '自动生成失败，请重试');
          setIsGenerating(false);
          return;
        }
        // 直接追加 assistant 消息（db id，轮询更新按 id 匹配）
        updateConversation(convId, (c) => ({
          ...c,
          messages: [
            ...c.messages,
            {
              id: data.assistantMessage.id,
              role: 'assistant' as const,
              content: '',
              status: 'pending' as const,
              createdAt: Date.now(),
            },
          ],
        }));
      })
      .catch(() => {
        setError('自动生成失败，请重试');
        setIsGenerating(false);
      })
      .finally(() => {
        generateInFlightRef.current = false;
      });
  }, [convId, conversations, isGenerating, model, updateConversation]);


  const handleSend = async (overrideText?: string) => {
    // 语音输入：识别文本直接传入（避免 React 状态异步导致读旧值）
    const text = (overrideText ?? input).trim();
    if (!text || isGenerating) return;

    setError(null);
    // 当前对话由路由决定：/chat（无 id）→ 创建新对话并跳转；/chat/[id] → 直接使用
    // （函数内局部变量遮蔽组件级 const convId，便于创建后替换为真实 id）
    let convId = conversationId;
    let isFirstMessage = false;
    const target = conversations.find((c) => c.id === convId);
    if (!target) {
      // 新聊天首条消息：创建真实对话，URL 立即带上新对话 id
      const newConv = await createDbConversation();
      if (!newConv) {
        setError('对话同步失败，请重试');
        return;
      }
      router.replace(`/chat/${newConv.id}`);
      convId = newConv.id;
      isFirstMessage = true;
    } else {
      isFirstMessage = target.messages.length === 0;
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

    // 本地先显示（占位 id；后端返回 db id 后替换，轮询更新按 db id 匹配）
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

    const sentImages = images.map((img) => img.url);
    setInput('');
    setImages([]);
    // 立即进入生成态（防连点；刷新/重进后由轮询按 DB 状态恢复）
    setIsGenerating(true);

    // 调用后端生成端点：后端插入 user/assistant 消息并后台执行生成（不阻塞）
    // 生成状态以数据库为准，前端轮询观察——页面刷新/切换菜单不中断生成
    generateInFlightRef.current = true;
    try {
      const res = await fetch(`/api/conversations/${convId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, images: sentImages, model }),
      });
      const data = await res.json();
      if (!res.ok || !data?.assistantMessage?.id) {
        setError(data?.error || '发送失败，请重试');
        // 生成未开始：移除本地占位
        updateConversation(convId, (c) => ({
          ...c,
          messages: c.messages.filter((m) => m.id !== assistantMsg.id),
        }));
        setIsGenerating(false);
        return;
      }
      // 用 db id 替换本地占位 id（轮询更新按 db id 匹配）
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => {
          if (m.id === userMsg.id && data.userMessage?.id) {
            return { ...m, id: data.userMessage.id };
          }
          if (m.id === assistantMsg.id) {
            return { ...m, id: data.assistantMessage.id };
          }
          return m;
        }),
      }));
    } catch {
      setError('发送失败，请重试');
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.filter((m) => m.id !== assistantMsg.id),
      }));
      setIsGenerating(false);
    } finally {
      generateInFlightRef.current = false;
    }
  };

  // ===== 空状态（新建对话）：标题 + 对话输入框 + 模板推荐（一体）=====
  const startEmptyChat = async (text?: string) => {
    const content = (text ?? '').trim();
    if (!content || isGenerating) return;
    // handleSend 内部负责创建真实对话（空态首条消息才落库）
    handleSend(content);
  };

  // 用户主动停止：调用后端 cancel 端点（DB 状态置 cancelled，后台生成器停止）
  const handleStop = () => {
    const cur = conversations.find((c) => c.id === convId);
    const activeMsg = cur?.messages.find(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'),
    );
    if (convId && activeMsg) {
      fetch(`/api/conversations/${convId}/messages/${activeMsg.id}/cancel`, {
        method: 'POST',
      }).catch(() => {});
    }
  };

  // 重新生成最后一条 AI 回复：删除旧回复 → 后端重新生成（历史消息保留，只插 assistant）
  const handleRegenerate = useCallback(
    async (assistantMsgId: string) => {
      if (isGenerating) return;
      const conv = conversations.find((c) => c.id === conversationId);
      if (!conv) return;

      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId);
      if (idx <= 0) return;
      const userMsg = conv.messages[idx - 1];
      if (userMsg.role !== 'user') return;

      // 本地：移除旧回复，插入新 pending 占位
      const newAssistant: Message = {
        id: nextId(),
        role: 'assistant',
        content: '',
        status: 'pending',
        createdAt: Date.now(),
      };
      setError(null);
      updateConversation(conversationId, (c) => ({
        ...c,
        messages: c.messages
          .filter((m) => m.id !== assistantMsgId)
          .concat(newAssistant),
      }));
      setIsGenerating(true);

      try {
        // 删除旧回复（DB），再触发重新生成
        await fetch(
          `/api/conversations/${conversationId}/messages/${assistantMsgId}`,
          { method: 'DELETE' },
        ).catch(() => {});
        const res = await fetch(`/api/conversations/${conversationId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: userMsg.content,
            images: userMsg.images,
            model,
            regenerate: true,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.assistantMessage?.id) {
          setError(data?.error || '重新生成失败，请重试');
          updateConversation(conversationId, (c) => ({
            ...c,
            messages: c.messages.filter((m) => m.id !== newAssistant.id),
          }));
          setIsGenerating(false);
          return;
        }
        // 用 db id 替换占位（轮询更新按 db id 匹配）
        updateConversation(conversationId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === newAssistant.id
              ? { ...m, id: data.assistantMessage.id }
              : m,
          ),
        }));
      } catch {
        setError('重新生成失败，请重试');
        updateConversation(conversationId, (c) => ({
          ...c,
          messages: c.messages.filter((m) => m.id !== newAssistant.id),
        }));
        setIsGenerating(false);
      }
    },
    [conversationId, conversations, isGenerating, model, updateConversation],
  );

  // 配置模型成功后：刷新模型列表 + 自动重试当前对话中失败/未回复的最后一条消息
  const handleModelConfigured = useCallback(() => {
    // 1. 刷新模型列表（模型选择器出现新模型）
    loadModels();
    // 2. 若当前对话的最后一条 user 消息没有成功回复（error/空/无回复），自动重试
    if (!convId || isGenerating) return;
    const cur = conversations.find((c) => c.id === convId);
    if (!cur || cur.messages.length === 0) return;
    // 找到最后一条 user 消息（失败时其后可能跟了一条 assistant error 消息）
    const lastUser = [...cur.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || lastUser.status !== 'done') return;
    // 该 user 消息之后是否已有成功的 assistant 回复
    const lastUserIdx = cur.messages.findIndex((m) => m.id === lastUser.id);
    const repliesAfter = cur.messages.slice(lastUserIdx + 1);
    const hasOkReply = repliesAfter.some(
      (m) => m.role === 'assistant' && m.status !== 'error' && m.content,
    );
    if (hasOkReply) return;

    // 删除该 user 消息之后的所有失败回复（error assistant），避免重试后新旧回复并存
    const staleReplies = repliesAfter.filter((m) => m.role === 'assistant');
    for (const sr of staleReplies) {
      fetch(`/api/conversations/${convId}/messages/${sr.id}`, {
        method: 'DELETE',
      }).catch(() => {});
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.filter((m) => m.id !== sr.id),
      }));
    }

    // 触发重新生成（复用 handleRegenerate 的调用形态：无 assistant id → 走 autoGenerate 路径）
    autoGenerateRef.current = null;
    setIsGenerating(true);
    generateInFlightRef.current = true;
    fetch(`/api/conversations/${convId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: lastUser.content,
        images: lastUser.images ?? [],
        model,
        regenerate: true,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.assistantMessage?.id) {
          setError(data?.error || '自动重试失败，请重试');
          setIsGenerating(false);
          return;
        }
        updateConversation(convId, (c) => ({
          ...c,
          messages: [
            ...c.messages,
            {
              id: data.assistantMessage.id,
              role: 'assistant' as const,
              content: '',
              status: 'pending' as const,
              createdAt: Date.now(),
            },
          ],
        }));
      })
      .catch(() => {
        setError('自动重试失败，请重试');
        setIsGenerating(false);
      })
      .finally(() => {
        generateInFlightRef.current = false;
      });
  }, [convId, conversations, isGenerating, model, loadModels, updateConversation]);

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

  const handleDeleteConversation = (id: string) => {
    // 删除的是当前对话（/chat/[id]）→ 回到新聊天
    if (convId === id) router.replace('/chat');
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setDeleteTarget(null);

    // 异步从 Supabase 删除；删除完成后再通知侧边栏刷新（否则列表仍显示）
    fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      .then(() => window.dispatchEvent(new Event('conversations-updated')))
      .catch(() => window.dispatchEvent(new Event('conversations-updated')));
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-[#f7efe4] via-background to-[#f3e6d4] dark:from-[#3a2b1e]/40 dark:via-background dark:to-[#4a2e17]/35">
      {/* 品牌光晕：铺满整个对话页（空态与消息态统一背景） */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-[#b77945]/12 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-[#d9b38c]/18 blur-3xl" />
      {/* === Chat Main Area === */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* header：仅已有对话时显示（空态不显示"新建对话"行） */}
        {activeConversation && (
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="truncate text-sm font-medium text-foreground">
              {activeConversation.title}
            </h2>
            <div className="flex items-center gap-1">
              {/* AI 生成工作流后：右上角预览按钮 */}
              {previewWorkflow && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  {t('chat.previewWorkflow')}
                </Button>
              )}
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
          loadingHistory ? (
            /* 历史加载中：显示加载占位，避免闪现欢迎页空态 */
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">{t('chat.loading')}</p>
            </div>
          ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8">
            <div className="w-full max-w-2xl">
              {/* 标题 + 输入框一体（同一容器） */}
              <div className="flex flex-col items-center gap-2">
                <div className="bg-brand-gradient flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-[#b77945]/25">
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
                  onModelChange={handleModelChange}
                />
              </div>

              {/* 模板推荐 */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">{t('home.recommend')}</span>
                {RECOMMENDATIONS.map((rec) => (
                  <button
                    key={rec}
                    onClick={() => startEmptyChat(t(rec).replace(/^[^\s]+\s*/, ''))}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {t(rec)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )
        ) : (
          <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {/* 顶部留出充足边距（首条消息不贴标题栏），底部 24px */}
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-6 pt-10">
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

        {/* 底部输入框：flex 列最后一项，天然贴底；消息区 flex-1 独立滚动 */}
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
              onModelChange={handleModelChange}
            />
          </div>
        )}

        {/* 模型配置引导弹窗 */}
        <ModelConfigDialog
          open={modelConfigOpen}
          onOpenChange={setModelConfigOpen}
          onConfigured={handleModelConfigured}
        />

        {/* 工作流预览抽屉（AI 生成工作流后） */}
        <WorkflowPreviewDrawer
          open={previewOpen}
          data={previewWorkflow}
          onOpenChange={setPreviewOpen}
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
