import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl } from '../url-security';

describe('isSafeHttpUrl（SSRF 防护）', () => {
  it('拒绝内网 IPv6', async () => {
    const cases = ['http://[::1]', 'http://[fe80::1]', 'http://[fc00::1]', 'http://[::ffff:127.0.0.1]'];
    for (const u of cases) {
      const r = await isSafeHttpUrl(u);
      expect(r.ok, u).toBe(false);
    }
  });

  it('拒绝非 http/https 协议', async () => {
    expect((await isSafeHttpUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await isSafeHttpUrl('gopher://127.0.0.1:6379')).ok).toBe(false);
    expect((await isSafeHttpUrl('ftp://example.com')).ok).toBe(false);
  });

  it('拒绝回环地址', async () => {
    expect((await isSafeHttpUrl('http://127.0.0.1')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://127.0.0.1:3000/api')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://localhost')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://localhost:5432')).ok).toBe(false);
  });

  it('拒绝内网/链路本地/保留地址', async () => {
    expect((await isSafeHttpUrl('http://10.0.0.1')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://172.16.0.1')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://172.31.255.255')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://192.168.1.1')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://169.254.169.254/latest/meta-data/')).ok).toBe(false);
    expect((await isSafeHttpUrl('http://0.0.0.0')).ok).toBe(false);
  });

  it('拒绝特殊编码的 IPv4（十进制/十六进制）', async () => {
    // 2130706433 = 127.0.0.1
    expect((await isSafeHttpUrl('http://2130706433')).ok).toBe(false);
    // 0x7f000001 = 127.0.0.1
    expect((await isSafeHttpUrl('http://0x7f000001')).ok).toBe(false);
    // 0177.0.0.1（八进制）
    expect((await isSafeHttpUrl('http://0177.0.0.1')).ok).toBe(false);
  });


  it('拒绝 .local 域名', async () => {
    expect((await isSafeHttpUrl('http://foo.local')).ok).toBe(false);
  });

  it('公网 https 地址放行', async () => {
    expect((await isSafeHttpUrl('https://api.example.com/v1')).ok).toBe(true);
    expect((await isSafeHttpUrl('https://www.google.com')).ok).toBe(true);
  });

  it('非法 URL 拒绝', async () => {
    expect((await isSafeHttpUrl('not a url')).ok).toBe(false);
    expect((await isSafeHttpUrl('')).ok).toBe(false);
  });
});
