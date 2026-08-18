import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// ===== 敏感配置加密（API Key 等）=====
// 密钥从 AUTH_SECRET（SHA-256 派生 32 字节）——与 JWT 同源，无需新增环境变量。
// 格式: enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>
// 兼容旧数据：无 enc: 前缀视为明文（历史遗留），按原样返回。

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET 未配置：无法加解密敏感配置（openssl rand -hex 32）');
  }
  return createHash('sha256').update(secret).digest();
}

/** 加密敏感值；空字符串原样返回（保持空值语义） */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * 解密敏感值。
 * - 空值 → ''
 * - 无 enc: 前缀（历史明文数据）→ 原样返回
 * - 解密失败（AUTH_SECRET 变更 / 数据损坏）→ 返回 '' 并告警（不抛错，避免单条坏数据拖垮整列表）
 */
export function decryptSecret(value: string): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return value;
  const [ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    console.warn('[secrets] 敏感配置解密失败（AUTH_SECRET 变更或数据损坏）');
    return '';
  }
}
