/**
 * PlaceholderPage — 桌面端未实现 / 不适用路由的统一占位页
 *
 * 侧边栏「管理」分组下的部分入口（搜索配置、用户、统计、审计、API 调用、
 * 存储设置）目前只在云端 / 企业版提供，桌面端为本地单用户模式。
 * 之前的版本里这些入口没有注册路由，点击后主区域完全空白，
 * 这里统一给出明确的说明，避免出现「白屏像卡死」的体验。
 *
 * 同时用作 404 兜底（`notFound` 模式）——该模式下标题、说明文案、
 * 返回目标都与「功能未开放」不同，不再共用同一段描述。
 */

import { ArrowLeft, Compass, FileQuestion, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/lib/i18n';

interface PlaceholderPageProps {
  /** 标题的 i18n key（在 Provider 内部解析，避免上层组件取不到翻译） */
  titleKey?: string;
  /** 图标 */
  icon?: LucideIcon;
  /** 404 模式：标题固定为「页面不存在」，说明与返回目标单独处理 */
  notFound?: boolean;
}

export default function PlaceholderPage({
  titleKey,
  icon,
  notFound = false,
}: PlaceholderPageProps) {
  const t = useT();
  const navigate = useNavigate();

  const Icon = icon ?? (notFound ? FileQuestion : Compass);
  const title = notFound ? t('common.pageNotFound') : titleKey ? t(titleKey) : '';
  const description = notFound ? t('common.pageNotFoundDesc') : t('common.desktopOnly');
  const backTo = notFound ? '/' : '/chat';
  const backLabel = notFound ? t('common.backHome') : t('sidebar.chat');

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {!notFound && (
              <p className="text-sm text-muted-foreground">{t('sidebar.management')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <Icon className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{description}</p>
          <button
            onClick={() => navigate(backTo)}
            className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
