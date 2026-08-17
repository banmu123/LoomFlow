import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { Toaster } from 'sonner';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LoomFlow',
    template: '%s | LoomFlow',
  },
  description: 'LoomFlow - AI 原生工作流平台',
  keywords: ['LoomFlow', 'AI工作流', '工作流编排'],
  authors: [{ name: 'LoomFlow' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>
        <I18nProvider>
          {isDev && <Inspector />}
          {children}
          {/* 全局 toast（此前未挂载导致所有 toast 静默失效——接口错误不显示） */}
          <Toaster position="top-center" richColors />
        </I18nProvider>
      </body>
    </html>
  );
}
