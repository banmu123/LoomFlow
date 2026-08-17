// ===== Node System 统一出口 =====
// 供运行时、前端类型共享、未来 Plugin SDK 使用。
// 约定：新增节点 = 注册 NodeDefinition（nodeRegistry）+ 注册 Executor（ExecutorRegistry），
// 消费方（schema 校验 / /api/nodes / 节点库面板 / FlowEngine 调度）自动生效，无 if/else 分支。

export type {
  NodeDefinition,
  NodePortDefinition,
  NodeConfigField,
  NodeConfigFieldType,
  NodeCategory,
} from './node-definition';

export { NodeRegistry, nodeRegistry } from './node-registry';
export { createExecutor, ExecutorRegistry } from './executors';
export { registerNodePlugin } from './plugin';
export type { NodePlugin, ExecutorConstructor } from './plugin';

// 引入即注册内置节点（副作用：与 index.ts 的注册行为保持一致）
import './nodes/builtin';
