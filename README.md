# LoomFlow — AI 原生的工作流平台

> 用自然语言生成工作流 → 可视化画布编辑 → 一键发布成 API。支持私有化部署、团队协作、中英双语。

**AI-Native Workflow Platform**: describe your process in plain language, get a runnable workflow on a visual canvas, then publish it as a secured HTTP API. Self-hosted, team-ready, i18n (中文 / English).

---

## ✨ 功能亮点

### 🤖 AI 生成工作流
在对话中描述需求（"帮我做一个视频文案生成流程"），AI 直接生成可执行的工作流并加载到画布。

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

### 环境要求
- Node.js ≥ 20.9
- pnpm 9+
- Supabase 项目（或自建 PostgreSQL，见部署手册）

### 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（参考 .env.example 创建 .env.local）
#    COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY / AUTH_SECRET

# 3. 初始化数据库（Supabase SQL Editor 按顺序执行）
#    scripts/supabase-init.sql
#    scripts/supabase-users.sql
#    scripts/supabase-updates.sql

# 4. 启动开发服务器（默认端口 5000）
pnpm dev
```

打开 http://localhost:5000，默认管理员账号 `admin`（密码在 supabase-users.sql 中设置）。

### 生产部署

完整部署手册：**[docs/config/Deployment-Manual.md](docs/config/Deployment-Manual.md)**
（覆盖：服务器准备、Nginx + HTTPS、域名、一键部署脚本、换服务器迁移）

### 外部调用 API 文档

**[docs/api-external.md](docs/api-external.md)**

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
