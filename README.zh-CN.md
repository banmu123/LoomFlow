# LoomFlow

> [English](README.md) | 中文

**为个人和小团队打造的轻量级 AI 工作流构建器。**

用自然语言描述想法 → 生成可运行的工作流 → 画布上自由调整 → 一键发布为 API。

让每个人都能创建自己的 AI 自动化流程。

---

## 🎯 适合谁用？

- ✅ **独立开发者** — 想给产品加 AI 能力，但不想自己搭一套编排平台
- ✅ **内容创作者** — 把重复的生产步骤变成一键自动流程
- ✅ **小型工作室** — 用可分享、可试运行的流程更快交付演示和客户项目
- ✅ **AI 自动化爱好者** — 几分钟做出原型，然后正式部署跑起来

## 🤔 为什么不用 Dify / n8n？

| | **LoomFlow** | Dify | n8n |
|---|---|---|---|
| 起步方式 | **自然语言直接生成工作流**，秒级开始 | 模板/手动搭建，偏企业级 LLM 应用平台 | 手动拖节点，AI 只是众多节点之一 |
| 定位 | 轻量 · 个人/小团队 · **AI 优先** | 重：RAG/知识库/团队协作/复杂部署 | 通用自动化，节点多而杂 |
| 部署 | **一条命令 Docker 自托管**（1GB 内存即可） | 较重 | 中等 |
| 对外提供 | 一键发布为带鉴权的 HTTP API + 分享页 | 应用/工作流为主 | Webhook/API |

**一句话**：Dify 是给团队造 LLM 应用平台的，n8n 是给所有人做通用自动化的——**LoomFlow 是给个人和小团队"用一句话把想法变成可运行、可发布的工作流"**。不追求大而全，追求 30 秒上手、一分钟部署。

---

## ✨ 功能亮点

### 💬 自然语言生成工作流
不需要从零拖拽——**用大白话描述流程**，AI 直接生成可执行的工作流加载到画布：

> **你：** "帮我做一个流程：输入产品名，AI 生成卖点文案，再生成推广视频脚本"
>
> **AI：** ✅ 已生成 4 节点工作流（开始 → LLM 文案 → LLM 脚本 → 结束），已加载到画布

之后可视化微调，一键发布为 API。

### 🎨 可视化画布
Tinyflow 画布编辑器：拖拽节点、连接流程、配置参数，支持 10 种节点（LLM / HTTP / 代码 / 模板 / 循环 / 人工确认等）。

### 🚀 工作流即 API
一键发布工作流为 HTTP 接口（**一个全局 API Key 调用你所有已发布工作流**，不限调用次数，含调用日志），外部系统直接对接：

```bash
curl -X POST https://your-host/api/publish/{workflowId}/execute \
  -H "Authorization: Bearer ffk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"query": "..."}}'
```

> API Key 首次发布时自动生成、只显示一次；过期后在「API 管理」页重新生成即可恢复。

### 🔗 工作流分享页
生成公开链接，对方无需登录即可查看流程节点、填写输入、试运行——演示/交付利器。

### 🏢 团队与权限
- 用户隔离（数据完全互相不可见，含 admin）
- 无次数限制（对话与 API 调用均不限次数）
- 审计日志（登录、操作全记录）

### 📊 管理后台
用户管理、用量统计（趋势图）、审计日志、API 调用日志。

### 🌐 国际化
中英双语一键切换（框架支持扩展任意语言）。

### 🔒 私有化部署
应用 + 数据 + 存储都可部署在自己服务器；数据库可切换自建 PostgreSQL（详见部署手册）。

---

## 📸 界面截图

| AI 对话 | 工作流画布 |
|---------|-----------|
| ![对话](public/screenshots/chat.png) | ![画布](public/screenshots/canvas.png) |

## 🏗️ 架构图

```mermaid
flowchart TB
    subgraph Client["客户端"]
        Browser["浏览器 — Next.js 前端<br/>AI 对话 / 画布 / 管理后台 / 分享页"]
        External["外部系统<br/>curl / API 调用方"]
    end

    subgraph App["LoomFlow 应用（Next.js）"]
        UI["App Router 页面<br/>对话 / 工作流 / 管理 / 分享"]
        API["API Routes<br/>auth / chat-ai / workflow-history / publish / api-key"]
        Engine["工作流执行引擎<br/>FlowEngine + NodeRegistry + Executors"]
        Registry["Model Registry<br/>模型配置 / Provider"]
    end

    subgraph Data["数据层"]
        PostgREST["PostgREST"]
        PG[("PostgreSQL<br/>conversations / workflow_history / workflow_versions<br/>user_api_keys / ai_models / audit_logs ···")]
    end

    subgraph ExternalSvc["外部服务"]
        LLM["LLM 服务<br/>DeepSeek / 任意 OpenAI 兼容接口"]
        OSS["对象存储<br/>阿里云 OSS / S3 兼容"]
        Search["搜索 API"]
    end

    Browser --> UI
    External -->|"Authorization: Bearer API Key"| API
    UI --> API
    API --> Engine
    API --> Registry
    API --> PostgREST --> PG
    Engine --> LLM
    Engine --> Search
    API --> OSS
```

**核心流程**：自然语言描述流程 → AI 生成工作流（Schema 校验 + 失败自动修复）→ 画布可视化微调 → 保存为版本历史 → 发布指定版本为带鉴权的 HTTP API（每用户一个全局 API Key）→ 外部系统凭 `Authorization: Bearer <key>` 调用。

**Docker 自托管部署**：

```mermaid
flowchart LR
    User["用户"] -->|":5000"| App["loomflow 应用"]
    App -->|"http://nginx:80/rest/v1"| Nginx["Nginx 反向代理"]
    Nginx --> PostgREST["PostgREST"]
    PostgREST --> PG[("PostgreSQL 16<br/>数据卷：loomflow-pgdata")]
```

## 🚀 快速开始

### 🐳 Docker 部署（推荐，一键自托管）

**内置 PostgreSQL + PostgREST + Nginx**——完全自包含，**无需 Supabase 云**。

```bash
git clone https://github.com/banmu123/LoomFlow.git
cd LoomFlow
cp .env.example .env      # 填 POSTGRES_PASSWORD / PGRST_JWT_SECRET，生成 SERVICE_ROLE_KEY
docker compose up -d      # 自动初始化数据库（含默认 admin 账号）
```

- 访问：http://localhost:5000
- 默认账号：`admin` / `123456`（⚠️ 首次登录后请立即修改）
- 数据持久化在 Docker 卷；日志：`docker compose logs -f loomflow`
- 停止：`docker compose down` —— 完整指南：[docs/docker-deploy.md](docs/docker-deploy.md)

### 🧑‍💻 本地开发

环境要求：Node.js ≥ 20.9、pnpm 9+、一个 Supabase 项目。

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env.local
```

环境变量（从哪里获取）：

| 变量 | 获取方式 |
|------|---------|
| `COZE_SUPABASE_URL` | Supabase → Project Settings → API |
| `COZE_SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API（service_role） |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| `AUTH_SECRET` | `openssl rand -hex 32` |

```bash
# 3. 初始化数据库 —— 数据库设置清单
#    创建 Supabase 项目 → SQL Editor → 按顺序执行：
#    ① scripts/supabase-init.sql
#    ② scripts/supabase-users.sql   ← ⚠️ 执行前先把默认 admin 密码改成你自己的
#    ③ scripts/supabase-updates.sql
#    ④ scripts/supabase-apikeys.sql  ← 全局 API Key 表（可重复执行）
#    验证表：conversations / messages / workflow_history / users / ai_models ...

# 4. 启动
pnpm dev
```

打开 http://localhost:5000。

> ⚠️ **安全提示**：初始 admin 密码在 `supabase-users.sql` 中设置——**首次部署前必须修改为强密码**。系统无法自动强制，请把它视为必做步骤。

### 🚀 生产部署 / 自托管

完整指南：**[docs/config/Deployment-Manual.md](docs/config/Deployment-Manual.md)**

```bash
pnpm build
COZE_PROJECT_ENV=PROD PORT=5000 pm2 start dist/server.js --name loomflow
pm2 save
```

最低服务器：1 核 CPU / 1GB 内存 / Ubuntu 20.04+ / Node ≥ 20.9。

### 🗄️ 自建 PostgreSQL

通过 **Docker 自托管 Supabase** 从云切换到自己的 PostgreSQL——**代码零改动**。见[部署手册第十一章](docs/config/Deployment-Manual.md)。

### ✅ 部署后验证

```bash
curl http://localhost:5000/api/health
# {"status":"ok","service":"loomflow","version":"v0.1.0",...}
```

检查清单：
- ✅ `http://localhost:5000` 可打开（登录页）
- ✅ admin 账号可登录
- ✅ 工作流画布可加载
- ✅ 创建一个简单工作流 → 保存
- ✅ 发布为 API → 用 API Key 调用

## 📚 文档

- **[Roadmap 路线图](ROADMAP.md)** — 项目规划（v0.1 → v0.5）
- **[架构说明](docs/config/architecture.md)** — 从自然语言到可执行 API 的完整链路
- **[安全设计](docs/config/security.md)** — 沙箱/认证/配额/审计/隔离
- **[自定义节点指南](docs/config/custom-node-guide.md)** — 开发自己的节点（开发者平台）
- **[部署手册](docs/config/Deployment-Manual.md)** — 自托管/迁移/HTTPS

---

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui |
| 画布 | @tinyflow-ai/ui |
| AI | AI SDK v7 + DeepSeek（OpenAI 兼容，可切换任意模型） |
| 数据库 | Supabase (PostgreSQL) + Drizzle ORM 预装 |
| 存储 | 阿里云 OSS / S3 兼容 |
| 部署 | pm2 + Nginx + 一键部署脚本 |

---

## 📁 项目结构

```
src/
├── app/                  # 页面与 API 路由
│   ├── (main)/           # 主界面（对话 + 工作流）
│   ├── admin/            # 管理后台
│   ├── share/            # 工作流分享页
│   └── api/              # 后端 API（auth / conversations / workflow-history / publish / admin）
├── components/           # UI 组件
├── lib/
│   ├── tinyflow/         # 工作流执行引擎（10 种节点执行器）
│   ├── workflow-ai/      # AI 生成工作流提示词
│   └── i18n.tsx          # 国际化框架
├── messages/             # 中英文案
└── scripts/              # 部署脚本
```

---

## 📄 开源协议

[MIT](LICENSE)

## 🙏 致谢

- [Tinyflow](https://github.com/tinyflow-ai) — 工作流画布
- [AI SDK](https://ai-sdk.dev/) — LLM 流式调用
- [shadcn/ui](https://ui.shadcn.com) — UI 组件
