// ===== Model Capability 定义 =====

export type ModelCapability = 'text' | 'vision' | 'audio' | 'image' | 'tool';

export interface ModelDefinition {
  /** 模型 ID（API 调用名） */
  id: string;
  /** Provider 标识（deepseek / ark / openai-compatible / ...） */
  provider: string;
  /** 模型能力声明 */
  capabilities: ModelCapability[];
  /** 显示名 */
  label?: string;
}

/** 判断模型是否具备某能力 */
export function hasCapability(model: ModelDefinition, cap: ModelCapability): boolean {
  return model.capabilities.includes(cap);
}
