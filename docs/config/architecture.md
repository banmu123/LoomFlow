# LoomFlow Architecture

> 架构说明：从自然语言到可执行 API 的完整链路。

## 核心数据流

```
Natural Language
      ↓
Workflow Generator（/api/chat-ai + prompts）
      ↓
Workflow JSON
      ↓
Schema Validation（validateWorkflow）
      ↓（失败自动修复 /api/workflow-ai/repair）
Visual Canvas（Tinyflow）
      ↓
Save（workflow_history + data_hash 去重）
      ↓
Publish（全局 API Key + 有效期）
      ↓
Flow Engine（runFlow）
      ↓
Node/Executor Registry → Executor
      ↓
HTTP API（/api/publish/*/execute）
```

## 分层架构

### 1. 自然语言 → 工作流生成

- `/api/chat-ai`：DeepSeek 流式对话（`FULL_SYSTEM_PROMPT` = 对话规则 + 工作流生成规则 `src/lib/workflow-ai/prompts.ts`）
- 输出含工作流 JSON（`nodes` / `edges`）
- 生成后立即 **Schema 校验**（`src/lib/tinyflow/schema.ts`），失败自动调用 `/api/workflow-ai/repair` 让 AI 修复一次

### 2. 节点系统（单一事实来源）

```
NodeDefinition（类型描述：label/category/inputs/outputs/capabilities/executorType）
      ↓ 注册
NodeRegistry（10 个内置节点，nodes/builtin.ts）
      ↓
Schema 校验（未知类型/单例/循环等 13 场景）
      ↓
节点库 UI（GET /api/nodes）
```

- `NodeRegistry` 是节点的唯一真相来源（schema.ts 不再维护第二份列表）
- 注册节点时校验 `executorType` 可执行（运行时）

### 3. 工作流执行引擎

```
FlowEngine（拓扑遍历/条件/循环/Confirm 暂停恢复）
      ↓
GraphParser（图解析 + Kahn 拓扑排序 + 循环检测）
      ↓
ParameterResolver（ref/input/fixed/form 四类参数解析）
      ↓
ExpressionEvaluator（条件表达式求值）
      ↓
ExecutorRegistry → 10 种 Executor
      ↓
runFlow（统一入口，落库 flow_runs）
```

执行前校验：节点配置合法性（`Executor.validate`）+ 图结构（Schema）。

### 4. 模型层（可配置）

```
ModelRegistry（内置 + 用户配置合并，ai_models 表）
      ↓
ModelDefinition（id/provider/capabilities/baseURL/apiKey）
      ↓
getProviderClientForModel（模型级配置优先于环境变量）
      ↓
AI SDK（DeepSeek / Ark / OpenAI-compatible）
```

- 图片多模态由模型 `vision` 能力决定
- 模型不存在 → 明确报错（无硬编码白名单）

### 5. 对外 API

| 层 | 接口 |
|----|------|
| 认证 | `/api/auth/*`（JWT + httpOnly Cookie） |
| 对话 | `/api/chat-ai`（流式 + 配额） |
| 工作流 | `/api/workflow-history*`（保存/去重/发布/分享） |
| 外部调用 | `/api/publish/*`（全局 API Key 鉴权 + 调用日志，不限次数） |
| 管理 | `/api/admin/*`（用户/统计/审计/API 日志） |
| 节点 | `/api/nodes`（节点库） |

## 关键设计决策

| 决策 | 理由 |
|------|------|
| NodeDefinition ≠ NodeData | 类型描述与实例配置分离，可扩展 |
| Schema 从 NodeRegistry 派生 | 新增节点无需改校验层 |
| 执行前校验 | 配置错误提前拦截（而非运行时失败） |
| Code 沙箱（vm + 超时） | 用户代码隔离执行 |
| 模型能力驱动多模态 | 新增视觉模型无需改引擎 |
| 最终输出回退汇总 | 外部调用总能拿到结果 |
