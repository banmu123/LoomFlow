import { describe, it, expect, beforeAll } from 'vitest';
import { validatePassword } from '../password';
import { signJWT, verifyJWT } from '../auth';
import { truncateTitle } from '../utils';

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

describe('truncateTitle', () => {
  it('超过 5 字符截断并加省略号（按 code unit 计数）', () => {
    expect(truncateTitle('你好，今天天气不错')).toBe('你好，今天…');
  });

  it('恰好 5 字符不截断', () => {
    expect(truncateTitle('你好，今天')).toBe('你好，今天');
  });

  it('少于 5 字符不截断', () => {
    expect(truncateTitle('你好')).toBe('你好');
  });

  it('空字符串返回空', () => {
    expect(truncateTitle('')).toBe('');
  });

  it('自定义最大长度', () => {
    expect(truncateTitle('一二三四五六七八', 4)).toBe('一二三四…');
  });
});
