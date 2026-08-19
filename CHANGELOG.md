# Changelog

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
