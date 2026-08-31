/**
 * Runtime Mode Detection
 *
 * 区分 Docker 自托管模式和 Vercel Serverless 模式。
 * 默认返回 'docker'，保证现有 Docker 用户升级后无需修改配置。
 *
 * Docker 模式：
 *   - server.ts 启动 scheduler
 *   - 内置 cron + evolution scheduler
 *
 * Serverless 模式：
 *   - server.ts 跳过 scheduler
 *   - Vercel Cron 调用 /api/cron/* 端点
 */

export type RuntimeMode = 'docker' | 'serverless';

export function getRuntimeMode(): RuntimeMode {
  return process.env.RUNTIME_MODE === 'serverless' ? 'serverless' : 'docker';
}
