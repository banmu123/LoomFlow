import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encryptSecret, decryptSecret } from '../secrets';

const SECRET = 'unit-test-auth-secret-0123456789abcdef';

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe('encryptSecret / decryptSecret', () => {
  it('加解密往返一致', () => {
    const encrypted = encryptSecret('tvly-abc123');
    expect(decryptSecret(encrypted)).toBe('tvly-abc123');
  });

  it('密文不含明文（不可读）', () => {
    const encrypted = encryptSecret('sk-super-secret-key');
    expect(encrypted).not.toContain('super-secret-key');
    expect(encrypted).toMatch(/^enc:v1:/);
  });

  it('两次加密结果不同（随机 IV）', () => {
    const a = encryptSecret('same-key');
    const b = encryptSecret('same-key');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('空值原样返回', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('旧明文数据透明兼容（无 enc: 前缀原样返回）', () => {
    expect(decryptSecret('legacy-plain-key')).toBe('legacy-plain-key');
    expect(decryptSecret('')).toBe('');
  });

  it('解密失败（密钥变更）返回空串而非崩溃', () => {
    const encrypted = encryptSecret('tvly-abc123');
    process.env.AUTH_SECRET = 'different-secret-9876543210';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decryptSecret(encrypted)).toBe('');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('密文被篡改返回空串（GCM 认证失败）', () => {
    const encrypted = encryptSecret('tvly-abc123');
    const tampered = encrypted.slice(0, -2) + 'AA';
    expect(decryptSecret(tampered)).toBe('');
  });

  it('AUTH_SECRET 未配置时加密抛明确错误', () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptSecret('key')).toThrow('AUTH_SECRET');
  });
});
