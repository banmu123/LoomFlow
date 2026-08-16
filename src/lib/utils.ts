import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 对话标题展示：过长只显示前 max 个字 + 省略号（存储保留完整标题，仅展示截断）
export function truncateTitle(title: string, max = 5) {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}
