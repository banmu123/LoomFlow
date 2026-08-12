import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { OSSConfig } from './oss-config';
import { fetchOSSConfig } from './oss-config';

interface UploadResult {
  success: boolean;
  message: string;
  data?: {
    fileName: string;
    key: string;
    url: string;
    size: number;
  };
}

/**
 * 生成随机字符串
 */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 清理文件名中的特殊字符
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * 生成 OSS Key
 */
function generateOSSKey(fileName: string, prefix?: string): string {
  const timestamp = Date.now();
  const random = randomString(6);
  const sanitized = sanitizeFileName(fileName);
  const key = `${timestamp}_${random}_${sanitized}`;
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * 获取文件 Content-Type
 */
function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    // 视频
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    // 音频
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    // 文档
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // 其他
    json: 'application/json',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 创建 S3 客户端
 * 注意：endpoint 为虚拟主机风格（https://{bucket}.oss-{region}.aliyuncs.com），
 * 必须使用默认虚拟主机模式（forcePathStyle: false），否则 key 会带 bucket 前缀导致 URL 404
 */
function createS3Client(config: OSSConfig): S3Client {
  return new S3Client({
    region: config.region.replace('oss-', ''),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
    endpoint: config.endpoint,
    forcePathStyle: false,
  });
}

/**
 * 上传文件到 OSS（使用传入的配置）
 */
export async function uploadFileToOSSWithConfig(
  file: File,
  options?: {
    key?: string;
    prefix?: string;
    onProgress?: (progress: number) => void;
    config?: OSSConfig;
  }
): Promise<UploadResult> {
  const config = options?.config || (await fetchOSSConfig());

  if (!config) {
    return { success: false, message: 'OSS 配置未设置' };
  }

  try {
    const key = options?.key || generateOSSKey(file.name, options?.prefix);
    const contentType = getContentType(file.name);

    // 将 File 转换为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const client = createS3Client(config);

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await client.send(command);

    // 生成访问 URL（bucket 域名 + key）
    const regionId = config.region.replace('oss-', '');
    const url = `https://${config.bucket}.oss-${regionId}.aliyuncs.com/${key}`;

    return {
      success: true,
      message: '上传成功',
      data: {
        fileName: file.name,
        key,
        url,
        size: file.size,
      },
    };
  } catch (error) {
    console.error('OSS 上传失败:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '上传失败',
    };
  }
}

/**
 * 上传文件到 OSS（自动获取配置）
 */
export async function uploadFileToOSS(
  file: File,
  options?: {
    key?: string;
    prefix?: string;
    onProgress?: (progress: number) => void;
  }
): Promise<UploadResult> {
  return uploadFileToOSSWithConfig(file, options);
}