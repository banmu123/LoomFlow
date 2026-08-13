// 内部版本号（1, 2, 3... 递增整数）→ 展示版本号（语义化格式，从 0.0.0 开始）
// 第 1 个版本显示 v0.0.0，第 2 个 v0.0.1，依此类推
export function formatVersion(version: number): string {
  return `0.0.${version - 1}`;
}
