# Coze 工作流配置文档

> 更新日期：2026-07-08
> 涉及文件：
> - `src/lib/coze-client.ts` — Coze API 客户端工厂
> - `src/lib/coze-workflows.ts` — 工作流 ID 配置
> - `src/app/api/chat/route.ts` — AI 对话路由

---

## 一、环境变量

```env
# Coze API Personal Access Token（必填）
PAT_TOKEN=pat_xxxxxxxxxxxxxxxx

# 备用 API Key（PAT_TOKEN 不存在时使用）
COZE_API_KEY=

# 测试模式（true 时工作流以测试模式运行，不计费）
COZE_WORKFLOW_TEST_MODE=true
```

### 获取方式

| 变量 | 获取路径 |
|------|---------|
| `PAT_TOKEN` | Coze 平台 → 个人设置 → API Token → 创建 Personal Access Token |

---

## 二、Coze 客户端配置

### 文件：`src/lib/coze-client.ts`

```typescript
import { CozeAPI } from '@coze/api';

export const COZE_SPACE_ID = '7595145929213886527';
export const COZE_BASE_URL = 'https://api.coze.cn';

export function createCozeClient(): CozeAPI {
  const isTestMode = process.env.COZE_WORKFLOW_TEST_MODE === 'true';

  return new CozeAPI({
    token: process.env.PAT_TOKEN || process.env.COZE_API_KEY || '',
    baseURL: COZE_BASE_URL,
    ...(isTestMode ? { headers: { 'x-run-mode': 'test_run' } } : {}),
  });
}

export function buildDebugUrl(workflowId: string, executeId: string): string {
  return `https://www.coze.cn/work_flow?execute_id=${executeId}&space_id=${COZE_SPACE_ID}&workflow_id=${workflowId}&execute_mode=2`;
}
```

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `baseURL` | `https://api.coze.cn` | Coze 中国站 API |
| `token` | `PAT_TOKEN` 或 `COZE_API_KEY` | 认证令牌 |
| `x-run-mode` | `test_run`（可选） | 测试模式，不消耗配额 |
| `COZE_SPACE_ID` | `7595145929213886527` | 用于构建调试 URL |

---

## 三、工作流 ID

### 文件：`src/lib/coze-workflows.ts`

```typescript
export const WORKFLOW_IDS = {
  AI_CHAT: '7659983968448069684',
} as const;
```

| 工作流 ID | 名称 | API 路由 | 说明 |
|-----------|------|---------|------|
| `7659983968448069684` | AI 对话 | `/api/chat` | 带上下文的 AI 对话，SSE 流式输出 |

---

## 四、工作流调用模式

### SSE 流式调用

用于 AI 对话，实时返回结果。

```typescript
// src/app/api/chat/route.ts
const apiClient = createCozeClient();
const stream = await apiClient.workflows.runs.stream({
  workflow_id: WORKFLOW_IDS.AI_CHAT,
  parameters: {
    input: JSON.stringify(messages),
    reportContext: '',
  },
});

// 返回 ReadableStream，逐事件推送给前端
for await (const event of stream) {
  switch (event.event) {
    case WorkflowEventType.MESSAGE:
      // 输出文本片段或工作流数据
      break;
    case WorkflowEventType.ERROR:
      // 错误处理
      break;
    case WorkflowEventType.DONE:
      // 流结束
      break;
  }
}
```

**响应头**：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

---

## 五、返回数据处理

AI 对话返回的数据可能包含工作流定义（tinyFlowData），用于在画布上绘制流程图。

### 数据格式

```json
{
  "output": {
    "tinyFlowData": {
      "nodes": [...],
      "edges": [...],
      "viewport": {...}
    }
  }
}
```

### 解析逻辑

`src/app/api/chat/route.ts` 中的 `extractWorkflowAndText` 函数处理：

```typescript
// output 为对象时
if (outputVal && typeof outputVal === 'object') {
  if (outputVal.tinyFlowData) {
    return { text: '...', workflow: outputVal.tinyFlowData };
  }
}

// output 为字符串时（可能是 JSON）
if (typeof outputVal === 'string') {
  const inner = JSON.parse(outputVal);
  if (inner.tinyFlowData) {
    return { text: '...', workflow: inner.tinyFlowData };
  }
}
```

### 前端加载流程

1. API 返回 `{ workflow: tinyFlowData }` 给前端
2. `ChatPanel` 检测到 `data.workflow` 后：
   - 调用 `setPendingWorkflow(workflowData)` 缓存数据
   - 触发 `tinyflow-load-data` 事件
   - 如不在编辑器页面，跳转 `/workflows/editor`
3. `TinyflowWrapper` 监听到事件后调用 `instanceRef.current.setData(detail)` 绘制到画布

---

## 六、依赖包

```json
{
  "@coze/api": "^1.3.9"
}
```

---

## 七、迁移检查清单

- [ ] 在 Coze 平台创建/复制工作流，记录新的 workflow ID
- [ ] 更新 `src/lib/coze-workflows.ts` 中的 `AI_CHAT` ID
- [ ] 生成新的 `PAT_TOKEN` 并配置到 `.env.local`
- [ ] 确认 `@coze/api` 版本兼容
- [ ] 如开启测试模式，设置 `COZE_WORKFLOW_TEST_MODE=true`