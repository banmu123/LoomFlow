// ===== Plugin SDK 雏形：第三方节点注册入口 =====
// 未来社区插件通过 registerNodePlugin 注册节点与执行器：
//
//   registerNodePlugin({
//     id: 'github',
//     nodes: [githubNodeDef],                          // NodeDefinition
//     executors: [{ type: 'githubNode', executor: GithubExecutor }],
//   });
//
// 注册后引擎调度（FlowEngine）、schema 校验、节点库（/api/nodes）自动生效——
// 无需改动任何运行时代码。

import type { NodeDefinition } from './node-definition';
import { nodeRegistry } from './node-registry';
import type { BaseExecutor } from './executors/BaseExecutor';
import type { ParameterResolver } from '../tinyflow/engine/ParameterResolver';
import type { ExpressionEvaluator } from '../tinyflow/engine/ExpressionEvaluator';
import { ExecutorRegistry } from './executors';

export type ExecutorConstructor = new (
  paramResolver: ParameterResolver,
  exprEvaluator: ExpressionEvaluator,
) => BaseExecutor;

export interface NodePlugin {
  /** 插件标识（如 'github' / 'notion'） */
  id: string;
  /** 插件节点定义（自动标记 source: 'custom'） */
  nodes: NodeDefinition[];
  /** 执行器注册表（type 必须与节点 executorType 对应） */
  executors: Array<{ type: string; executor: ExecutorConstructor }>;
}

/** 注册一个节点插件（Registry 模式——新增节点无需改动引擎/校验/节点库） */
export function registerNodePlugin(plugin: NodePlugin): void {
  for (const def of plugin.nodes) {
    nodeRegistry.register({ ...def, source: 'custom' });
  }
  for (const e of plugin.executors) {
    ExecutorRegistry.register(e.type, e.executor);
  }
}
