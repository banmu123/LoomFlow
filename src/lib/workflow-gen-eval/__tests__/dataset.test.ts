import { describe, it, expect } from 'vitest';
// 副作用导入：注册内置节点，保证断言基于真实 NodeRegistry
import '@/lib/tinyflow/nodes/builtin';
import { nodeRegistry } from '@/lib/tinyflow/node-registry';
import { BENCHMARK_DATASET_V1, getDataset } from '../dataset';

describe('评测数据集', () => {
  it('版本与案例数量固定', () => {
    expect(BENCHMARK_DATASET_V1.version).toBe('wf-gen-v1');
    expect(BENCHMARK_DATASET_V1.cases).toHaveLength(10);
  });

  it('Case ID 唯一', () => {
    const ids = BENCHMARK_DATASET_V1.cases.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('只使用真实存在的节点类型', () => {
    const known = new Set(nodeRegistry.list().map((node) => node.type));
    for (const caseDef of BENCHMARK_DATASET_V1.cases) {
      for (const type of [...caseDef.expectedNodeTypes, ...caseDef.forbiddenNodeTypes]) {
        expect(known.has(type), `${caseDef.id}: ${type}`).toBe(true);
      }
    }
  });

  it('每个案例都有可判定的约束', () => {
    for (const caseDef of BENCHMARK_DATASET_V1.cases) {
      expect(caseDef.constraints.length, caseDef.id).toBeGreaterThan(0);
      expect(caseDef.evaluationRules.length, caseDef.id).toBeGreaterThan(0);
    }
  });

  it('未知评测集版本给出明确错误', () => {
    expect(() => getDataset('wf-gen-v0')).toThrow(/未知评测集版本/);
  });
});
