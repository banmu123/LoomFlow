/**
 * VersionHistoryPanel — 版本历史侧边面板
 *
 * 在编辑器内浏览版本、预览、恢复。
 */

import { useEffect, useState, useCallback } from 'react';
import { Clock, RotateCcw, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useRepository } from '../app/repositories';
import type { WorkflowVersionRecord } from '../app/repositories/workflow-repository';
import { Button } from '@/components/ui/button';

interface VersionHistoryPanelProps {
  workflowId: string;
  onRestore: (version: WorkflowVersionRecord) => void;
  onClose: () => void;
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString(undefined, { hour12: false }); }
  catch { return iso; }
}

export function VersionHistoryPanel({ workflowId, onRestore, onClose }: VersionHistoryPanelProps) {
  const repo = useRepository();
  const [versions, setVersions] = useState<WorkflowVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    repo.listVersions(workflowId)
      .then(setVersions)
      .catch(() => toast.error('Failed to load versions'))
      .finally(() => setLoading(false));
  }, [workflowId, repo]);

  const handleRestore = useCallback(async (version: WorkflowVersionRecord) => {
    setRestoring(version.version);
    try {
      onRestore(version);
      toast.success(`Restored to version ${version.version}`);
    } catch {
      toast.error('Restore failed');
    } finally { setRestoring(null); }
  }, [onRestore]);

  return (
    <div className="flex h-full w-80 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Version History</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && versions.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No versions yet</div>
        )}
        {versions.map((v) => (
          <div key={v.id} className="border-b border-border px-4 py-3 hover:bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                    v{v.version}
                  </span>
                  <span className="text-sm font-medium">{v.title}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatTime(v.createdAt)}
                </div>
                {v.description && (
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{v.description}</div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRestore(v)}
                disabled={restoring === v.version}
                className="flex-shrink-0"
              >
                {restoring === v.version ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                Restore
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
