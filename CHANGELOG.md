# Changelog

## [v0.1.11] - 2026-09-02

### 新增

- **路由切换与首屏性能优化**
  - 侧边栏导航改用 `next/link` 启用路由预取（原 `router.push` 零预取，切页冷启动）
  - 新增 `(main)/loading.tsx` 切页骨架屏，消除"点击 → 白屏"体感
  - `react-markdown` / `@ai-sdk` 改为 `next/dynamic` 按需加载并全站共享 chunk（原重复打包 3 份）
  - `/chat`、`/chat/[id]`、`/workflows/editor` 首屏 JS 从 1MB+ 降至 340–470KB（约 -60%）
  - `SimpleChatMessage` 加 `memo`（ref 转发避免过期闭包），修复流式输出时全列表重渲染
  - I18n context value 加 `useMemo`

### 修复

- **画布 AI 助手对话无任何反馈**：后端消息提取只读 `content` 字段，未兼容 `useChat` 的 UIMessage `parts` 结构，导致 `promptMessages` 为空、`streamText` 抛 "messages must not be empty"；`extractMessageText` 兼容 parts/content 两种结构，空消息返回 400 明确报错；前端渲染 `error` 状态（原完全静默）
- **流式错误被脱敏为 "An error occurred."**：AI SDK 默认不透传流式中途错误的真实原因；`canvas-assistant` / `chat-ai` / `workflow-notes` 三个路由接入 `onError`（共享 `uiStreamErrorText`），前端可看到如 "Insufficient Balance" 等可诊断文案

### 变更

- GitHub 仓库 metadata 补充 description 与 topics（OSS discovery）
- README 测试数更新：725 → 735

### 测试

- 735 个单元测试全绿
  - 新增 chat-recommendations i18n key 校验、extractMessageText（parts/content 兼容）、uiStreamErrorText 用例
- validate（ts-check + lint）通过

---

## [v0.1.10] - 2026-09-01

### 新增

- **Vercel Hobby 免费计划兼容**：单 Cron 统一调度，适配 Hobby 计划每天一次限制
  - **Cron Runner**（`src/lib/scheduler/cron-runner.ts`）：统一调度入口，根据 `last_run_at` 和 `cron_expr` 频率判断到期任务
  - 支持频率：every 10 minutes / every 30 minutes / hourly / daily
  - 单次触发同时执行 scheduled tasks + evolution checks

### 变更

- `vercel.json` cron 配置：`*/10 * * * *` + `*/30 * * * *` → `0 0 * * *`（每天 UTC 0 点触发）
- `/api/cron/scheduler` 改为调用 `runScheduledTasks()`，返回 `{ success, executed, skipped }`
- 删除 `/api/cron/evolution` 独立端点，合并到 scheduler cron runner
- Docker 模式保持不变：`initScheduler()` + `initEvolutionScheduler()` 正常运行
- Favicon 替换为 LoomFlow logo（`src/app/icon.png`）

---

## [v0.1.9] - 2026-08-31

### 新增

- **回归检测（Regression Detection）**：自动检测工作流性能退化
  - **Baseline Manager**：支持三种基线——版本基线（Version）、生产基线（Production）、滚动基线（Rolling 24h/7d/30d）
  - **Regression Detector**：纯函数层，5 指标逐项检测（成功率、失败率、P95 延迟、成本、测试得分），支持相对 + 绝对阈值
  - **Regression Policy**：可配置的 severity 阈值（info/low/medium/high/critical），OR 逻辑判定 regression，AND 逻辑判定 improvement
  - **Trade-off 检测**：区分 regressed / improved / stable / tradeoff / inconclusive，不强行压成单一分数
  - **Regression Event 集成**：检测到退化时自动创建 Evolution Event，接入现有 AI 优化管线，幂等 key 防重复

- **演化历史（Evolution History）**：完整可追溯的工作流演化记录
  - **Session 聚合**：按 proposal_id 分组，多个事件聚合为一次演化
  - **Timeline**：按 createdAt + eventId 稳定排序的事件时间线
  - **Outcome**：before/after 指标对比（observed_after_version，非 version-scoped）
  - **查询 API**：GET /api/evolution/history（分页 + 时间/状态/严重度过滤）

- **Quality Gate**：发布闸门，ALLOW / WARNING / BLOCK 三级决策
  - **6 项检查**：Schema（required）、Static Analysis（required）、Tests（required）、Regression（advisory）、Cost（advisory）、Security（required）
  - **Policy 模型**：服务端加载，客户端不能覆盖 required checks
  - **Gate Evaluation 持久化**：quality_gate_evaluations 表，30 分钟有效期，绑定用户/版本/dataHash
  - **TOCTOU 防护**：发布前重新校验版本 dataHash 未变化
  - **Quality Gate UI**：发布流程集成——ALLOW 自动发布、WARNING 弹窗确认、BLOCK 阻止发布
  - **Quality Gate 组件**：可复用 QualityGateResult，每项检查独立行，可展开查看详情

- **聊天体验优化**
  - 轮询间隔从 1.5s 降至 500ms（3x 更快反馈）
  - DB 写入节流从 500ms 降至 300ms（更流畅的分块）
  - pending 状态增强：spinner +「思考中...」标签
  - streaming 状态增加打字机光标动画

### 变更

- ROADMAP 重构：v0.1 Foundation → v0.2 Intelligence → v0.3 Evolution → v0.4 Quality & Reliability → v0.5 Developer Ecosystem → v0.6 Experience RAG
- README 测试数更新：698 → 725
- 项目结构新增 `quality-gate/`、`evolution-history/` 目录

### 测试

- 725 个单元测试全绿
  - regression-policy 27 + baseline 24 + regression 44 + orchestrator 12 + regression-event 31 + quality-gate 27 + evolution-history 12 + 其他
- validate（ts-check + lint）通过

---

## [v0.1.8] - 2026-08-27

### 新增

- **工作流演化引擎（Evolution Engine）**：工作流持续自优化，无需人工干预
  - **触发规则**：支持三种触发类型——定时（cron）、指标触发（延迟增长/失败率超阈值等 6 种指标 × 6 种操作符）、事件触发（连续失败/连续超时）
  - **规则评估器**：cooldown 冷却期防重复触发、最小执行数检查、重复 proposal 防重
  - **触发检测器**：当前窗口 vs 基线窗口指标对比，输出 MetricSnapshot（current + baseline + delta）
  - **编排层**：薄编排，复用现有 workflow-eval + workflow-copilot 管线，不含优化逻辑
  - **调度器**：30 分钟扫描循环，按 workflow 分组串行执行，启动时延迟 30s 首次扫描
  - **演化看板**：工作流健康评分（成功率×0.4 + 延迟×0.3 + 失败率×0.3）、趋势检测、瓶颈展示、AI 提案（查看 Diff/确认/拒绝）、演化时间线、触发规则 CRUD
  - **三级权限**：owner 全权、member 只读、admin 全权（复用现有认证系统）
  - **可靠性**：幂等 key（rule_id + date）防重复 proposal、DB UNIQUE 约束兜底
- **安全修复**：`next.config.ts` 图片优化器 SSRF 风险，`remotePatterns` 从 `*` 限制为 `*.aliyuncs.com`
- **i18n 补全**：15 个组件 60+ 处硬编码中文替换为 `t()` 国际化调用，新增 40+ i18n key（tools/nodeConfig/modelConfig/sidebar 等）

### 变更

- `i18n.tsx` 导出 `I18nContext` 供 class 组件（ErrorBoundary）使用
- `formatTime` locale 硬编码 `'zh-CN'` 改为 `undefined`（浏览器默认）
- README 测试数更新、版本号更新、新增演化引擎功能说明

### 测试

- 538 个单元测试全绿（新增 45 个演化引擎测试：rule-evaluator 13 + trigger-detector 10 + permissions 10 + orchestrator 9 + 其他 3）
- validate（ts-check + lint）通过

---

## [v0.1.7] - 2026-08-23

### 新增

- **场景中心（平民自动化核心体验）**：打开即见 23 个真实刚需场景模板（办公效率/营销文案/销售客服/数据处理/内容创作/运营自动化 6 类），点击卡片 → 填参数 → 运行 → 出结果，全程不碰画布；模板支持分类筛选
- **模板直达运行页** `/templates/[id]`：长文本字段自动用大输入框，结果直接展示，可一键「打开完整编辑器」进阶调整
- **对话趋势感知**：AI 自动分析用户近 30 天对话反复关注的话题（职业发展/AI 应用/编程/健康等 10 类），注入系统提示词
- **行为洞察**：AI 读取用户真实工作流行为（近 7 天创建数/执行成功率/常用节点/发布数），对话中自然引用（"我注意到你上周做了…"）
- **AI 升级为人生设计教练**（斯坦福人生设计课方法论）：关注投入感、帮用户看多种可能、鼓励小步实验、区分可改变与需接受；不强行说教

### 修复

- **画布 AI 助手消息 400**：`prepareSendMessagesRequest` 自定义 body 漏带 `messages`，导致后端收不到对话内容（对话信息全空）
- **首次部署配置模型不生效**：配置模型成功后自动重试当前对话中失败/未回复的最后一条用户消息，并清理旧 error 回复，无需手动重发或重新进入模型配置页
- **本机 Docker 镜像拉取**：`mirror.ccs.tencentyun.com` 仅腾讯云 VPC 内网可用，本机需配置公网加速（DaoCloud 等）

### 重构

- **移除空谈功能死代码**：删除无 UI 引用的 growth 模块（14 个 API 路由 + 11 个 lib 模块 + 5 个死亡测试），净减 3200+ 行
- 首页 `/` 恢复为对话入口（redirect /chat）；侧边栏移除能力面板/答题入口
- 保留聊天在用的用户画像注入（ability-service / conversation-trends / behavior-insights）

### 测试

- 253 个单元测试全绿；validate（ts-check + lint）通过

---

## [v0.1.6] - 2026-08-19

### 新增

- **拿铁主题 UI 全面升级**：奶泡白/焦糖/深咖啡品牌色板（Light/Dark 双主题）+ 品牌渐变 + 登录页与侧边栏产品 Logo + 模型选择器胶囊化
- **自研画布包 `loomflow-ui`**（fork tinyflow 品牌化）：包名/背景水印改为 LoomFlow、兜底节点标题数据驱动（去除 TinyFlow.ai）；已发布 npm v0.1.1
- **画布国际化**：DOM 翻译层实现 tinyflow 内置文本中英切换（节点库/配置面板/占位符 60+ 项映射，切回中文自动恢复）
- 定时任务页、推荐模板、画布/预览工作流提示全部接入 i18n（英文模式不再出现中文）

### 性能

- **画布加载并行化**：4 个接口 + loomflow-ui import 全部并行（串行 1.6s → 0.36s）
- **新聊天跳转提速**：创建对话接口携带首条消息，省一个串行网络往返（8s → 约减半）
- **Docker 构建加速**：pnpm store + Turbopack 编译缓存持久化，增量部署不再全量重建
- DOM 翻译层改增量处理（画布交互只扫新增节点）

### 工程

- **Docker 为唯一部署方式**：移除 pm2 全部引用（deploy.sh 删除、服务器 pm2/systemd/旧目录清理）
- README 全面同步（节点数 12、Docker 部署、Search Registry、Logo、测试 209 用例、中英分离）
- 移除自定义节点复制功能（按需求）

### 测试

- 209 个单元测试全绿；validate（ts-check + lint）通过

---

## [v0.1.5] - 2026-08-18

### 新增

- **Search Provider 系统**：统一搜索适配层（`SearchProviderRegistry` + tavily/exa/google 三实现 + 统一 `{results: [{title,url,content}]}` 输出）；管理后台「搜索配置」页（添加/编辑/删除/启用开关/**测试连接**/google cx 动态字段）；画布搜索节点引擎下拉选择已启用服务；AI 生成工作流注入真实服务列表防幻觉
- **内置 Excel 节点**（excelNode）：数据生成 .xlsx（SheetJS 写入方向），输出 base64（前端直接下载）或上传 OSS；数据源支持上游节点输出或静态 jsonData；AI 生成工作流与 `create_custom_node`（executorType=excelNode）均可使用
- **一键 Docker 部署脚本**（`scripts/deploy-docker.sh`）：同步代码 → 迁移 → 权限自检 → 构建 → 健康验证；`/api/health` 增加 db 连通自检
- **自定义节点可复用内置执行器**：`executor_type` 落库 + 重启恢复绑定；AI 对话可创建可直接运行的自定义节点（template/code/llm/http/excel 等 10 种执行器）

### 安全（重点）

- **密钥全加密**：AES-256-GCM（密钥由 AUTH_SECRET 派生）覆盖搜索服务 / AI 模型 / 全局 API Key / OSS 配置四类密钥；全局 API Key 增加 SHA-256 哈希列支持等值鉴权（密文不可直接查询）；旧明文数据透明兼容
- **容器非 root 运行**（USER node）+ 服务器 `.env` 权限收紧（600）
- **自托管增量表权限修复**：migration 阶段新建的表（node_definitions / search_providers）自动补 GRANT + `ALTER DEFAULT PRIVILEGES` 治本（杜绝未来新表无权限）+ 部署时权限自检

### 修复

- **搜索节点字段冲突**：统一 `keyword`/`limit`（画布内置面板字段），修正 `??` 优先级导致「搜索数据量/关键字」被旧字段遮蔽的问题
- **自定义节点 AI 创建失效**：intent 分流修正（含「节点」关键词启用工具）+ `executorType` 不再硬编码自身类型
- Vercel/CI 构建系列修复：移除 react-dev-inspector/.babelrc、typescript/tailwindcss/tsup 移入 dependencies、Next 16.1.1 → 16.2.12（SSRF/DoS/缓存投毒安全修复）
- 全局 toast 不显示（挂载 sonner Toaster）

### 测试

- 211 个单元测试（新增 search registry/providers 19、secrets 8、excel-executor 7、search-executor 8、node-custom 绑定、intent、api-key 等 85 个）

---

## [v0.1.4] - 2026-08-17

### 安全（重点）

- **flow 试运行路由强制认证**：`/api/flow/execute|stream` 未登录 401；`status|stop|confirm` 增加登录 + 流程归属校验（此前未认证可执行任意工作流 = RCE/SSRF/成本滥用入口）
- **Code Node 沙箱逃逸封堵**：移除宿主 realm 对象注入（vm 逃逸已实测 RCE），utils 改从新 realm 获取、移除 fetch、inputs 深克隆、异步挂起超时兜底
- **HTTP Node SSRF 防护**：URL 协议白名单 + 内网/回环/链路本地拦截（含特殊编码/IPv6/IPv4 映射 + DNS 解析二次校验）+ 手动重定向逐跳校验 + 10s 超时 + 1MB 响应体限制
- **OSS AccessKeySecret 不再下发客户端**：新增 `/api/oss/upload` 服务端代理上传（MIME 白名单 + 大小限制），`/api/oss/config` 只返回非敏感字段
- **webhook_url SSRF 防护**：定时任务创建/更新时校验公网 http/https
- 修复退出登录后仍保持登录态（清除 cookie 多属性变体）；Secure cookie 改为按请求协议动态判断（HTTP 直连可正常登录）

### 新增

- **定时任务功能完整化**：调度器启用（服务启动加载 + 10 分钟 DB 同步）、容器时区 TZ、页面频率预设点选（无需懂 cron）、webhook 回调
- AI 回复 **Markdown 渲染美化**：JSON 代码块/列表/跳转按钮层次分明，内容宽度撑满（AI 头像 → 用户头像）

### 修复

- **执行历史输入被清空**：saveFlowRun 更新分支只补传入字段（二次调用不再覆盖 inputs/workflow_id）
- 切换对话闪现欢迎页空态 → 加载占位

### 测试

- 126 个单元测试（新增：生成执行器状态机、工作流提取、调度器、SSRF 防护、沙箱逃逸回归、频率预设等 40 个）

---

## [v0.1.3] - 2026-08-16

### 新增

- **AI 生成改为后端执行 + 前端轮询**：生成任务生命周期属于 conversation（数据库消息状态 `pending→streaming→done/cancelled` 为唯一事实来源），切换页面/刷新不中断生成；停止按钮保存 `cancelled` 状态与已生成内容
- **生成幂等触发**（`ensureGeneration`）：发消息端点 + 轮询端点（GET messages 发现 pending 自动补触发）双保险，route fire-and-forget 失效时生成仍会执行
- **工作流预览抽屉**：AI 生成工作流后右上角「预览工作流」按钮，右侧抽屉（80vw）内复用完整画布（TinyflowWrapper），可一键进入完整编辑器
- **欢迎页/对话页拆分**：`/chat`（ChatLanding 欢迎页）与 `/chat/[id]`（ChatPanel 对话页）两个独立界面，路由区分对话
- **对话切换由路由驱动**：移除 chat-* 自定义事件状态冲突，URL 为唯一事实来源（刷新保留当前对话、浏览器前进后退可用）
- **migration 一次性容器**（docker-compose）：每次 `up` 自动执行幂等迁移 SQL，一键部署免手动补库；迁移后 `NOTIFY pgrst, 'reload schema'` 自动刷新 PostgREST schema 缓存
- 对话标题 = 第一句话（截 20 字持久化）；历史标题过长显示「前 5 字 + …」

### 修复

- **生成中断**：切换菜单/跳转不再 abort 生成（原「已停止生成」问题）
- **底部输入框贴齐可视底部**：根因是 `scrollIntoView` 连带滚动 overflow-hidden 根容器（scrollTop=128 内容上移）——改为只滚消息容器
- **对话历史置底**：`space-y-*` 的 margin-top 覆盖 `mt-auto`——改用 `gap-*`
- **自动发送失败**：欢迎页首条消息改为直接写库，ChatPanel 按「最后一条 user 无 AI 回复」自动生成（不再依赖 URL 参数）
- **生产 AI 无内容返回**：PostgREST schema 缓存过期导致 PATCH 400（PGRST204）——重启 postgrest + NOTIFY 防复发
- **重新生成重复插入**：改为更新原消息（DELETE 旧消息 + 重新生成）
- 切换对话闪现欢迎页空态 → 加载占位

### 变更

- 移除前端流式解析（AbortController/reader，约 400 行）；AI 生成不再自动跳转画布（改为预览按钮）
- 路由：`/` 重定向 `/chat`；`/chat` 为新聊天空态，`/chat/[id]` 为对话

---

## [v0.2.0] - 2026-08-13

### 新增

- **全局 API Key**：一个用户一个 Key，可调用该用户所有已发布工作流（`user_api_keys` 表）
- **API 管理页**（工作区 → API 管理）：查看 Key 状态 / 有效期配置 / 生成与重新生成（新 Key 仅显示一次）
- Key 首次发布时自动生成；重新生成保留有效期配置，旧 Key 立即失效
- 迁移脚本 `scripts/supabase-apikeys.sql`（幂等，含存量 Key 提升与 Docker initdb 挂载）

### 变更

- 移除按工作流的 API Key 与调用配额（`api_quota`/`api_used`），API 调用不限次数
- **移除对话配额**（`chat_quota`/`chat_used` 校验与扣减、用户管理页配额 UI、相关文案），对话与 API 均不限次数
- 发布对话框：Key 仅首次生成时显示，其余情况引导至 API 管理页
- `api_call_logs` / 审计保留；`/api/workflow-history` 不再返回任何 Key 字段

### 文档

- README（中英）、docs/api-external.md、docs/config/security.md、docs/config/architecture.md、docs/docker-deploy.md 同步全局 Key 模型

---

## [v0.1.0] - 2026-08-12

### 新增

- **节点系统**：NodeDefinition / NodeRegistry 单一事实来源；10 个内置节点注册；executorType 绑定校验；节点库面板（分类展示）
- **模型可配置化**：Model Registry（capabilities/providers/models）；管理界面添加模型（per-model API Key / Base URL）；画布与对话动态同步；视觉能力驱动多模态
- **AI 生成自动修复**：生成 → Schema 校验 → 失败自动调用 repair API 修复
- **Code Node 沙箱**：node:vm 隔离（process/require 不可访问）+ 5s 超时
- **Workflow Schema 校验**：13 种错误场景（未知类型/悬空连接/循环/开始结束单例等）
- **最终输出提取增强**：endNode 无配置时回退汇总所有节点输出
- **执行器 validate 接口**：7 个执行器配置校验 + 执行前拦截
- **测试体系**：60 个单元测试（引擎/参数/表达式/沙箱/Schema/i18n/模型注册表/节点注册表）
- **CI**：GitHub Actions（lint + typecheck + test + build，Node 20/22）

### 变更

- 三栏后台布局（菜单栏 | AI 对话 | 内容区）、管理菜单并入主界面、对话可收起
- 移除 coze-coding-dev-sdk（构建兼容性）
- 双语 README（英文主文档 + 中文版）
- 项目更名 LoomFlow

### 文档

- 部署手册：自建 PostgreSQL 迁移指南（Docker 自托管）、英文摘要
- CHANGELOG 体系建立

---

本项目所有值得记录的版本变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
