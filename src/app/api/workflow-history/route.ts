import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

// 递归排序对象键，保证相同内容的工作流 hash 一致
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeHash(data: unknown): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  // 完全隔离：所有用户（含 admin）只能看到自己的工作流
  const { data, error } = await supabase
    .from('workflow_history')
    .select('*')
    .eq('saved', true)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body?.data) {
    return Response.json({ error: 'data 不能为空' }, { status: 400 });
  }

  const dataHash = computeHash(body.data);

  // upsert：data_hash 相同则更新，否则插入（去重）
  const { data, error } = await supabase
    .from('workflow_history')
    .upsert(
      {
        title: body.title?.trim() || '未命名工作流',
        description: body.description?.trim() || null,
        data: body.data,
        data_hash: dataHash,
        conversation_id: body.conversation_id || null,
        user_id: user.id,
        saved: true,
      },
      { onConflict: 'user_id,data_hash' },
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}
