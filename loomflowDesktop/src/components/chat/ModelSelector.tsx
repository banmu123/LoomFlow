/**
 * ModelSelector — 模型选择下拉
 *
 * 从 SQLite 读取已启用模型，显示 provider + 模型名。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';
import { useRepository } from '../../app/repositories';
import type { AIModelRecord } from '../../app/repositories/workflow-repository';

interface ModelSelectorProps {
  value: string | null;
  onChange: (modelId: string | null) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, className }: ModelSelectorProps) {
  const repo = useRepository();
  const [models, setModels] = useState<AIModelRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    repo.getEnabledModels().then(setModels).catch(() => {});
  }, [repo]);

  const selected = models.find((m) => m.id === value);

  if (models.length === 0) {
    return (
      <div className={`inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground ${className ?? ''}`}>
        <Cpu className="h-3.5 w-3.5" />
        No models configured
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <Cpu className="h-3.5 w-3.5 text-primary" />
        {selected?.displayName || selected?.modelName || 'Select model'}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-lg">
            <div className="p-1">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    m.id === value ? 'bg-primary/10 text-primary' : ''
                  }`}
                >
                  <div className="flex-1">
                    <div className="font-medium">{m.displayName || m.modelName}</div>
                    <div className="text-xs text-muted-foreground">{m.provider} · {m.modelName}</div>
                  </div>
                  {m.id === value && <div className="h-2 w-2 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
