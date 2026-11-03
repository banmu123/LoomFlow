import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { runAgent, type AgentTool } from '@/lib/agent/runtime';
import { mcpRegistry, type ToolScope } from '@/lib/mcp';

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Agent 节点：受控的多轮工具调用。
 *
 * 与 LLM 节点的区别：LLM 节点是一次模型调用；Agent 节点由模型决定"是否继续
 * 调用工具"，Runtime 负责步数/预算/超时/权限/追踪。
 */
export class AgentExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.goal) return 'Agent 节点缺少目标（goal）';
    if (!data.llmId) return 'Agent 节点未选择模型';
    if (!data.mcpServerId) return 'Agent 节点未选择 MCP Server';
    return null;
  }

  async execute(
    node: FlowNode,
    context: FlowContext,
    _subFlowRunner?: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const data = node.data;
    const goal = this.paramResolver.interpolateTemplate(String(data.goal ?? ''), context);
    if (!goal.trim()) throw new Error('Agent 节点目标为空');

    const serverId = String(data.mcpServerId);
    const allowedScope = (['read', 'write', 'dangerous'].includes(String(data.allowedScope))
      ? String(data.allowedScope)
      : 'read') as ToolScope;
    const approved = new Set(parseList(data.approvedTools));

    // 工具来自 MCP Registry（按当前用户隔离）；拿不到工具就明确失败，不静默降级
    const servers = await mcpRegistry.listServers(context.userId ?? undefined);
    const server = servers.find((item) => item.id === serverId);
    if (!server) {
      throw new Error(`MCP Server 不可用：${serverId}${servers.length === 0 ? '（尚未配置任何 MCP Server）' : ''}`);
    }
    if (server.error) {
      throw new Error(`MCP Server 连接失败：${server.error}`);
    }

    const tools: AgentTool[] = (server.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
      scope: server.scope,
      execute: async (args) => {
        const result = await mcpRegistry.callTool({
          serverId,
          tool: tool.name,
          arguments: args,
          userId: context.userId ?? undefined,
          // 已获审批时用 Server 自身权限级别调用；否则用节点允许的级别
          callerScope: approved.has(tool.name) ? server.scope : allowedScope,
          approved: approved.has(tool.name),
          timeoutMs: Number(data.toolTimeoutMs) || 20_000,
        });
        return { content: result.text || '(empty)', isError: result.isError };
      },
    }));

    const result = await runAgent(
      {
        goal,
        systemPrompt: data.systemPrompt
          ? this.paramResolver.interpolateTemplate(String(data.systemPrompt), context)
          : undefined,
        modelId: String(data.llmId),
        fallbackModelIds: parseList(data.fallbackModelIds),
        tools,
        maxSteps: Number(data.maxSteps) || 6,
        tokenBudget: Number(data.tokenBudget) || 20_000,
        timeoutMs: Number(data.timeoutMs) || 120_000,
        allowedScope,
        approvedTools: [...approved],
        temperature: data.temperature === undefined ? undefined : Number(data.temperature),
        signal,
      },
    );

    if (result.status === 'approval_required' && result.pendingApproval) {
      throw new Error(
        `Agent 需要人工审批：工具 ${result.pendingApproval.tool}（需要 ${result.pendingApproval.requiredScope} 权限）。` +
          `请在节点配置的「已审批工具」中加入该工具后重试。`,
      );
    }
    if (result.status === 'cancelled') {
      throw new Error('Agent 执行已取消');
    }

    return {
      output: result.answer,
      status: result.status,
      steps: result.steps,
      tokens: result.totalTokens,
      stoppedReason: result.stoppedReason,
    };
  }
}
