import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getOSSConfig } from './oss-config';

// 服务端 OSS 上传（S3 兼容协议，支持阿里云 OSS / S3 兼容存储）
// 知识库文档 oss 模式使用；配置缺失时返回 null（调用方应回退到数据库存储）
// 配置来源：管理后台「存储设置」（数据库）优先，其次环境变量

async function getClient() {
  const config = await getOSSConfig();
  if (!config) return null;
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
  });
}

export async function uploadTextToOSS(
  key: string,
  content: string,
  contentType = 'text/plain',
): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;

  await client.send(
    new PutObjectCommand({
      Bucket: (await getOSSConfig())!.bucket,
      Key: key,
      Body: content,
      ContentType: contentType,
    }),
  );

  return key;
}

// 删除 OSS 对象（文档/知识库删除时清理，避免残留文件）
export async function deleteOSSObject(key: string): Promise<void> {
  if (!key) return;
  const client = await getClient();
  const config = await getOSSConfig();
  if (!client || !config) return;
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  } catch {
    // 删除失败不影响主流程（残留文件无害）
  }
}
