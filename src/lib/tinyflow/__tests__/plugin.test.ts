import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerNodePlugin,
  nodeRegistry,
  ExecutorRegistry,
} from '../node-system';
import { BaseExecutor } from '../executors/BaseExecutor';
import type { FlowNode, FlowContext } from '../types';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import type { NodeDefinition } from '../node-definition';

// ===== 模拟第三方插件：github 节点 =====
class GithubExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }
  validate(node: FlowNode): string | null {
    if (!node.data.repo) return '缺少 repo';
    return null;
  }
  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    return { output: `https://github.com/${node.data.repo}` };
  }
}

const githubNodeDef: NodeDefinition = {
  type: 'githubNode',
  label: 'GitHub',
  description: '查询 GitHub 仓库（第三方插件示例）',
  category: 'integration',
  inputs: [],
  outputs: [{ name: 'output', label: 'URL', dataType: 'string' }],
  executorType: 'githubNode',
  builtin: false,
  configSchema: [{ name: 'repo', label: '仓库', type: 'string', required: true }],
};

describe('Plugin SDK：registerNodePlugin 注册第三方节点', () => {
  beforeEach(() => {
    // 清理：移除插件注册（避免污染其他测试）
    nodeRegistry.unregister('githubNode');
    // ExecutorRegistry 无 unregister——用独立注册表验证
  });

  it('注册插件后：定义进入 NodeRegistry（标记 custom）', () => {
    registerNodePlugin({ id: 'github', nodes: [githubNodeDef], executors: [] });
    const def = nodeRegistry.get('githubNode');
    expect(def).toBeDefined();
    expect(def?.source).toBe('custom');
    expect(def?.label).toBe('GitHub');
  });

  it('注册插件后：执行器进入 ExecutorRegistry，可被引擎调度', async () => {
    registerNodePlugin({
      id: 'github',
      nodes: [githubNodeDef],
      executors: [{ type: 'githubNode', executor: GithubExecutor }],
    });
    expect(ExecutorRegistry.getSupportedTypes()).toContain('githubNode');

    // 通过统一工厂创建并执行（与内置节点同一路径）
    const { createExecutor } = await import('../node-system');
    const executor = createExecutor(
      'githubNode',
      {} as ParameterResolver,
      {} as ExpressionEvaluator,
    );
    const result = await executor.execute(
      { id: 'g1', type: 'githubNode', position: { x: 0, y: 0 }, data: { repo: 'banmu123/LoomFlow' } } as unknown as FlowNode,
      {} as FlowContext,
    );
    expect(result.output).toBe('https://github.com/banmu123/LoomFlow');
  });
});
