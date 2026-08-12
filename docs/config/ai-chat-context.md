# AI 对话功能 — 上下文传参处理文档

> 生成日期：2026-07-08
> 涉及文件：
> - `src/app/api/chat/route.ts` — 对话 API 路由（调用 Coze 工作流）
> - `src/lib/report-context.ts` — 上下文构建器（报告 + 裂变剧情）
> - `src/hooks/useConversations.ts` — 前端对话管理 Hook
> - `src/contexts/ChatContext.ts` — 对话 React Context
> - `src/app/api/chat/conversations/` — 对话 CRUD API
> - `src/app/api/chat/conversations/[id]/messages/` — 消息 CRUD API
> - `src/types/chat.ts` — 类型定义

---

## 一、整体数据流

```
用户输入消息
    │
    ▼
前端 useConversations.sendMessage()
    │
    ├── 1. 确保有活跃对话（无则自动创建）
    ├── 2. 保存用户消息到 DB（POST /api/chat/conversations/:id/messages）
    ├── 3. 构建消息历史（取最近 20 条 + 当前消息）
    │
    ▼
POST /api/chat  ← 携带 messages 数组
    │
    ├── 4. 认证校验（getSession）
    ├── 5. 并行构建 reportContext（查询分析报告 + 裂变剧情）
    ├── 6. 调用 Coze 工作流（SSE 流式）
    │       parameters: {
    │         input: JSON.stringify(messages[-20:]),
    │         reportContext: contextText
    │       }
    │
    ▼
Coze 工作流处理 → SSE 流式返回
    │
    ▼
前端逐 chunk 解析 SSE → 实时显示
    │
    ├── 7. 流结束后保存 AI 回复到 DB
    └── 8. 更新对话列表
```

---

## 二、前端发送消息流程

### 文件：`src/hooks/useConversations.ts` → `sendMessage()`

```typescript
const sendMessage = async (content: string) => {
  // Step 1: 确保有活跃对话
  let convId = activeConversationId;
  if (!convId) {
    // 自动创建新对话
    const res = await fetch('/api/chat/conversations', { method: 'POST' });
    convId = data.id;
  }

  // Step 2: 保存用户消息到数据库
  await fetch(`/api/chat/conversations/${convId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', content }),
  });

  // Step 3: 构建消息历史
  const currentMessages = activeConversation.messages || [];
  const chatHistory = [...currentMessages, { role: 'user', content }].map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Step 4: 调用流式 API
  const response = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: chatHistory }),
    signal: abortController.signal,
  });

  // Step 5: 解析 SSE 流，逐 chunk 更新 streamingContent
  // Step 6: 流结束后保存 AI 回复到数据库
};
```

### 发送给后端的数据格式

```json
{
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "你好！有什么可以帮助你的？" },
    { "role": "user", "content": "推荐一个适合做视频的报告" }
  ]
}
```

**注意**：只传 `role` 和 `content`，不传 `id`、`created_at` 等元数据。

---

## 三、后端处理流程

### 文件：`src/app/api/chat/route.ts`

### 3.1 接收参数

```typescript
const { messages } = await request.json();
// messages: Array<{ role: 'user' | 'assistant', content: string }>
```

### 3.2 消息截断

```typescript
const MAX_MESSAGES = 20;
const inputStr = JSON.stringify(messages.slice(-MAX_MESSAGES));
```

- 最多传递最近 **20 条**消息给工作流
- 超出的历史消息会被截断，只保留最近的对话上下文

### 3.3 构建内容上下文

```typescript
const { contextText: reportContext } = await buildReportContext(
  session.name,           // 用户名
  session.role === 'admin' // 是否管理员
);
```

### 3.4 调用 Coze 工作流

```typescript
const stream = apiClient.workflows.runs.stream({
  workflow_id: '7646245102751367211',
  parameters: {
    input: inputStr,                              // 消息历史 JSON 字符串
    reportContext: reportContext || '暂无相关内容推荐',  // 内容推荐上下文
  },
});
```

传给工作流的两个参数：

| 参数名 | 类型 | 内容 | 说明 |
|--------|------|------|------|
| `input` | string (JSON) | 最近 20 条消息的数组 | 对话历史，工作流内部解析 |
| `reportContext` | string | 用户的报告+裂变剧情摘要 | 供 AI 推荐内容时引用 |

---

## 四、上下文构建（reportContext）

### 文件：`src/lib/report-context.ts` → `buildReportContext()`

### 4.1 数据查询

并行查询两张表：

```typescript
const [reportsResult, fissionResult] = await Promise.all([
  // 查询分析报告（analysis_history）
  client.from('analysis_history')
    .select('id, title, analysis_type, plot_summary, video_url, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(30),

  // 查询裂变剧情（fission_plots）
  client.from('fission_plots')
    .select('id, title, analysis_history_id, parsed_output, created_at')
    .order('created_at', { ascending: false })
    .limit(30),
]);
```

### 4.2 数据权限

| 角色 | 查询范围 |
|------|---------|
| admin | 查询所有数据 |
| 普通用户 | 仅查询 `created_by = userName` 的数据 |

### 4.3 生成的 contextText 格式

```
用户当前有 5 条视频分析报告：
[报告1] id:abc123 标题:王者荣耀买量分析 类型:买量分析 概述:该视频展示了...
[报告2] id:def456 标题:原神剧情解析 类型:剧本分析 概述:视频围绕...
...

用户当前有 3 条裂变剧情：
[剧情1] id:ghi789 标题:反转剧情方案A 内容:通过角色身份互换...
[剧情2] id:jkl012 标题:悬疑开头方案 内容:以神秘事件引入...
...

推荐规则：
- 询问视频主题/素材推荐 → [REPORT:id=报告ID]
- 询问剧情创意/裂变方案 → [FISSION:id=剧情ID]
- 无匹配数据时坦诚告知
```

### 4.4 报告摘要提取

```typescript
// plot_summary 可能是 JSON 或纯文本
let summary = r.plot_summary || '';
try {
  const parsed = JSON.parse(summary);
  summary = parsed.Plot || parsed.summary || JSON.stringify(parsed);
} catch { /* 纯文本直接使用 */ }
// 超过 200 字截断
if (summary.length > 200) summary = summary.substring(0, 200) + '...';
```

### 4.5 裂变剧情摘要提取

```typescript
// 从 parsed_output 中提取 plotOverview
// 路径: parsed_output.output[0].overallAnalysis.plotOverview
function extractFissionSummary(parsedOutput): string
```

提取优先级：
1. `parsedOutput.output[0].overallAnalysis.plotOverview`
2. `parsedOutput.output[0].plotOverview`
3. `parsedOutput.plotOverview`

### 4.6 引用标记规范

AI 工作流在回复中使用特定标记引用内容：

| 标记格式 | 含义 |
|---------|------|
| `[REPORT:id=报告ID]` | 引用分析报告 |
| `[FISSION:id=剧情ID]` | 引用裂变剧情 |

前端 `SimpleChatMessage` 组件通过 `parseContentReferences()` 解析这些标记，渲染为可点击的 `ContentRefCard` 卡片。

---

## 五、SSE 流式响应处理

### 5.1 后端输出格式

```
data: {"content":"你好"}
data: {"content":"，我来"}
data: {"content":"帮你分析"}
data: {"content":"推荐报告 [REPORT:id=abc123]"}
data: [DONE]
```

### 5.2 工作流输出解析

工作流返回的原始内容可能是嵌套 JSON，通过 `extractTextFromContent()` 按优先级提取：

```
优先级：operation → recommend → create → chatting → output → 原始文本
```

```typescript
function extractTextFromContent(raw: unknown): string {
  // 1. 尝试 JSON.parse
  // 2. 按优先级 key 提取文本
  // 3. 处理嵌套 JSON 字符串
  // 4. fallback 到 output 字段
  // 5. 最终 fallback 返回原文
}
```

### 5.3 前端 SSE 解析

```typescript
// 逐 chunk 读取
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  // 按 \n 分割行
  // 过滤 data: 前缀
  // JSON.parse 获取 content 或 error
  // 累加到 assistantContent
  // 收到 [DONE] 结束
}
```

### 5.4 流式状态管理

| 状态变量 | 类型 | 说明 |
|---------|------|------|
| `streamingContent` | `string \| null` | 当前累积的 AI 回复内容，null 表示不在流式中 |
| `isSending` | `boolean` | 是否正在等待/接收流式响应 |
| `error` | `string \| null` | 错误信息 |

流式内容存放在 `ChatContext`（而非 `ChatPanel`）中，确保切换面板不会丢失正在接收的内容。

---

## 六、对话持久化

### 6.1 数据库表

#### chat_conversations

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(36) | 对话 ID（UUID） |
| `user_id` | VARCHAR(36) | 所属用户 |
| `title` | VARCHAR(500) | 对话标题（首条消息自动生成） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 最后更新时间 |

#### chat_messages

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | VARCHAR(36) | 消息 ID（UUID） |
| `conversation_id` | VARCHAR(36) | 所属对话 |
| `role` | VARCHAR(20) | `user` / `assistant` |
| `content` | TEXT | 消息内容 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

### 6.2 消息保存时机

| 消息类型 | 保存时机 |
|---------|---------|
| 用户消息 | 发送到 API **之前**，立即写入 DB |
| AI 回复 | SSE 流 **结束后**（收到 `[DONE]` 或流断开），将完整内容写入 DB |

### 6.3 自动标题生成

当对话标题为默认值 `"新对话"` 时，第一条用户消息会自动设为标题：

```typescript
if (role === 'user' && conversation.title === '新对话') {
  updateData.title = content.length > 50
    ? content.substring(0, 50) + '...'
    : content;
}
```

---

## 七、API 路由清单

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 发送消息，返回 SSE 流 |
| `/api/chat/conversations` | GET | 获取当前用户的对话列表 |
| `/api/chat/conversations` | POST | 创建新对话 |
| `/api/chat/conversations/:id` | GET | 获取对话详情（含消息） |
| `/api/chat/conversations/:id` | PATCH | 重命名对话 |
| `/api/chat/conversations/:id` | DELETE | 删除对话 |
| `/api/chat/conversations/:id/messages` | POST | 添加消息（user/assistant） |
| `/api/chat/content-refs` | GET/POST | 内容引用解析 |
| `/api/chat/analysis` | - | 对话中的分析功能 |

---

## 八、请求参数总结

### POST /api/chat

```json
{
  "messages": [
    { "role": "user", "content": "第一条消息" },
    { "role": "assistant", "content": "AI 回复" },
    { "role": "user", "content": "最新消息" }
  ]
}
```

### 实际传给 Coze 工作流的参数

```json
{
  "workflow_id": "7646245102751367211",
  "parameters": {
    "input": "[{\"role\":\"user\",\"content\":\"第一条消息\"},{\"role\":\"assistant\",\"content\":\"AI 回复\"},{\"role\":\"user\",\"content\":\"最新消息\"}]",
    "reportContext": "用户当前有 5 条视频分析报告：\n[报告1] id:abc123 ...\n\n推荐规则：\n- ..."
  }
}
```

### 关键约束

| 约束 | 值 | 说明 |
|------|-----|------|
| 最大消息数 | 20 条 | `messages.slice(-MAX_MESSAGES)` |
| 报告查询上限 | 30 条 | `analysis_history` 最近 30 条 |
| 裂变剧情查询上限 | 30 条 | `fission_plots` 最近 30 条 |
| 摘要截断长度 | 200 字 | 每条报告/剧情的概述最多 200 字 |
| 流式超时 | 无显式超时 | 依赖 AbortController 手动取消 |

---

## 九、错误处理

| 场景 | 处理方式 |
|------|---------|
| 未登录 | 返回 401 |
| messages 参数缺失 | 返回 400 |
| Coze 工作流 ERROR 事件 | SSE 推送 `{"error":"..."}` |
| 流读取异常 | SSE 推送 `{"error":"流读取失败: ..."}` |
| 前端网络错误 | 设置 `error` 状态，清除流式状态 |
| 用户取消（AbortController） | 静默处理，不设错误 |
| 切换对话 | 自动 abort 正在进行的流式请求 |
