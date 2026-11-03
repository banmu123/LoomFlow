# LoomFlow Security

> 安全设计说明：已实现的安全机制与边界。

## 1. 代码执行沙箱（Code Node）

`src/lib/sandbox/` + `services/code-sandbox/`（详见 [code-sandbox.md](code-sandbox.md)）

| 机制 | 实现 |
|------|------|
| 隔离 | 独立 Runner 容器 + `node --permission` 子进程；`node:vm` 只负责代码语义，**不作为安全边界** |
| 不可访问 | 文件系统（权限模型 + 容器只读）、`process` / `require` / 环境变量（子进程 `env: {}`） |
| 网络 | Runner 位于 `internal` 网络，无外网出口；Docker Socket 不挂载 |
| 资源限制 | 非 root、`cap_drop ALL`、pids/内存/CPU 限制、执行超时 5s（上限 10s） |
| 失败关闭 | 沙箱不可用直接报错，**不回退到 vm**；`LOOMFLOW_CODE_SANDBOX=vm` 仅限本地显式启用 |
| 错误处理 | 统一错误码（`timeout` / `sandbox_unavailable` / `execution_error`），不泄露内部信息 |

**边界**：容器隔离是纵深防御，不是"绝对安全"；共享内核、Node 权限模型的强度有限。面向不可信多租户应替换为 gVisor/Firecracker。残余风险见 [code-sandbox.md](code-sandbox.md) 第 8 节。

## 2. 认证与登录

| 机制 | 实现 |
|------|------|
| Token | JWT（HMAC-SHA256），存储于 **httpOnly Cookie**（JS 不可读，防 XSS 窃取） |
| 密钥 | `AUTH_SECRET`（生产必配，`openssl rand -hex 32`） |
| 登录锁定 | 连续 5 次失败锁 15 分钟（423），`failed_attempts` / `locked_until` |
| 密码策略 | ≥8 位且含字母数字（创建/修改/自助改密统一校验） |
| 自助改密 | 验证旧密码，改后强制重新登录 |
| 管理员解锁 | 管理界面一键解锁（备用账号场景） |

## 3. 权限模型

| 层 | 控制 |
|----|------|
| 角色 | `admin` / `user`（管理操作仅 admin：用户/模型/配额管理） |
| 数据隔离 | 所有用户数据带 `user_id`，**完全互相不可见（含 admin）** |
| 越权防护 | 访问他人资源返回 403（对话/工作流/消息/执行记录） |
| 未登录 | 数据接口一律 401 |

## 4. 限流策略

| 项 | 说明 |
|------|------|
| 对话 | 不限次数 |
| API 调用 | 不限次数（全局 API Key 只管理有效期，无调用次数限制） |
| 调用审计 | 外部调用记录均落库（`api_call_logs`） |

## 5. 审计日志

| 项 | 实现 |
|----|------|
| 记录操作 | 登录成功/失败/锁定、登出、用户增删改、模型增删改、工作流发布/删除、对话删除、外部 API 调用等 |
| 字段 | user / action / detail(JSONB) / IP / 时间 |
| 查看 | 管理后台审计页（按操作筛选），仅 admin |

## 6. API Key 管理

| 项 | 实现 |
|----|------|
| 全局 API Key | 每用户一个（`user_api_keys` 表，`ffk_` 前缀，256-bit 随机），可调用该用户所有已发布工作流 |
| Key 生命周期 | 首次发布自动生成、**只显示一次**（列表/查询接口不返回明文）；过期后可重新生成（旧 Key 立即失效） |
| 有效期 | `api_key_expires_days` / `api_key_expires_at`（0 = 永不过期），「API 管理」页配置 |
| 鉴权 | `Authorization: Bearer <key>` → 查用户 → 校验工作流已发布且属于该用户 |
| 模型 API Key | 每模型独立（模型级配置优先），**列表/响应接口不返回**（防泄露） |
| 审计 | 生成/重新生成/配置有效期均记录（不记录 Key 值） |

## 7. 数据存储

| 层 | 说明 |
|----|------|
| 密码 | bcrypt 哈希（pgcrypto `crypt`），任何位置不存明文 |
| SQL | 全部幂等，RLS 开启（宽松策略 + 应用层隔离兜底） |
| OSS | RAM 子账号最小权限（仅目标 bucket 读写），配置接口登录鉴权，bundle 无密钥 |
| 模型 Key | 存数据库（自托管可控），界面提示风险 |

## 8. 已知边界

| 边界 | 说明 |
|------|------|
| HTTPS | 生产建议 Nginx + certbot（部署手册第四章），当前默认 HTTP |
| 分享页 | 公开访问（token 256-bit 不可枚举），试运行消耗模型额度 |
| Code 沙箱 | 容器 + 权限模型；共享内核，不是 VM 级隔离（见 code-sandbox.md） |
| 登录接口 | 无独立限流（依赖失败锁定机制） |

## 9. 模型调用（Model Gateway）

| 项 | 实现 |
|----|------|
| 凭证 | 沿用 `ai_models.api_key` 加密存储；网关不写日志、不返回前端 |
| 自定义 baseURL | 仅 http/https；拒绝回环/私网/链路本地/云元数据（`169.254.169.254`）；DNS 解析后二次校验 |
| 本地模型例外 | `MODEL_ALLOW_PRIVATE_HOSTS`（默认 `ollama`）显式放行，其他 provider 不得指向内网 |
| 降级 | 429/5xx/超时切候选；401/403/404 立即停止，不无限重试 |
| 请求放大 | 每候选只调用一次；候选上限 3；熔断打开直接跳过 |
| 成本 | 价格来自配置；未配置标记 unknown，不编造金额 |

## 10. MCP 与 Agent

| 项 | 实现 |
|----|------|
| Server 地址 | SSRF 校验 + 可选域名白名单 `MCP_ALLOWED_HOSTS` |
| STDIO | 仅部署级配置（`MCP_STDIO_SERVERS_JSON`），命令必须命中 allowlist；普通用户无法创建 |
| 凭证 | HTTP Server 请求头加密存储，接口不返回 |
| 工具权限 | 白名单 + `read/write/dangerous` 等级；危险操作需 `approved` |
| Prompt Injection | 工具输出包裹 `<tool_output>` 边界、截断 8k 字符；系统提示词声明工具输出为数据 |
| 工具参数 | 拒绝 `__proto__`/`constructor`/`prototype`；必须是 JSON 对象 |
| Agent 预算 | 最大步数、Token、超时三重硬限制；超出即停止并返回状态 |
| 取消 | AbortSignal 贯通模型调用与工具调用 |
| 审计 | MCP Server 创建、Agent 工具调用均记录（不记录凭据与完整参数） |
