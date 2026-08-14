# LoomFlow Roadmap

> 让每个人都能创建自己的 AI 自动化流程。

## ✅ v0.1.x — Foundation & Self-hosted Platform（Current）

**Goal**: A runnable, deployable, extensible AI workflow platform.

**Done:**

- ✅ Visual workflow canvas (Tinyflow-based, 10 node types)
- ✅ Workflow creation, execution, version history (save updates in place, view/restore versions)
- ✅ AI-assisted workflow generation (natural language → runnable workflow, auto-validation & repair)
- ✅ Workflow templates (product copy / video script / weekly report / translator)
- ✅ HTTP API publishing — publish a chosen version, one global API key per user, call logs
- ✅ Model provider integration (bring-your-own-model, any OpenAI-compatible endpoint)
- ✅ Knowledge base (per-user, database or OSS storage, searchable by the Knowledge node)
- ✅ AI chat assistant — queries system state, troubleshoots failures, navigates you to the right page
- ✅ i18n (English / Chinese)
- ✅ Docker-based self-hosted deployment (PostgreSQL + PostgREST + Nginx + App, one command)

**Focus of this phase**: prove LoomFlow is a truly runnable platform.

## 🚧 v0.2 — Workflow Experience & Observability（Next）

**Goal**: Better workflow debugging, management and runtime visibility.

**Planned:**

- [x] Workflow execution history — run records, status, inputs/outputs, errors *(done)*
- [ ] **Node-level execution trace** — per-node duration and status in the run timeline:

  ```
  Workflow Run
  Node A ✓ 200ms
  Node B ✓ 1.5s
  Node C ❌ Error
  ```
- [ ] **Workflow debug assistant** — AI helps analyze:
  - Why a run failed
  - Which node is the performance bottleneck
  - How to optimize

> Note: a first version of the debug assistant already exists in the AI chat (troubleshooting tools); v0.2 deepens it into run-level traces and optimization suggestions.

## 🚧 v0.3 — AI Workflow Copilot

**Goal**: AI participates in the whole workflow lifecycle, not just generation.

**Planned:**

- [ ] **Natural language editing** — e.g. *"Add a content moderation node"* → automatically modifies the workflow
- [ ] **Workflow optimization** — AI analyzes:
  - Execution efficiency
  - Token usage
  - Cost
  - Node structure
- [ ] **Workflow explanation** — *"Explain how this workflow works"* → AI generates a description automatically

> Note: natural-language generation and a system-aware chat assistant are already in place; this phase extends AI to editing, optimization and explanation of existing workflows.

## 🏢 v0.4 — Team & Enterprise Features

**Goal**: Team and enterprise internal AI automation.

**Planned:**

- **Workspace** — organization hierarchy:

  ```
  Company
  ├── Marketing
  ├── Sales
  ├── Customer Service
  └── R&D
  ```
- **Access control** — roles: Admin / Editor / Viewer
- **Secrets management** — API keys, environment variables, credentials

## 🌱 v0.5 — Ecosystem & Extensions

**Goal**: A scalable AI workflow ecosystem.

**Planned:**

- **Custom nodes** — developers can create and publish their own nodes (NodeRegistry already supports custom registration)
- **Workflow templates** — sharing: AI Agent / RAG / Data Processing / Automation
- **Plugin system** — third-party extensions

---

*Feedback and contributions welcome — open an issue or PR.*
