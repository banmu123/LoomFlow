# LoomFlow — AI-Native Workflow Platform

> English | [中文](README.zh-CN.md)

Describe a process in plain language → get a runnable workflow on a visual canvas → publish it as a secured HTTP API. Self-hosted, team-ready, i18n.

---

## ✨ Highlights

### 💬 Natural Language → Workflow
No drag-and-drop required to start — just **describe your process in plain language**, and the AI generates an executable workflow directly onto the canvas:

> **You:** "帮我做一个流程：输入产品名，AI 生成卖点文案，再生成推广视频脚本"
>
> **AI:** ✅ Generated a 4-node workflow (Start → LLM 文案 → LLM 脚本 → End), loaded to canvas

Then fine-tune visually and publish as an API.

### 🎨 Visual Canvas
Tinyflow canvas editor: drag nodes, connect flows, configure parameters. 10 node types (LLM / HTTP / Code / Template / Loop / Human Confirm, etc.).

### 🚀 Workflow as API
One-click publish a workflow as an HTTP endpoint (API Key auth + call quota + call logs) for external systems:

```bash
curl -X POST https://your-host/api/publish/{workflowId}/execute \
  -H "Authorization: Bearer ffk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"query": "..."}}'
```

### 🔗 Shareable Workflow Pages
Generate a public link — recipients can view nodes, fill inputs, and run the workflow without signing in. Perfect for demos and delivery.

### 🏢 Team & Permissions
- Full data isolation (including admin)
- Chat quota + API quota control
- Audit logs for all critical operations

### 📊 Admin Dashboard
User management, usage statistics (trends), audit logs, API call logs.

### 🌐 Internationalization
Chinese/English one-click switch (framework supports any language).

### 🔒 Self-Hosted & Private
App, data, and storage can all be deployed on your own server. Database can be switched to self-hosted PostgreSQL (see Deployment Manual).

### 🧩 Extensible Node System
`NodeRegistry` + `NodeDefinition` — a single source of truth for nodes. Custom nodes can be registered with one entry, with automated validation (executor binding, start/end singleton).

### 🧠 Bring Your Own Model
Add **any model** (DeepSeek / Ark / any OpenAI-compatible endpoint) through the admin UI — **no code changes**:

- Per-model API key & base URL (overrides environment defaults)
- Declare capabilities (text / vision / ...) — vision models enable image input automatically
- Canvas & chat model lists sync instantly after adding

```text
Admin → Model Settings → Add Model
  id: qwen-vl-max · provider: openai-compatible
  base URL: https://... · api key: sk-...
  capabilities: [text, vision]  →  ✅ instantly available everywhere
```

---

## 🚀 Quick Start

### Requirements
- Node.js ≥ 20.9
- pnpm 9+
- A Supabase project (or self-hosted PostgreSQL, see Deployment Manual)

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment (copy .env.example to .env.local)
#    Required: COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY / AUTH_SECRET
cp .env.example .env.local

# 3. Initialize database (run in Supabase SQL Editor, in order)
#    scripts/supabase-init.sql → supabase-users.sql → supabase-updates.sql

# 4. Start dev server (default port 5000)
pnpm dev
```

Open http://localhost:5000 — default admin account `admin` (password set in `supabase-users.sql`).

### Production Deployment

Full deployment manual: **[docs/config/Deployment-Manual.md](docs/config/Deployment-Manual.md)**
(Server setup, Nginx + HTTPS, domain, one-click deploy script, server migration, self-hosted PostgreSQL migration)

## 📚 Documentation

- **[Architecture](docs/config/architecture.md)** — from natural language to executable API, end-to-end
- **[Security](docs/config/security.md)** — sandbox, auth, quotas, audit, isolation
- **[Custom Node Guide](docs/config/custom-node-guide.md)** — build your own nodes (developer platform)
- **[Deployment Manual](docs/config/Deployment-Manual.md)** — self-host, migrate, HTTPS

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui |
| Canvas | @tinyflow-ai/ui |
| AI | AI SDK v7 + DeepSeek (OpenAI-compatible, switchable to any model) |
| Database | Supabase (PostgreSQL) / self-hosted PostgreSQL |
| Storage | Aliyun OSS / S3-compatible |
| Deployment | pm2 + Nginx + one-click deploy script |

---

## 📁 Project Structure

```
src/
├── app/                  # Pages & API routes
│   ├── (main)/           # Main UI (chat + workflows + admin)
│   ├── share/            # Public workflow share pages
│   └── api/              # Backend APIs (auth / conversations / publish / admin / nodes)
├── components/           # UI components
├── lib/
│   ├── tinyflow/         # Workflow execution engine + NodeRegistry/NodeDefinition
│   ├── ai/               # Model Registry (providers / capabilities / models)
│   ├── workflow-ai/      # AI workflow generation prompts
│   └── i18n.tsx          # i18n framework
├── messages/             # zh/en translations
└── scripts/              # SQL init + deploy scripts
```

---

## 🧪 Testing & CI

- **Vitest** — 60 unit tests (engine, schema, sandbox, i18n, model registry, node registry)
- **GitHub Actions** — lint + typecheck + test + production build on every push (Node 20/22 matrix)

---

## 📄 License

[MIT](LICENSE)

## 🙏 Credits

- [Tinyflow](https://github.com/tinyflow-ai) — workflow canvas
- [AI SDK](https://ai-sdk.dev/) — LLM streaming
- [shadcn/ui](https://ui.shadcn.com) — UI components
