import { z } from 'zod';
import { tool } from 'ai';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import type { AuthUser } from '@/lib/server-auth';
import { logAudit } from '@/lib/audit';
import { deleteOSSObject } from '@/lib/oss-server';
import { getOSSConfig } from '@/lib/oss-config';

// ===== Agent 只读工具集 =====
// P1：让 AI 对话能查询系统状态（工作流/模型/日志/发布），实现「知道一切 + 排错」
// 所有工具以当前登录用户身份执行（数据隔离），只读无副作用
// 返回尽量精简的摘要，控制 token 消耗

const MAX_LIST = 10;

// 工具执行前统一取用户（未登录返回 null，工具返回错误信息）
async function getAuthUser(): Promise<AuthUser | string> {
  const user = await getCurrentUser();
  if (!user) return '未登录，请先登录';
  return user;
}

function isUser(u: AuthUser | string): u is AuthUser {
  return typeof u !== 'string';
}

// 1. 列出当前用户的工作流
const listWorkflows = tool({
  description: '列出当前用户的所有工作流（标题/节点数/发布状态/更新时间）。回答"我有几个工作流""我的工作流有哪些"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data, error } = await supabase
      .from('workflow_history')
      .select('id, title, published, created_at, updated_at, data')
      .eq('saved', true)
      .eq('user_id', u.id)
      .order('updated_at', { ascending: false })
      .limit(MAX_LIST);
    if (error) return { error: error.message };
    return {
      workflows: (data ?? []).map((w: { id: string; title: string; published: boolean; updated_at: string; data: { nodes?: unknown[] } | null }) => ({
        id: w.id,
        title: w.title,
        nodes: Array.isArray(w.data?.nodes) ? w.data.nodes.length : 0,
        published: w.published,
        updatedAt: w.updated_at,
      })),
    };
  },
});

// 2. 获取单个工作流详情（节点结构 + LLM 配置摘要）
const getWorkflow = tool({
  description: '获取单个工作流的详细结构：节点类型、LLM 节点使用的模型（llmId）、输入参数。回答"这个工作流怎么做的""用的什么模型"时使用。',
  inputSchema: z.object({ workflowId: z.string().describe('工作流 ID（可从 list_workflows 获得）') }),
  execute: async ({ workflowId }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data, error } = await supabase
      .from('workflow_history')
      .select('id, title, description, published, data')
      .eq('id', workflowId)
      .eq('user_id', u.id)
      .single();
    if (error || !data) return { error: error ? error.message : '工作流不存在' };

    const nodes = Array.isArray(data.data?.nodes) ? data.data.nodes : [];
    const summary = nodes.map((n: { type?: string; data?: Record<string, unknown> }) => ({
      type: n.type,
      title: n.data?.title,
      // LLM 节点：报告模型 id 与 prompt 概要
      ...(n.type === 'llmNode'
        ? {
            llmId: n.data?.llmId,
            systemPrompt: String(n.data?.systemPrompt ?? '').slice(0, 100),
            userPrompt: String(n.data?.userPrompt ?? '').slice(0, 100),
          }
        : {}),
    }));
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      published: data.published,
      nodes: summary,
    };
  },
});

// 3. 版本历史
const listWorkflowVersions = tool({
  description: '获取工作流的版本历史（版本号/时间/标题）。回答"改过几次""有哪些版本"时使用。',
  inputSchema: z.object({ workflowId: z.string().describe('工作流 ID') }),
  execute: async ({ workflowId }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data, error } = await supabase
      .from('workflow_versions')
      .select('version, title, created_at')
      .eq('workflow_id', workflowId)
      .order('version', { ascending: false })
      .limit(MAX_LIST);
    if (error) return { error: error.message };
    return { versions: data ?? [] };
  },
});

// 4. 已配置模型
const listModels = tool({
  description: '列出当前系统已配置的 AI 模型（ID/Provider/能力）。回答"能用什么模型""模型配置"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const { data, error } = await supabase
      .from('ai_models')
      .select('id, provider, capabilities, label')
      .order('id');
    if (error) return { error: error.message };
    return { models: data ?? [] };
  },
});

// 5. 全局 API Key 状态
const getApiKeyStatus = tool({
  description: '获取当前用户全局 API Key 的状态（是否生成/有效期/是否过期）。回答"API Key 状态""Key 过期了吗"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data } = await supabase
      .from('user_api_keys')
      .select('api_key_expires_at, created_at')
      .eq('user_id', u.id)
      .maybeSingle();
    if (!data) return { keyStatus: '未生成' };
    const expired =
      data.api_key_expires_at && new Date(data.api_key_expires_at).getTime() < Date.now();
    return {
      keyStatus: expired ? '已过期' : '有效',
      expiresAt: data.api_key_expires_at,
      createdAt: data.created_at,
    };
  },
});

// 6. 执行历史（画布试运行 + API 调用）
const getExecutionHistory = tool({
  description: '获取最近的工作流执行记录（来源/状态/错误信息/耗时）。回答"上次运行失败了吗""执行报错了什么"时使用。',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional().describe('条数，默认 5'),
  }),
  execute: async ({ limit = 5 }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    // 当前用户的工作流 id（api_call_logs 无 user_id，按工作流归属过滤）
    const { data: mine } = await supabase
      .from('workflow_history')
      .select('id')
      .eq('user_id', u.id)
      .eq('saved', true);
    const myIds = (mine ?? []).map((w: { id: string }) => w.id);
    if (myIds.length === 0) return { canvasRuns: [], apiCalls: [] };

    // 画布试运行记录（flow_runs）
    const { data: runs, error: runsErr } = await supabase
      .from('flow_runs')
      .select('workflow_id, status, error, created_at, duration_ms')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    // 外部 API 调用记录（api_call_logs）
    const { data: logs, error: logsErr } = await supabase
      .from('api_call_logs')
      .select('workflow_id, status, error, created_at, duration_ms')
      .in('workflow_id', myIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (runsErr || logsErr) {
      return { error: runsErr?.message || logsErr?.message };
    }
    return {
      canvasRuns: (runs ?? []).map((r: { workflow_id: string; status: string; error: string | null; duration_ms: number | null; created_at: string }) => ({
        workflowId: r.workflow_id,
        status: r.status,
        error: r.error ? String(r.error).slice(0, 300) : null,
        durationMs: r.duration_ms,
        at: r.created_at,
      })),
      apiCalls: (logs ?? []).map((l: { workflow_id: string; status: string; error: string | null; duration_ms: number | null; created_at: string }) => ({
        workflowId: l.workflow_id,
        status: l.status,
        error: l.error ? String(l.error).slice(0, 300) : null,
        durationMs: l.duration_ms,
        at: l.created_at,
      })),
    };
  },
});

// 7. API 调用日志（外部系统调用）
const getApiCallLogs = tool({
  description: '获取外部系统通过 API Key 调用工作流的日志（成功/失败/错误/耗时）。回答"外部调用报错""API 调用失败原因"时使用。',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional().describe('条数，默认 5'),
    workflowId: z.string().optional().describe('按工作流过滤（可选）'),
  }),
  execute: async ({ limit = 5, workflowId }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    // api_call_logs 无 user_id：按工作流归属过滤
    const { data: mine } = await supabase
      .from('workflow_history')
      .select('id')
      .eq('user_id', u.id)
      .eq('saved', true);
    const myIds = (mine ?? []).map((w: { id: string }) => w.id);
    if (myIds.length === 0) return { logs: [] };

    let query = supabase
      .from('api_call_logs')
      .select('workflow_id, status, error, created_at, duration_ms, ip')
      .in('workflow_id', myIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (workflowId) query = query.eq('workflow_id', workflowId);
    const { data, error } = await query;
    if (error) return { error: error.message };
    return {
      logs: (data ?? []).map((l: { workflow_id: string; status: string; error: string | null; duration_ms: number | null; ip: string | null; created_at: string }) => ({
        workflowId: l.workflow_id,
        status: l.status,
        error: l.error ? String(l.error).slice(0, 300) : null,
        durationMs: l.duration_ms,
        ip: l.ip,
        at: l.created_at,
      })),
    };
  },
});

// 7.5 OSS 配置状态（追问存储方式时可结合实际情况建议）
const getOSSConfigStatus = tool({
  description: '查询系统是否已配置 OSS 存储（数据库配置或环境变量）。创建知识库选择存储方式时，用于判断能否用 OSS。',
  inputSchema: z.object({}),
  execute: async () => {
    const config = await getOSSConfig();
    if (!config) {
      return { configured: false, message: 'OSS 未配置，建议使用数据库存储' };
    }
    return { configured: true, message: 'OSS 已配置，可选择 OSS 存储' };
  },
});

// 8. 列出用户的知识库（创建/删除前查看）
const listKnowledgeBases = tool({
  description: '列出当前用户的所有知识库（名称/存储方式/文档数）。回答"我有哪些知识库"或准备创建/删除知识库时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data, error } = await supabase
      .from('knowledge_bases')
      .select('id, name, description, storage_type')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false });
    if (error) return { error: error.message };
    // 统计各库文档数
    const bases = data ?? [];
    const withCounts = await Promise.all(
      bases.map(async (b: { id: string; name: string; description: string | null; storage_type: string }) => {
        const { count } = await supabase
          .from('knowledge_documents')
          .select('id', { count: 'exact', head: true })
          .eq('knowledge_base_id', b.id);
        return { ...b, documentCount: count ?? 0 };
      }),
    );
    return { knowledgeBases: withCounts };
  },
});

// 9. 创建知识库（执行类：须先征得用户同意）
const createKnowledgeBase = tool({
  description: '创建一个新的知识库（用户确认后调用）。name 必填，storage_type 可选 database（默认）/ oss。',
  inputSchema: z.object({
    name: z.string().describe('知识库名称'),
    description: z.string().optional().describe('描述'),
    storageType: z.enum(['database', 'oss']).optional().describe('存储方式，默认 database'),
  }),
  execute: async ({ name, description, storageType = 'database' }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (!name?.trim()) return { error: '知识库名称不能为空' };
    const { data, error } = await supabase
      .from('knowledge_bases')
      .insert({
        user_id: u.id,
        name: name.trim(),
        description: description?.trim() || null,
        storage_type: storageType === 'oss' ? 'oss' : 'database',
      })
      .select('id, name, storage_type')
      .single();
    if (error) return { error: error.message };
    await logAudit({
      userId: u.id,
      username: u.username,
      action: 'knowledge_base_create',
      detail: { kbId: data.id, name, via: 'ai-assistant' },
      ip: 'ai',
    });
    return { created: data, message: `知识库「${data.name}」创建成功` };
  },
});

// 10. 删除知识库（执行类：须先征得用户同意；连带删除文档与 OSS 文件）
const deleteKnowledgeBase = tool({
  description: '删除一个知识库及其所有文档（用户确认后调用）。删除前可先用 list_knowledge_bases 确认。',
  inputSchema: z.object({
    knowledgeBaseId: z.string().describe('知识库 ID（从 list_knowledge_bases 获取）'),
  }),
  execute: async ({ knowledgeBaseId }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };

    const { data: kb } = await supabase
      .from('knowledge_bases')
      .select('id, name, user_id')
      .eq('id', knowledgeBaseId)
      .single();
    if (!kb) return { error: '知识库不存在' };
    if (kb.user_id !== u.id) return { error: '无权操作该知识库' };

    // 清理 OSS 文件（失败不影响删除）
    const { data: docs } = await supabase
      .from('knowledge_documents')
      .select('oss_key')
      .eq('knowledge_base_id', knowledgeBaseId);
    if (docs) {
      for (const d of docs as Array<{ oss_key: string | null }>) {
        if (d.oss_key) await deleteOSSObject(d.oss_key);
      }
    }

    const { error } = await supabase
      .from('knowledge_bases')
      .delete()
      .eq('id', knowledgeBaseId);
    if (error) return { error: error.message };

    await logAudit({
      userId: u.id,
      username: u.username,
      action: 'knowledge_base_delete',
      detail: { kbId: knowledgeBaseId, name: kb.name, via: 'ai-assistant' },
      ip: 'ai',
    });
    return { deleted: knowledgeBaseId, message: `知识库「${kb.name}」已删除` };
  },
});

// 10.5 配置模型（执行类：仅 admin，须两段式确认；Key 只在本次配置使用）
const createModel = tool({
  description: '在系统中添加/配置一个 AI 模型（仅管理员，执行类：调用前必须先向用户展示将配置的模型 ID/Provider，征得明确同意后再调用）。id 和 apiKey 必填；用户未明确提供 API Key 时先询问，不要编造。',
  inputSchema: z.object({
    id: z.string().describe('模型 ID，如 deepseek-v4-flash'),
    provider: z.string().optional().describe('provider：deepseek / ark / openai-compatible / custom，默认 deepseek'),
    apiKey: z.string().describe('API Key（用户提供）'),
    baseUrl: z.string().optional().describe('Base URL，deepseek 可留空用默认'),
    label: z.string().optional().describe('显示名称'),
    capabilities: z.array(z.string()).optional().describe('能力，默认 ["text"]'),
  }),
  execute: async ({ id, provider = 'deepseek', apiKey, baseUrl, label, capabilities }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (u.role !== 'admin') return { error: '仅管理员可配置模型' };
    if (!id?.trim() || !apiKey?.trim()) {
      return { error: '模型 ID 和 API Key 不能为空，请先向用户确认' };
    }
    const { data, error } = await supabase
      .from('ai_models')
      .insert({
        id: id.trim(),
        provider,
        capabilities: Array.isArray(capabilities) && capabilities.length > 0 ? capabilities : ['text'],
        label: label?.trim() || null,
        base_url: baseUrl?.trim() || null,
        api_key: apiKey.trim(),
      })
      .select('id, provider, capabilities, label')
      .single();
    if (error) {
      if (error.code === '23505') return { error: '模型 ID 已存在，可更新或换一个 ID' };
      return { error: error.message };
    }
    await logAudit({
      userId: u.id,
      username: u.username,
      action: 'model_create',
      detail: { modelId: data.id, provider, via: 'ai-assistant' },
      ip: 'ai',
    });
    return { created: data, message: `模型「${data.id}」配置成功，对话与画布立即可用` };
  },
});

// 11. 用户列表（管理：仅 admin）
const listUsers = tool({
  description: '列出系统所有用户（管理员）。回答"有哪些用户/用户列表"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (u.role !== 'admin') return { error: '仅管理员可查看用户列表' };
    const { data, error } = await supabase
      .from('users')
      .select('username, display_name, role, status, locked_until, failed_attempts, created_at')
      .order('created_at', { ascending: false });
    if (error) return { error: error.message };
    return {
      users: (data ?? []).map((x: { username: string; display_name: string | null; role: string; status: string; locked_until: string | null; failed_attempts: number; created_at: string }) => ({
        username: x.username,
        displayName: x.display_name,
        role: x.role,
        status: x.status,
        locked: x.locked_until ? new Date(x.locked_until).getTime() > Date.now() : false,
        failedAttempts: x.failed_attempts,
        createdAt: x.created_at,
      })),
    };
  },
});

// 12. 用量统计（管理：仅 admin）
const getStats = tool({
  description: '获取平台整体用量统计（管理员）：用户/对话/消息/工作流/执行次数/API 调用数。回答"用量统计/平台情况"时使用。',
  inputSchema: z.object({}),
  execute: async () => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (u.role !== 'admin') return { error: '仅管理员可查看统计' };
    const [
      users,
      conversations,
      messages,
      workflows,
      runs,
      apiCalls,
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('conversations').select('id', { count: 'exact', head: true }),
      supabase.from('messages').select('id', { count: 'exact', head: true }),
      supabase.from('workflow_history').select('id', { count: 'exact', head: true }).eq('saved', true),
      supabase.from('flow_runs').select('status', { count: 'exact', head: false }),
      supabase.from('api_call_logs').select('id', { count: 'exact', head: true }),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const r of (runs.data ?? []) as Array<{ status: string }>) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }
    return {
      stats: {
        users: users.count ?? 0,
        conversations: conversations.count ?? 0,
        messages: messages.count ?? 0,
        workflows: workflows.count ?? 0,
        flowRuns: runs.count ?? 0,
        apiCalls: apiCalls.count ?? 0,
      },
      runStatus: statusCounts,
    };
  },
});

// 13. 审计日志（管理：仅 admin）
const getAuditLogs = tool({
  description: '获取最近的审计日志（管理员）：登录/用户/工作流/API 操作记录。回答"审计日志/操作记录/谁做了什么"时使用。',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(30).optional().describe('条数，默认 10'),
  }),
  execute: async ({ limit = 10 }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (u.role !== 'admin') return { error: '仅管理员可查看审计日志' };
    const { data, error } = await supabase
      .from('audit_logs')
      .select('username, action, detail, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    return {
      logs: (data ?? []).map((l: { username: string | null; action: string; detail: unknown; ip: string | null; created_at: string }) => ({
        username: l.username,
        action: l.action,
        detail: l.detail,
        ip: l.ip,
        at: l.created_at,
      })),
    };
  },
});

// 14. 全量 API 调用日志（管理：仅 admin；普通用户的调用情况）
const getAdminApiLogs = tool({
  description: '获取外部 API 调用记录（管理员，含所有用户）：工作流/状态/错误/耗时/来源 IP。回答"API 调用情况/外部调用日志"时使用。',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(30).optional().describe('条数，默认 10'),
  }),
  execute: async ({ limit = 10 }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    if (u.role !== 'admin') return { error: '仅管理员可查看 API 调用日志' };
    const { data, error } = await supabase
      .from('api_call_logs')
      .select('workflow_id, status, error, duration_ms, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    // 关联工作流标题
    const wfIds = [...new Set((data ?? []).map((l: { workflow_id: string }) => l.workflow_id))];
    const { data: wfs } = await supabase
      .from('workflow_history')
      .select('id, title')
      .in('id', wfIds);
    const titleMap: Record<string, string> = {};
    for (const w of (wfs ?? []) as Array<{ id: string; title: string }>) titleMap[w.id] = w.title;
    return {
      logs: (data ?? []).map((l: { workflow_id: string; status: string; error: string | null; duration_ms: number | null; ip: string | null; created_at: string }) => ({
        workflowTitle: titleMap[l.workflow_id] ?? l.workflow_id,
        status: l.status,
        error: l.error ? String(l.error).slice(0, 200) : null,
        durationMs: l.duration_ms,
        ip: l.ip,
        at: l.created_at,
      })),
    };
  },
});

// 15. 知识库检索（RAG：让 AI 基于用户知识库回答）
const searchKnowledge = tool({
  description: '在用户的知识库中检索文档。当用户的问题涉及"我的资料/文档/知识库"或需要基于已有资料回答时使用，检索结果将作为回答的依据。',
  inputSchema: z.object({
    keyword: z.string().describe('检索关键词（如问题中的核心词）'),
    limit: z.number().int().min(1).max(10).optional().describe('返回条数，默认 3'),
  }),
  execute: async ({ keyword, limit = 3 }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };

    const { data: kbs } = await supabase
      .from('knowledge_bases')
      .select('id')
      .eq('user_id', u.id);
    const kbIds = (kbs ?? []).map((k: { id: string }) => k.id);
    if (kbIds.length === 0) return { documents: [], note: '用户还没有创建知识库' };

    // 拆词检索（复用知识库节点的检索策略）；拆不出词时返回空（避免误返回全部文档）
    const terms = (keyword || '')
      .replace(/[，。！？、；：""''（）\s,\.!?;:\(\)\[\]「」]/g, ' ')
      .split(/\s+/)
      .filter((s) => s.length >= 2)
      .slice(0, 5);
    if (terms.length === 0) {
      return { documents: [], note: '无法从问题中提取检索关键词' };
    }
    const orClauses = terms
      .map((t) => `title.ilike.%${t}%,content.ilike.%${t}%`)
      .join(',');

    const { data, error } = await supabase
      .from('knowledge_documents')
      .select('title, content')
      .in('knowledge_base_id', kbIds)
      .or(orClauses)
      .limit(limit);

    if (error) return { error: error.message };
    return {
      documents: (data ?? []).map((d: { title: string; content: string }) => ({
        title: d.title,
        content: d.content.slice(0, 1500),
      })),
    };
  },
});

// 9. 发布状态
const getPublishStatus = tool({
  description: '获取工作流的发布状态（是否发布/发布的版本/发布内容是否与当前一致）。回答"发布了吗""发布的是哪个版本"时使用。',
  inputSchema: z.object({ workflowId: z.string().describe('工作流 ID') }),
  execute: async ({ workflowId }) => {
    const u = await getAuthUser();
    if (!isUser(u)) return { error: u };
    const { data, error } = await supabase
      .from('workflow_history')
      .select('id, title, published, published_version')
      .eq('id', workflowId)
      .eq('user_id', u.id)
      .single();
    if (error || !data) return { error: error ? error.message : '工作流不存在' };
    return {
      title: data.title,
      published: data.published,
      publishedVersion: data.published_version,
      note: data.published
        ? `已发布（版本 v${data.published_version ?? '?'}）`
        : '未发布',
    };
  },
});

// ===== 工具集（导出给 chat-ai 使用）=====
export const agentTools = {
  list_workflows: listWorkflows,
  get_workflow: getWorkflow,
  list_workflow_versions: listWorkflowVersions,
  list_models: listModels,
  get_api_key_status: getApiKeyStatus,
  get_execution_history: getExecutionHistory,
  get_api_call_logs: getApiCallLogs,
  list_knowledge_bases: listKnowledgeBases,
  search_knowledge: searchKnowledge,
  get_oss_config_status: getOSSConfigStatus,
  create_knowledge_base: createKnowledgeBase,
  delete_knowledge_base: deleteKnowledgeBase,
  create_model: createModel,
  list_users: listUsers,
  get_stats: getStats,
  get_audit_logs: getAuditLogs,
  get_admin_api_logs: getAdminApiLogs,
  get_publish_status: getPublishStatus,
};

export const agentToolsPrompt = `你有能力查询并操作用户的系统。可用工具：
- list_workflows：列出工作流
- get_workflow：工作流详情（节点/模型/prompt）
- list_workflow_versions：版本历史
- list_models：已配置模型
- get_api_key_status：API Key 状态
- get_execution_history：执行记录（含错误）
- get_api_call_logs：外部 API 调用日志（含错误）
- list_knowledge_bases：列出知识库
- search_knowledge：检索用户知识库（基于资料回答时使用）
- get_oss_config_status：查询 OSS 是否已配置
- create_knowledge_base：创建知识库（执行类）
- delete_knowledge_base：删除知识库（执行类）
- create_model：配置 AI 模型（执行类，仅管理员）
- list_users：用户列表（仅管理员）
- get_stats：平台用量统计（仅管理员）
- get_audit_logs：审计日志（仅管理员）
- get_admin_api_logs：API 调用记录（仅管理员）
- get_publish_status：发布状态

## 权限规则
- 标有"仅管理员"的工具：非管理员调用会返回"仅管理员可查看/操作"，此时如实告知用户需要管理员权限
- create_model 配置模型前：确认模型 ID 与 API Key（Key 仅本次配置使用，不要在回复中重复显示用户提供的完整 API Key）

使用规则：
1. 用户询问"我的工作流/模型/日志/发布/报错"相关时，先调用工具查询，再基于真实数据回答
2. 排查错误时：先查执行记录或调用日志找到错误，再查相关工作流/模型配置分析原因，给出明确的解决建议
3. 工具返回 error 时如实说明，不要编造

## 执行类操作规则（create_knowledge_base / delete_knowledge_base）

这些工具会修改用户数据，必须遵守两段式确认：
1. **调用前先向用户展示将要执行的操作**（如："我将创建知识库「测试」（数据库存储），确认执行吗？"），等待用户明确回复
2. 用户明确同意（"确认/好/可以/执行"等）后，**再调用工具**
3. 用户拒绝或未明确同意时，**不得调用**执行类工具
4. 删除类操作要特别说明影响（"将删除知识库及其所有文档"）
5. **关键参数不明确时先询问，不要擅自用默认值**：如创建知识库未指定名称、或未指定存储方式（数据库/OSS）时，先问用户选择（可用 get_oss_config_status 了解 OSS 是否可用，给出建议），等用户明确后再执行`;

// 系统页面导航知识：全模式注入（不依赖工具），让 AI 能引导用户去正确页面操作
export const systemNavPrompt = `## 系统页面导航（给用户的操作指引）

- 画布编辑器：/workflows/editor（创建/修改工作流）
- 工作流列表：/workflows
- 模型配置：/admin/models（添加/管理模型，仅管理员）
- API 管理：/workflows/api-keys（全局 API Key、有效期、重新生成）
- 知识库：/knowledge（创建知识库、上传文档；工作流中的「知识库」节点从这里选）
- 执行历史：/workflows/history
- 定时任务：/workflows/schedules

当用户需要做某件事（配置模型、发布、查看日志、重新生成 Key 等）时：
1. 先查相关状态（如有必要）
2. 明确告诉用户去哪个页面、具体操作步骤（如"管理后台 → 模型配置 → 添加模型，填入 ID 和 API Key"）
3. 用 [去往：页面名](/路径) 格式附上跳转链接（页面名用中文，如 [去往：模型配置](/admin/models)）`;
