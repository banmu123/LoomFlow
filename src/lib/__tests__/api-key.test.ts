import { describe, it, expect, beforeEach } from 'vitest';
import { hashApiKey } from '../api-key';
import { encryptSecret, decryptSecret } from '../secrets';

beforeEach(() => {
  process.env.AUTH_SECRET = 'unit-test-auth-secret-for-api-key';
});

describe('全局 API Key 存储（哈希 + 密文）', () => {
  it('hashApiKey 确定性（等值查询依赖）', () => {
    const key = 'ffk_testkey123';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(hashApiKey(`${key}x`));
  });

  it('存入的是密文而非明文（DB 泄露不可用）', () => {
    const key = 'ffk_supersecret';
    const stored = encryptSecret(key);
    expect(stored).not.toContain('supersecret');
    // 鉴权流程：哈希定位 + 解密校验
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptSecret(stored)).toBe(key);
  });
});
