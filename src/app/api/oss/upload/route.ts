import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getOSSConfig } from '@/lib/oss-config';
import { uploadBufferToOSS } from '@/lib/oss-server';

export const runtime = 'nodejs';

// 生成 OSS Key（服务端统一生成，避免客户端可控路径）
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 服务端代理上传：登录用户 → 服务端用 OSS 密钥上传 → 返回 URL。
// 密钥永不下发客户端（安全：此前 /api/oss/config 泄露 AccessKeySecret 已修复）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const config = await getOSSConfig();
  if (!config) {
    return NextResponse.json({ error: 'OSS 配置未设置' }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: '表单解析失败' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少文件' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: '文件为空' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: '文件大小超过 10MB 限制' }, { status: 400 });
  }

  const prefix = typeof formData.get('prefix') === 'string' ? String(formData.get('prefix')) : undefined;
  if (prefix && !/^[a-zA-Z0-9_-]+$/.test(prefix)) {
    return NextResponse.json({ error: 'prefix 不合法' }, { status: 400 });
  }

  // MIME 白名单（防 SVG/HTML 等可执行内容存储型 XSS）
  const allowedTypes = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'text/markdown',
    'application/json', 'application/zip',
  ]);
  const contentType = file.type || 'application/octet-stream';
  if (!allowedTypes.has(contentType)) {
    return NextResponse.json({ error: `不支持的文件类型: ${contentType}` }, { status: 400 });
  }

  // 生成 key（时间戳 + 随机 + 清洗后的文件名）
  const timestamp = Date.now();
  const keyBase = `${timestamp}_${randomString(6)}_${sanitizeFileName(file.name)}`;
  const key = prefix ? `${prefix}/${keyBase}` : keyBase;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadBufferToOSS(key, buffer, contentType);
  if (!uploaded) {
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }

  const regionId = config.region.replace('oss-', '');
  const url = `https://${config.bucket}.oss-${regionId}.aliyuncs.com/${key}`;

  return NextResponse.json({
    success: true,
    data: { fileName: file.name, key, url, size: file.size },
  });
}
