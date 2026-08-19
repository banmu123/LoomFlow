# LoomFlow 部署手册

> LoomFlow 自托管部署指南：从服务器准备、Nginx/HTTPS 到数据库迁移。
> `{占位符}` 为每台服务器不同的变量，见符号约定。

---

## 架构概览（当前技术栈）

```
浏览器 / 外部系统
      │
      ▼
Nginx（可选，80/443）──▶ Docker 应用容器（loomflow-app，端口 5000）
                              │
                              ▼
                    PostgreSQL（Docker 容器，PostgREST 数据层）
```

- **部署方式**：Docker Compose（唯一方式）——应用/PostgreSQL/PostgREST/Nginx/migration 全容器化
- **数据**：PostgreSQL 数据卷持久化（`loomflow-pgdata`）
- **外部调用**：已发布工作流通过 API Key 对外提供 HTTP 接口（`docs/api-external.md`）

---

## English Summary

**LoomFlow** is a self-hosted, AI-native workflow platform. Describe a process in plain language, get a runnable workflow on a visual canvas, then publish it as a secured HTTP API.

### Quick Start (Self-Host)

```bash
# Requirements: Node.js >= 20.9, pnpm 9+, a Supabase project (or self-hosted PostgreSQL)

# 1. Install dependencies
pnpm install

# 2. Configure environment (copy .env.example to .env.local)
#    Required: COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY / AUTH_SECRET
cp .env.example .env.local

# 3. Initialize database (run in Supabase SQL Editor, in order):
#    scripts/supabase-init.sql → supabase-users.sql → supabase-updates.sql

# 4. Build & start (production)
# Docker Compose 一键部署（推荐，自动初始化数据库 + 启动全部容器）
docker compose up -d --build
```

### Documentation Map

| Section | Topic |
|---------|-------|
| 1-3 | Server preparation, code upload, Docker deployment & operations |
| 4 | Nginx reverse proxy, domain, HTTPS (certbot) — **must disable buffering for SSE** |
| 5 | Deployment updates (one-click script `scripts/deploy-docker.sh`) |
| 6 | **Server migration** — copy `.env.local` (keep `AUTH_SECRET`!), database needs no action |
| 7-9 | App-specific config: Supabase SQL init, environment variables, build commands |
| 10 | Publish workflows as external HTTP APIs (API Key auth) |
| 11 | **Database migration** to self-hosted PostgreSQL (Docker self-hosted Supabase, zero code changes) |
| Appendix A | Tech-stack replacement reference table |

### Key Notes

- **AUTH_SECRET** (required in production): `openssl rand -hex 32` — keep it identical when migrating servers, or all login sessions will be invalidated
- **SSE streaming**: Nginx must set `proxy_buffering off` for `/api/`, otherwise AI chat replies are delayed as whole blocks
- **Data isolation**: all user data is fully isolated (including admin); no migration needed when switching servers (data lives in Supabase cloud / your database)
- **AI models**: configurable via Admin → Model settings (per-model API key & base URL, model-level config overrides environment variables)
- **ICP filing** (China mainland servers): domains must be filed before serving on ports 80/443

---

## 符号约定

| 变量 | 含义 | 当前值参考 |
|------|------|-----------|
| `{SERVER_USER}` | SSH 登录用户 | `ubuntu` |
| `{SERVER_IP}` | 服务器公网 IP | `your-server-ip` |
| `{APP_DIR}` | 应用部署目录 | `/opt/loomflow` |
| `{PORT}` | 应用端口 | `5000` |
| `{DOMAIN}` | 域名 | `your-domain.com` |

---

# 第一部分：部署流程

## 一、服务器准备

### 1.1 系统要求

| 项目 | 要求 |
|------|------|
| 系统 | Ubuntu 20.04+ / Debian 11+ |
| Node.js | ≥ 20.9（当前项目要求，其他技术按需） |
| pnpm / docker | 按需安装（Docker 为唯一部署方式） |
| 内存 | ≥ 1GB（推荐 2GB） |

### 1.2 安装基础环境

```bash
# Docker（唯一部署方式，应用/数据库/反代全容器化）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 当前用户免 sudo 执行 docker（重新登录生效）

# pnpm（本地构建/开发用；服务器上如需构建也需安装）
npm install -g pnpm
```

> ⚠️ Docker 部署不依赖 nvm/Node 版本管理——构建在容器内完成（node:20-slim）。
> 一键部署脚本（`scripts/deploy-docker.sh`）本地执行，自动同步代码 + 构建 + 重启。

### 1.3 防火墙放行端口

云厂商控制台安全组/防火墙放行：

| 端口 | 用途 |
|------|------|
| `{PORT}`（如 5000） | 应用直连访问（无域名方案） |
| `80` / `443` | 域名 + HTTPS 方案 |

---

## 二、代码上传

### 方式 A：打包上传（无需 Git 托管）

Mac 本地（在项目目录）：

```bash
tar -czf /tmp/app-deploy.tar.gz \
  --exclude='node_modules' --exclude='.next' --exclude='dist' \
  --exclude='.env.local' --exclude='.env' --exclude='tsconfig.tsbuildinfo' .

scp /tmp/app-deploy.tar.gz {SERVER_USER}@{SERVER_IP}:/tmp/
```

服务器：

```bash
sudo mkdir -p {APP_DIR}
sudo tar -xzf /tmp/app-deploy.tar.gz -C {APP_DIR}
sudo chown -R $(whoami):$(whoami) {APP_DIR}
```

### 方式 B：Git

```bash
git clone {仓库地址} {APP_DIR}
```

---

## 三、Docker 部署与运维（唯一方式）

> 部署流程：首次 `docker compose up -d`（自动初始化数据库）；更新用一键脚本 `scripts/deploy-docker.sh`（本地执行）。

```bash
# 首次部署（服务器上，仓库根目录）
cd {APP_DIR}
cp .env.example .env        # 填 POSTGRES_PASSWORD / PGRST_JWT_SECRET，生成 SERVICE_ROLE_KEY
docker compose up -d        # 自动：初始化数据库（含默认 admin）+ 启动全部容器

# 更新部署（本地执行，自动同步代码 + 迁移 + 权限自检 + 构建 + 健康验证）
SERVER_IP={SERVER_IP} ./scripts/deploy-docker.sh
```

常用运维命令：

```bash
docker compose logs -f loomflow     # 应用日志
docker compose ps                   # 容器状态
docker compose restart loomflow     # 重启应用
docker compose down                 # 停止（数据保留在卷中）
docker compose down -v              # 停止并删除数据卷（⚠️ 清空数据库）
docker exec -it loomflow-postgres psql -U postgres -d loomflow   # 进入数据库
```

> 部署时自动执行：SQL 迁移（幂等，migration 容器）→ 权限自检（`scripts/check-grants.sh`）→ 重建镜像 → 健康验证。

---

## 四、Nginx + 域名配置（完整流程）

> 先 IP + 端口访问（无需 Nginx），后配域名 HTTPS。以下是从头到尾的完整步骤。

### 4.1 安装 Nginx

```bash
sudo apt-get update && sudo apt-get install -y nginx
```

### 4.2 反代配置（通用模板，SSE 必须关缓冲）

创建 `/etc/nginx/sites-available/loomflow`：

```nginx
server {
    listen 80;
    server_name {DOMAIN};          # 有域名填域名；无域名填 _（IP 访问）

    # API 全部走反代，SSE 流式必须关缓冲，否则 AI 回复整段延迟出现
    location /api/ {
        proxy_pass http://127.0.0.1:{PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;              # ← SSE 关键
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # 其余请求
    location / {
        proxy_pass http://127.0.0.1:{PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启用并测试：

```bash
sudo ln -s /etc/nginx/sites-available/loomflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default      # 移除默认站点（可选）
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 添加域名的完整流程（从 IP 方案切换）

假设当前用 `http://{SERVER_IP}:{PORT}` 直连，现在要上域名：

**① DNS 解析**（域名注册商控制台）

| 主机记录 | 记录类型 | 记录值 |
|---------|---------|--------|
| `www` | A | `{SERVER_IP}` |
| `@`（根域名，可选） | A | `{SERVER_IP}` |

等待生效（几分钟到几十分钟），验证：

```bash
ping {DOMAIN}        # 返回 {SERVER_IP} 即生效
```

**② 确认端口放行**：安全组放行 80 / 443

**③ Nginx 配置**：按 4.2 模板，`server_name` 填 `{DOMAIN}`，启用配置

**④ 浏览器验证**：访问 `http://{DOMAIN}` 能打开应用（此时是 HTTP）

**⑤ 签发 HTTPS 证书**：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d {DOMAIN} -d www.{DOMAIN}
```

按提示填邮箱 → 同意条款 → 自动申请证书并改写 Nginx 配置（HTTPS 自动生效）

**⑥ 验证 + 自动续期**：

```bash
sudo certbot renew --dry-run        # 测试续期（证书 90 天，certbot 定时任务自动续）
curl -sI https://{DOMAIN}/login     # 返回 200 即成功
```

**⑦ 后续：旧访问方式可保留可关闭**

- `http://{SERVER_IP}:{PORT}` 直连仍可用（端口放行着）
- 想关闭直连：安全组移除 5000 端口放行（可选，更安全）

> ⚠️ **备案提醒（国内服务器）**：域名解析到国内服务器必须 ICP 备案，否则 80/443 会被运营商拦截（显示备案提示页）。未备案时：
> - 用 IP + 端口方案（无备案要求）
> - 或域名解析到海外服务器（绕开备案）
> - 或去备案（约 1-2 周）

### 4.4 换域名/续期

```bash
# 换域名：改 Nginx server_name → 重新 certbot --nginx -d 新域名 → 旧证书删掉
sudo rm -f /etc/letsencrypt/live/旧域名 -r   # 视情况清理

# 手动续期
sudo certbot renew
```

---

## 五、更新部署

### 方式一：一键脚本（推荐）

`scripts/deploy-docker.sh`（Mac 本地执行）。脚本顶部通过环境变量指定服务器：

```bash
SERVER_USER=ubuntu SERVER_IP="{SERVER_IP}" APP_DIR="{APP_DIR}" ./scripts/deploy-docker.sh
```

使用（需先配置 SSH 免密，一次性）：

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519   # 如已有密钥则跳过
ssh-copy-id {SERVER_USER}@{SERVER_IP}              # 输入一次密码

SERVER_IP={SERVER_IP} ./scripts/deploy-docker.sh
# 自动：同步代码 → 数据库迁移 → 权限自检 → 构建镜像 → 健康验证
```

### 方式二：手动

```bash
# Mac 本地打包上传（命令同第二章）
# 服务器：
cd {APP_DIR} && tar -xzf /tmp/app-deploy.tar.gz --overwrite
docker compose up -d --build
```

---

## 六、迁移 / 换服务器流程（通用框架）

| 步骤 | 操作 | 备注 |
|------|------|------|
| 1 | 新服务器装环境（第一章） | |
| 2 | 复制 `.env.local` 到新服务器 | **直接复制旧服务器的**，见下方注意事项 ⚠️ |
| 3 | 上传代码（第二章） | |
| 4 | 构建 + 启动（第三章） | |
| 5 | 验证（curl / 浏览器） | |
| 6 | DNS 解析切到新 IP（4.3 ①） | 域名方案 |
| 7 | 数据源处理 | **数据在云端（Supabase）→ 无需迁移**；数据在服务器本地 → 需备份迁移 |
| 8 | 旧服务器停用 | 确认新环境稳定后 |

### ⚠️ 换服务器注意事项（最容易踩的坑）

1. **`.env.local` 直接复制，不要重新生成**
   尤其 `AUTH_SECRET` 必须与旧服务器一致——换了它，所有已登录用户的 token 全部失效，需要重新登录。直接 `scp` 旧服务器的 `.env.local` 过来即可。

2. **数据库不用做任何事**
   数据在 PostgreSQL 数据卷（Docker），随服务器迁移时需**同步数据卷**（见下方提示）；全新部署则自动初始化。

3. **一键脚本环境变量指向新服务器**
   ```bash
   SERVER_USER=ubuntu SERVER_IP="新IP" APP_DIR="/opt/loomflow" ./scripts/deploy-docker.sh
   ```
   Mac 的 SSH 密钥**不用重新生成**，直接对新服务器执行 `ssh-copy-id {新用户}@{新IP}` 即可。

4. **域名 + HTTPS：DNS 换 IP + 证书在新服务器重新签发**
   - DNS 解析改到新 IP，等待生效（几分钟到几十分钟）
   - **证书绑定域名不绑定服务器**：新服务器上重新执行 `sudo certbot --nginx -d {DOMAIN}` 签发即可（旧服务器的证书删不删随意，不影响）
   - 切换期间旧服务器可继续服务（DNS 生效前流量仍走旧服务器），实现平滑迁移

5. **Docker 开机自启**
   compose 中已配置 `restart: unless-stopped`，新服务器 `docker compose up -d` 后无需额外配置。

> 检查清单：Docker 环境、.env 完整（含密钥）、容器全部 healthy、防火墙、DNS、数据源连通性。

---

# 第二层：本应用配置（LoomFlow / Next.js / Supabase）

> 换技术栈时，**本章整层替换**，第一层不动。替换对照见附录 A。

## 七、数据库初始化（Supabase 版）

Supabase 控制台 → SQL Editor，**按顺序**执行项目 `scripts/` 下三个脚本：

| 顺序 | 脚本 | 内容 |
|------|------|------|
| 1 | `scripts/supabase-init.sql` | 基础表（conversations / messages / workflow_history）+ 触发器 + RLS |
| 2 | `scripts/supabase-users.sql` | 用户表 + 初始 admin（密码在脚本中修改后执行） |
| 3 | `scripts/supabase-updates.sql` | 增量：数据隔离 user_id、配额字段、工作流去重索引、发布字段（幂等，可重复执行） |

> 旧环境升级只需执行第 3 个脚本。换服务器无需重建库（数据在云端）。

## 八、环境变量（.env.local）

```bash
# 数据库（Supabase 项目 → Settings → API）
COZE_SUPABASE_URL={SUPABASE_PROJECT}
COZE_SUPABASE_SERVICE_ROLE_KEY=eyJ...（service_role key）

# AI 模型（DeepSeek 官方）
DEEPSEEK_API_KEY=sk-...

# 认证密钥（生产必填，随机生成；⚠️ 换服务器时保持与旧服务器一致，否则登录态全部失效）
AUTH_SECRET=$(openssl rand -hex 32)

# 可选：OSS 上传、Coze 等，按需添加
```

> `.env.local` 不会被部署脚本覆盖，更新代码时保持不变。
> ⚠️ 换服务器时**直接复制旧服务器的 `.env.local`**（见第六章注意事项），不要重新生成。

## 九、构建与启动命令（Next.js 版）

```bash
cd {APP_DIR}
docker compose up -d --build
```

验证：

```bash
curl -s http://localhost:{PORT}/login        # 返回 HTML 即成功
curl -s http://localhost:{PORT}/api/auth/me  # {"authenticated":false} 正常
```

## 十、外部调用 API（发布工作流）

详见 `docs/api-external.md`。已发布工作流通过 `Authorization: Bearer <API Key>` 对外提供：

```
POST /api/publish/{workflowId}/execute      # 执行（同步/异步）
GET  /api/publish/{workflowId}/status/{flowId}
POST /api/publish/{workflowId}/confirm/{flowId}
```

---

## 十.五、搜索引擎节点配置

搜索节点（searchEngineNode）通过可配置的 HTTP 端点执行搜索，不再依赖特定 SDK。

### 环境变量

```bash
SEARCH_API_URL=https://your-search-endpoint/search
SEARCH_API_KEY=your_api_key_optional
```

### 请求格式（LoomFlow → 搜索端点）

```json
POST {SEARCH_API_URL}
Authorization: Bearer {SEARCH_API_KEY}
Content-Type: application/json

{ "query": "搜索关键词", "limit": 5 }
```

### 响应格式（搜索端点 → LoomFlow）

```json
{
  "results": [
    { "title": "...", "url": "...", "snippet": "..." }
  ]
}
```

> `results` 为数组；也兼容直接返回数组的格式。未配置 `SEARCH_API_URL` 时，节点执行会明确报错提示配置。

## 十一、自建 PostgreSQL 迁移指南

> 目标：把数据库从 Supabase 云迁移到**自己服务器上的 PostgreSQL**（数据完全自持）。

### 11.1 先了解：三条路径

| 方案 | 做法 | 代码改动 | 适合 |
|------|------|---------|------|
| **A. Docker 自托管 Supabase**（推荐） | 服务器跑官方自托管栈（Postgres + PostgREST + Studio） | **零改动** | 想数据自持、又要兼容现架构 |
| **B. 数据访问兼容层** | 用 pg 驱动重写数据访问层 | 大 | 彻底去掉 Supabase 依赖（后续工程） |
| **C. 纯 SQL 不可行** | supabase-js 是 PostgREST 协议，不能直连裸 PG | — | 仅 SQL 可复用 |

> 本项目所有 SQL 脚本（`scripts/*.sql`）均为标准 PostgreSQL 语法（UUID/JSONB/RLS），**在自建 PG 上可直接执行**。

### 11.2 方案 A：Docker 自托管 Supabase（推荐）

**① 前置**：服务器安装 Docker + Docker Compose

```bash
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

**② 获取自托管配置**（Supabase 官方维护）

```bash
git clone --depth 1 https://github.com/supabase/supabase ~/supabase-selfhosted
cd ~/supabase-selfhosted/docker
cp .env.example .env
# 编辑 .env：设置 POSTGRES_PASSWORD、ANON_KEY、SERVICE_ROLE_KEY 等（生成强随机值）
```

**③ 启动**

```bash
docker compose up -d
# 等待就绪（首次拉镜像约 5-10 分钟）
docker compose ps        # 全部 running 即成功
```

**④ 数据迁移（从 Supabase 云导出 → 导入自托管）**

```bash
# 4.1 导出云端数据（Supabase 项目 → Settings → Database → Connection string）
pg_dump "postgresql://postgres.xxx:密码@aws-0-xxx.pooler.supabase.com:6543/postgres" \
  --data-only --exclude-table=users > /tmp/supabase-data.sql

# 4.2 在自托管环境执行项目初始化 SQL（新建库时）
psql "postgresql://postgres:密码@localhost:5432/postgres" \
  -f /path/to/scripts/supabase-init.sql
psql ... -f /path/to/scripts/supabase-users.sql   # 先改脚本里的初始密码
psql ... -f /path/to/scripts/supabase-updates.sql

# 4.3 导入数据（跳过 users 表——密码哈希随初始化脚本创建）
psql "postgresql://postgres:密码@localhost:5432/postgres" < /tmp/supabase-data.sql
```

> ⚠️ 数据迁移建议先小库演练；`--exclude-table=users` 是因为 admin 密码在初始化脚本创建，避免冲突。

**⑤ 切换应用指向自托管**

修改 `.env.local`：

```bash
COZE_SUPABASE_URL=http://localhost:8000        # 自托管 API 网关地址（Kong）
COZE_SUPABASE_SERVICE_ROLE_KEY=你的SERVICE_ROLE_KEY
```

重启应用：

```bash
docker compose restart loomflow
```

**⑥ 验证**：登录、对话、工作流列表、执行历史均正常；数据可在自托管 Studio 查看。

> 自托管栈端口：Kong API 网关 8000、Studio 3000、Postgres 5432。生产请用 Nginx 反代 + HTTPS。

### 11.3 方案 B：数据访问兼容层（后续工程）

保持所有业务代码不变，替换 `src/lib/supabase/server.ts` 为 pg 驱动实现相同的链式 API（`from().select().eq().order().insert().update().delete()`）。改动面大（几十处调用），列为后续工程。

### 11.4 迁移检查清单

- [ ] Docker + Compose 就绪、自托管栈启动成功
- [ ] 初始化 SQL 在自托管库执行成功（3 个脚本）
- [ ] 数据导入完成（pg_dump 演练过）
- [ ] `.env.local` 指向自托管地址（URL + SERVICE_ROLE_KEY）
- [ ] 应用重启后全功能验证
- [ ] 旧 Supabase 云项目数据备份保留（迁移后确认无误再停）

---

# 附录

## A：技术栈替换对照表

| 替换项 | 第一层（通用） | 第二层要动的 | 具体操作 |
|--------|:---:|------|------|
| Supabase → 自建 PostgreSQL | ✅ 不动 | 第七章 + 第八章 | 建库建表（迁移 SQL）；`COZE_SUPABASE_*` → `DATABASE_URL` + 连接池 |
| Supabase → MySQL | ✅ 不动 | 第七章 + 第八章 | SQL 语法重写（UUID/JSONB/RLS 均为 PG 特性）；驱动换成 mysql 客户端 |
| Supabase → 其他 BaaS | ✅ 不动 | 第七章 + 第八章 | 用其 SDK/管理台建表；改客户端初始化代码 |
| 数据库迁移 | ✅ 不动 | 第六章步骤 7 | 数据在云端则无需迁移；自建库需 dump/restore |
| Next.js → 其他后端框架 | ✅ 不动 | 第九章 + 第十章 | 构建/启动命令换框架；API 路由换框架语法（外部 API 契约保持不变最好） |
| Supabase → **Docker 自托管 Supabase** | ✅ 不动 | 第八章 | 见「十一、自建 PostgreSQL 迁移指南」（代码零改动） |
| 自托管 → 托管平台（Vercel/Railway 等） | 第五章跳过 | 整个第二层 | 平台对接仓库自动部署；环境变量在平台面板配置；无服务器概念 |
| Node 版本/包管理器 | 第一章微调 | — | 按框架要求 |

## B：故障排查

| 症状 | 排查 |
|------|------|
| 登录 500「Supabase 配置缺失」 | .env.local 的 COZE_SUPABASE_URL / SERVICE_ROLE_KEY 未配置或错误 |
| 对话保存失败 | 确认 SQL 已执行（user_id 列存在） |
| AI 回复不流式（整段延迟出现） | Nginx 的 `/api/` 未关 `proxy_buffering off` |
| 保存工作流报 ON CONFLICT 错误 | 未执行 supabase-updates.sql（user_id+data_hash 联合唯一索引缺失） |
| 构建失败 | Node 版本 ≥20.9；pnpm install 完整执行 |
| 域名访问显示备案提示 | 域名未备案（国内服务器），见 4.3 备案提醒 |
| 域名解析不生效 | ping 确认；检查 DNS 记录类型（A 记录）和生效时间 |

## C：当前服务器参数

| 项 | 值 |
|----|-----|
| 服务器 | 腾讯云轻量（Ubuntu） |
| SSH | `{SERVER_USER}@{SERVER_IP}` |
| 应用目录 | `/opt/loomflow` |
| 端口 | 5000（直连）/ 80（Nginx 待配域名） |
| 域名 | 未接入 |
| 数据库 | Supabase（自己的项目） |
