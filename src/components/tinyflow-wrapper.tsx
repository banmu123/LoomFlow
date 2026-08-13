'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import '@tinyflow-ai/ui/dist/index.css';
import type { Tinyflow as TinyflowInstance } from '@tinyflow-ai/ui';
import type { TinyflowData, Parameter } from '@/lib/tinyflow/types';
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
import { Play, Square, Loader2, CheckCircle2, XCircle, Clock, Settings2, ArrowLeft, Braces, Upload, Save, Boxes, History, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { toast } from 'sonner';
import { getPendingWorkflow, clearPendingWorkflow } from '@/lib/pending-workflow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatVersion } from '@/lib/version';
import { uploadFileToOSS } from '@/lib/oss-upload-client';

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

  // ===== Init Tinyflow =====
  useEffect(() => {
    let destroyed = false;
    (async () => {
      // 模型列表严格来自模型配置（/api/ai/models），实例化前先拉取：
      // provider.llm 闭包持有局部变量（每次渲染/打开面板都能拿到最新配置，未配置时为空）
      let llmOptions: { value: string; label: string }[] = [];
      try {
        const res = await fetch('/api/ai/models');
        const data = await res.json();
        if (Array.isArray(data)) {
          llmOptions = data.map((m: { id: string; label: string | null }) => ({
            value: m.id,
            label: m.label || m.id,
          }));
        }
      } catch {
        // 拉取失败保持空列表（画布会提示先配置模型）
      }
      if (destroyed || !containerRef.current) return;

      const { Tinyflow } = await import('@tinyflow-ai/ui');
      if (destroyed || !containerRef.current) return;
      instanceRef.current = new Tinyflow({
        element: containerRef.current,
        defaultTheme: 'light',
        provider: {
          llm: () => llmOptions,
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
          toast.success('工作流已加载到画布');
        } catch {
          toast.error('工作流数据格式无效');
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
        toast.success('工作流已加载到画布');
      } catch {
        toast.error('工作流数据格式无效');
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
      setFlowJsonText('获取数据失败');
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
            ? `工作流已更新（版本 v${formatVersion(result?.version ?? 0)}）`
            : '工作流已保存到历史记录',
          {
            duration: 4000,
            action: {
              label: '查看历史',
              onClick: () => router.push('/workflows/history'),
            },
          },
        );
        // 1.5s 后恢复按钮状态
        setTimeout(() => setSavedFlash(false), 1500);
      } else {
        toast.error(result?.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
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
      else toast.error(data?.error || '加载版本历史失败');
    } catch {
      toast.error('加载版本历史失败');
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
      toast.error('预览失败：版本数据格式无效');
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
      toast.success(`已还原到版本 v${formatVersion(target.version)}「${target.title}」（如需保留，请再次保存）`);
    } catch {
      toast.error('还原失败：版本数据格式无效');
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
        toast.error(data?.error || '发布失败');
      }
    } catch {
      toast.error('发布失败');
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
        throw new Error('JSON 格式错误，请检查输入');
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
      setError(e instanceof Error ? e.message : '输入解析错误');
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
        body: JSON.stringify({ flowData, inputs }),
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
        setError(data.error || '执行失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
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
    setError('流程已被中止');
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
        setError(data.error || '执行失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
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
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
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

        toast.success(`${file.name} 上传成功`);
      } else {
        toast.error(result.message || '上传失败');
      }
    } catch (error) {
      toast.error('上传失败');
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
                <span className="ml-2 text-xs">上传中...</span>
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
                      删除
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
                删除
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
              <span className="text-sm font-semibold">{t('workflows.testRun')}配置</span>
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
              已保存
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
            <DialogTitle>保存到历史</DialogTitle>
            <DialogDescription>为工作流命名并添加备注（可选）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>工作流名称 *</Label>
              <Input
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder={`工作流 ${new Date().toLocaleString('zh-CN')}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="描述这个工作流的用途（可选）"
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                setSaveDialogOpen(false);
                handleSaveWorkflow(saveTitle, saveDescription);
              }}
              disabled={savingWorkflow}
            >
              {savingWorkflow && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 节点库对话框 */}
      <Dialog open={nodesOpen} onOpenChange={setNodesOpen}>
        <DialogContent className="z-[1200] max-w-md">
          <DialogHeader>
            <DialogTitle>节点库</DialogTitle>
            <DialogDescription>由 NodeRegistry 提供的内置节点（{nodeLibrary.length} 个）</DialogDescription>
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
                        </div>
                        {node.capabilities.length > 0 && (
                          <div className="ml-2 flex shrink-0 gap-1">
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
                    ))}
                  </div>
                </div>
              ))}
            {nodeLibrary.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">节点库为空</p>
            )}
          </div>
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
                toast.success('已复制到剪贴板');
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
