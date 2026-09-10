/**
 * ChatPage — Desktop 对话页面
 *
 * 左侧对话列表 + 右侧对话面板（ChatPanel 或 ChatLanding）。
 * 与 Web 端 /chat 页面结构一致。
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useRepository } from '../app/repositories';
import type { ConversationSummary } from '../app/repositories/workflow-repository';
import { ConversationList } from '../components/chat/ConversationList';
import { ChatPanel } from '../components/chat/ChatPanel';
import { ChatLanding } from '../components/chat/ChatLanding';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repo = useRepository();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try { setConversations(await repo.listConversations()); }
    catch { toast.error('Failed to load conversations'); }
    finally { setLoading(false); }
  }, [repo]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const handleNew = useCallback(async () => {
    navigate('/chat');
  }, [navigate]);

  const handleDelete = useCallback(async (convId: string) => {
    try {
      await repo.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (id === convId) navigate('/chat');
      toast.success('Conversation deleted');
    } catch {
      toast.error('Delete failed');
    }
  }, [repo, id, navigate]);

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        loading={loading}
        onNew={handleNew}
        onDelete={handleDelete}
      />
      <div className="flex-1 min-w-0">
        {id ? <ChatPanel conversationId={id} /> : <ChatLanding />}
      </div>
    </div>
  );
}
