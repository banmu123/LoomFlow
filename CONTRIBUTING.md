# Contributing to LoomFlow

感谢你愿意为 LoomFlow 贡献代码！本指南帮助你在开发、测试、提 PR 时保持一致，避免返工。

## 开发环境

| 依赖 | 版本要求 |
|------|---------|
| Node.js | ≥ 20.9 |
| pnpm | ≥ 9.0（**仅允许 pnpm**，禁用 npm/yarn） |
| 数据库 | Supabase 项目（或 Docker 自托管 PostgreSQL + PostgREST） |

```bash
git clone <repo>
cd LoomFlow
pnpm install
cp .env.example .env.local   # 填入 COZE_SUPABASE_URL / COZE_SUPABASE_SERVICE_ROLE_KEY / DEEPSEEK_API_KEY / AUTH_SECRET
pnpm dev
```

## 目录结构速览

```
src/
├── app/          # 页面路由 + API routes（(main) 主界面 / share 分享页 / api 后端）
├── components/   # UI 组件（shadcn/ui 风格；画布组件 tinyflow-wrapper）
├── lib/
│   ├── tinyflow/ # 工作流执行引擎：NodeRegistry + NodeDefinition + Executor（新增节点在此扩展）
│   ├── search/   # 搜索适配层（SearchProviderRegistry，镜像 Model Registry 模式）
│   ├── ai/       # 模型注册表（providers / capabilities / models）
│   ├── agent/    # AI 对话工具集（create_custom_node 等）
│   └── secrets.ts# 敏感配置加密（AES-256-GCM，密钥派生自 AUTH_SECRET）
├── messages/     # zh/en 国际化
└── scripts/      # SQL 初始化（supabase-*.sql）+ 构建部署脚本
```

## 代码规范

1. **提交前必跑**：`pnpm validate`（ts-check + eslint）与 `pnpm test`（vitest），必须全绿
2. TypeScript `strict`：禁止隐式 `any` / `as any`；类型收窄后再使用
3. 不写死绝对路径，用 `path.resolve(__dirname, ...)` / `process.cwd()`
4. 动态内容（`typeof window` / `Date.now()`）必须在 `'use client'` + `useEffect` 中使用，禁止在 JSX 渲染逻辑里直接调用
5. UI 组件优先复用 `src/components/ui/`（shadcn/ui），不引入新的样式体系
6. **所有用户可见文案必须走 i18n**：通过 `useT()` 渲染（`t('命名空间.key')`），禁止在 JSX/toast/对话框硬编码中文；新增文案同步更新 `src/messages/zh.ts` 与 `en.ts`（画布内置文本例外，走 `src/lib/tinyflow-locale.ts` 映射表）
7. 新增节点：遵循「NodeDefinition（nodes/builtin.ts）+ Executor（executors/）+ 注册」三步，不要绕过 NodeRegistry

## 数据库变更

- 新表/新列统一追加到 `scripts/supabase-updates.sql`（**幂等**：`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`）
- 新建的表需同时补授权（`GRANT ALL ... TO anon, service_role`）——详见该文件第 30 节注释
- 不要在服务器上手动建表（Docker migration 容器每次部署自动执行该文件）
- 部署迁移验证：`bash scripts/check-grants.sh`（权限自检）

## 敏感信息

- 任何入库的密钥（API Key / AccessKeySecret 等）必须经 `encryptSecret()` 加密后存储，读取用 `decryptSecret()`（`src/lib/secrets.ts`）
- 需要等值查询的加密字段：增加 SHA-256 哈希列（参考 `user_api_keys.api_key_hash` 模式）
- API 响应禁止返回 api_key；写入操作 admin-only + `logAudit`

## 测试

- 新增逻辑必须带单元测试（镜像 `src/lib/**/__tests__/` 现有风格）
- 执行器测试参考 `search-executor.test.ts` / `excel-executor.test.ts`（mock ParameterResolver + GraphParser）
- 测试间不要污染全局单例（nodeRegistry / ExecutorRegistry 用后清理）

## 提 PR

1. commit message 遵循现有风格：`feat:` / `fix:` / `security:` / `docs:` 前缀 + 中文描述要点
2. 一个 PR 聚焦一个改动，避免混合无关修改
3. 提交前确认：`pnpm validate` ✓、`pnpm test` ✓、涉及 DB 的改动已追加幂等 SQL
4. 说明改动动机与影响面（如「画布字段统一」会影响旧工作流数据时需注明兼容策略）

## 发布流程

1. 更新 `CHANGELOG.md`（新增版本条目，分类：新增/修复/安全/测试）
2. 更新 `package.json` version
3. `git tag vX.Y.Z && git push --tags`
4. 部署：`SERVER_IP=xxx ./scripts/deploy-docker.sh`（自动迁移 + 权限自检 + 构建 + 健康验证）

## 部署

- 生产环境为 Docker Compose 部署（应用 + PostgreSQL + PostgREST + Nginx 全容器化）
- 本地/CI 构建：`pnpm build`
- 一键部署：`scripts/deploy-docker.sh`（见 `docs/config/Deployment-Manual.md`）
