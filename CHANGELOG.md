# Changelog

## [v0.2.0] - 2026-08-13

### 新增

- **全局 API Key**：一个用户一个 Key，可调用该用户所有已发布工作流（`user_api_keys` 表）
- **API 管理页**（工作区 → API 管理）：查看 Key 状态 / 有效期配置 / 生成与重新生成（新 Key 仅显示一次）
- Key 首次发布时自动生成；重新生成保留有效期配置，旧 Key 立即失效
- 迁移脚本 `scripts/supabase-apikeys.sql`（幂等，含存量 Key 提升与 Docker initdb 挂载）

### 变更

- 移除按工作流的 API Key 与调用配额（`api_quota`/`api_used`），API 调用不限次数
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
