/**
 * App — LoomFlow Desktop 主入口
 *
 * 复用 Web 端的 i18n、Theme、UI 组件，保持一致的视觉体验。
 * 路由使用 react-router-dom 替代 Next.js。
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import {
  Activity,
  BarChart3,
  CloudCog,
  Compass,
  FileClock,
  Search,
  Users,
} from 'lucide-react';
import { I18nProvider } from '@/lib/i18n';
import { RepositoryProvider } from './app/repositories';
import { DesktopLayout } from './components/layout/DesktopLayout';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import WorkflowsPage from './pages/WorkflowsPage';
import EditorPage from './pages/EditorPage';
import RunsPage from './pages/RunsPage';
import KnowledgePage from './pages/KnowledgePage';
import SkillsPage from './pages/SkillsPage';
import ModelsPage from './pages/ModelsPage';
import SettingsPage from './pages/SettingsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import './index.css';

/**
 * 桌面端暂未实现 / 不适用的管理模块。
 *
 * 桌面端是本地单用户模式，用户管理、用量统计、审计日志等依赖服务端能力，
 * 在桌面端没有意义。这里统一注册占位路由，保证侧边栏点击不会出现空白页。
 */
const PLACEHOLDER_ROUTES = [
  { path: '/admin/search-providers', titleKey: 'sidebar.searchProviders', icon: Search },
  { path: '/admin/users', titleKey: 'sidebar.users', icon: Users },
  { path: '/admin/stats', titleKey: 'sidebar.stats', icon: BarChart3 },
  { path: '/admin/logs', titleKey: 'sidebar.logs', icon: FileClock },
  { path: '/admin/api-logs', titleKey: 'sidebar.apiLogs', icon: Activity },
  { path: '/admin/oss', titleKey: 'sidebar.oss', icon: CloudCog },
] as const;

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider>
        <RepositoryProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<DesktopLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/chat/:id" element={<ChatPage />} />
                <Route path="/workflows" element={<WorkflowsPage />} />
                <Route path="/workflows/editor" element={<EditorPage />} />
                <Route path="/workflows/editor/:id" element={<EditorPage />} />
                <Route path="/workflows/history" element={<RunsPage />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/admin/models" element={<ModelsPage />} />
                {PLACEHOLDER_ROUTES.map((route) => (
                  <Route
                    key={route.path}
                    path={route.path}
                    element={<PlaceholderPage titleKey={route.titleKey} icon={route.icon} />}
                  />
                ))}
                <Route path="/settings" element={<SettingsPage />} />
                {/* 404 兜底 */}
                <Route path="*" element={<PlaceholderPage icon={Compass} notFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </RepositoryProvider>
        {/* 全局唯一的 toast 容器：复用 Web 端同一封装（跟随明暗主题）。
            切勿再挂载第二个 <Toaster />，否则同一条消息会重复弹出。 */}
        <Toaster position="top-center" richColors />
      </I18nProvider>
    </ThemeProvider>
  );
}
