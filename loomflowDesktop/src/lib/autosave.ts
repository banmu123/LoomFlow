/**
 * useAutosave — 工作流自动保存 Hook
 *
 * 在 workflow data 变化时 debounce 自动保存。
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { TinyflowData } from '@/lib/tinyflow/types';
import type { WorkflowRepository, WorkflowRecord } from '../app/repositories/workflow-repository';

interface UseAutosaveOptions {
  repository: WorkflowRepository;
  workflowId: string | null;
  data: TinyflowData | null;
  enabled?: boolean;
  debounceMs?: number;
  onSaved?: (record: WorkflowRecord) => void;
}

export function useAutosave({
  repository,
  workflowId,
  data,
  enabled = true,
  debounceMs = 2000,
  onSaved,
}: UseAutosaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef<string>('');

  const save = useCallback(async () => {
    if (!data || !workflowId) return;
    const dataStr = JSON.stringify(data);
    if (dataStr === lastSavedRef.current) return; // No changes

    setSaving(true);
    try {
      const record = await repository.update(workflowId, { data });
      lastSavedRef.current = dataStr;
      onSaved?.(record);
    } catch (err) {
      console.error('[autosave] Failed:', err);
    } finally {
      setSaving(false);
    }
  }, [repository, workflowId, data, onSaved]);

  // Update lastSaved when workflowId or data changes externally
  useEffect(() => {
    if (data) {
      lastSavedRef.current = JSON.stringify(data);
    }
  }, [workflowId]); // Only reset on workflow change, not on every data edit

  // Debounced autosave
  useEffect(() => {
    if (!enabled || !data || !workflowId) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      save();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data, enabled, debounceMs, save, workflowId]);

  return { saving, save };
}
