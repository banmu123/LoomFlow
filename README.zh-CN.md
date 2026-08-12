# LoomFlow — AI 原生的工作流平台

> [English](README.md) | 中文

> 用自然语言生成工作流 → 可视化画布编辑 → 一键发布成 API。支持私有化部署、团队协作、中英双语。

**AI-Native Workflow Platform**: describe your process in plain language, get a runnable workflow on a visual canvas, then publish it as a secured HTTP API. Self-hosted, team-ready, i18n (中文 / English).

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
一键发布工作流为 HTTP 接口（API Key 鉴权 + 调用配额 + 调用日志），外部系统直接对接：

```bash
curl -X POST https://your-host/api/publish/{workflowId}/execute \
  -H "Authorization: Bearer ffk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"query": "..."}}'
```

### 🔗 工作流分享页
生成公开链接，对方无需登录即可查看流程节点、填写输入、试运行——演示/交付利器。

### 🏢 团队与权限
- 用户隔离（数据完全互相不可见，含 admin）
- 对话配额 / API 配额双重控制
- 审计日志（登录、操作全记录）

### 📊 管理后台
用户管理、用量统计（趋势图）、审计日志、API 调用日志。

### 🌐 国际化
中英双语一键切换（框架支持扩展任意语言）。

### 🔒 私有化部署
应用 + 数据 + 存储都可部署在自己服务器；数据库可切换自建 PostgreSQL（详见部署手册）。

---

## 🚀 快速开始

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
