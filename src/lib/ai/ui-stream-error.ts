/**
 * UI 消息流的错误文案。
 * AI SDK 默认把流式错误脱敏为 "An error occurred."（防止泄露服务端细节），
 * 但模型供应商的业务错误（如 Insufficient Balance / 模型不存在）对用户有诊断价值，
 * 这里透传原始 message；如后续需要隐藏敏感错误，在此统一收口处理。
 */
export function uiStreamErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : error != null ? String(error) : '';
  return message.trim() || 'Unknown error';
}
