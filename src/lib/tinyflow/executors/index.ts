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
