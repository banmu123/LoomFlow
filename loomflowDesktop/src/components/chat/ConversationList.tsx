/**
 * ConversationList — 对话侧边栏
 *
 * 显示对话列表，支持搜索、新建、删除。
 */

import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, MessageSquare, Trash2 } from 'lucide-react';
import type { ConversationSummary } from '../../app/repositories/workflow-repository';

interface ConversationListProps {
  conversations: ConversationSummary[];
  loading: boolean;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export function ConversationList({ conversations, loading, onNew, onDelete }: ConversationListProps) {
  const { id: activeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  return (
    <div className="flex h-full w-64 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Chats</span>
        <button
          onClick={onNew}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="New Chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">Loading...</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {search ? 'No results' : 'No conversations yet'}
          </div>
        )}
        {filtered.map((c) => (
          <div
            key={c.id}
            onClick={() => navigate(`/chat/${c.id}`)}
            onMouseEnter={() => setHoveredId(c.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={`group flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
              c.id === activeId
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted/50 text-foreground'
            }`}
          >
            <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-50" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm">{c.title}</div>
            </div>
            <span className="flex-shrink-0 text-xs text-muted-foreground">{formatTime(c.updatedAt)}</span>
            {hoveredId === c.id && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
