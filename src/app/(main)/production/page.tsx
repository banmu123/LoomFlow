import { PlaceholderPage } from '@/components/PlaceholderPage';
import { Factory } from 'lucide-react';

export default function ProductionPage() {
  return (
    <PlaceholderPage
      title="Production 生产"
      description="执行业务生产任务 — 配置数据、资产生产、Unity 队列、插件构建"
      icon={Factory}
    />
  );
}
