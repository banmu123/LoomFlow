import { ChatPanel } from '@/components/ChatPanel';

// 对话界面（/chat/[id]）：专属对话窗口——标题栏 + 消息列表 + 底部输入框
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatPanel conversationId={id} />;
}
