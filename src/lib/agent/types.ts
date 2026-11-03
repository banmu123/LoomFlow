import type { ModelMessage } from 'ai';
import type { GatewayToolCall } from '@/lib/gateway';
import type { ToolScope } from '@/lib/mcp';

export interface AgentToolResult {
  content: string;
  isError?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema（用于模型工具定义与参数校验提示） */
  inputSchema: Record<string, unknown>;
  scope: ToolScope;
  execute: (args: Record<string, unknown>) => Promise<AgentToolResult>;
}

export interface AgentModelResponse {
  text: string;
  toolCalls: GatewayToolCall[];
  totalTokens: number;
  modelId: string;
}

export type AgentModelCaller = (input: {
  messages: ModelMessage[];
  system?: string;
  tools?: Record<string, unknown>;
  modelId?: string;
  fallbackModelIds?: string[];
  temperature?: number;
  abortSignal?: AbortSignal;
}) => Promise<AgentModelResponse>;

export type AgentStatus =
  | 'completed'
  | 'max_steps'
  | 'budget_exceeded'
  | 'approval_required'
  | 'cancelled';

export interface AgentStepToolCall {
  name: string;
  arguments: unknown;
  ok: boolean;
  error?: string;
}

export interface AgentStep {
  index: number;
  modelId: string;
  text: string;
  toolCalls: AgentStepToolCall[];
  totalTokens: number;
}

export interface AgentOptions {
  goal: string;
  systemPrompt?: string;
  modelId?: string;
  fallbackModelIds?: string[];
  tools: AgentTool[];
  /** 最大决策轮次（默认 6，上限 20） */
  maxSteps?: number;
  /** Token 预算（默认 20000） */
  tokenBudget?: number;
  /** 总执行时间（默认 120s） */
  timeoutMs?: number;
  /** 允许自动执行的最高权限，超出需要审批 */
  allowedScope?: ToolScope;
  /** 已获人工审批的工具名 */
  approvedTools?: string[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface AgentPendingApproval {
  tool: string;
  arguments: unknown;
  requiredScope: ToolScope;
}

export interface AgentResult {
  status: AgentStatus;
  answer: string;
  steps: AgentStep[];
  totalTokens: number;
  pendingApproval?: AgentPendingApproval;
  stoppedReason?: 'timeout' | 'cancelled' | 'token_budget' | 'max_steps';
}
