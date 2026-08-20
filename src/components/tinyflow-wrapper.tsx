'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import 'loomflow-ui/dist/index.css';
import type { Tinyflow as TinyflowInstance, CustomNode } from 'loomflow-ui';
import type { TinyflowData, Parameter, FlowNode } from '@/lib/tinyflow/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Square, Loader2, CheckCircle2, XCircle, Clock, Settings2, ArrowLeft, Braces, Upload, Save, Boxes, History, RotateCcw, Plus, Bot } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { useTinyflowLocale } from '@/lib/tinyflow-locale';
import { toast } from 'sonner';
import { getPendingWorkflow, clearPendingWorkflow } from '@/lib/pending-workflow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatVersion } from '@/lib/version';
import { uploadFileToOSS } from '@/lib/oss-upload-client';
import { NodeConfigPanel } from '@/components/NodeConfigPanel';
import { CanvasAssistant } from '@/components/CanvasAssistant';
import { getConfigDefaults, mergeConfig } from '@/lib/tinyflow/node-config';
import type { NodeDefinition } from '@/lib/tinyflow/node-definition';

// ===== Types =====

interface NodeEvent {
  type: string;
  data: {
    nodeId?: string;
    status?: string;
    outputs?: Record<string, unknown>;
    error?: string;
    duration?: number;
  };
  timestamp: number;
}

interface ConfirmRequest {
  type: 'confirm_required';
  nodeId: string;
  message: string;
  confirms: Parameter[];
}

type InputMode = 'form' | 'json';

// ===== Helpers =====

/** Extract start node parameters from flowData */
function getStartParameters(flowData: TinyflowData | null): Parameter[] {
  if (!flowData?.nodes) return [];
  const startNode = flowData.nodes.find((n) => n.type === 'startNode');
  return startNode?.data?.parameters ?? [];
}

/** Build default values from parameters */
function buildDefaultValues(params: Parameter[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of params) {
    const key = p.name || '';
    if (!key) continue;
    const dt = p.dataType || 'string';
    switch (dt) {
      case 'number': {
        const num = Number(p.defaultValue);
        values[key] = p.defaultValue !== undefined && !isNaN(num) ? num : 0;
        break;
      }
      case 'boolean':
        values[key] = p.defaultValue === 'true';
        break;
      case 'object':
      case 'array':
        try {
          values[key] = p.defaultValue ? JSON.parse(p.defaultValue) : (dt === 'array' ? [] : {});
        } catch {
          values[key] = dt === 'array' ? [] : {};
        }
        break;
      default:
        values[key] = p.defaultValue ?? '';
    }
  }
  return values;
}

/** Format timestamp (number 毫秒或 ISO 字符串) to HH:MM:SS */
function formatTime(ts: number | string): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

// ===== Component =====

export default function TinyflowWrapper() {
  const router = useRouter();
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TinyflowInstance | null>(null);
  const flowIdRef = useRef<string | null>(null);

  // tinyflow 库内置文本国际化（库无 i18n API，DOM 翻译层：en 时替换，zh/卸载恢复）
  useTinyflowLocale(containerRef);

  // Run state
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<NodeEvent[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [confirmData, setConfirmData] = useState<Record<string, string>>({});
  const [showResults, setShowResults] = useState(false);

  // 节点库
  const [nodesOpen, setNodesOpen] = useState(false);
  const [nodeLibrary, setNodeLibrary] = useState<Array<{
    type: string; label: string; description: string; category: string; capabilities: string[];
  }>>([]);

  useEffect(() => {
    if (!nodesOpen) return;
    (async () => {
      try {
        const res = await fetch('/api/nodes');
        const data = await res.json();
        if (Array.isArray(data?.nodes)) setNodeLibrary(data.nodes);
      } catch {
        // ignore
      }
    })();
  }, [nodesOpen]);

  // ===== 节点库 → 画布：添加 / 配置 / 启用 =====
  // 启用节点集合（隐藏未启用的库节点面板项）
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(() => new Set());
  // ref 透传给 hiddenNodes（避免闭包捕获初始空集）
  const enabledTypesRef = useRef(enabledTypes);
  enabledTypesRef.current = enabledTypes;
  // 配置面板目标
  const [configTarget, setConfigTarget] = useState<{ id: string; type: string; data: Record<string, unknown> } | null>(null);

  // 从节点库添加节点到画布（数据来自 Registry，非硬编码；用 configSchema 默认值初始化配置）
  const handleAddNode = (def: NodeDefinition) => {
    const data = instanceRef.current?.getData() as TinyflowData | undefined;
    if (!data) return;
    const newNode: FlowNode = {
      id: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: def.type,
      position: { x: 100 + Math.random() * 240, y: 100 + Math.random() * 240 },
      data: {
        title: def.label,
        description: def.description ?? '',
        condition: '',
        loopEnable: false,
        loopIntervalMs: '0',
        maxLoopCount: '0',
        loopBreakCondition: '',
        retryEnable: false,
        retryIntervalMs: '0',
        maxRetryCount: '0',
        resetRetryCountAfterNormal: false,
        ...getConfigDefaults(def.configSchema),
      },
    };
    instanceRef.current?.setData({ ...data, nodes: [...data.nodes, newNode] });
    toast.success(t('canvas.nodeAdded', { label: def.label }));
  };

  // 读取画布当前节点（配置面板/删除用）
  const getCanvasNodes = (): FlowNode[] => {
    const data = instanceRef.current?.getData() as TinyflowData | undefined;
    return data?.nodes ?? [];
  };

  // 打开节点配置面板（回显 node.data；configSchema 默认值兜底）
  const openNodeConfig = (node: FlowNode) => {
    setConfigTarget({ id: node.id, type: node.type, data: (node.data as Record<string, unknown>) || {} });
  };

  // t('common.save')节点配置（按 configSchema 合并回 node.data，全量写回画布）
  const handleSaveNodeConfig = (nodeId: string, values: Record<string, unknown>) => {
    const data = instanceRef.current?.getData() as TinyflowData | undefined;
    if (!data) return;
    const def = nodeLibrary.find((n) => n.type === configTarget?.type);
    const schema = (def as unknown as NodeDefinition | undefined)?.configSchema ?? [];
    instanceRef.current?.setData({
      ...data,
      nodes: data.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: mergeConfig(n.data as Record<string, unknown>, schema, values) } : n,
      ),
    });
    toast.success(t('canvas.configSaved'));
  };

  // 单节点运行：构建默认输入（节点参数 defaultValue；ref 参数无上游时用默认值）

  // ===== 删除节点 =====
  // 删除画布节点
  const handleRemoveNode = useCallback(
    (nodeId: string) => {
      const data = instanceRef.current?.getData() as TinyflowData | undefined;
      if (!data) return;
      instanceRef.current?.setData({
        ...data,
        nodes: data.nodes.filter((n) => n.id !== nodeId),
        edges: data.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      });
      toast.success(t('canvas.nodeDeleted'));
    },
    [t],
  );

  // 启用/禁用节点类型（Tinyflow 库面板按 hiddenNodes 隐藏）
  const toggleNodeType = (type: string, enabled: boolean) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (enabled) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // 分类标签
  const CATEGORY_LABELS: Record<string, string> = {
    core: '核心',
    ai: 'AI',
    integration: '集成',
    logic: '逻辑',
    data: '数据',
    custom: '自定义',
  };

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('form');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [flowJsonText, setFlowJsonText] = useState('');
  // 画布 AI 助手面板
  const [assistantOpen, setAssistantOpen] = useState(false);
  // 单节点运行对话框
  const [nodeRunTarget, setNodeRunTarget] = useState<FlowNode | null>(null);
  const [nodeRunInputs, setNodeRunInputs] = useState('{}');
  const [nodeRunResult, setNodeRunResult] = useState<unknown>(null);
  const [nodeRunError, setNodeRunError] = useState<string | null>(null);
  const [nodeRunLoading, setNodeRunLoading] = useState(false);
  // 单节点运行：表单/JSON 输入模式
  const [nodeRunMode, setNodeRunMode] = useState<InputMode>('form');
  const [nodeRunFormValues, setNodeRunFormValues] = useState<Record<string, unknown>>({});
  const openNodeRun = useCallback((node: FlowNode) => {
    const params = (Array.isArray(node.data.parameters) ? node.data.parameters : []) as Parameter[];
    const defaults: Record<string, unknown> = {};
    for (const p of params) {
      const key = p.name || p.id;
      if (key && p.defaultValue !== undefined) defaults[key] = p.defaultValue;
    }
    setNodeRunTarget(node);
    setNodeRunMode('form');
    setNodeRunFormValues(defaults);
    setNodeRunInputs(JSON.stringify(defaults, null, 2));
    setNodeRunResult(null);
    setNodeRunError(null);
  }, []);

  // 单节点运行：表单/JSON 切换（与试运行面板一致）
  const switchNodeRunToForm = useCallback(() => {
    try {
      setNodeRunFormValues(JSON.parse(nodeRunInputs || '{}'));
    } catch {
      // JSON 非法时保留当前表单值
    }
    setNodeRunMode('form');
  }, [nodeRunInputs]);

  const switchNodeRunToJson = useCallback(() => {
    setNodeRunInputs(JSON.stringify(nodeRunFormValues, null, 2));
    setNodeRunMode('json');
  }, [nodeRunFormValues]);

  const handleNodeRun = useCallback(async () => {
    if (!nodeRunTarget || nodeRunLoading) return;
    let inputs: Record<string, unknown>;
    if (nodeRunMode === 'json') {
      try {
        inputs = JSON.parse(nodeRunInputs || '{}');
      } catch {
        setNodeRunError(t('canvas.jsonParseError'));
        return;
      }
    } else {
      inputs = nodeRunFormValues;
    }
    setNodeRunLoading(true);
    setNodeRunError(null);
    setNodeRunResult(null);
    try {
      const res = await fetch('/api/flow/execute-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: nodeRunTarget, inputs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNodeRunError(data?.error || t('canvas.executeFailed'));
        return;
      }
      setNodeRunResult(data.result);
    } catch {
      setNodeRunError(t('canvas.networkError'));
    } finally {
      setNodeRunLoading(false);
    }
  }, [nodeRunTarget, nodeRunLoading, nodeRunInputs, nodeRunMode, nodeRunFormValues, t]);

  // ===== Init Tinyflow =====
  useEffect(() => {
    let destroyed = false;
    (async () => {
      // 并行拉取画布所需数据 + 预加载 loomflow-ui 包（此前串行：4 接口 ~1.6s + import ~0.3s，
      // 现在全部并行，总耗时 ≈ 最慢一项 ~0.5s）
      const [llmRes, kbRes, searchRes, nodesRes, uiModule] = await Promise.all([
        fetch('/api/ai/models'),
        fetch('/api/knowledge-bases'),
        fetch('/api/search-providers'),
        fetch('/api/nodes'),
        import('loomflow-ui'),
      ]);
      const { Tinyflow } = uiModule;
      if (destroyed || !containerRef.current) return;

      // 模型列表严格来自模型配置（/api/ai/models），实例化前先拉取：
      // provider.llm 闭包持有局部变量（每次渲染/打开面板都能拿到最新配置，未配置时为空）
      let llmOptions: { value: string; label: string }[] = [];
      try {
        const data = await llmRes.json();
        if (Array.isArray(data)) {
          llmOptions = data.map((m: { id: string; label: string | null }) => ({
            value: m.id,
            label: m.label || m.id,
          }));
        }
      } catch {
        // 拉取失败保持空列表（画布会提示先配置模型）
      }
      // 知识库列表（画布知识库节点下拉选择，同模型选择模式）
      let knowledgeOptions: { value: string; label: string }[] = [];
      try {
        const data = await kbRes.json();
        if (Array.isArray(data)) {
          knowledgeOptions = data.map((k: { id: string; name: string }) => ({
            value: k.id,
            label: k.name,
          }));
        }
      } catch {
        // 拉取失败保持空列表
      }
      // 搜索服务列表（画布搜索节点「搜索引擎」下拉，仅已启用的）
      let searchProviderOptions: { value: string; label: string }[] = [];
      try {
        const data = await searchRes.json();
        if (Array.isArray(data)) {
          searchProviderOptions = (data as Array<{ id: string; label: string | null; enabled: boolean }>)
            .filter((p) => p.enabled)
            .map((p) => ({ value: p.id, label: p.label || p.id }));
        }
      } catch {
        // 拉取失败保持空列表（画布会提示先配置搜索服务）
      }
      // tinyflow 未内置的类型 → 注册为 customNode，画布才能正常渲染（否则显示 TinyFlow.ai 兜底节点）：
      // 1) 自定义节点（source: custom）2) 本项目新增的内置类型（如 excelNode，source: official 但 tinyflow 不认识）
      const TINYFLOW_BUILTIN_TYPES = [
        'startNode', 'endNode', 'llmNode', 'httpNode', 'codeNode', 'knowledgeNode',
        'searchEngineNode', 'templateNode', 'conditionNode', 'confirmNode', 'loopNode',
      ];
      let customNodeMap: Record<string, CustomNode> = {};
      try {
        const data = await nodesRes.json();
        const customDefs = (Array.isArray(data?.nodes) ? data.nodes : []).filter(
          (n: { type: string; source?: string }) =>
            n.source === 'custom' || !TINYFLOW_BUILTIN_TYPES.includes(n.type),
        );
        customNodeMap = Object.fromEntries(
          customDefs.map((n: { type: string; label: string; description?: string; configSchema?: Array<{ name: string; label: string; type: string; default?: unknown }> }) => [
            n.type,
            {
              title: n.label,
              description: n.description ?? '',
              group: 'custom',
              parametersEnable: true,
              parameters: (n.configSchema ?? []).map((f) => ({
                name: f.name,
                label: f.label,
                dataType: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string',
                ...(f.default !== undefined ? { defaultValue: String(f.default) } : {}),
              })),
              outputDefsEnable: true,
            },
          ]),
        );
      } catch {
        // 自定义节点拉取失败不影响内置节点
      }
      if (destroyed || !containerRef.current) return;

      instanceRef.current = new Tinyflow({
        element: containerRef.current,
        defaultTheme: 'light',
        provider: {
          llm: () => llmOptions,
          knowledge: () => knowledgeOptions,
          searchEngine: () => searchProviderOptions,
        },
        customNodes: customNodeMap,
        // 节点库启用控制：隐藏未启用的节点类型（勾选后才在面板显示）
        hiddenNodes: () => [...enabledTypesRef.current],
        // 节点工具栏「运行」按钮：单节点运行（不执行整个工作流）
        onNodeExecute: (node: unknown) => {
          const n = node as FlowNode;
          if (!n?.id || !n?.type) return;
          if (n.type === 'startNode' || n.type === 'endNode') {
            toast.error(t('canvas.nodeRunNotApplicable'));
            return;
          }
          openNodeRun(n);
        },
        onDataChange: (data) => {
          // 数据变化时触发重新计算 startParams
          console.log('Tinyflow data changed:', data);
        },
      });

      // check for pending workflow data (e.g. from AI chat navigation / 工作流列表打开)
      const pending = getPendingWorkflow();
      if (pending) {
        clearPendingWorkflow();
        try {
          instanceRef.current.setData(pending.data as TinyflowData);
          // 从列表打开时携带工作流 id：后续保存=更新当前记录并记录版本
          setCurrentWorkflowId(pending.id);
          toast.success(t('canvas.workflowLoaded'));
        } catch {
          toast.error(t('canvas.workflowInvalid'));
        }
      }
    })();
    return () => {
      destroyed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  // ===== Listen for workflow load events (from AI chat) =====
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || !instanceRef.current) return;
      try {
        instanceRef.current.setData(detail);
        toast.success(t('canvas.workflowLoaded'));
      } catch {
        toast.error(t('canvas.workflowInvalid'));
      }
    };
    window.addEventListener('tinyflow-load-data', handler);
    return () => window.removeEventListener('tinyflow-load-data', handler);
  }, []);

  // ===== Derived: start node parameters =====
  const startParams = useMemo<Parameter[]>(() => {
    if (!instanceRef.current) {
      console.log('startParams: instanceRef.current is null');
      return [];
    }
    try {
      const data = instanceRef.current.getData() as TinyflowData;
      console.log('startParams: raw data from getData():', data);

      if (!data?.nodes) {
        console.log('startParams: data.nodes is empty');
        return [];
      }

      console.log('startParams: all nodes:', data.nodes.map(n => ({ id: n.id, type: n.type, dataKeys: Object.keys(n.data || {}) })));

      const startNode = data.nodes.find((n) => n.type === 'startNode');
      if (!startNode) {
        console.log('startParams: startNode not found');
        return [];
      }

      console.log('startParams: startNode:', startNode);
      console.log('startParams: startNode.data:', startNode.data);

      // 尝试多种可能的字段名
      const nodeData = startNode.data as Record<string, unknown>;
      const params = nodeData.parameters
        ?? nodeData.inputs
        ?? nodeData.params
        ?? [];

      console.log('startParams: extracted params:', params);
      return Array.isArray(params) ? params as Parameter[] : [];
    } catch (e) {
      console.error('startParams: error:', e);
      return [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // ===== Sync form values when panel opens =====
  useEffect(() => {
    if (panelOpen) {
      const defaults = buildDefaultValues(startParams);
      setFormValues(defaults);
      setJsonText(JSON.stringify(defaults, null, 2));
    }
  }, [panelOpen, startParams]);

  // ===== Switch mode: sync values =====
  const switchToForm = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      setFormValues(parsed);
    } catch {
      // keep current form values if {t('workflows.json')} is invalid
    }
    setInputMode('form');
  }, [jsonText]);

  const switchToJson = useCallback(() => {
    setJsonText(JSON.stringify(formValues, null, 2));
    setInputMode('json');
  }, [formValues]);

  // ===== View {t('workflows.json')} =====
  const handleViewJson = useCallback(() => {
    if (!instanceRef.current) return;
    try {
      const data = instanceRef.current.getData();
      setFlowJsonText(JSON.stringify(data, null, 2));
    } catch {
      setFlowJsonText(t('canvas.saveFailed'));
    }
    setJsonDialogOpen(true);
  }, []);

  // ===== Save Workflow =====
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  // 当前工作流 id：从列表打开时携带；首次保存后记住（后续保存=更新当前记录，不新增列表条目）
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | undefined>(undefined);
  // 历史修改面板
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<
    {
      id: string;
      version: number;
      title: string;
      description: string | null;
      data: TinyflowData;
      created_at: string;
      is_current: boolean;
      published: boolean;
      published_version: number | null;
    }[]
  >([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  // 待还原的版本（ConfirmDialog 确认后加载到画布）
  const [versionToRestore, setVersionToRestore] = useState<{ version: number; title: string } | null>(null);
  // 待发布的版本（ConfirmDialog 确认后发布该版本）
  const [publishTarget, setPublishTarget] = useState<{ version: number; title: string } | null>(null);

  const handleSaveWorkflow = useCallback(async (title?: string, description?: string) => {
    if (!instanceRef.current || savingWorkflow) return;
    setSavingWorkflow(true);
    setSavedFlash(false);
    try {
      const data = instanceRef.current.getData();
      const res = await fetch('/api/workflow-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 已有工作流：更新当前记录并记录版本；首次：创建记录
          id: currentWorkflowId,
          title: title || undefined,
          description: description ?? undefined,
          data,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        setSavedFlash(true);
        // 首次保存后记住工作流 id：后续保存都是更新当前记录
        if (result?.id) setCurrentWorkflowId(result.id);
        toast.success(
          currentWorkflowId
            ? t('workflows.updated', { version: formatVersion(result?.version ?? 0) })
            : t('workflows.saved'),
          {
            duration: 4000,
            action: {
              label: t('workflows.viewHistory'),
              onClick: () => router.push('/workflows/history'),
            },
          },
        );
        // 1.5s 后恢复按钮状态
        setTimeout(() => setSavedFlash(false), 1500);
      } else {
        toast.error(result?.error || t('canvas.saveFailed'));
      }
    } catch {
      toast.error(t('canvas.saveFailed'));
    } finally {
      setSavingWorkflow(false);
    }
  }, [savingWorkflow, router, currentWorkflowId]);

  // 保存入口：已有工作流直接保存（不弹窗）；首次创建弹窗填名称
  const handleSaveClick = useCallback(() => {
    if (currentWorkflowId) {
      handleSaveWorkflow();
    } else {
      setSaveTitle('');
      setSaveDescription('');
      setSaveDialogOpen(true);
    }
  }, [currentWorkflowId, handleSaveWorkflow]);

  // 加载版本历史
  const loadVersions = useCallback(async () => {
    if (!currentWorkflowId) return;
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/workflow-history/${currentWorkflowId}/versions`);
      const data = await res.json();
      if (Array.isArray(data)) setVersions(data);
      else toast.error(data?.error || t('canvas.versionLoadFailed'));
    } catch {
      toast.error(t('canvas.versionLoadFailed'));
    } finally {
      setVersionsLoading(false);
    }
  }, [currentWorkflowId]);

  // 预览版本：点击版本条目直接把该版本加载到画布（不弹确认）
  const handlePreviewVersion = useCallback((v: { version: number; title: string; data: TinyflowData }) => {
    if (!instanceRef.current) return;
    try {
      instanceRef.current.setData(v.data);
      toast.success(t('workflows.versionPreviewed', { version: formatVersion(v.version), title: v.title }));
    } catch {
      toast.error(t('canvas.versionPreviewFailed'));
    }
  }, [t]);

  // 还原版本到画布（弹确认，提示覆盖当前）
  const handleRestoreVersion = useCallback((v: { version: number; title: string }) => {
    setVersionToRestore(v);
  }, []);

  const confirmRestore = useCallback(() => {
    if (!versionToRestore || !instanceRef.current) return;
    const target = versions.find((v) => v.version === versionToRestore.version);
    if (!target) return;
    try {
      instanceRef.current.setData(target.data);
      toast.success(t('canvas.versionRestored', { version: formatVersion(target.version), title: target.title }));
    } catch {
      toast.error(t('canvas.versionRestoreFailed'));
    }
    setVersionToRestore(null);
  }, [versionToRestore, versions]);

  // 发布指定版本（外部 API 立即切换到该版本内容）
  const confirmPublishVersion = useCallback(async () => {
    if (!publishTarget || !currentWorkflowId) return;
    try {
      const res = await fetch(`/api/workflow-history/${currentWorkflowId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: publishTarget.version }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('workflows.versionPublished', { version: publishTarget.version }));
        loadVersions();
      } else {
        toast.error(data?.error || t('canvas.publishFailed'));
      }
    } catch {
      toast.error(t('canvas.publishFailed'));
    } finally {
      setPublishTarget(null);
    }
  }, [publishTarget, currentWorkflowId, loadVersions, t]);

  // ===== Build inputs object =====
  const buildInputs = useCallback((): Record<string, unknown> => {
    if (inputMode === 'json') {
      try {
        return JSON.parse(jsonText);
      } catch {
        throw new Error(t('canvas.jsonParseError'));
      }
    }
    return formValues;
  }, [inputMode, jsonText, formValues]);

  // ===== Execute =====
  const handleExecute = useCallback(async () => {
    if (!instanceRef.current || running) return;

    let inputs: Record<string, unknown>;
    try {
      inputs = buildInputs();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('canvas.inputParseError'));
      setShowResults(true);
      return;
    }

    setRunning(true);
    setEvents([]);
    setResult(null);
    setError(null);
    setConfirmReq(null);
    setShowResults(true);

    const flowData = instanceRef.current.getData() as TinyflowData;

    try {
      const response = await fetch('/api/flow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowData,
          inputs,
          // 关联当前工作流（执行记录 flow_runs.workflow_id 落库，供 AI 排查稳定性）
          workflowId: currentWorkflowId ?? null,
        }),
      });
      const data = await response.json();

      if (data.events) setEvents(data.events);
      flowIdRef.current = data.flowId;

      if (data.status === 'paused' && data.confirmRequest) {
        setConfirmReq(data.confirmRequest);
        setConfirmData({});
      } else if (data.status === 'completed') {
        setResult(data.outputs || {});
      } else if (data.status === 'failed') {
        setError(data.error || t('canvas.executeFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('canvas.networkError'));
    } finally {
      setRunning(false);
    }
  }, [running, buildInputs]);

  // ===== Stop =====
  const handleStop = useCallback(async () => {
    if (!flowIdRef.current) return;
    try {
      await fetch('/api/flow/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flowIdRef.current }),
      });
    } catch {
      // ignore
    }
    setRunning(false);
    setError(t('canvas.flowStopped'));
  }, []);

  // ===== Confirm =====
  const handleConfirm = useCallback(async () => {
    if (!flowIdRef.current || !confirmReq) return;

    setRunning(true);
    setConfirmReq(null);

    try {
      const response = await fetch('/api/flow/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowId: flowIdRef.current, confirmData }),
      });
      const data = await response.json();

      if (data.events) setEvents((prev) => [...prev, ...data.events]);

      if (data.status === 'paused' && data.confirmRequest) {
        setConfirmReq(data.confirmRequest);
        setConfirmData({});
      } else if (data.status === 'completed') {
        setResult(data.outputs || {});
      } else if (data.status === 'failed') {
        setError(data.error || t('canvas.executeFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('canvas.networkError'));
    } finally {
      setRunning(false);
    }
  }, [confirmReq, confirmData]);

  // ===== Render helpers =====

  const renderNodeStatus = (status?: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-[#b77945]" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  // 文件上传状态管理
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});

  // 处理文件上传到 OSS
  const handleFileUpload = useCallback(async (file: File, fieldKey: string, isMultiple: boolean, contentType: string) => {
    setUploadingFiles(prev => ({ ...prev, [fieldKey]: true }));

    try {
      const result = await uploadFileToOSS(file, {
        prefix: `workflow/${contentType}`,
      });

      if (result.success && result.data) {
        const url = result.data.url;

        setFormValues(prev => {
          const currentVal = prev[fieldKey];
          if (isMultiple) {
            const currentFiles = Array.isArray(currentVal) ? currentVal : (currentVal ? [currentVal as string] : []);
            return { ...prev, [fieldKey]: [...currentFiles, url] };
          }
          return { ...prev, [fieldKey]: url };
        });

        toast.success(t('canvas.uploadSuccess', { name: file.name }));
      } else {
        toast.error(result.message || t('canvas.uploadFailed'));
      }
    } catch (error) {
      toast.error(t('canvas.uploadFailed'));
      console.error('Upload error:', error);
    } finally {
      setUploadingFiles(prev => ({ ...prev, [fieldKey]: false }));
    }
  }, []);

  // Render a single form field based on dataType and contentType
  const renderFormField = (param: Parameter, idx: number) => {
    const key = param.name || `field_${idx}`;
    const dt = (param.dataType || 'string').toLowerCase();
    const contentType = (param.contentType || '').toLowerCase();
    const formType = (param.formType || '').toLowerCase();
    const val = formValues[key];
    const label = param.name || `字段 ${idx + 1}`;
    const desc = param.description;
    const required = param.required;
    const isUploading = uploadingFiles[key] || false;

    const setVal = (v: unknown) => {
      setFormValues((prev) => ({ ...prev, [key]: v }));
    };

    // 文件上传组件
    if (contentType === 'video' || contentType === 'audio' || contentType === 'image') {
      const acceptMap: Record<string, string> = {
        video: 'video/*',
        audio: 'audio/*',
        image: 'image/*',
      };
      const accept = acceptMap[contentType] || '*/*';
      // formType 为 "checkbox" 时允许多选
      const isMultiple = formType === 'checkbox';

      return (
        <div key={idx} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-medium">{label}</Label>
            {required && <span className="text-xs text-red-500">*</span>}
            <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-muted-foreground">
              {contentType}
              {isMultiple && ' (多选)'}
            </Badge>
          </div>
          {desc && <p className="text-[11px] text-muted-foreground">{desc}</p>}

          <div className="relative">
            <Input
              type="file"
              accept={accept}
              multiple={isMultiple}
              disabled={isUploading}
              onChange={async (e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;

                if (isMultiple) {
                  // 多选：逐个上传
                  for (const file of Array.from(files)) {
                    await handleFileUpload(file, key, true, contentType);
                  }
                } else {
                  // 单选：上传单个文件
                  await handleFileUpload(files[0], key, false, contentType);
                }
                // 清空 input 值，允许重复选择同一文件
                e.target.value = '';
              }}
              className="h-8 text-sm file:mr-2 file:h-6 file:rounded-md file:border-0 file:bg-primary file:px-2 file:text-xs file:text-primary-foreground hover:file:bg-primary/90"
            />
            {isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="ml-2 text-xs">{t('canvas.uploading')}</span>
              </div>
            )}
          </div>

          {/* 显示已上传文件列表 */}
          {isMultiple && Array.isArray(val) && val.length > 0 && (
            <div className="space-y-1">
              {val.map((fileUrl, fileIdx) => {
                // 从 URL 中提取文件名
                const fileName = fileUrl.split('/').pop() || `文件 ${fileIdx + 1}`;
                return (
                  <div key={fileIdx} className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5">
                    <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-xs text-primary hover:underline"
                    >
                      {fileName}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const newFiles = val.filter((_, i) => i !== fileIdx);
                        setVal(newFiles.length > 0 ? newFiles : '');
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 单选：显示已上传文件 */}
          {!isMultiple && typeof val === 'string' && val && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5">
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              <a
                href={val}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs text-primary hover:underline"
              >
                {val.split('/').pop() || '已上传文件'}
              </a>
              <button
                type="button"
                onClick={() => setVal('')}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t('common.delete')}
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={idx} className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs font-medium">{label}</Label>
          {required && <span className="text-xs text-red-500">*</span>}
          <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal text-muted-foreground">
            {dt}
          </Badge>
        </div>
        {desc && <p className="text-[11px] text-muted-foreground">{desc}</p>}

        {dt === 'number' && (
          <Input
            type="number"
            value={val as number}
            onChange={(e) => setVal(Number(e.target.value))}
            placeholder={param.defaultValue || '0'}
            className="h-8 text-sm"
          />
        )}

        {dt === 'boolean' && (
          <div className="flex items-center gap-2 py-1">
            <Switch checked={val as boolean} onCheckedChange={setVal} />
            <span className="text-xs text-muted-foreground">{val ? 'true' : 'false'}</span>
          </div>
        )}

        {(dt === 'object' || dt === 'array') && (
          <Textarea
            value={typeof val === 'string' ? val : JSON.stringify(val, null, 2)}
            onChange={(e) => setVal(e.target.value)}
            placeholder={dt === 'array' ? '[]' : '{}'}
            className="min-h-[80px] font-mono text-xs"
          />
        )}

        {dt === 'string' && (
          <Input
            value={(val as string) || ''}
            onChange={(e) => setVal(e.target.value)}
            placeholder={param.defaultValue || `请输入 ${label}`}
            className="h-8 text-sm"
          />
        )}
      </div>
    );
  };

  // Render confirm field based on formType
  const renderConfirmField = (field: Parameter, idx: number) => {
    const key = field.name || `field_${idx}`;
    const ft = field.formType || 'input';
    const label = field.formLabel || field.name || `字段 ${idx + 1}`;
    const desc = field.formDescription;
    const required = field.required;
    const enums = field.enums || [];

    const setVal = (v: string) => {
      setConfirmData((prev) => ({ ...prev, [key]: v }));
    };

    return (
      <div key={idx} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          {required && <span className="text-xs text-red-500">*</span>}
        </div>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}

        {ft === 'radio' && (
          <RadioGroup
            value={confirmData[key] || ''}
            onValueChange={setVal}
            className="flex flex-col gap-2"
          >
            {enums.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <RadioGroupItem value={opt} id={`cf-${idx}-${i}`} />
                <Label htmlFor={`cf-${idx}-${i}`} className="text-sm font-normal cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        {ft === 'checkbox' && (
          <div className="flex flex-col gap-2">
            {enums.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
                  id={`cf-${idx}-${i}`}
                  checked={(confirmData[key] || '').split(',').includes(opt)}
                  onCheckedChange={(checked) => {
                    const current = (confirmData[key] || '').split(',').filter(Boolean);
                    const next = checked
                      ? [...current, opt]
                      : current.filter((v) => v !== opt);
                    setVal(next.join(','));
                  }}
                />
                <Label htmlFor={`cf-${idx}-${i}`} className="text-sm font-normal cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
          </div>
        )}

        {ft === 'select' && (
          <Select value={confirmData[key] || ''} onValueChange={setVal}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择..." />
            </SelectTrigger>
            <SelectContent>
              {enums.map((opt, i) => (
                <SelectItem key={i} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {ft === 'textarea' && (
          <Textarea
            value={confirmData[key] || ''}
            onChange={(e) => setVal(e.target.value)}
            placeholder={field.formPlaceholder || '请输入...'}
            className="min-h-[80px]"
          />
        )}

        {(ft === 'input' || (!['radio', 'checkbox', 'select', 'textarea'].includes(ft))) && (
          <Input
            value={confirmData[key] || ''}
            onChange={(e) => setVal(e.target.value)}
            placeholder={field.formPlaceholder || '请输入...'}
          />
        )}
      </div>
    );
  };

  // ===== Layout =====
  return (
    <div className="flex h-full w-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/workflows')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('common.back')}
        </Button>
        <div className="flex items-center gap-2">
        <Popover
          open={panelOpen}
          onOpenChange={(open) => {
            if (running && !open) return; // prevent closing while running
            setPanelOpen(open);
          }}
        >
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              <Settings2 className="mr-1 h-4 w-4" />
              {t('workflows.testRun')}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[440px] p-0"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold">{t('canvas.testRunConfig')}</span>
              <Tabs value={inputMode} onValueChange={(v) => v === 'form' ? switchToForm() : switchToJson()}>
                <TabsList className="h-7">
                  <TabsTrigger value="form" className="text-xs px-2.5 py-0.5">{t('workflows.form')}</TabsTrigger>
                  <TabsTrigger value="json" className="text-xs px-2.5 py-0.5">{t('workflows.json')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Panel body */}
            <div className="max-h-[400px] overflow-y-auto px-4 py-3">
              {inputMode === 'form' ? (
                <div className="space-y-4">
                  {startParams.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('workflows.noInputParams')}
                    </p>
                  ) : (
                    startParams.map((p, idx) => renderFormField(p, idx))
                  )}
                </div>
              ) : (
                <Textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="min-h-[200px] font-mono text-xs"
                  placeholder='{"key": "value"}'
                />
              )}
            </div>

            {/* Panel footer: run button */}
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-2">
                {running && (
                  <Badge variant="secondary" className="animate-pulse">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    {t('workflows.running')}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {running ? (
                  <Button variant="destructive" size="sm" onClick={handleStop}>
                    <Square className="mr-1 h-3.5 w-3.5" />
                    {t('workflows.stopRun')}
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleExecute}>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    {t('workflows.run')}
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button size="sm" variant="outline" onClick={handleViewJson}>
          <Braces className="mr-1 h-4 w-4" />
          {t('workflows.viewJson')}
        </Button>

        <Button
          size="sm"
          variant={assistantOpen ? 'default' : 'outline'}
          onClick={() => setAssistantOpen((v) => !v)}
        >
          <Bot className="mr-1 h-4 w-4" />
          {t('canvas.assistant')}
        </Button>

        {currentWorkflowId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowVersions(true);
              loadVersions();
            }}
          >
            <History className="mr-1 h-4 w-4" />
            {t('workflows.viewHistory')}
          </Button>
        )}

        <Button
          size="sm"
          variant={savedFlash ? 'outline' : 'default'}
          className={savedFlash ? 'border-green-500 text-green-600' : undefined}
          onClick={handleSaveClick}
          disabled={savingWorkflow}
        >
          {savingWorkflow ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              {t('workflows.saving')}
            </>
          ) : savedFlash ? (
            <>
              <CheckCircle2 className="mr-1 h-4 w-4 text-green-500" />
              {t('workflows.saved')}
            </>
          ) : (
            <>
              <Save className="mr-1 h-4 w-4" />
              {t('workflows.saveToHistory')}
            </>
          )}
        </Button>

        {showResults ? (
          <Button variant="ghost" size="sm" onClick={() => setShowResults(false)}>
            {t('workflows.hideResults')}
          </Button>
        ) : (
          (events.length > 0 || error || result) && (
            <Button variant="ghost" size="sm" onClick={() => setShowResults(true)}>
              {t('workflows.viewResults')}
            </Button>
          )
        )}
        </div>
      </div>

      {/* Main content: canvas + results */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Tinyflow canvas（min-w-0 防止画布内容撑爆布局，把日志面板挤出屏幕） */}
        <div
          ref={containerRef}
          className="h-full min-h-0 min-w-0 flex-1 [&_.tf-node-wrapper-title]:hidden"
        />

        {/* AI 助手面板（协助分析/修改工作流） */}
        <CanvasAssistant
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          getCanvasData={() => instanceRef.current?.getData()}
          onApplyWorkflow={(data) => {
            instanceRef.current?.setData(data as never);
          }}
        />

        {/* Results panel（宽度随屏幕自适应） */}
        {showResults && (
          <div className="h-full min-h-0 w-80 shrink-0 border-l border-border bg-background xl:w-96">
            <ScrollArea className="h-full">
              <div className="space-y-3 p-4">
                <h3 className="text-sm font-semibold">{t('workflows.executionLog')}</h3>

                {events.length === 0 && !error && !result && (
                  <p className="text-sm text-muted-foreground">{t('workflows.noExecutionRecords')}</p>
                )}

                {events.map((event, idx) => (
                  <div
                    key={idx}
                    className="min-w-0 rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 break-all font-medium">{event.type}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    {event.data.nodeId && (
                      <div className="mt-1 flex items-center gap-2">
                        {renderNodeStatus(event.data.status)}
                        <span className="break-all text-xs text-muted-foreground">
                          {event.data.nodeId}
                        </span>
                        {event.data.duration != null && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {event.data.duration}ms
                          </span>
                        )}
                      </div>
                    )}
                    {event.data.error && (
                      <p className="mt-1 break-all text-xs text-red-500">
                        {event.data.error}
                      </p>
                    )}
                    {event.data.outputs &&
                      typeof event.data.outputs === 'object' &&
                      Object.keys(event.data.outputs).length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                          {JSON.stringify(event.data.outputs, null, 2)}
                        </pre>
                      )}
                  </div>
                ))}

                {error && (
                  <div className="min-w-0 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      <span className="font-medium">{t('workflows.executionError')}</span>
                    </div>
                    <p className="mt-1 break-all text-xs">{error}</p>
                  </div>
                )}

                {result && (
                  <div className="min-w-0 rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium">{t('workflows.executionComplete')}</span>
                    </div>
                    <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* 历史修改面板（样式同执行日志） */}
        {showVersions && (
          <div className="h-full min-h-0 w-80 shrink-0 border-l border-border bg-background xl:w-96">
            <ScrollArea className="h-full">
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t('workflows.viewHistory')}</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowVersions(false)}
                  >
                    {t('common.close')}
                  </Button>
                </div>

                {!versionsLoading && versions.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('workflows.versionPanelHint')}
                  </p>
                )}

                {versionsLoading && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('common.loading')}
                  </p>
                )}

                {!versionsLoading && versions.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('workflows.noVersions')}
                  </p>
                )}

                {versions.map((v) => (
                  <div
                    key={v.id}
                    className={`min-w-0 cursor-pointer rounded-md border p-3 text-sm transition-colors hover:bg-muted/50 ${
                      v.is_current ? 'border-green-500/60' : 'border-border'
                    }`}
                    onClick={() => handlePreviewVersion(v)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium">v{formatVersion(v.version)}</span>
                        {v.is_current && (
                          <Badge variant="outline" className="shrink-0 border-green-500/60 text-green-600">
                            {t('workflows.currentVersion')}
                          </Badge>
                        )}
                        {v.published && v.published_version === v.version && (
                          <Badge className="shrink-0">
                            {t('workflows.currentPublished')} v{formatVersion(v.version)}
                          </Badge>
                        )}
                        <span className="truncate text-xs text-muted-foreground">
                          {v.title}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(v.created_at)}
                      </span>
                    </div>
                    {v.description && (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {v.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestoreVersion(v);
                        }}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        {t('workflows.restore')}
                      </Button>
                      <Button
                        variant={v.published && v.published_version === v.version ? 'ghost' : 'default'}
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPublishTarget(v);
                        }}
                      >
                        {t('workflows.publishThisVersion')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {/* 保存工作流对话框 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="z-[1200] max-w-md">
          <DialogHeader>
            <DialogTitle>{t('canvas.saveDialogTitle')}</DialogTitle>
            <DialogDescription>{t('canvas.saveDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('canvas.name')} *</Label>
              <Input
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder={`工作流 ${new Date().toLocaleString('zh-CN')}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('canvas.remark')}</Label>
              <Textarea
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder={t('canvas.remarkPlaceholder')}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                setSaveDialogOpen(false);
                handleSaveWorkflow(saveTitle, saveDescription);
              }}
              disabled={savingWorkflow}
            >
              {savingWorkflow && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 节点库对话框 */}
      <Dialog open={nodesOpen} onOpenChange={setNodesOpen}>
        <DialogContent className="z-[1200] max-w-md">
          <DialogHeader>
            <DialogTitle>{t('canvas.nodeLib')}</DialogTitle>
            <DialogDescription>{t('canvas.nodeLibDesc', { count: nodeLibrary.length })}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-4 overflow-y-auto py-2">
            {(['ai', 'logic', 'integration', 'core', 'data', 'custom'] as const)
              .map((cat) => ({ cat, nodes: nodeLibrary.filter((n) => n.category === cat) }))
              .filter((g) => g.nodes.length > 0)
              .map((group) => (
                <div key={group.cat}>
                  <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
                    {CATEGORY_LABELS[group.cat] || group.cat}
                  </h4>
                  <div className="space-y-1.5">
                    {group.nodes.map((node) => (
                      <div
                        key={node.type}
                        className="flex items-start justify-between rounded-md border border-border bg-card p-2.5"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{node.label}</span>
                            <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                              {node.type}
                            </code>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {node.description}
                          </p>
                          {/* 启用开关：关闭后从画布节点面板隐藏（hiddenNodes） */}
                          <button
                            type="button"
                            onClick={() => toggleNodeType(node.type, !enabledTypes.has(node.type))}
                            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            {enabledTypes.has(node.type) ? t('canvas.nodeHidden') : t('canvas.nodeShown')}
                          </button>
                        </div>
                        <div className="ml-2 flex shrink-0 flex-col items-end gap-1">
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleAddNode(node as unknown as NodeDefinition)}>
                            <Plus className="mr-1 h-3 w-3" />
                            {t('canvas.add')}
                          </Button>
                          {node.capabilities.length > 0 && (
                            <div className="flex gap-1">
                              {node.capabilities.map((cap) => (
                                <span
                                  key={cap}
                                  className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                                >
                                  {cap}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            {nodeLibrary.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('canvas.nodeLibEmpty')}</p>
            )}
          </div>

          {/* 画布节点（配置 / 删除） */}
          <div className="border-t border-border pt-3">
            <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{t('canvas.canvasNodes', { count: getCanvasNodes().length })}</h4>
            <div className="space-y-1.5">
              {getCanvasNodes().map((n) => (
                <div key={n.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 truncate">
                    {String((n.data as Record<string, unknown>).title || n.type)}
                    <code className="ml-1.5 text-[10px] text-muted-foreground">{n.type}</code>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => openNodeConfig(n)}>
                      {t('canvas.configure')}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-destructive" onClick={() => handleRemoveNode(n.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
              {getCanvasNodes().length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">{t('canvas.canvasEmpty')}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 节点配置面板（configSchema 驱动表单） */}
      <NodeConfigPanel
        open={!!configTarget}
        onOpenChange={(open) => !open && setConfigTarget(null)}
        node={configTarget ? { id: configTarget.id, type: configTarget.type } : null}
        definition={(nodeLibrary.find((n) => n.type === configTarget?.type) as unknown as NodeDefinition | null) ?? null}
        initialData={configTarget?.data ?? {}}
        onSave={handleSaveNodeConfig}
      />

      {/* 单节点运行对话框 */}
      <Dialog open={!!nodeRunTarget} onOpenChange={(open) => !open && setNodeRunTarget(null)}>
        <DialogContent className="z-[1200] max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('canvas.nodeRunTitle')}</DialogTitle>
            <DialogDescription>
              {nodeRunTarget && (
                <span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {String((nodeRunTarget.data as Record<string, unknown>).title || nodeRunTarget.type)}
                  </code>
                  <span className="ml-2 text-xs text-muted-foreground">{nodeRunTarget.type}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
              {t('canvas.nodeRunHint')}
            </p>

            {/* 输入模式切换：表单 / JSON */}
            <Tabs
              value={nodeRunMode}
              onValueChange={(v) => (v === 'form' ? switchNodeRunToForm() : switchNodeRunToJson())}
            >
              <TabsList className="h-7">
                <TabsTrigger value="form" className="text-xs px-2.5 py-0.5">
                  {t('workflows.form')}
                </TabsTrigger>
                <TabsTrigger value="json" className="text-xs px-2.5 py-0.5">
                  {t('workflows.json')}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {nodeRunMode === 'form' ? (
              <div className="space-y-3">
                {(() => {
                  const params = (Array.isArray(nodeRunTarget?.data?.parameters)
                    ? (nodeRunTarget?.data as Record<string, unknown>).parameters
                    : []) as Parameter[];
                  if (params.length === 0) {
                    return (
                      <p className="rounded-md bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                        {t('workflows.noInputParams')}
                      </p>
                    );
                  }
                  return params.map((p, idx) => {
                    const key = p.name || `field_${idx}`;
                    const dt = (p.dataType || 'string').toLowerCase();
                    const value = nodeRunFormValues[key];
                    const setVal = (v: unknown) =>
                      setNodeRunFormValues((prev) => ({ ...prev, [key]: v }));
                    return (
                      <div key={idx} className="space-y-1.5">
                        <Label className="text-xs font-medium">
                          {p.name || `字段 ${idx + 1}`}
                          {p.required && <span className="ml-0.5 text-red-500">*</span>}
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {dt}
                          </span>
                        </Label>
                        {p.description && (
                          <p className="text-[11px] text-muted-foreground">{p.description}</p>
                        )}
                        {dt === 'number' && (
                          <Input
                            type="number"
                            value={value as number}
                            onChange={(e) => setVal(Number(e.target.value))}
                            placeholder={String(p.defaultValue ?? '0')}
                            className="h-8 text-sm"
                          />
                        )}
                        {dt === 'boolean' && (
                          <div className="flex items-center gap-2 py-1">
                            <Switch checked={Boolean(value)} onCheckedChange={setVal} />
                            <span className="text-xs text-muted-foreground">
                              {value ? 'true' : 'false'}
                            </span>
                          </div>
                        )}
                        {(dt === 'object' || dt === 'array') && (
                          <Textarea
                            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                            onChange={(e) => setVal(e.target.value)}
                            placeholder={dt === 'array' ? '[]' : '{}'}
                            className="min-h-[70px] font-mono text-xs"
                          />
                        )}
                        {dt === 'string' && (
                          <Input
                            value={(value as string) || ''}
                            onChange={(e) => setVal(e.target.value)}
                            placeholder={String(p.defaultValue ?? `请输入 ${p.name}`)}
                            className="h-8 text-sm"
                          />
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('canvas.nodeRunInput')}</Label>
                <Textarea
                  value={nodeRunInputs}
                  onChange={(e) => setNodeRunInputs(e.target.value)}
                  rows={5}
                  className="font-mono text-xs"
                />
              </div>
            )}
            {nodeRunError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {nodeRunError}
              </div>
            )}
            {nodeRunResult !== null && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('canvas.nodeRunOutput')}</Label>
                <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                  {JSON.stringify(nodeRunResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeRunTarget(null)}>
              {t('common.close')}
            </Button>
            <Button onClick={handleNodeRun} disabled={nodeRunLoading}>
              {nodeRunLoading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              {t('canvas.nodeRun')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmReq} onOpenChange={(open) => !open && !running && setConfirmReq(null)}>
        <DialogContent className="z-[1200]">
          <DialogHeader>
            <DialogTitle>{t('workflows.needConfirm')}</DialogTitle>
            <DialogDescription>{confirmReq?.message}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {confirmReq?.confirms.map((field, idx) => renderConfirmField(field, idx))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReq(null)} disabled={running}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={running}>
              {running && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('workflows.confirmSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* {t('workflows.json')} viewer dialog */}
      <Dialog open={jsonDialogOpen} onOpenChange={setJsonDialogOpen}>
        <DialogContent className="z-[1200] max-w-2xl">
          <DialogHeader>
            <DialogTitle>工作流 {t('workflows.json')} 数据</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs font-mono">
            {flowJsonText}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(flowJsonText);
                toast.success(t('canvas.copied'));
              }}
            >
              {t('common.copy')}
            </Button>
            <Button onClick={() => setJsonDialogOpen(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 还原版本确认（还原会替换画布当前内容）——必须放在 Dialog 外层，否则不挂载 */}
      <ConfirmDialog
        open={!!versionToRestore}
        title={
          versionToRestore
            ? t('workflows.restoreConfirm', {
                version: formatVersion(versionToRestore.version),
                title: versionToRestore.title,
              })
            : ''
        }
        onConfirm={confirmRestore}
        onCancel={() => setVersionToRestore(null)}
      />

      {/* 发布版本确认（外部 API 立即切换到该版本） */}
      <ConfirmDialog
        open={!!publishTarget}
        title={
          publishTarget
            ? t('workflows.publishVersionConfirm', {
                version: formatVersion(publishTarget.version),
                title: publishTarget.title,
              })
            : ''
        }
        confirmText={t('workflows.publish')}
        onConfirm={confirmPublishVersion}
        onCancel={() => setPublishTarget(null)}
      />
    </div>
  );
}
