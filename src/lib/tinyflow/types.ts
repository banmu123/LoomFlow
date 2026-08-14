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
  data?: { condition?: string };
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
  | 'waiting_confirm';

export interface NodeResult {
  nodeId: string;
  status: NodeStatus;
  outputs: Record<string, unknown>;
  error?: string;
  duration?: number;
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

export interface ExecuteOptions {
  flowData: TinyflowData;
  inputs: Record<string, unknown>;
  userId?: string | null;
  signal?: AbortSignal;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, result: NodeResult) => void;
  onFlowComplete?: (outputs: Record<string, unknown>) => void;
  onFlowError?: (error: Error) => void;
  resumeContext?: FlowContext;
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
