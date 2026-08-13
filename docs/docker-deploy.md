# LoomFlow Docker 部署指南

> 自托管一键部署：LoomFlow + PostgreSQL + PostgREST + Nginx 反代（数据完全自持）。

## 前置要求

- Docker Engine 20.10+ / Docker Desktop
- Docker Compose v2

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/banmu123/LoomFlow.git
cd LoomFlow

# 2. 配置环境
cp .env.example .env
#    必填项：
#    POSTGRES_PASSWORD=你的强密码
#    PGRST_JWT_SECRET=随机串（至少 32 字符，openssl rand -hex 32）
#    生成 service_role JWT 并填入 COZE_SUPABASE_SERVICE_ROLE_KEY：
#      node docker/generate-service-role-key.mjs $PGRST_JWT_SECRET
#    可选（按需）：DEEPSEEK_API_KEY / OSS_* / SEARCH_API_*

# 3. 启动（首次会自动初始化数据库：建表 + 默认 admin）
docker compose up -d
```

## 访问

| 地址 | 说明 |
|------|------|
| http://localhost:5000 | LoomFlow 应用（可用 `PORT=xxx` 改端口） |
| admin 账号 | `admin` / `123456`（⚠️ 首次登录后立即修改） |
| 首次使用 | 管理后台 → 模型配置 → **添加模型**（如 deepseek-v4-flash + 你的 API Key），否则对话/LLM 节点会提示先配置模型 |

## 常用命令

```bash
docker compose logs -f loomflow   # 应用日志
docker compose logs -f postgres   # 数据库日志
docker compose ps                 # 服务状态
docker compose down               # 停止（保留数据）
docker compose down -v            # 停止并删除数据（⚠️ 重置数据库）
docker compose up -d --build      # 更新代码后重新构建
```

## 架构

```
┌─────────────────────────────────────────┐
│ loomflow（:5000）                        │
│   └─ COZE_SUPABASE_URL=http://nginx:80  │
│              ↓ /rest/v1                 │
│ nginx（反代，supabase-js 兼容）           │
│              ↓                          │
│ postgrest（REST 层）                     │
│              ↓                          │
│ postgres:16（数据卷 loomflow-pgdata）    │
│   └─ initdb 自动执行 5 个 SQL（首次）      │
└─────────────────────────────────────────┘
```

## 数据持久化

- PostgreSQL 数据存储在命名卷 `loomflow-pgdata`，`docker compose down` 不丢失
- 删除数据：`docker compose down -v`（⚠️ 不可恢复）
- 备份：`docker exec loomflow-postgres pg_dump -U postgres loomflow > backup.sql`

## 数据库初始化（自动）

首次启动 postgres 容器时自动按顺序执行：

```
00-extensions.sql（pgcrypto + anon/service_role 角色）
10-init.sql（基础表）
20-users.sql（用户表 + 默认 admin）
30-updates.sql（全部增量表/列/索引）
35-apikeys.sql（全局 API Key 表 + 存量 Key 迁移，可重复执行）
40-grants.sql（PostgREST 角色授权）
```

初始化只在数据卷为空时执行；已有数据卷不会重复执行。

## 默认账号

- 用户名：`admin`
- 默认密码：`123456`
- ⚠️ **首次登录后请立即修改密码**（应用内：对话面板 → 修改密码）

## 升级

```bash
git pull
# 已有数据卷不会自动执行 initdb 脚本——新版本若新增表，需手动执行迁移 SQL：
#   （示例：v0.2 全局 API Key 表）
docker exec -i loomflow-postgres psql -U postgres -d loomflow < scripts/supabase-apikeys.sql
docker compose up -d --build
```

## 常见问题

| 问题 | 解决 |
|------|------|
| 端口 5000 被占用 | `.env` 设 `PORT=5001` 等 |
| 应用健康检查失败 | `docker compose ps` 看各服务状态；`docker compose logs loomflow` |
| 登录失败 | 确认数据库初始化完成（postgres 日志无 ERROR） |
| 修改了 SQL 脚本不生效 | `docker compose down -v` 后重新 up（会清空数据） |
| 升级后 API 接口报错（表不存在） | 按「升级」章节执行对应的迁移 SQL（如 `supabase-apikeys.sql`） |
