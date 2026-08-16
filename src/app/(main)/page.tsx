import { redirect } from 'next/navigation';

// 对话页统一入口 /chat（/chat = 新聊天空态，/chat/[id] = 已生成对话）
// 旧地址 / 重定向，避免两套入口
export default function RootPage() {
  redirect('/chat');
}
