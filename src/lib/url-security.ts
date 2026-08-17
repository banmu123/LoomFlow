import dns from 'node:dns/promises';

// ===== SSRF 防护：URL 安全检查（供 HTTP 节点 / webhook 回调使用）=====

type CheckResult = { ok: true } | { ok: false; reason: string };

/** 解析 IPv4 字符串为数字（兼容十进制/十六进制/八进制写法，如 2130706433、0x7f000001） */
function ipv4ToInt(hostname: string): number | null {
  // 单段整数形式
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) return n;
    return null;
  }
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    let octet: number;
    if (/^\d+$/.test(part)) {
      octet = Number(part);
    } else if (/^0x[0-9a-f]+$/i.test(part)) {
      octet = parseInt(part.slice(2), 16);
    } else if (/^0[0-7]+$/.test(part)) {
      octet = parseInt(part, 8);
    } else {
      return null;
    }
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/** 私网/回环/链路本地/保留 IPv4 段 */
function isPrivateIpv4(int: number): boolean {
  const b1 = (int >>> 24) & 0xff;
  const b2 = (int >>> 16) & 0xff;
  // 0.0.0.0/8 保留；10/8 私网；100.64/10 CGNAT；127/8 回环；
  // 169.254/16 链路本地；172.16/12 私网；192.168/16 私网；
  // 224/4 组播；240/4 保留
  return (
    b1 === 0 ||
    b1 === 10 ||
    (b1 === 100 && (b2 & 0xc0) === 0x40) ||
    b1 === 127 ||
    (b1 === 169 && b2 === 254) ||
    (b1 === 172 && b2 >= 16 && b2 <= 31) ||
    (b1 === 192 && b2 === 168) ||
    (b1 >= 224)
  );
}

/** 解析 IPv6（简化：仅判断是否私网前缀；hostname 可能带方括号 [::1]） */
function isPrivateIpv6(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // IPv4 映射（两种形式：::ffff:127.0.0.1 点分；Node URL 规范化的 ::ffff:7f00:1 十六进制）
  const ipv4MappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedDotted) {
    const int = ipv4ToInt(ipv4MappedDotted[1]);
    return int !== null && isPrivateIpv4(int);
  }
  const ipv4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4MappedHex) {
    const a = parseInt(ipv4MappedHex[1], 16);
    const b = parseInt(ipv4MappedHex[2], 16);
    const ipv4 = `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
    const int = ipv4ToInt(ipv4);
    return int !== null && isPrivateIpv4(int);
  }

  // ::1 回环；fe80::/10 链路本地；fc00::/7 唯一本地；:: 未指定
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  );
}

/**
 * 校验 URL 可安全访问：
 * 1. 仅 http/https
 * 2. 拒绝 localhost/.local/回环/私网/链路本地/保留地址（含特殊编码形式）
 * 3. DNS 解析后再次校验（防域名指向内网）
 */
export async function isSafeHttpUrl(rawUrl: string): Promise<CheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'URL 格式无效' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: '仅支持 http/https 协议' };
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: '不允许访问 localhost' };
  }
  if (hostname.endsWith('.local')) {
    return { ok: false, reason: '不允许访问 .local 域名' };
  }

  // IPv4 字面量（含整数/十六进制/八进制写法）：直接判断，无需 DNS
  const ipv4 = ipv4ToInt(hostname);
  if (ipv4 !== null) {
    return isPrivateIpv4(ipv4)
      ? { ok: false, reason: '不允许访问内网/回环/保留地址' }
      : { ok: true };
  }

  // IPv6 字面量：直接判断，无需 DNS
  if (hostname.includes(':')) {
    return isPrivateIpv6(hostname)
      ? { ok: false, reason: '不允许访问内网/回环 IPv6 地址' }
      : { ok: true };
  }

  // 域名：DNS 解析后校验（域名可能指向内网）
  try {
    const resolved = await dns.lookup(hostname, { all: true });
    for (const entry of resolved) {
      if (entry.family === 4) {
        const int = ipv4ToInt(entry.address);
        if (int !== null && isPrivateIpv4(int)) {
          return { ok: false, reason: '域名解析到内网/回环地址' };
        }
      } else if (isPrivateIpv6(entry.address)) {
        return { ok: false, reason: '域名解析到内网 IPv6 地址' };
      }
    }
  } catch {
    // 解析失败放行（fetch 会给出错误）
  }

  return { ok: true };
}
