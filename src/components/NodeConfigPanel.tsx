'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { NodeConfigField, NodeDefinition } from '@/lib/tinyflow/node-definition';
import { getConfigDefaults, validateConfig } from '@/lib/tinyflow/node-config';

// 节点配置面板：根据 NodeDefinition.configSchema 动态生成表单。
// 值来源：节点当前 data（回显）→ configSchema 默认值兜底。
// 保存：onSave(nodeId, mergedData)——由调用方写回画布。

export function NodeConfigPanel({
  open,
  onOpenChange,
  node,
  definition,
  initialData,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 被配置的节点（仅用于展示与回传 id） */
  node: { id: string; type: string } | null;
  definition: NodeDefinition | null;
  /** 节点当前配置（回显） */
  initialData: Record<string, unknown>;
  /** 保存回调（返回合并后的完整节点 data） */
  onSave: (nodeId: string, data: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<string[]>([]);

  // 打开时：用节点当前 data 回显，configSchema 默认值兜底
  useEffect(() => {
    if (open && definition) {
      setValues({ ...getConfigDefaults(definition.configSchema), ...initialData });
      setErrors([]);
    }
  }, [open, definition, initialData]);

  if (!node || !definition) return null;
  const schema = definition.configSchema ?? [];

  const handleSave = () => {
    const errs = validateConfig(schema, values);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    onSave(node.id, values);
    onOpenChange(false);
  };

  const setField = (name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1200] max-w-md">
        <DialogHeader>
          <DialogTitle>
            {definition.label}
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {node.type}
            </code>
          </DialogTitle>
        </DialogHeader>

        {schema.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            该节点没有声明配置项（configSchema 为空）
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto py-2">
            {schema.map((field) => (
              <ConfigField key={field.name} field={field} value={values[field.name]} onChange={(v) => setField(field.name, v)} />
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===== 单字段渲染（支持 string/number/boolean/select/textarea/json）=====
function ConfigField({
  field,
  value,
  onChange,
}: {
  field: NodeConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  // 动态选项（optionsProvider）兜底：/api/nodes 已 resolve 为静态 options；
  // 直接传入内存 NodeDefinition 时在此加载
  const [dynamicOptions, setDynamicOptions] = useState<Array<{ value: string; label: string }> | null>(null);
  useEffect(() => {
    if (field.type === 'select' && field.optionsProvider) {
      Promise.resolve(field.optionsProvider())
        .then((opts) => setDynamicOptions(opts))
        .catch(() => setDynamicOptions([]));
    }
  }, [field]);
  const options = dynamicOptions ?? field.options ?? [];
  const label = (
    <Label className="text-xs">
      {field.label}
      {field.required && <span className="ml-0.5 text-destructive">*</span>}
    </Label>
  );

  switch (field.type) {
    case 'number':
      return (
        <div className="space-y-1">
          {label}
          <Input
            type="number"
            value={value === undefined || value === '' ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            min={field.min}
            max={field.max}
            placeholder={field.placeholder}
          />
          {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <div>
            {label}
            {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
          </div>
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
        </div>
      );
    case 'select':
      return (
        <div className="space-y-1">
          {label}
          <Select value={String(value ?? '')} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={field.placeholder || '请选择'} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
        </div>
      );
    case 'textarea':
    case 'code':
      return (
        <div className="space-y-1">
          {label}
          <Textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            className="font-mono text-xs"
          />
          {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
        </div>
      );
    case 'json':
      return (
        <div className="space-y-1">
          {label}
          <Textarea
            value={value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            onChange={(e) => {
              // JSON 字段：尝试解析，失败保持字符串（保存时校验）
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                onChange(e.target.value);
              }
            }}
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            className="font-mono text-xs"
          />
          {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
        </div>
      );
    default: // string
      return (
        <div className="space-y-1">
          {label}
          <Input
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
          {field.description && <p className="text-[11px] text-muted-foreground">{field.description}</p>}
        </div>
      );
  }
}
