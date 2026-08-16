import { ChatPanel } from '@/components/ChatPanel';

// 对话页路由：/chat = 新聊天（空态）；/chat/[id] = 已生成的对话
// 用 [[...id]] 可选捕获段：两个地址是同一个页面组件，切换时不重挂载（流式回复不中断）
export default async function ChatPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  return <ChatPanel conversationId={id?.[0] ?? ''} />;
}
