// OSS 配置接口
export interface OSSConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint?: string;
}

// 缓存配置
let cachedConfig: OSSConfig | null = null;

/**
 * 生成默认 Endpoint（区域端点，SDK 虚拟主机模式会自动加 bucket 前缀）
 */
function generateEndpoint(_bucket: string, region: string): string {
  const regionId = region.replace('oss-', '');
  return `https://oss-${regionId}.aliyuncs.com`;
}

/**
 * 从环境变量获取配置（服务端使用）
 */
export function getOSSConfigFromEnv(): OSSConfig | null {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.OSS_REGION;

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return null;
  }

  const endpoint = process.env.OSS_ENDPOINT || generateEndpoint(bucket, region);

  return { accessKeyId, accessKeySecret, bucket, region, endpoint };
}

/**
 * 从 NEXT_PUBLIC 环境变量获取配置（客户端降级使用）
 */
export function getOSSConfigFromPublicEnv(): OSSConfig | null {
  const accessKeyId = process.env.NEXT_PUBLIC_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.NEXT_PUBLIC_OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.NEXT_PUBLIC_OSS_BUCKET;
  const region = process.env.NEXT_PUBLIC_OSS_REGION;

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return null;
  }

  const endpoint = process.env.NEXT_PUBLIC_OSS_ENDPOINT || generateEndpoint(bucket, region);

  return { accessKeyId, accessKeySecret, bucket, region, endpoint };
}

/**
 * 客户端获取 OSS 配置（通过 API 或降级到环境变量）
 */
export async function fetchOSSConfig(): Promise<OSSConfig | null> {
  // 有缓存直接返回
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const response = await fetch('/api/oss/config');
    if (response.ok) {
      const data = await response.json();
      if (data.isComplete) {
        cachedConfig = data;
        return data;
      }
    }
  } catch {
    // API 失败，降级到环境变量
  }

  // 降级到 NEXT_PUBLIC 环境变量
  return null;
}

/**
 * 清除缓存（配置变更时调用）
 */
export function clearOSSConfigCache(): void {
  cachedConfig = null;
}