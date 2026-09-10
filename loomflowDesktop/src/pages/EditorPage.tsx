/**
 * EditorPage — Desktop 画布编辑器
 *
 * 复用 loomflow-ui 的 Tinyflow 画布，与 Web 端 EditorPage 对齐：
 * - 节点定义取自共享的 NodeRegistry（前端本地读取，桌面端无需后端接口）
 * - customNodes 注册 tinyflow 未内置的类型（如 excelNode），否则会渲染成兜底节点
 * - useTinyflowLocale 提供画布内置文本的本地化（库自身无 i18n API，走 DOM 翻译层）
 * - 主题跟随 next-themes，不再硬编码 light
 * - 试运行支持开始节点的输入参数（表单 / JSON 两种模式）
 *
 * 注意：画布容器必须「始终挂载」——早期版本在 loading 时提前 return 整个页面，
 * 导致初始化 effect 运行时 containerRef.current 仍为 null 且因依赖为 [] 永不重跑，
 * 画布区域会一直空白。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import 'loomflow-ui/dist/index.css';
import type { Tinyflow as TinyflowInstance, CustomNode } from 'loomflow-ui';
import type { TinyflowData, Parameter } from '@/lib/tinyflow/types';
import { nodeRegistry } from '@/lib/tinyflow/node-registry';
import '@/lib/tinyflow/nodes/builtin'; // 副作用：注册内置节点定义
import { useTinyflowLocale } from '@/lib/tinyflow-locale';
import { toast } from 'sonner';
import { ArrowLeft, Save, Play, Square, Loader2, CheckCircle2, XCircle, Clock, Settings2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';
import type { WorkflowRecord, WorkflowVersionRecord } from '../app/repositories/workflow-repository';
import { LocalWorkflowRuntime } from '../app/runtime';
import type { FlowEvent } from '../app/runtime';
import { VersionHistoryPanel } from '../components/VersionHistoryPanel';

/** tinyflow 库内建识别的节点类型（其余类型需注册为 customNode 才能正常渲染） */
const TINYFLOW_BUILTIN_TYPES = [
  'startNode', 'endNode', 'llmNode', 'httpNode', 'codeNode', 'knowledgeNode',
  'searchEngineNode', 'templateNode', 'conditionNode', 'confirmNode', 'loopNode',
];

/** 把 NodeRegistry 中 tinyflow 不认识的类型转成 customNodes 配置 */
function buildCustomNodes(): Record<string, CustomNode> {
  const map: Record<string, CustomNode> = {};
  for (const def of nodeRegistry.list()) {
    if (TINYFLOW_BUILTIN_TYPES.includes(def.type)) continue;
    map[def.type] = {
      title: def.label,
      description: def.description ?? '',
      group: 'tools',
      parametersEnable: true,
      parameters: (def.configSchema ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        dataType: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string',
        ...(f.default !== undefined ? { defaultValue: String(f.default) } : {}),
      })),
      outputDefsEnable: true,
    };
  }
  return map;
}

/**
 * 提取「工作流内容」的规范化表示，用于脏标记比对。
 *
 * 不能直接 JSON.stringify(getData())：
 * - 库挂载后会往节点/边上补 `measured`、`selected`、`dragging` 等运行时字段
 * - viewport 会在自动适配画布时变化，而它并不是用户对内容的修改
 * 这两类变化都会让刚打开的工作流立刻显示「未保存」。
 */
function canonicalizeWorkflow(data: TinyflowData | null | undefined): string {
  const nodes = (data?.nodes ?? []).map((n) => {
    const node = n as unknown as Record<string, unknown>;
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    };
  });
  const edges = (data?.edges ?? []).map((e) => {
    const edge = e as unknown as Record<string, unknown>;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: edge.data,
    };
  });
  return JSON.stringify({ nodes, edges });
}

/**
 * 新建工作流的初始数据。
 *
 * 节点标题取自共享的 NodeRegistry（与左侧节点面板同源），而不是在此处按当前语言固化：
 * 语言由 I18nProvider 从 localStorage 异步恢复，构造时读到的可能是旧语言，
 * 会把中文标题写进英文界面的工作流数据里。
 * 标题文本由 useTinyflowLocale 在渲染层统一本地化。
 */
function createEmptyWorkflow(): TinyflowData {
  const base = {
    description: '',
    condition: '',
    loopEnable: false,
    loopIntervalMs: '',
    maxLoopCount: '',
    loopBreakCondition: '',
    retryEnable: false,
    retryIntervalMs: '',
    maxRetryCount: '',
    resetRetryCountAfterNormal: false,
  };
  const startLabel = nodeRegistry.get('startNode')?.label ?? 'Start';
  const endLabel = nodeRegistry.get('endNode')?.label ?? 'End';
  return {
    nodes: [
      { id: 'start-1', type: 'startNode', position: { x: 100, y: 200 }, data: { ...base, title: startLabel, parameters: [] } },
      { id: 'end-1', type: 'endNode', position: { x: 600, y: 200 }, data: { ...base, title: endLabel } },
    ],
    edges: [{ id: 'edge-1', source: 'start-1', target: 'end-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** 读取开始节点的输入参数定义 */
function getStartParameters(flowData: TinyflowData | null): Parameter[] {
  if (!flowData?.nodes) return [];
  const startNode = flowData.nodes.find((n) => n.type === 'startNode');
  const params = (startNode?.data as Record<string, unknown> | undefined)?.parameters;
  return Array.isArray(params) ? (params as Parameter[]) : [];
}

/** 按参数定义生成默认输入值 */
function buildDefaultValues(params: Parameter[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of params) {
    const key = p.name || '';
    if (!key) continue;
    const dt = p.dataType || 'string';
    if (dt === 'number') {
      const num = Number(p.defaultValue);
      values[key] = p.defaultValue !== undefined && !isNaN(num) ? num : 0;
    } else if (dt === 'boolean') {
      values[key] = p.defaultValue === 'true';
    } else if (dt === 'object' || dt === 'array') {
      try {
        values[key] = p.defaultValue ? JSON.parse(p.defaultValue) : (dt === 'array' ? [] : {});
      } catch {
        values[key] = dt === 'array' ? [] : {};
      }
    } else {
      values[key] = p.defaultValue ?? '';
    }
  }
  return values;
}

type PanelMode = 'none' | 'run' | 'trace' | 'versions';
type CanvasState = 'pending' | 'ready' | 'error';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repo = useRepository();
  const t = useT();
  const { resolvedTheme } = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TinyflowInstance | null>(null);
  const workflowRef = useRef<WorkflowRecord | null>(null);

  // tinyflow 画布内置文本的本地化（库无 i18n API）
  useTinyflowLocale(containerRef);

  const [loading, setLoading] = useState(true);
  const [canvasState, setCanvasState] = useState<CanvasState>('pending');
  const [nodeCount, setNodeCount] = useState(0);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(id ?? null);
  const lastSavedDataRef = useRef<string>('');

  // Run state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const runtimeRef = useRef<LocalWorkflowRuntime | null>(null);

  // Node execution tracking
  const [flowEvents, setFlowEvents] = useState<FlowEvent[]>([]);

  // 右侧面板（互斥，避免多个面板同时挤压画布）
  const [panel, setPanel] = useState<PanelMode>('none');

  // 试运行输入
  const [runParams, setRunParams] = useState<Parameter[]>([]);
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');

  // ===== Load or create workflow =====
  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        const wf = await repo.get(id);
        if (!wf) { toast.error(t('editor.notFound')); navigate('/workflows'); return; }
        setTitle(wf.title);
        workflowRef.current = wf;
        setCurrentId(wf.id);
        lastSavedDataRef.current = canonicalizeWorkflow(wf.data);
        instanceRef.current?.setData(wf.data);
      } catch (err) {
        console.error('[EditorPage] Load failed:', err);
        toast.error(t('editor.loadFailed'));
        navigate('/workflows');
      } finally { setLoading(false); }
    })();
  }, [id, repo, navigate, t]);

  // ===== Init Tinyflow =====
  // 画布容器始终挂载（见文件头注释），因此这里 effect 首次执行时 containerRef 已就绪。
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    (async () => {
      try {
        const { Tinyflow } = await import('loomflow-ui');
        if (destroyed || !containerRef.current) return;

        // 画布里的 LLM 节点模型下拉：直接读本地 SQLite 已启用的模型
        const provider = {
          llm: async () => {
            try {
              const models = await repo.listModels();
              return models
                .filter((m) => m.isEnabled)
                .map((m) => ({ value: m.id, label: m.displayName || m.modelName }));
            } catch {
              return [];
            }
          },
          knowledge: () => [],
          searchEngine: () => [],
        };

        const seed = workflowRef.current?.data ?? (id ? undefined : createEmptyWorkflow());
        if (seed) lastSavedDataRef.current = canonicalizeWorkflow(seed);

        // 库构造后不会同步创建 SvelteFlow 实例（getData() 此时会抛错），因此
        // 「已落盘」基线要等首次 onDataChange 回调拿到归一化数据后再校准。
        let baselinePending = true;
        const applyCanvasState = (next: TinyflowData) => {
          setNodeCount(next?.nodes?.length ?? 0);
          const canonical = canonicalizeWorkflow(next);
          if (baselinePending) {
            baselinePending = false;
            lastSavedDataRef.current = canonical;
            setDirty(false);
            return;
          }
          setDirty(canonical !== lastSavedDataRef.current);
        };

        instanceRef.current = new Tinyflow({
          element: containerRef.current,
          defaultTheme: (resolvedTheme === 'dark' ? 'dark' : 'light'),
          data: seed,
          provider,
          customNodes: buildCustomNodes(),
          onDataChange: (next) => applyCanvasState(next as TinyflowData),
        });

        setNodeCount(seed?.nodes?.length ?? 0);
        setCanvasState('ready');
      } catch (err) {
        console.error('[EditorPage] Tinyflow init failed:', err);
        if (!destroyed) setCanvasState('error');
      }
    })();
    return () => {
      destroyed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== Theme sync =====
  useEffect(() => {
    if (canvasState !== 'ready') return;
    instanceRef.current?.setTheme(resolvedTheme === 'dark' ? 'dark' : 'light');
  }, [resolvedTheme, canvasState]);

  // ===== Init Runtime =====
  useEffect(() => {
    const runtime = new LocalWorkflowRuntime(repo);
    runtime.onEvent((event: FlowEvent) => {
      setFlowEvents((prev) => [...prev, event]);
      if (event.type === 'flow_start') setActiveExecutionId(event.executionId ?? null);
    });
    runtimeRef.current = runtime;
  }, [repo]);

  // ===== Save =====
  // 返回落库后的 workflow id：新建工作流时 id 在保存后才产生，
  // 调用方（handleRun）必须使用返回值，避免闭包里 currentId 仍是旧值。
  const handleSave = useCallback(async (): Promise<string | null> => {
    if (!instanceRef.current) return currentId;
    const data = instanceRef.current.getData() as TinyflowData;
    if (!data) return currentId;
    setSaving(true);
    try {
      let record: WorkflowRecord;
      if (currentId) {
        record = await repo.update(currentId, { title: title.trim() || undefined, data });
      } else {
        record = await repo.create({ title: title.trim() || t('workflows.untitled'), data });
        setCurrentId(record.id);
        navigate(`/workflows/editor/${record.id}`, { replace: true });
      }
      lastSavedDataRef.current = canonicalizeWorkflow(data);
      setDirty(false);
      workflowRef.current = record;
      return record.id;
    } catch (err) {
      console.error('[EditorPage] Save failed:', err);
      toast.error(t('common.error'));
      return null;
    } finally { setSaving(false); }
  }, [currentId, repo, title, navigate, t]);

  // ===== Autosave（仅已落库的工作流）=====
  useEffect(() => {
    if (!dirty || !currentId) return;
    const timer = setTimeout(() => { handleSave(); }, 2000);
    return () => clearTimeout(timer);
  }, [dirty, currentId, handleSave]);

  // ===== Cmd/Ctrl+S =====
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ===== Run 配置面板 =====
  const refreshRunParams = useCallback(() => {
    const data = instanceRef.current?.getData() as TinyflowData | undefined;
    const params = getStartParameters(data ?? null);
    const defaults = buildDefaultValues(params);
    setRunParams(params);
    setFormValues(defaults);
    setJsonText(JSON.stringify(defaults, null, 2));
  }, []);

  const openRunPanel = useCallback(() => {
    refreshRunParams();
    setPanel((p) => (p === 'run' ? 'none' : 'run'));
  }, [refreshRunParams]);

  /** 解析试运行输入（表单或 JSON） */
  const buildInputs = useCallback((): Record<string, unknown> => {
    if (inputMode === 'json') {
      try {
        return JSON.parse(jsonText || '{}') as Record<string, unknown>;
      } catch {
        throw new Error(t('canvas.jsonParseError'));
      }
    }
    return formValues;
  }, [inputMode, jsonText, formValues, t]);

  // ===== Run =====
  const handleRun = useCallback(async () => {
    if (!instanceRef.current || running) return;
    const data = instanceRef.current.getData() as TinyflowData;
    if (!data) return;

    let inputs: Record<string, unknown> = {};
    if (panel === 'run') {
      try {
        inputs = buildInputs();
      } catch (err) {
        setPanel('trace');
        setRunError((err as Error).message);
        return;
      }
    }

    // 运行前先落盘：既保证画布内容与执行内容一致，也保证首次运行能拿到
    // workflow id 从而写入 executions 记录（否则历史里看不到这次运行）
    let targetId: string | null = currentId;
    if (dirty || !currentId) targetId = await handleSave();

    setRunning(true); setResult(null); setRunError(null); setPanel('trace');
    setFlowEvents([]); setActiveExecutionId(null);
    try {
      const runtime = runtimeRef.current;
      if (!runtime) throw new Error(t('editor.runtimeNotReady'));
      const res = await runtime.execute({ flowData: data, inputs, workflowId: targetId ?? undefined });
      if (res.status === 'completed') {
        setResult(res.outputs ?? null);
        toast.success(t('editor.runDone', { ms: res.durationMs ?? 0 }));
      } else if (res.status === 'cancelled') {
        toast.info(t('workflows.flowStopped'));
      } else {
        setRunError(res.error ?? t('editor.runFailed'));
        toast.error(res.error ?? t('editor.runFailed'));
      }
    } catch (err) {
      const e = err as Error;
      setRunError(e.message);
      toast.error(e.message);
    } finally { setRunning(false); setActiveExecutionId(null); }
  }, [running, panel, buildInputs, dirty, currentId, handleSave, t]);

  // ===== Stop =====
  const handleStop = useCallback(async () => {
    const execId = activeExecutionId;
    if (!execId) return;
    try {
      await runtimeRef.current?.stop(execId);
    } catch {
      toast.error(t('common.error'));
    }
  }, [activeExecutionId, t]);

  // ===== Version Restore =====
  const handleVersionRestore = useCallback(async (version: WorkflowVersionRecord) => {
    if (!instanceRef.current || !currentId) return;
    const record = await repo.update(currentId, {
      title: version.title,
      description: version.description ?? undefined,
      data: version.data,
    });
    instanceRef.current.setData(version.data);
    lastSavedDataRef.current = canonicalizeWorkflow(version.data);
    setTitle(record.title);
    workflowRef.current = record;
    setDirty(false);
    setPanel('none');
  }, [currentId, repo]);

  // ===== 输入表单渲染 =====
  const renderInputField = useCallback((p: Parameter, idx: number) => {
    const key = p.name || `field_${idx}`;
    const dt = (p.dataType || 'string').toLowerCase();
    const val = formValues[key];
    const setVal = (v: unknown) => setFormValues((prev) => ({ ...prev, [key]: v }));
    const label = p.name || t('editor.fieldFallback', { index: idx + 1 });
    const inputCls = 'mt-1 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm';

    return (
      <div key={idx} className="space-y-1">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium">{label}</label>
          {p.required && <span className="text-xs text-red-500">*</span>}
          <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{dt}</span>
        </div>
        {p.description && <p className="text-[11px] text-muted-foreground">{p.description}</p>}
        {dt === 'boolean' ? (
          <button
            type="button"
            onClick={() => setVal(!val)}
            className="mt-1 inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs"
          >
            <span className={`h-3 w-3 rounded-full ${val ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
            {val ? 'true' : 'false'}
          </button>
        ) : dt === 'number' ? (
          <input type="number" value={(val as number) ?? 0} onChange={(e) => setVal(Number(e.target.value))} className={inputCls} />
        ) : dt === 'object' || dt === 'array' ? (
          <textarea
            value={typeof val === 'string' ? val : JSON.stringify(val ?? (dt === 'array' ? [] : {}), null, 2)}
            onChange={(e) => setVal(e.target.value)}
            rows={3}
            className={`${inputCls} font-mono text-xs`}
          />
        ) : (
          <input
            value={(val as string) ?? ''}
            onChange={(e) => setVal(e.target.value)}
            placeholder={p.defaultValue || ''}
            className={inputCls}
          />
        )}
      </div>
    );
  }, [formValues, t]);

  // ===== Render =====
  return (
    <div className="relative flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => navigate('/workflows')} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {t('common.back')}
          </button>
          <div className="h-4 w-px bg-border" />
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="w-64 border-none bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
            placeholder={t('workflows.untitled')}
          />
          {dirty && <span className="shrink-0 text-xs text-amber-500">● {t('common.unsaved')}</span>}
          {canvasState === 'ready' && (
            <span className="shrink-0 text-xs text-muted-foreground">{t('editor.nodeCount', { count: nodeCount })}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={openRunPanel}
            className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted ${panel === 'run' ? 'bg-muted' : ''}`}
            title={t('workflows.runConfig')}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t('workflows.runConfig')}
          </button>
          {currentId && (
            <button
              onClick={() => setPanel((p) => (p === 'versions' ? 'none' : 'versions'))}
              className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted ${panel === 'versions' ? 'bg-muted' : ''}`}
            >
              <Clock className="h-3.5 w-3.5" />
              {t('workflows.viewHistory')}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || (!dirty && !!currentId)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {t('common.save')}
          </button>
          {running ? (
            <button
              onClick={handleStop}
              disabled={!activeExecutionId}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              title={t('workflows.stopRun')}
            >
              <Square className="h-3.5 w-3.5" />
              {activeExecutionId ? t('workflows.stopRun') : t('workflows.running')}
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {t('workflows.run')}
            </button>
          )}
        </div>
      </div>

      {/* Canvas + side panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* 画布容器：必须始终挂载 */}
        <div className="relative min-w-0 flex-1">
          <div ref={containerRef} className="h-full w-full" />

          {(!loading && canvasState === 'pending') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t('editor.canvasLoading')}</span>
            </div>
          )}

          {canvasState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80">
              <XCircle className="h-5 w-5 text-red-500" />
              <span className="text-sm text-muted-foreground">{t('editor.initFailed')}</span>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                {t('common.refresh')}
              </button>
            </div>
          )}
        </div>

        {/* 试运行输入面板 */}
        {panel === 'run' && (
          <div className="flex w-80 shrink-0 flex-col border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-medium">{t('workflows.runConfig')}</span>
              <button onClick={() => setPanel('none')} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex items-center gap-1 border-b border-border px-4 py-2">
              <button
                onClick={() => { try { setFormValues(JSON.parse(jsonText || '{}')); } catch { /* 保留表单值 */ } setInputMode('form'); }}
                className={`rounded-md px-2 py-1 text-xs ${inputMode === 'form' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                {t('workflows.form')}
              </button>
              <button
                onClick={() => { setJsonText(JSON.stringify(formValues, null, 2)); setInputMode('json'); }}
                className={`rounded-md px-2 py-1 text-xs ${inputMode === 'json' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
              >
                {t('workflows.json')}
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {inputMode === 'form' ? (
                runParams.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">{t('workflows.noInputParams')}</p>
                ) : (
                  runParams.map((p, idx) => renderInputField(p, idx))
                )
              ) : (
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={12}
                  className="w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
                  placeholder='{"key": "value"}'
                />
              )}
            </div>
            <div className="border-t border-border p-3">
              <button
                onClick={handleRun}
                disabled={running}
                className="w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {t('workflows.run')}
              </button>
            </div>
          </div>
        )}

        {/* 执行追踪 / 结果面板 */}
        {panel === 'trace' && (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-medium">{t('canvas.traceTitle')}</span>
              <button onClick={() => setPanel('none')} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-3 p-4">
              {running && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('canvas.traceFlowRunning')}
                </div>
              )}

              {flowEvents.length === 0 && !running && !result && !runError && (
                <p className="text-sm text-muted-foreground">{t('workflows.noExecutionRecords')}</p>
              )}

              {/* 节点级执行轨迹 */}
              {flowEvents.filter((e) => e.nodeId).length > 0 && (
                <div className="space-y-1.5">
                  {flowEvents.filter((e) => e.nodeId).map((ev, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
                      {ev.type === 'node_start' && <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-blue-500" />}
                      {ev.type === 'node_complete' && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-500" />}
                      {ev.type === 'node_error' && <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-muted-foreground">{ev.nodeId}</span>
                          {ev.nodeType && <span className="shrink-0 text-muted-foreground/50">{ev.nodeType}</span>}
                          {ev.type === 'node_complete' && ev.data?.durationMs != null && (
                            <span className="ml-auto shrink-0 text-muted-foreground">{String(ev.data.durationMs)}ms</span>
                          )}
                        </div>
                        {ev.type === 'node_error' && ev.data?.error != null && (
                          <div className="mt-0.5 break-words text-red-500">{String(ev.data.error)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-600">{t('workflows.executionComplete')}</span>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
                </div>
              )}
              {runError && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-red-600">{t('workflows.executionError')}</span>
                  </div>
                  <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-xs text-destructive">{runError}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {panel === 'versions' && currentId && (
          <VersionHistoryPanel
            workflowId={currentId}
            onRestore={handleVersionRestore}
            onClose={() => setPanel('none')}
          />
        )}
      </div>

      {/* 画布未就绪时，工作流数据加载中的提示 */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
