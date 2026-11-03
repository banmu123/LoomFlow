import type { ModelCapability, ModelDefinition } from '@/lib/ai';
import type { ModelMessage } from 'ai';

/** 任务类型 → 能力要求（路由器使用） */
export type GatewayTaskType = 'chat' | 'summarize' | 'extract' | 'vision' | 'tool';

export type RoutePreference = 'balanced' | 'cost' | 'latency';

export interface GatewayToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface GatewayUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** provider = 供应商真实返回；unknown = 供应商未返回，未做估算 */
  source: 'provider' | 'unknown';
}

export interface GatewayCost {
  amount: number | null;
  currency: string | null;
  /** false 表示没有配置价格，amount 为 null（不编造） */
  known: boolean;
}

export interface GatewayRequest {
  messages: ModelMessage[];
  system?: string;
  /** 手动指定模型（最高优先级） */
  modelId?: string;
  /** 备用模型（按用户给定顺序） */
  fallbackModelIds?: string[];
  requireCapabilities?: ModelCapability[];
  taskType?: GatewayTaskType;
  prefer?: RoutePreference;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  /** 工具定义（Agent 使用）；执行由调用方负责 */
  tools?: Record<string, unknown>;
  requestId?: string;
}

export interface FallbackAttempt {
  modelId: string;
  provider: string;
  errorClass: string;
  retryable: boolean;
  latencyMs: number;
  statusCode?: number;
}

export interface GatewayResult {
  text: string;
  modelId: string;
  provider: string;
  usage: GatewayUsage;
  cost: GatewayCost;
  latencyMs: number;
  requestId: string;
  /** 被跳过的模型及原因（观测用，不隐藏原始错误类型） */
  fallbacks: FallbackAttempt[];
  toolCalls: GatewayToolCall[];
  finishReason: string;
}

export type GatewayErrorCode =
  | 'no_model_available'
  | 'all_providers_failed'
  | 'config_error'
  | 'cancelled';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly attempts: FallbackAttempt[];
  readonly cause?: unknown;

  constructor(
    code: GatewayErrorCode,
    message: string,
    options: { attempts?: FallbackAttempt[]; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.attempts = options.attempts ?? [];
    this.cause = options.cause;
  }
}

export interface GatewayCandidate extends ModelDefinition {
  /** 该候选的来源：显式 / 备用 / 路由选中 */
  origin: 'explicit' | 'fallback' | 'routed';
}
