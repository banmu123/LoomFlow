# LoomFlow Roadmap

> 让每个人都能创建自己的 AI 自动化流程。

---

## ✅ v0.1 — Foundation & Self-hosted Platform

**目标**: 可运行、可部署、可扩展的 AI 工作流平台。

- ✅ 可视化工作流画布（Tinyflow，12 种节点）
- ✅ 工作流创建 / 执行 / 版本历史（原地更新、查看/还原版本）
- ✅ AI 辅助生成（自然语言 → 可运行工作流，自动校验与修复）
- ✅ 工作流模板（23 个真实场景模板，6 大分类）
- ✅ HTTP API 发布（指定版本发布、全局 API Key、调用日志）
- ✅ 模型接入（自带模型，任意 OpenAI 兼容端点）
- ✅ 知识库（数据库或 OSS 存储，Knowledge 节点可检索）
- ✅ AI 对话助手（查询系统状态、排查故障、导航页面）
- ✅ 国际化（中 / 英）
- ✅ Docker 自托管部署（PostgreSQL + PostgREST + Nginx + App，一条命令）

---

## ✅ v0.2 — Workflow Observability & Evaluation

**目标**: 工作流调试、运行可观测、质量评估。

- ✅ 执行历史 — 运行记录、状态、输入/输出、错误
- ✅ 节点级执行追踪 — 每个节点的状态/耗时/模型/Tokens/错误时间线
- ✅ 执行指标聚合 — 成功率、失败率、P95 延迟、成本、重试率、超时率（24h/7d/30d）
- ✅ 节点级指标 — 最慢节点、最贵节点、最易失败节点
- ✅ 瓶颈检测 — 自动识别延迟/成本/失败瓶颈 + 优化建议
- ✅ 静态分析 — 9 项检查（未用节点、不可达节点、重复节点、缺错误处理、潜在死循环等）
- ✅ Benchmark — 多采样版本对比（延迟 40% + 成本 20% + 成功率 20% + 测试 20% 加权）
- ✅ 评估模型 — 8 维评分（正确性、可靠性、延迟、成本、Token、失败率、重试、超时）
- ✅ Debug 助手 — 画布 AI 助手读取运行历史，回答「为什么失败」并给修复建议

---

## ✅ v0.3 — AI Workflow Copilot

**目标**: AI 参与工作流全生命周期，不只是生成。

- ✅ 自然语言编辑 — 画布 AI 助手描述修改需求 → 输出 Patch → 一键应用
- ✅ 工作流优化 — AI 分析执行效率 / Token / 成本 / 节点结构 → 生成优化 Patch
- ✅ 工作流解释 — Copilot explain 模式
- ✅ AI 测试生成 — test 模式自动生成测试用例草稿
- ✅ Diff & Patch — 8 种 Patch 操作、结构化 Diff、人类可读 Markdown
- ✅ Proposal 管线 — AI Patch → 临时副本 → Schema 校验 → 依赖校验 → 测试 → Diff → 用户确认
- ✅ 测试用例系统 — 7 种评估规则（精确匹配、部分匹配、包含、JSONPath、数值容差、数组包含、JSON Schema）
- ✅ Copilot 上下文构建 — 按任务类型自动裁剪（create/modify/debug/explain/optimize/test）

---

## ✅ v0.4 — Workflow Evolution Engine

**目标**: 工作流持续自优化，无需人工干预。

- ✅ 演化调度器 — 30 分钟扫描循环，按 workflow 分组串行执行
- ✅ 规则评估器 — cooldown 冷却期、最小执行数、重复 proposal 防重
- ✅ 触发检测器 — cron / metric（6 指标 × 6 操作符）/ event（连续失败/超时）
- ✅ 回归检测 — 版本基线 / 生产基线 / 滚动基线，5 指标（成功率、失败率、P95 延迟、成本、测试得分），相对 + 绝对阈值
- ✅ 回归事件集成 — 检测到退化时自动创建 Evolution Event，接入现有 AI 优化管线
- ✅ 演化历史 — Session 聚合（proposal_id 分组）、Timeline、before/after 效果追踪
- ✅ Quality Gate — 6 项检查（Schema / 静态分析 / 测试 / 回归 / 成本 / 安全），ALLOW/WARNING/BLOCK 决策
- ✅ Quality Gate UI — 发布流程集成，BLOCK 阻止发布，WARNING 需确认，ALLOW 自动发布
- ✅ 演化看板 — 工作流健康评分、趋势、瓶颈、AI 提案、触发规则 CRUD、Quality Gate 状态
- ✅ 三级权限 — owner 全权、member 只读、admin 全权

---

## 🔲 v0.5 — Team & Enterprise

**目标**: 团队与企业内部 AI 自动化。

- 🔲 Workspace — 组织层级（Company → Department → Team）
- 🔲 角色权限 — Admin / Editor / Viewer（当前仅 admin / user）
- 🔲 Secrets 管理 — 集中管理 API Key、环境变量、凭证（当前散落在节点配置中）
- 🔲 协作编辑 — 多人同时编辑同一工作流
- 🔲 审批流程 — 工作流发布需团队审批

---

## 🔲 v0.6 — Ecosystem & Extensions

**目标**: 可扩展的 AI 工作流生态。

- ✅ 自定义节点 — NodeRegistry 已支持自定义注册（node-custom.ts）
- ✅ 工作流模板 — 23 个场景模板，支持分类筛选
- 🔲 插件系统 — 第三方扩展（NodeRegistry plugin SDK 已预留）
- 🔲 模板市场 — 社区分享工作流模板
- 🔲 跨工作流学习 — 从成功工作流中提取模式，应用到其他工作流

---

*欢迎反馈和贡献 — 提 Issue 或 PR。*
