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
| Code 沙箱（容器 + 权限模型） | 用户代码隔离执行，vm 不再作为边界 |
| 模型能力驱动多模态 | 新增视觉模型无需改引擎 |
| 最终输出回退汇总 | 外部调用总能拿到结果 |

## 6. AI 基础设施（第二阶段）

```
LLM / Agent 节点
      ↓
Model Gateway（路由 / 降级 / 熔断 / 成本 / 指标）
      ↓
Provider Adapter（ModelRegistry + AI SDK）
      ↓
DeepSeek / OpenAI / Qwen / Ark / Claude / Ollama

Agent 节点 → Agent Runtime（步数/预算/权限/追踪）
      ↓
MCP Registry（工具发现 / 白名单 / 权限）
      ↓
MCP Server（Streamable HTTP / STDIO）

Python Tool 节点 → @/lib/python-tools → FastAPI 工具服务
```

| 模块 | 位置 | 职责 |
|------|------|------|
| Model Gateway | `src/lib/gateway/` | 候选排序、429/5xx/超时降级、熔断、Token/成本统计、baseURL SSRF 校验 |
| MCP Client | `src/lib/mcp/` | initialize / tools.list / tools.call，HTTP 与 STDIO 两种传输 |
| Agent Runtime | `src/lib/agent/` | 多轮工具调用、最大步数、Token 预算、超时、取消、权限审批 |
| Python 工具服务 | `services/agent-tools/` | 表格、文档、文本、字段提取（不执行任意代码） |

设计原则：

1. **复用而不重写**：模型解析仍走 `getProviderClientForModel`，执行仍走 FlowEngine；
2. **工具即数据**：MCP 工具输出视为不可信内容，包裹边界并截断；
3. **权限前置**：工具 scope 与 Agent `allowedScope` 比对，超出直接拒绝，不"先执行再报错"；
4. **不假装智能**：路由是确定的排序规则，Agent 是带预算的循环，不是黑盒。

## 7. 评测、可观测性与回滚（第三阶段）

```
生成链路：NL → Workflow JSON → Schema → Repair
                        ↓
              Generation Eval（wf-gen-v1）
              ├─ 结构：Schema / 节点类型 / 连通性 / 参数
              ├─ 语义：节点选择 / 意图 / 约束
              ├─ 运行：执行成功 / 任务完成 / 修复率
              └─ 成本：延迟 / Token / 估算成本
                        ↓
                 Quality Gate（可选 generationEval）

运行链路：HTTP → flow_jobs(traceparent) → Worker → FlowEngine → Node → Gateway / MCP / Python
                        ↓
                 OpenTelemetry（Trace + Metrics + OTLP）

发布链路：Version B 上线 → 回归检测 → 回滚决策 → 指针切回 Version A
```

| 模块 | 位置 | 职责 |
|------|------|------|
| Generation Eval | `src/lib/workflow-gen-eval/` | 基准集、确定性指标、A/B、Judge 兜底 |
| Telemetry | `src/lib/telemetry/` | SDK 初始化、Span/Metric 封装、W3C 传播、脱敏 |
| Rollback | `src/lib/rollback/` | 决策纯函数、策略存储、原子版本切换 |

复用关系：回归判定复用 `workflow-eval/regression.ts`；门禁复用 `quality-gate`；发布指针复用既有 `published_version/published_data`。
