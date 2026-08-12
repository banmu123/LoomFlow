# 阿里云 OSS 对接配置文档

> 生成日期：2026-07-09
> 涉及文件：
> - `src/lib/oss-config.ts` — OSS 配置管理（运行时获取 + 缓存）
> - `src/lib/oss-upload-client.ts` — 客户端直传 OSS（S3 协议）
> - `src/lib/oss-transfer.ts` — 服务端文件转存（外部 URL → OSS）
> - `src/app/api/oss/config/route.ts` — 运行时 OSS 配置 API（需登录）

---

## 一、环境变量

| 变量名 | 必填 | 说明 | 使用位置 |
|--------|------|------|----------|
| `OSS_ACCESS_KEY_ID` | 是 | 阿里云 Access Key ID | 服务端 |
| `OSS_ACCESS_KEY_SECRET` | 是 | 阿里云 Access Key Secret | 服务端 |
| `OSS_BUCKET` | 是 | OSS Bucket 名称 | 服务端 |
| `OSS_REGION` | 是 | OSS Region（如 `oss-cn-shenzhen`） | 服务端 |
| `OSS_ENDPOINT` | 否 | 自定义 Endpoint（不填则自动生成） | 服务端 |
| `NEXT_PUBLIC_OSS_ACCESS_KEY_ID` | 是 | 同上（客户端用） | 客户端直传 |
| `NEXT_PUBLIC_OSS_ACCESS_KEY_SECRET` | 是 | 同上（客户端用） | 客户端直传 |
| `NEXT_PUBLIC_OSS_BUCKET` | 是 | 同上（客户端用） | 客户端直传 |
| `NEXT_PUBLIC_OSS_REGION` | 是 | 同上（客户端用） | 客户端直传 |
| `NEXT_PUBLIC_OSS_ENDPOINT` | 否 | 同上（客户端用） | 客户端直传 |

> **注意**：生产环境必须同时配置 `OSS_*` 和 `NEXT_PUBLIC_OSS_*` 两组变量。

### Endpoint 自动生成规则

```
https://{bucket}.oss-{region去掉oss-前缀}.aliyuncs.com
```

示例：`bucket=czk-ai-project`, `region=oss-cn-shenzhen` → `https://czk-ai-project.oss-cn-shenzhen.aliyuncs.com`

---

## 二、配置管理（oss-config.ts）

### 2.1 配置接口

```typescript
interface OSSConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint?: string;
}
```

### 2.2 配置获取流程

```
fetchOSSConfig()
  ├── 有缓存 → 直接返回
  ├── 无缓存 → fetch('/api/oss/config')
  │   ├── 成功 → 缓存并返回
  │   └── 失败 → 降级到 NEXT_PUBLIC_* 环境变量
```

### 2.3 API 路由

**GET /api/oss/config**（需登录）

返回：
```json
{
  "accessKeyId": "xxx",
  "accessKeySecret": "xxx",
  "bucket": "xxx",
  "region": "oss-cn-shenzhen",
  "endpoint": "https://xxx.oss-cn-shenzhen.aliyuncs.com",
  "isComplete": true
}
```

---

## 三、客户端直传（oss-upload-client.ts）

### 3.1 使用方式

```typescript
import { uploadFileToOSSWithConfig } from '@/lib/oss-upload-client';

const result = await uploadFileToOSSWithConfig(file, {
  key: 'custom/path/filename.jpg',  // 可选，不传则自动生成
  onProgress: (p) => console.log(`${p}%`),  // 可选进度回调
});

if (result.success) {
  console.log('URL:', result.data.url);
  console.log('Key:', result.data.key);
}
```

### 3.2 返回结构

```typescript
{
  success: boolean;
  message: string;
  data?: {
    fileName: string;  // 实际文件名
    key: string;       // OSS 存储路径
    url: string;       // 完整访问 URL
    size: number;      // 文件大小
  };
}
```

### 3.3 默认文件路径

```
{timestamp}_{random6}_{sanitized_filename}
例: 1688888888_abc123_图片.jpg
```

---

## 四、服务端转存（oss-transfer.ts）

### 4.1 使用方式

```typescript
import { transferFileToOSS, transferBufferToOSS, transferFilesToOSS } from '@/lib/oss-transfer';

// 从 URL 转存
const result = await transferFileToOSS(sourceUrl, 'path/file.jpg');
// 返回: { url: string, key: string } | null

// 批量转存
const { urls, keys } = await transferFilesToOSS(urlArray, 'prefix');

// 从 Buffer 上传
const result = await transferBufferToOSS(buffer, 'path/file.jpg', 'image/jpeg');
```

### 4.2 自动 Key 生成

```
{timestamp}_{random6}{ext}
```

---

## 五、S3 客户端配置

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: config.region,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.accessKeySecret,
  },
  endpoint: config.endpoint,
  forcePathStyle: true,  // 阿里云 OSS 必须为 true
});

await client.send(new PutObjectCommand({
  Bucket: config.bucket,
  Key: ossKey,
  Body: buffer,
  ContentType: contentType,
}));
```

---

## 六、CORS 配置

客户端直传需要配置 CORS 规则：

1. 登录 https://oss.console.aliyun.com/
2. Bucket → 权限管理 → 跨域设置 → 创建规则

| 配置项 | 值 |
|--------|-----|
| 来源 | `*` |
| 允许方法 | `PUT, POST, GET, HEAD, DELETE` |
| 允许头部 | `*` |
| 暴露头部 | `ETag, x-oss-request-id` |
| 缓存时间 | `600` |

---

## 七、迁移检查清单

- [ ] 创建 OSS Bucket，配置 CORS 规则
- [ ] 生成 Access Key（建议 RAM 子账号）
- [ ] 配置环境变量（`.env.local` 和部署平台）
- [ ] 测试客户端上传
- [ ] 测试服务端转存
- [ ] 重新构建客户端（确保 NEXT_PUBLIC_* 内联）

---

## 八、依赖包

```json
{
  "@aws-sdk/client-s3": "S3 兼容协议上传/删除"
}
```
