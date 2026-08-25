// ===== 来自前端的原始数据结构 =====

export interface TinyflowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: NodeData;
  parentId?: string;
  selected?: boolean;
  measured?: { width: number; height: number };
  dragging?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  data?: {
    condition?: string;
    /** 输出端口路由：边从源节点的哪个输出端口走（如条件节点 true/false）。
     *  仅当源节点输出结果中该端口为 truthy 时才会走此边；缺省 = 无条件/条件表达式模式 */
    sourcePort?: string;
  };
  selected?: boolean;
}

export interface NodeData {
  title: string;
  description: string;
  condition: string;
  loopEnable: boolean;
  loopIntervalMs: string;
  maxLoopCount: string;
  loopBreakCondition: string;
  retryEnable: boolean;
  retryIntervalMs: string;
  maxRetryCount: string;
  resetRetryCountAfterNormal: boolean;
  expand?: boolean;
  parameters?: Parameter[];
  outputDefs?: Parameter[];
  images?: Parameter[];
  llmId?: string | number;
  systemPrompt?: string;
  userPrompt?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  outType?: 'text' | 'json';
  jsonSchema?: string;
  method?: string;
  url?: string;
  headers?: Parameter[];
  bodyType?: string;
  formData?: Parameter[];
  formUrlencoded?: Parameter[];
  bodyJson?: string;
  bodyRaw?: string;
  engine?: string;
  code?: string;
  knowledgeId?: string | number;
  keyword?: string;
  limit?: string;
  template?: string;
  confirms?: Parameter[];
  message?: string;
  loopVars?: Parameter[];
  [key: string]: unknown;
}

export interface Parameter {
  id?: string;
  name?: string;
  nameDisabled?: boolean;
  dataType?: string;
  dataTypeItems?: SelectItem[];
  dataTypeDisabled?: boolean;
  contentType?: string;
  ref?: string;
  refType?: string;
  value?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
  deleteDisabled?: boolean;
  addChildDisabled?: boolean;
  children?: Parameter[];
  enums?: string[];
  formType?: string;
  formLabel?: string;
  formDescription?: string;
  formPlaceholder?: string;
  formAttrs?: string;
}

export interface SelectItem {
  value: number | string;
  label: string;
  children?: SelectItem[];
}

// ===== 引擎内部类型 =====

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'waiting_confirm'
  | 'cancelled'
  | 'timeout';

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  outputs: Record<string, unknown>;
  error?: string;
  duration?: number;
  /** 实际尝试次数（含重试）；>=1 */
  attempt?: number;
  /** 重试次数（不含首次） */
  retryCount?: number;
}

export interface FlowContext {
  flowId: string;
  inputs: Record<string, unknown>;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeStatuses: Map<string, NodeStatus>;
  variables: Map<string, unknown>;
  /** 执行者用户 id（数据隔离：知识库检索等按用户过滤） */
  userId?: string | null;
}

export interface RetryConfig {
  /** 是否启用重试（false = 关闭，非幂等操作必须允许关闭） */
  retryEnable: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始退避间隔（ms） */
  retryDelayMs: number;
  /** 是否指数退避 */
  exponentialBackoff: boolean;
}

export interface ExecuteOptions {
  flowData: TinyflowData;
  inputs: Record<string, unknown>;
  userId?: string | null;
  /** 关联工作流 id（trace/backfill） */
  workflowId?: string | null;
  signal?: AbortSignal;
  /** 工作流级超时（ms）；<=0 = 不限制 */
  timeoutMs?: number;
  /** 节点级默认超时（ms）；节点 data.timeout 优先 */
  defaultNodeTimeoutMs?: number;
  /** 最大并行节点数（依赖关系允许时）；1 = 串行（默认），上限由引擎钳制 */
  maxConcurrency?: number;
  /** 幂等键（重复请求直接返回首次结果） */
  idempotencyKey?: string;
  /** 恢复 checkpoint 数据（resume） */
  resumeCheckpoint?: unknown;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
  onFlowComplete?: (outputs: Record<string, unknown>) => void;
  onFlowError?: (error: Error) => void;
  resumeContext?: FlowContext;
  /** checkpoint 持久化回调（每次节点完成后调用，供落库） */
  onCheckpoint?: (flowId: string, checkpoint: unknown) => void;
}

export interface FlowError extends Error {
  code: string;
  confirmRequest?: ConfirmRequest;
  nodeId?: string;
  contextSnapshot?: FlowContext;
}

export interface ConfirmRequest {
  type: 'confirm_required';
  nodeId: string;
  message: string;
  confirms: {
    name?: string;
    formType?: string;
    formLabel?: string;
    formDescription?: string;
    enums?: string[];
    contentType?: string;
    required?: boolean;
  }[];
}

export interface SubFlowRunner {
  (
    childNodes: FlowNode[],
    context: FlowContext,
    options: ExecuteOptions
  ): Promise<void>;
}
