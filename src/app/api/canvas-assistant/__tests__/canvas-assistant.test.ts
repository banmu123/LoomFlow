import { describe, it, expect } from 'vitest';
import { summarizeCanvas, buildSystemPrompt } from '@/app/api/canvas-assistant/route';
import { extractWorkflowJson } from '@/lib/agent/workflow-extract';
import { zh } from '@/messages/zh';
import { en } from '@/messages/en';

// ===== 画布 AI 助手逻辑测试 =====

describe('summarizeCanvas 画布数据摘要', () => {
  it('正常画布数据完整注入', () => {
    const data = { nodes: [{ id: 'n1', type: 'startNode' }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const s = summarizeCanvas(data);
    expect(s).toContain('startNode');
    expect(s).toContain('n1');
  });

  it('超长画布数据截断（防 token 爆炸）', () => {
    const big = { nodes: Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, data: 'x'.repeat(50) })) };
    const s = summarizeCanvas(big);
    // 6000 截断 + 「…（已截断）」标记 6 字符
    expect(s.length).toBe(6006);
    expect(s.endsWith('…（已截断）')).toBe(true);
  });

  it('空/不可序列化数据兜底', () => {
    expect(summarizeCanvas(null)).toContain('无数据');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(summarizeCanvas(circular)).toContain('无法序列化');
  });
});

describe('buildSystemPrompt 系统提示词', () => {
  it('画布数据注入到提示词中', () => {
    const prompt = buildSystemPrompt({ nodes: [{ id: 'n1', type: 'llmNode' }], edges: [] });
    expect(prompt).toContain('llmNode');
    expect(prompt).toContain('excelNode'); // 节点类型说明包含 excel
    expect(prompt).not.toContain('{cCanvas}'); // 占位符已被替换
  });
});

// ===== 推荐模板 key 有效性（今天 RECOMMENDATIONS 改为 i18n key）=====

describe('推荐模板 i18n key', () => {
  const RECOMMENDATIONS = [
    'home.templates.dailyNews',
    'home.templates.content',
    'home.templates.customer',
    'home.templates.weeklyReport',
    'home.templates.translator',
  ];

  function resolveKey(messages: Record<string, unknown>, key: string): string | undefined {
    const parts = key.split('.');
    let node: unknown = messages;
    for (const part of parts) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof node === 'string' ? node : undefined;
  }

  it('每个推荐模板 key 在 zh/en 中均可解析且非空', () => {
    for (const key of RECOMMENDATIONS) {
      const zhVal = resolveKey(zh, key);
      const enVal = resolveKey(en, key);
      expect(zhVal, `中文缺 key: ${key}`).toBeTruthy();
      expect(enVal, `英文缺 key: ${key}`).toBeTruthy();
      // 点击发送时会去掉 emoji 前缀（/^[^\s]+\s*/），剩余内容需为非空
      expect(zhVal!.replace(/^[^\s]+\s*/, '').trim().length).toBeGreaterThan(0);
      expect(enVal!.replace(/^[^\s]+\s*/, '').trim().length).toBeGreaterThan(0);
    }
  });

  it('extractWorkflowJson 能提取 AI 助手返回的完整工作流 JSON', () => {
    const aiReply = `我修改了流程：新增 LLM 总结节点。
\`\`\`json
{
  "nodes": [{ "id": "n1", "type": "startNode" }, { "id": "n2", "type": "llmNode" }],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2" }],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
\`\`\``;
    const extracted = extractWorkflowJson(aiReply);
    expect(extracted).not.toBeNull();
    expect(extracted!.nodes).toHaveLength(2);
    expect(extracted!.edges).toHaveLength(1);
  });
});
