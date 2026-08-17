// 客户端上传：走服务端代理（/api/oss/upload）。
// 安全：AccessKeySecret 永不下发客户端（此前 /api/oss/config 泄露密钥已修复）

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
 * 上传文件到 OSS（服务端代理上传）
 */
export async function uploadFileToOSS(
  file: File,
  options?: {
    key?: string;
    prefix?: string;
    onProgress?: (progress: number) => void;
  }
): Promise<UploadResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.prefix) formData.append('prefix', options.prefix);

    const res = await fetch('/api/oss/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok || !data?.data) {
      return { success: false, message: data?.error || '上传失败' };
    }

    return {
      success: true,
      message: '上传成功',
      data: {
        fileName: data.data.fileName,
        key: data.data.key,
        url: data.data.url,
        size: data.data.size,
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
