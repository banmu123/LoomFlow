# LoomFlow Custom Node Guide

> 开发自定义节点：让 LoomFlow 从工具变成开发者平台。

## 概念

| 概念 | 职责 |
|------|------|
| `NodeDefinition` | 描述节点类型（叫什么/分类/输入输出/能力/执行器） |
| `NodeRegistry` | 节点注册表（单一事实来源） |
| `Executor` | 节点执行逻辑 |
| `ExecutorRegistry` | 执行器注册表 |

链路：`NodeDefinition → NodeRegistry → executorType → ExecutorRegistry → Executor`

## 三步开发一个自定义节点

以「Slack 通知节点」为例。

### 第一步：实现执行器

创建 `src/lib/tinyflow/executors/SlackExecutor.ts`：

```ts
import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class SlackExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  // 配置校验（执行前拦截，可选但推荐）
  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.webhookUrl) return 'Slack 节点缺少 webhookUrl';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const message = data.message
      ? this.paramResolver.interpolateTemplate(data.message as string, context)
      : '';

    // 业务逻辑（调用 Slack API 等）
    const response = await fetch(data.webhookUrl as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) throw new Error(`Slack 通知失败 (${response.status})`);
    return { sent: true, message };
  }
}
```

### 第二步：注册执行器

在 `src/lib/tinyflow/executors/index.ts` 的构造函数中注册：

```ts
this.register('slackNode', SlackExecutor);
```

### 第三步：注册节点定义

在 `src/lib/tinyflow/nodes/builtin.ts` 添加并注册：

```ts
export const SLACK_NODE: NodeDefinition = {
  type: 'slackNode',
  label: 'Slack',
  description: '发送 Slack 通知',
  category: 'integration',
  inputs: [
    { name: 'message', label: 'Message', dataType: 'string', required: true },
    { name: 'webhookUrl', label: 'Webhook URL', dataType: 'string', required: true },
  ],
  outputs: [{ name: 'sent', label: 'Sent', dataType: 'boolean' }],
  executorType: 'slackNode',
  builtin: false,
};

nodeRegistry.register(SLACK_NODE);
```

### 完成

- ✅ 节点库（`GET /api/nodes`）自动展示
- ✅ Schema 校验自动认识新类型
- ✅ AI 生成工作流可引用新节点
- ✅ 执行前校验自动拦截配置错误

> 启动时的一致性校验：`executorType` 必须在 `ExecutorRegistry` 中存在，否则应用启动报错（防幽灵节点）。

## 可选增强

### 能力声明（如视觉节点）

```ts
capabilities: ['text', 'vision'],  // 模型/多模态相关节点声明能力
```

### 单元测试

仿照 `src/lib/tinyflow/__tests__/node-registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

describe('SlackExecutor', () => {
  it('缺少 webhookUrl 时校验失败', () => {
    // ...
  });
});
```

### 发布为可扩展 API

节点完成后，可配合发布系统暴露给外部（见 Deployment Manual 第十章）。

## 最佳实践

| 建议 | 说明 |
|------|------|
| 实现 `validate()` | 配置错误执行前拦截，用户体验远好于运行时崩溃 |
| 使用 `paramResolver.interpolateTemplate` | 支持 `{{nodeId.field}}` 跨节点引用 |
| 错误信息可读 | 抛错带节点上下文（如"Slack 通知失败 (403)"） |
| 不直接访问 `process` | 需要密钥用 `process.env`（服务端）或模型级配置 |
| 敏感字段 | 用 `NodeDefinition` 扩展字段（如 webhookUrl），避免写死 |
