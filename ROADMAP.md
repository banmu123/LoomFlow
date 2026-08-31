# LoomFlow Roadmap

> 让每个人都能创建自己的 AI 自动化流程。

---

## ✅ v0.1 — Foundation

**可运行、可部署的 AI 工作流平台。**

- 可视化工作流画布（12 种节点）
- 自然语言 → 可运行工作流（自动校验与修复）
- 工作流执行 / 版本历史 / 还原
- HTTP API 发布（指定版本、全局 API Key、调用日志）
- 模型接入（自带模型，任意 OpenAI 兼容端点）
- 知识库（数据库或 OSS 存储）
- AI 对话助手（系统查询、故障排查）
- Docker 一条命令自托管部署
- 国际化（中 / 英）

---

## ✅ v0.2 — Workflow Intelligence

**让工作流可调试、可评估、可优化。**

- 节点级执行追踪（状态 / 耗时 / 模型 / Tokens / 错误时间线）
- 执行指标聚合（成功率、失败率、P95 延迟、成本，24h/7d/30d）
- 节点级指标（最慢 / 最贵 / 最易失败节点）
- 瓶颈检测（自动识别 + 优化建议）
- 静态分析（9 项检查：未用节点、缺错误处理、潜在死循环等）
- Benchmark（多采样版本对比，加权评分）
- 评估模型（8 维评分：正确性、可靠性、延迟、成本等）
- 测试用例系统（7 种评估规则）
- AI Copilot（自然语言编辑 / 优化 / 解释 / 测试生成）
- Diff & Patch（8 种操作、结构化 Diff、Proposal 管线）

---

## ✅ v0.3 — Workflow Evolution

**工作流持续自优化，无需人工干预。**

- 演化调度器（30 分钟扫描，按 workflow 串行执行）
- 规则评估器（cooldown、最小执行数、重复防重）
- 触发检测器（cron / metric / event 三种触发）
- 回归检测（版本基线 / 生产基线 / 滚动基线，5 指标，相对 + 绝对阈值）
- 回归事件集成（自动创建 Evolution Event，接入 AI 优化管线）
- 演化历史（Session 聚合、Timeline、before/after 效果追踪）
- 演化看板（健康评分、趋势、瓶颈、AI 提案、触发规则 CRUD）
- 三级权限（owner / member / admin）

---

## 🔲 v0.4 — Quality & Reliability

**当前阶段。质量门禁、可靠性保障、生产级打磨。**

- ✅ Quality Gate（6 项检查：Schema / 静态分析 / 测试 / 回归 / 成本 / 安全）
- ✅ Quality Gate UI（发布流程集成，ALLOW / WARNING / BLOCK）
- ✅ 幂等执行（idempotency key、重复防重）
- ✅ 执行可靠性（timeout / retry / cancel / checkpoint / trace）
- 🔲 自动回滚（Quality Gate 检测到退化时可选自动回退）
- 🔲 Secrets 管理（集中管理 API Key、凭证，替代散落在节点配置中）
- 🔲 协作编辑（多人同时编辑同一工作流）
- 🔲 审批流程（工作流发布需团队审批）

---

## 🔲 v0.5 — Developer Ecosystem

**可扩展的开发者生态。**

- ✅ 自定义节点（NodeRegistry 已支持）
- ✅ 工作流模板（23 个场景模板）
- 🔲 插件系统（第三方扩展，Plugin SDK 已预留）
- 🔲 模板市场（社区分享工作流模板）
- 🔲 Workspace（组织层级：Company → Department → Team）
- 🔲 角色权限（Admin / Editor / Viewer）
- 🔲 Webhook 集成（事件驱动触发外部系统）

---

## 🔲 v0.6 — Experience RAG

**从执行经验中学习，跨工作流知识复用。**

- 🔲 执行经验提取（Problem → Context → Action → Result）
- 🔲 工作流记忆（Evolution History → 结构化记忆 → 可检索）
- 🔲 跨工作流学习（从成功工作流中提取模式，应用到其他工作流）
- 🔲 自然语言知识查询（"上次类似问题怎么解决的？"）
- 🔲 AI 优化建议增强（结合历史经验生成更精准的优化方案）

---

*欢迎反馈和贡献 — 提 Issue 或 PR。*
