/**
 * EditorPage — Desktop 画布编辑器
 *
 * 复用 loomflow-ui 的 Tinyflow 画布，与 Web 端 EditorPage 视觉一致。
 * Cmd+S 保存、自动保存、本地运行。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import 'loomflow-ui/dist/index.css';
import type { Tinyflow as TinyflowInstance } from 'loomflow-ui';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { toast } from 'sonner';
import { ArrowLeft, Save, Play, Square, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';
import type { WorkflowRecord, WorkflowVersionRecord } from '../app/repositories/workflow-repository';
import { LocalWorkflowRuntime } from '../app/runtime';
import type { FlowEvent } from '../app/runtime';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';

function createEmptyWorkflow(): TinyflowData {
  return {
    nodes: [
      { id: 'start-1', type: 'startNode', position: { x: 100, y: 200 }, data: { title: 'Start', description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false } },
      { id: 'end-1', type: 'endNode', position: { x: 600, y: 200 }, data: { title: 'End', description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false } },
    ],
    edges: [{ id: 'edge-1', source: 'start-1', target: 'end-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repo = useRepository();
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TinyflowInstance | null>(null);
  const workflowRef = useRef<WorkflowRecord | null>(null);

  const [loading, setLoading] = useState(true);
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(id ?? null);
  const lastSavedDataRef = useRef<string>('');

  // Run state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const runtimeRef = useRef<LocalWorkflowRuntime | null>(null);

  // Node execution tracking
  const [nodeEvents, setNodeEvents] = useState<Map<string, { status: 'running' | 'completed' | 'error'; data?: Record<string, unknown> }>>(new Map());
  const [flowEvents, setFlowEvents] = useState<FlowEvent[]>([]);

  // Version history
  const [showVersions, setShowVersions] = useState(false);

  // ===== Load or create workflow =====
  useEffect(() => {
    if (id) {
      // Load existing
      (async () => {
        try {
          const wf = await repo.get(id);
          if (!wf) { toast.error('Not found'); navigate('/workflows'); return; }
          setWorkflow(wf);
          setTitle(wf.title);
          workflowRef.current = wf;
          setCurrentId(wf.id);
          lastSavedDataRef.current = JSON.stringify(wf.data);
          if (instanceRef.current) instanceRef.current.setData(wf.data);
        } catch {
          toast.error('Load failed');
          navigate('/workflows');
        } finally { setLoading(false); }
      })();
    } else {
      // New workflow
      setLoading(false);
    }
  }, [id, repo, navigate]);

  // ===== Init Tinyflow =====
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    (async () => {
      try {
        const { Tinyflow } = await import('loomflow-ui');
        if (destroyed || !containerRef.current) return;
        instanceRef.current = new Tinyflow({
          element: containerRef.current,
          defaultTheme: 'light',
          provider: { llm: () => [], knowledge: () => [], searchEngine: () => [] },
          onDataChange: () => { setDirty(true); },
        });
        if (workflowRef.current) {
          instanceRef.current.setData(workflowRef.current.data);
        } else if (!id) {
          const empty = createEmptyWorkflow();
          instanceRef.current.setData(empty);
          lastSavedDataRef.current = JSON.stringify(empty);
        }
      } catch (err) {
        console.error('[EditorPage] Tinyflow init failed:', err);
      }
    })();
    return () => { destroyed = true; instanceRef.current?.destroy(); instanceRef.current = null; };
  }, []); // eslint-disable-line

  // ===== Init Runtime =====
  useEffect(() => {
    const runtime = new LocalWorkflowRuntime(repo);
    runtime.onEvent((event: FlowEvent) => {
      setFlowEvents((prev) => [...prev, event]);
      if (event.nodeId) {
        setNodeEvents((prev) => {
          const next = new Map(prev);
          if (event.type === 'node_start') {
            next.set(event.nodeId!, { status: 'running' });
          } else if (event.type === 'node_complete') {
            next.set(event.nodeId!, { status: 'completed', data: event.data });
          } else if (event.type === 'node_error') {
            next.set(event.nodeId!, { status: 'error', data: event.data });
          }
          return next;
        });
      }
    });
    runtimeRef.current = runtime;
  }, [repo]);

  // ===== Autosave =====
  useEffect(() => {
    if (!dirty || !currentId) return;
    const timer = setTimeout(() => { handleSave(); }, 2000);
    return () => clearTimeout(timer);
  }, [dirty, currentId]); // eslint-disable-line

  // ===== Cmd+S =====
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // eslint-disable-line

  // ===== Save =====
  const handleSave = useCallback(async () => {
    if (!instanceRef.current) return;
    const data = instanceRef.current.getData() as TinyflowData;
    if (!data) return;
    setSaving(true);
    try {
      let record: WorkflowRecord;
      if (currentId) {
        record = await repo.update(currentId, { title: title.trim() || undefined, data });
      } else {
        record = await repo.create({ title: title.trim() || t('workflows.untitled') || 'Untitled Workflow', data });
        setCurrentId(record.id);
        navigate(`/workflows/editor/${record.id}`, { replace: true });
      }
      lastSavedDataRef.current = JSON.stringify(data);
      setDirty(false);
      workflowRef.current = record;
      setWorkflow(record);
    } catch (err) {
      console.error('[EditorPage] Save failed:', err);
      toast.error(t('common.error'));
    } finally { setSaving(false); }
  }, [currentId, repo, title, navigate, t]);

  // ===== Run =====
  const handleRun = useCallback(async () => {
    if (!instanceRef.current || running) return;
    const data = instanceRef.current.getData() as TinyflowData;
    if (!data) return;
    if (dirty) await handleSave();
    setRunning(true); setResult(null); setRunError(null); setShowResults(true);
    setNodeEvents(new Map()); setFlowEvents([]);
    try {
      const runtime = runtimeRef.current;
      if (!runtime) throw new Error('Runtime not ready');
      const res = await runtime.execute({ flowData: data, inputs: {}, workflowId: currentId ?? undefined });
      if (res.status === 'completed') { setResult(res.outputs ?? null); toast.success(`Done ${res.durationMs}ms`); }
      else { setRunError(res.error ?? 'Failed'); toast.error(res.error ?? 'Failed'); }
    } catch (err) { const e = err as Error; setRunError(e.message); toast.error(e.message); }
    finally { setRunning(false); }
  }, [running, dirty, handleSave, currentId]);

  // ===== Version Restore =====
  const handleVersionRestore = useCallback(async (version: WorkflowVersionRecord) => {
    if (!instanceRef.current || !currentId) return;
    // Update the workflow with the version's data
    const record = await repo.update(currentId, {
      title: version.title,
      description: version.description ?? undefined,
      data: version.data,
    });
    // Reload canvas
    instanceRef.current.setData(version.data);
    setWorkflow(record);
    setTitle(record.title);
    workflowRef.current = record;
    setDirty(false);
    setShowVersions(false);
  }, [currentId, repo]);

  // ===== Render =====
  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — 与 Web 端一致的顶部工具栏 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/workflows')} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t('common.back') || 'Back'}
          </button>
          <div className="h-4 w-px bg-border" />
          <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} className="bg-transparent text-sm font-medium outline-none border-none w-64 placeholder:text-muted-foreground" placeholder={t('workflows.untitled') || 'Untitled Workflow'} />
          {dirty && <span className="text-xs text-amber-500">● {t('common.unsaved') || 'Unsaved'}</span>}
        </div>
        <div className="flex items-center gap-2">
          {currentId && (
            <button
              onClick={() => setShowVersions(!showVersions)}
              className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted ${showVersions ? 'bg-muted' : ''}`}
            >
              <Clock className="h-3.5 w-3.5" />
              Versions
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('common.save')}
          </button>
          <button onClick={handleRun} disabled={running} className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50">
            {running ? <><Square className="h-3.5 w-3.5" />Running...</> : <><Play className="h-3.5 w-3.5" />{t('workflows.run') || 'Run'}</>}
          </button>
        </div>
      </div>

      {/* Canvas + Results + Version History */}
      <div className="flex flex-1 overflow-hidden">
        <div ref={containerRef} className="flex-1" />
        {showResults && (
          <div className="w-80 border-l border-border overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-sm font-medium">{t('workflows.executionResult') || 'Execution'}</span>
              <button onClick={() => setShowResults(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {running && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Running...</div>}

              {/* Node-level events */}
              {flowEvents.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trace</div>
                  {flowEvents.filter((e) => e.nodeId).map((ev, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                      {ev.type === 'node_start' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                      {ev.type === 'node_complete' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      {ev.type === 'node_error' && <XCircle className="h-3 w-3 text-red-500" />}
                      <span className="font-mono text-muted-foreground">{ev.nodeId}</span>
                      {ev.type === 'node_complete' && ev.data?.durationMs != null && (
                        <span className="ml-auto text-muted-foreground">{String(ev.data.durationMs)}ms</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result && <div><div className="flex items-center gap-2 mb-2"><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-sm font-medium text-green-600">OK</span></div><pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre></div>}
              {runError && <div><div className="flex items-center gap-2 mb-2"><XCircle className="h-4 w-4 text-red-500" /><span className="text-sm font-medium text-red-600">Error</span></div><pre className="rounded-md bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap">{runError}</pre></div>}
            </div>
          </div>
        )}
        {showVersions && currentId && (
          <VersionHistoryPanel
            workflowId={currentId}
            onRestore={handleVersionRestore}
            onClose={() => setShowVersions(false)}
          />
        )}
      </div>
    </div>
  );
}
