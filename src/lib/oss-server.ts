import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getOSSConfig } from './oss-config';

// 服务端 OSS 上传（S3 兼容协议，支持阿里云 OSS / S3 兼容存储）
// 知识库文档 oss 模式使用；配置缺失时返回 null（调用方应回退到数据库存储）
// 配置来源：管理后台「存储设置」（数据库）优先，其次环境变量

export async function uploadTextToOSS(
  key: string,
  content: string,
  contentType = 'text/plain',
): Promise<string | null> {
  const config = await getOSSConfig();
  if (!config) return null;

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    }),
  );

  return key;
}
