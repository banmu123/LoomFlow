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
let dbConfigCache: OSSConfig | null = null;
let dbConfigCacheTime = 0;
const DB_CACHE_TTL_MS = 30_000;

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
 * 从数据库读取 OSS 配置（管理后台「存储设置」写入，优先于环境变量）
 * 缓存 30s；设置变更后调用 clearOSSConfigCache 立即生效
 */
export async function getOSSConfigFromDb(): Promise<OSSConfig | null> {
  const now = Date.now();
  if (dbConfigCache && now - dbConfigCacheTime < DB_CACHE_TTL_MS) {
    return dbConfigCache;
  }
  dbConfigCache = null;

  try {
    const { supabase } = await import('@/lib/supabase/server');
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'oss_config')
      .maybeSingle();

    const v = data?.value as
      | { accessKeyId?: string; accessKeySecret?: string; bucket?: string; region?: string; endpoint?: string }
      | undefined;
    if (v && v.accessKeyId && v.accessKeySecret && v.bucket && v.region) {
      dbConfigCache = {
        accessKeyId: v.accessKeyId,
        accessKeySecret: v.accessKeySecret,
        bucket: v.bucket,
        region: v.region,
        endpoint: v.endpoint || undefined,
      };
    }
  } catch {
    // 数据库不可用时回退环境变量
  }
  dbConfigCacheTime = now;
  return dbConfigCache;
}

/**
 * 获取有效 OSS 配置：数据库配置优先，其次环境变量
 */
export async function getOSSConfig(): Promise<OSSConfig | null> {
  const db = await getOSSConfigFromDb();
  return db || getOSSConfigFromEnv();
}

/**
 * 客户端获取 OSS 配置（仅通过服务端 API——NEXT_PUBLIC_OSS_* 已移除：
 * 前端 bundle 中的密钥会被任何访问者看到，属高危泄露面）
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
  dbConfigCache = null;
  dbConfigCacheTime = 0;
}