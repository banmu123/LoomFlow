import type { FlowNode } from '../types';
import { BaseExecutor } from './BaseExecutor';
import { StartExecutor } from './StartExecutor';
import { EndExecutor } from './EndExecutor';
import { LLMExecutor } from './LLMExecutor';
import { HttpExecutor } from './HttpExecutor';
import { CodeExecutor } from './CodeExecutor';
import { KnowledgeExecutor } from './KnowledgeExecutor';
import { SearchEngineExecutor } from './SearchEngineExecutor';
import { TemplateExecutor } from './TemplateExecutor';
import { ConditionExecutor } from './ConditionExecutor';
import { ConfirmExecutor } from './ConfirmExecutor';
import { LoopExecutor } from './LoopExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

type ExecutorConstructor = new (
  paramResolver: ParameterResolver,
  exprEvaluator: ExpressionEvaluator
) => BaseExecutor;

export class ExecutorRegistryClass {
  private registry = new Map<string, ExecutorConstructor>();

  constructor() {
    this.register('startNode', StartExecutor);
    this.register('endNode', EndExecutor);
    this.register('llmNode', LLMExecutor);
    this.register('httpNode', HttpExecutor);
    this.register('codeNode', CodeExecutor);
    this.register('knowledgeNode', KnowledgeExecutor);
    this.register('searchEngineNode', SearchEngineExecutor);
    this.register('templateNode', TemplateExecutor);
    this.register('conditionNode', ConditionExecutor);
    this.register('confirmNode', ConfirmExecutor);
    this.register('loopNode', LoopExecutor);
  }

  register(type: string, executor: ExecutorConstructor): void {
    this.registry.set(type, executor);
  }

  get(type: string): ExecutorConstructor | undefined {
    return this.registry.get(type);
  }

  getSupportedTypes(): string[] {
    return [...this.registry.keys()];
  }
}

export const ExecutorRegistry = new ExecutorRegistryClass();

/**
 * 执行器工厂：按节点类型创建执行器实例。
 * Registry/Factory 模式——新增节点只需注册（NodeDefinition + Executor），
 * 调度方统一走工厂，不出现针对具体节点的 if/else。
 * 未知类型抛出明确错误，便于插件定位问题。
 */
export function createExecutor(
  type: string,
  paramResolver: ParameterResolver,
  exprEvaluator: ExpressionEvaluator,
): BaseExecutor {
  const Ctor = ExecutorRegistry.get(type);
  if (!Ctor) {
    throw new Error(`未注册的执行器类型: ${type}`);
  }
  return new Ctor(paramResolver, exprEvaluator);
}
