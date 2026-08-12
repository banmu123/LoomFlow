# ForgeFlow 部署手册

> 分两层：**第一层通用部署流程**（与数据库/后端技术栈无关，换任何技术都能用）；
> **第二层本应用配置**（当前为 Next.js + Supabase，换技术栈时替换这一层，见附录 A）。
> `{占位符}` 为每台服务器不同的变量，见符号约定。

---

## 架构概览（当前技术栈）

```
浏览器 / 外部系统
      │
      ▼
Nginx（可选，80/443）──▶ Node 应用（dist/server.js，pm2 守护，端口 5000）
                              │
                              ▼
                    Supabase 云端数据库（数据不落在服务器）
```

- **服务器**：只跑应用代码（Node 进程）
- **数据**：在 Supabase 云端 → 换服务器/换数据库时分别处理（见第六章/附录 A）
- **外部调用**：已发布工作流通过 API Key 对外提供 HTTP 接口（`docs/api-external.md`）

## 符号约定

| 变量 | 含义 | 当前值参考 |
|------|------|-----------|
| `{SERVER_USER}` | SSH 登录用户 | `ubuntu` |
| `{SERVER_IP}` | 服务器公网 IP | `your-server-ip` |
| `{APP_DIR}` | 应用部署目录 | `/opt/forgeflow` |
| `{PORT}` | 应用端口 | `5000` |
| `{DOMAIN}` | 域名 | `your-domain.com` |

---

# 第一层：通用部署流程（与任何技术栈无关）

## 一、服务器准备

### 1.1 系统要求

| 项目 | 要求 |
|------|------|
| 系统 | Ubuntu 20.04+ / Debian 11+ |
| Node.js | ≥ 20.9（当前项目要求，其他技术按需） |
| pnpm / pm2 | 按需安装 |
| 内存 | ≥ 1GB（推荐 2GB） |

### 1.2 安装基础环境

```bash
# Node.js 20 LTS（推荐 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20

# pnpm / pm2
npm install -g pnpm pm2
```

> ⚠️ nvm 多版本时，非交互 SSH 会话找不到 pnpm/pm2（PATH 问题）。
> 一键部署脚本已内置处理；手动操作时先执行：
> ```bash
> for d in ~/.nvm/versions/node/*/bin; do export PATH="$d:$PATH"; done
> ```

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

## 三、进程管理（pm2）

```bash
# 启动（按应用实际命令，如 node dist/server.js）
cd {APP_DIR}
PORT={PORT} pm2 start dist/server.js --name app-name
pm2 save                 # 保存进程列表
pm2 startup              # 按提示执行输出的命令，实现开机自启
```

常用命令：

```bash
pm2 status                       # 状态
pm2 logs app-name --lines 30     # 日志
pm2 restart app-name             # 重启
pm2 delete app-name              # 删除进程
```

---

## 四、Nginx + 域名配置（完整流程）

> 先 IP + 端口访问（无需 Nginx），后配域名 HTTPS。以下是从头到尾的完整步骤。

### 4.1 安装 Nginx

```bash
sudo apt-get update && sudo apt-get install -y nginx
```

### 4.2 反代配置（通用模板，SSE 必须关缓冲）

创建 `/etc/nginx/sites-available/forgeflow`：

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
sudo ln -s /etc/nginx/sites-available/forgeflow /etc/nginx/sites-enabled/
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

项目根目录 `deploy.sh`（Mac 本地执行）。换服务器时修改脚本顶部配置区：

```bash
SERVER_USER="{SERVER_USER}"
SERVER_IP="{SERVER_IP}"
APP_DIR="{APP_DIR}"
```

使用（需先配置 SSH 免密，一次性）：

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519   # 如已有密钥则跳过
ssh-copy-id {SERVER_USER}@{SERVER_IP}              # 输入一次密码

chmod +x deploy.sh    # 只需一次
./deploy.sh           # 打包 → 上传 → 构建 → 重启，1-2 分钟
```

### 方式二：手动

```bash
# Mac 本地打包上传（命令同第二章）
# 服务器：
cd {APP_DIR} && tar -xzf /tmp/app-deploy.tar.gz --overwrite
pnpm install --prefer-frozen-lockfile
pnpm build
pm2 restart app-name
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
   表和数据都在 Supabase 云端，三个 SQL 脚本**只有全新数据库才需要执行**。换服务器 ≠ 新数据库。

3. **`deploy.sh` 修改三个配置项**
   ```bash
   SERVER_USER="新用户"
   SERVER_IP="新IP"
   APP_DIR="新目录"
   ```
   Mac 的 SSH 密钥**不用重新生成**，直接对新服务器执行 `ssh-copy-id {新用户}@{新IP}` 即可。

4. **域名 + HTTPS：DNS 换 IP + 证书在新服务器重新签发**
   - DNS 解析改到新 IP，等待生效（几分钟到几十分钟）
   - **证书绑定域名不绑定服务器**：新服务器上重新执行 `sudo certbot --nginx -d {DOMAIN}` 签发即可（旧服务器的证书删不删随意，不影响）
   - 切换期间旧服务器可继续服务（DNS 生效前流量仍走旧服务器），实现平滑迁移

5. **pm2 开机自启要重新配置**
   ```bash
   pm2 save && pm2 startup
   ```
   新服务器上必须重新执行，否则重启后应用不会自动起来。

> 检查清单：Node 版本、.env.local 完整（含密钥）、pm2 开机自启、防火墙、DNS、数据源连通性。

---

# 第二层：本应用配置（ForgeFlow / Next.js / Supabase）

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
pnpm install --prefer-frozen-lockfile
pnpm build          # = next build + tsup 打包 server.ts → dist/server.js

COZE_PROJECT_ENV=PROD PORT={PORT} pm2 start dist/server.js --name forgeflow
pm2 save
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
pm2 restart forgeflow --update-env
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
| 应用目录 | `/opt/forgeflow` |
| 端口 | 5000（直连）/ 80（Nginx 待配域名） |
| 域名 | 未接入 |
| 数据库 | Supabase（自己的项目） |
