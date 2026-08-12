import type { ModelCapability, ModelDefinition } from './capabilities';
import { hasCapability } from './capabilities';
import { BUILTIN_MODELS } from './models';

// ===== Model Registry =====
// 模型注册表：查询、按能力筛选、自定义注册

export class ModelRegistry {
  private models = new Map<string, ModelDefinition>();

  constructor(models: ModelDefinition[] = []) {
    for (const m of models) {
      this.register(m);
    }
  }

  register(model: ModelDefinition): void {
    this.models.set(model.id, model);
  }

  unregister(id: string): void {
    this.models.delete(id);
  }

  get(id: string): ModelDefinition | undefined {
    return this.models.get(id);
  }

  list(): ModelDefinition[] {
    return [...this.models.values()];
  }

  /** 按能力筛选模型 */
  listByCapability(cap: ModelCapability): ModelDefinition[] {
    return this.list().filter((m) => hasCapability(m, cap));
  }

  /** 查找支持指定能力的第一个模型 */
  findWithCapability(cap: ModelCapability): ModelDefinition | undefined {
    return this.list().find((m) => hasCapability(m, cap));
  }

  /** 检查模型是否存在且支持某能力 */
  canUse(modelId: string, cap: ModelCapability): boolean {
    const model = this.get(modelId);
    return !!model && hasCapability(model, cap);
  }
}

// 全局单例（内置模型）
export const modelRegistry = new ModelRegistry(BUILTIN_MODELS);
