import { describe, it, expect } from 'vitest';
import { formatVersion } from '../version';

describe('formatVersion 语义化版本显示', () => {
  it('第 1 个版本显示 v0.0.0', () => {
    expect(formatVersion(1)).toBe('0.0.0');
  });

  it('版本递增对应 0.0.x', () => {
    expect(formatVersion(2)).toBe('0.0.1');
    expect(formatVersion(3)).toBe('0.0.2');
    expect(formatVersion(10)).toBe('0.0.9');
  });
});
