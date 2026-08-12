# Changelog

## [v0.2.0] - 2026-08-12

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

## [v0.1.1] - 2026-08-12

### 修复

- **弹窗被画布遮挡**：Tinyflow 节点面板 z-index（1001）高于弹窗默认值（50），修改密码/删除确认/确认节点等弹窗被遮挡。已将弹窗 z-index 提升至 1200
- **密码框占位符显示原文**：i18n 翻译时部分 placeholder/title 被错误替换为带引号的 `{t(...)}` 字面量，页面显示原始文本。已修复全部 8 处
- **密码可见性**：新增 `PasswordInput` 组件（眼睛图标切换明文/密文），应用于登录页、修改密码、管理后台

### 变更

- 项目更名为 **LoomFlow**（原 ForgeFlow），更新 README、元数据、登录页品牌
- 移除对话面板「AI 对话」标题，对话历史面板默认收起
- 部署脚本 `deploy.sh` 支持环境变量覆盖（`SERVER_USER` / `SERVER_IP` / `APP_DIR`），开源后本地部署不受占位符影响

### 文档

- 公开部署手册（`docs/config/Deployment-Manual.md`）与外部 API 文档（`docs/api-external.md`）
- `.env.example` 更新为当前项目完整变量模板
- 移除 SQL 脚本中的初始密码（改为占位符，防止泄露生产凭据）

## [v0.1.0] - 2026-08-12

### 新增

- **AI 对话生成工作流**：自然语言描述需求，DeepSeek 流式生成可执行工作流并加载到画布（flash / pro 模型切换）
- **可视化画布**：Tinyflow 集成，10 种节点（LLM / HTTP / 代码 / 模板 / 循环 / 人工确认等），拖拽编排、试运行、执行日志
- **工作流即 API**：一键发布为 HTTP 接口（API Key 鉴权 + 调用配额 + 调用日志），支持同步/异步执行、人工确认流程
- **工作流分享页**：公开链接，无需登录即可查看节点、填写输入、试运行
- **用户体系**：JWT 登录（httpOnly Cookie）、登录失败锁定、密码强度策略、自助改密码、admin 解锁
- **团队与权限**：数据完全隔离、对话配额、API 配额、审计日志（11 类操作）
- **管理后台**：用户管理、用量统计仪表盘、审计日志、API 调用日志
- **执行持久化**：flow_runs 落库，执行历史页
- **工作流管理**：保存/去重（user_id+data_hash）、导入导出 JSON、执行历史
- **国际化**：中英双语一键切换（框架支持扩展任意语言）
- **部署体系**：一键部署脚本、完整部署手册（Nginx/HTTPS/迁移）、私有化部署支持

### 技术栈

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + Tinyflow 画布 + AI SDK v7 (DeepSeek) + Supabase + 阿里云 OSS

### 已知限制

- DeepSeek 官方 API 不支持图片识别（图片仅展示；配置火山方舟视觉模型后自动启用）
- 知识库 / 搜索节点为预留状态，未接入真实服务
- 定时任务框架已预留（调度器代码），暂未启用
