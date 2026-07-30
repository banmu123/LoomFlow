import { PlaceholderPage } from '@/components/PlaceholderPage';
import { LayoutDashboard } from 'lucide-react';

export default function CommandPage() {
  return (
    <PlaceholderPage
      title="Command 总控"
      description="今天先处理什么 — 总览、队列、推荐工作流、后端状态"
      icon={LayoutDashboard}
    />
  );
}
