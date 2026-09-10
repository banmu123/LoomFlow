/**
 * App — LoomFlow Desktop 主入口
 *
 * 复用 Web 端的 i18n、Theme、UI 组件，保持一致的视觉体验。
 * 路由使用 react-router-dom 替代 Next.js。
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
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
import './index.css';

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
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </RepositoryProvider>
        <Toaster position="top-center" richColors />
      </I18nProvider>
    </ThemeProvider>
  );
}
