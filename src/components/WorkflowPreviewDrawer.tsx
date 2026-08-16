'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { setPendingWorkflow } from '@/lib/pending-workflow';
import { useT } from '@/lib/i18n';
import { X, Maximize2 } from 'lucide-react';
import TinyflowWrapper from './tinyflow-wrapper';

// AI 对话生成工作流后的预览抽屉：右侧抽屉内直接复用完整画布（TinyflowWrapper，含画布菜单）。
// 数据传递复用 pending-workflow 机制：打开时写入，wrapper 挂载时自动加载
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

  // 打开抽屉时写入 pending-workflow，TinyflowWrapper 挂载时读取加载
  useEffect(() => {
    if (open && data) setPendingWorkflow(data);
  }, [open, data]);

  // 全屏打开完整编辑器
  const openEditor = () => {
    if (data) setPendingWorkflow(data);
    onOpenChange(false);
    router.push('/workflows/editor');
  };

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      {/* 注意：drawer.tsx 对 right 方向默认 w-3/4 + sm:max-w-sm（384px），
           utility 类特异性相同、生成顺序不定，必须内联样式覆盖（优先级最高） */}
      <DrawerContent
        className="h-full"
        style={{ width: '80vw', maxWidth: 'none' }}
      >
        <DrawerHeader className="flex items-center justify-between border-b border-border px-4 py-2">
          <DrawerTitle className="text-sm">{t('chat.workflowPreview')}</DrawerTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={openEditor}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {t('chat.workflowOpenEditor')}
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        {/* 复用完整画布（含画布菜单）：抽屉打开时挂载，wrapper 从 pending-workflow 加载数据 */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {open && <TinyflowWrapper />}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
