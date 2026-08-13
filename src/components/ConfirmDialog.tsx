'use client';

import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** 确认按钮文案（默认 common.confirm） */
  confirmText?: string;
  /** 取消按钮文案（默认 common.cancel） */
  cancelText?: string;
  /** 危险操作：确认按钮红色 */
  destructive?: boolean;
  /** 确认中：按钮禁用并转圈 */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// 统一确认弹窗：替代浏览器原生 confirm()，与系统 UI 保持一致
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  destructive,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !loading && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText ?? t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={onConfirm}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {loading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {confirmText ?? t('common.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
