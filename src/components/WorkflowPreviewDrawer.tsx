'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import type { Tinyflow as TinyflowInstance } from '@tinyflow-ai/ui';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { setPendingWorkflow } from '@/lib/pending-workflow';
import { useT } from '@/lib/i18n';
import { X } from 'lucide-react';

// AI 对话生成工作流后的预览抽屉：右上角「预览」按钮 → 右侧抽屉内渲染画布。
// 复用 Tinyflow 完整画布（与 /workflows/editor 同一实例能力），数据来自对话中提取的工作流 JSON
export function WorkflowPreviewDrawer({
  open,
  data,
  onOpenChange,
}: {
  open: boolean;
  data: TinyflowData | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TinyflowInstance | null>(null);
  const [ready, setReady] = useState(false);

  // 打开后渲染画布：等抽屉动画结束（容器尺寸稳定）再实例化 Tinyflow
  useEffect(() => {
    if (!open || !data) return;
    let destroyed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const { Tinyflow } = await import('@tinyflow-ai/ui');
      if (destroyed) return;
      timer = setTimeout(() => {
        if (destroyed || !containerRef.current) return;
        const inst = new Tinyflow({
          element: containerRef.current,
          defaultTheme: 'light',
        });
        try {
          inst.setData(data);
        } catch {
          // 数据格式异常：画布保持空白
        }
        instanceRef.current = inst;
        setReady(true);
      }, 300);
    })();
    return () => {
      destroyed = true;
      clearTimeout(timer);
      instanceRef.current?.destroy();
      instanceRef.current = null;
      setReady(false);
    };
  }, [open, data]);

  // 在完整编辑器中打开（复用 pending-workflow 机制，编辑器页自动加载）
  const openEditor = () => {
    if (data) setPendingWorkflow(data);
    onOpenChange(false);
    router.push('/workflows/editor');
  };

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-full w-[min(760px,92vw)]">
        <DrawerHeader className="flex items-center justify-between border-b border-border px-4 py-3">
          <DrawerTitle className="text-sm">{t('chat.workflowPreview')}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        {/* 画布容器：flex-1 铺满，min-h-0 允许内部滚动 */}
        <div className="min-h-0 flex-1">
          <div ref={containerRef} className="h-full w-full" />
        </div>

        <DrawerFooter className="flex-row items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {ready ? t('chat.workflowPreviewHint') : t('chat.workflowLoading')}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            <Button onClick={openEditor}>{t('chat.workflowOpenEditor')}</Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
