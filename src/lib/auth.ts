import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = process.env.AUTH_SECRET || 'forgeflow-dev-secret';
const COOKIE_NAME = 'forgeflow_token';
const TOKEN_TTL = 7 * 24 * 3600; // 7 天

interface AuthPayload {
  uid: string;
  username: string;
  role: string;
  exp: number;
}

// 签发 JWT（HS256）
export function signJWT(
  payload: { uid: string; username: string; role: string },
  expiresInSec = TOKEN_TTL,
): string {
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

// 验证 JWT，返回 payload 或 null
export function verifyJWT(token: string): AuthPayload | null {
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

// 生成 Set-Cookie 头
export function authCookie(token: string, maxAgeSec = TOKEN_TTL): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
}

export function clearAuthCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}
