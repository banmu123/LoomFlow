// =====================================================
// 生成 PostgREST service_role JWT（HS256，零依赖）
// 用法：node docker/generate-service-role-key.mjs <PGRST_JWT_SECRET>
// 输出：COZE_SUPABASE_SERVICE_ROLE_KEY 的值
// =====================================================

import { createHmac } from 'crypto';

const secret = process.argv[2];
if (!secret) {
  console.error('用法: node docker/generate-service-role-key.mjs <PGRST_JWT_SECRET>');
  process.exit(1);
}

const b64url = (s) => Buffer.from(s).toString('base64url');

// 1 年有效期（过期后需重新生成）
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({ role: 'service_role', exp: now + 365 * 24 * 3600 }),
);
const signature = createHmac('sha256', secret)
  .update(`${header}.${payload}`)
  .digest('base64url');

console.log(`${header}.${payload}.${signature}`);
