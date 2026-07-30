import { PlaceholderPage } from '@/components/PlaceholderPage';
import { FolderKanban } from 'lucide-react';

export default function ProjectPage() {
  return (
    <PlaceholderPage
      title="Project 项目事实"
      description="先确认事实，再执行 — 项目事实、SVN、目录结构、权限边界"
      icon={FolderKanban}
    />
  );
}
