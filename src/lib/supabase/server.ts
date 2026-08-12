/* eslint-disable @typescript-eslint/no-explicit-any -- supabase 无数据库类型定义，延迟初始化需宽松类型 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// 确保 .env.local 被加载（API route 上下文中有 Next.js 自动加载，这里做兜底）
config({ path: resolve(process.cwd(), '.env.local') });

function getSupabase() {
  const url = process.env.COZE_SUPABASE_URL;
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('[supabase] 环境变量未找到:');
    console.error('  COZE_SUPABASE_URL:', url || '(空)');
    console.error('  COZE_SUPABASE_SERVICE_ROLE_KEY:', key ? '(已设置)' : '(空)');
    throw new Error(
      'Supabase 配置缺失，请检查 .env.local 中的 COZE_SUPABASE_URL 和 COZE_SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  // 修正常见的 URL 笔误
  const cleanUrl = url.replace(/^h+ttps/, 'https');

  return createClient(cleanUrl, key);
}

// 延迟初始化，避免模块加载时 env 未就绪导致崩溃
// （无数据库类型定义，运行时行为不受影响）
let _client: any | null = null;

export const supabase = new Proxy({} as any, {
  get(_, prop) {
    if (!_client) _client = getSupabase();
    return _client[prop];
  },
});
