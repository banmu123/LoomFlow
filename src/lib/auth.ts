import { createHmac, timingSafeEqual } from 'crypto';

// ⚠️ 安全：AUTH_SECRET 必须配置。缺失时拒绝签发/验证（禁止回退到硬编码默认值，
// 否则任何人都能用公开密钥伪造管理员 token）
const SECRET = process.env.AUTH_SECRET || '';
const COOKIE_NAME = 'forgeflow_token';
const TOKEN_TTL = 7 * 24 * 3600; // 7 天

interface AuthPayload {
  uid: string;
  username: string;
  role: string;
  exp: number;
}

// 签发 JWT（HS256）；AUTH_SECRET 未配置时抛错（登录会失败并提示服务端配置问题）
export function signJWT(
  payload: { uid: string; username: string; role: string },
  expiresInSec = TOKEN_TTL,
): string {
  if (!SECRET) throw new Error('AUTH_SECRET 未配置：请在环境变量中设置（openssl rand -hex 32）');
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

// 验证 JWT，返回 payload 或 null（AUTH_SECRET 未配置时全部视为无效）
export function verifyJWT(token: string): AuthPayload | null {
  if (!SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const expected = createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as AuthPayload;
    if (!payload.uid || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, TOKEN_TTL };

// 生成 Set-Cookie 头（生产环境加 Secure：仅 HTTPS 传输）
export function authCookie(token: string, maxAgeSec = TOKEN_TTL): string {
  const secure = process.env.COZE_PROJECT_ENV === 'PROD' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

/**
 * 清除登录 cookie（返回多个属性变体）：
 * 浏览器按属性（Secure/Path/Domain）匹配 cookie——历史版本生成的 cookie 属性可能不同
 * （如旧版无 Secure），单条清除无法匹配旧 cookie 导致退出后仍保持登录态。
 * 因此同时发送带 Secure 与不带 Secure 两个变体，确保任意历史 cookie 都能被清除。
 */
export function clearAuthCookie(): string[] {
  const secure = process.env.COZE_PROJECT_ENV === 'PROD' ? '; Secure' : '';
  return [
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`,
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
  ];
}
