# Changelog

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
