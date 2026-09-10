/**
 * ChatPage — Desktop 对话页面
 *
 * 对话历史已在 SidebarNav 中展示，此处只渲染 ChatPanel 或 ChatLanding。
 * 与 Web 端一致：点击侧边栏对话 → /chat/:id → ChatPanel，点 New Chat → /chat → ChatLanding
 */

import { useParams } from 'react-router-dom';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ChatLanding } from '../components/chat/ChatLanding';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0">
        {id ? <ChatPanel conversationId={id} /> : <ChatLanding />}
      </div>
    </div>
  );
}
