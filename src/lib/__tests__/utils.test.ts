import { describe, it, expect, beforeAll } from 'vitest';
import { validatePassword } from '../password';
import { signJWT, verifyJWT } from '../auth';

// JWT 需要 AUTH_SECRET（安全要求：缺失时拒绝签发）
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-for-unit-tests';
});

describe('validatePassword', () => {
  it('长度不足 8 位拒绝', () => {
    expect(validatePassword('abc123')).toBe('密码长度至少 8 位');
  });

  it('纯数字拒绝', () => {
    expect(validatePassword('12345678')).toBe('密码必须同时包含字母和数字');
  });

  it('纯字母拒绝', () => {
    expect(validatePassword('abcdefgh')).toBe('密码必须同时包含字母和数字');
  });

  it('合法密码通过', () => {
    expect(validatePassword('abc12345')).toBeNull();
  });
});

describe('JWT', () => {
  it('签发后可验证', () => {
    const token = signJWT({ uid: 'u1', username: 'admin', role: 'admin' });
    const payload = verifyJWT(token);
    expect(payload).not.toBeNull();
    expect(payload?.username).toBe('admin');
  });

  it('篡改签名被拒绝', () => {
    const token = signJWT({ uid: 'u1', username: 'admin', role: 'admin' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyJWT(tampered)).toBeNull();
  });

  it('非法格式被拒绝', () => {
    expect(verifyJWT('not-a-jwt')).toBeNull();
  });
});
