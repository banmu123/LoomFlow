import { z } from 'zod';
import { tool } from 'ai';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import type { AuthUser } from '@/lib/server-auth';

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

// 8. 知识库检索（RAG：让 AI 基于用户知识库回答）
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
  search_knowledge: searchKnowledge,
  get_publish_status: getPublishStatus,
};

export const agentToolsPrompt = `你有能力查询用户的系统状态来回答问题或排查问题。可用工具：
- list_workflows：列出工作流
- get_workflow：工作流详情（节点/模型/prompt）
- list_workflow_versions：版本历史
- list_models：已配置模型
- get_api_key_status：API Key 状态
- get_execution_history：执行记录（含错误）
- get_api_call_logs：外部 API 调用日志（含错误）
- search_knowledge：检索用户知识库（基于资料回答时使用）
- get_publish_status：发布状态

使用规则：
1. 用户询问"我的工作流/模型/日志/发布/报错"相关时，先调用工具查询，再基于真实数据回答
2. 排查错误时：先查执行记录或调用日志找到错误，再查相关工作流/模型配置分析原因，给出明确的解决建议
3. 工具返回 error 时如实说明，不要编造
4. 你只能读取和查询，不能修改任何数据`;

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
