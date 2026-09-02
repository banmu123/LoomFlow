import { describe, it, expect } from 'vitest';
import { uiStreamErrorText } from '../ui-stream-error';

// UI 消息流错误文案：SDK 默认脱敏为 "An error occurred."，此处透传可诊断信息
describe('uiStreamErrorText', () => {
  it('透传 Error 的 message（如供应商余额不足）', () => {
    expect(uiStreamErrorText(new Error('Insufficient Balance'))).toBe('Insufficient Balance');
  });

  it('非 Error 对象转字符串', () => {
    expect(uiStreamErrorText('timeout')).toBe('timeout');
    expect(uiStreamErrorText(42)).toBe('42');
  });

  it('空值兜底', () => {
    expect(uiStreamErrorText(null)).toBe('Unknown error');
    expect(uiStreamErrorText(undefined)).toBe('Unknown error');
    expect(uiStreamErrorText('')).toBe('Unknown error');
    expect(uiStreamErrorText(new Error(''))).toBe('Unknown error');
  });
});
