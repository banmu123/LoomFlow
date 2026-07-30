import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI工作流平台',
    template: '%s | AI工作流平台',
  },
  description: 'AI工作流平台 - 智能工作流编排与管理',
  keywords: ['AI工作流', '工作流编排', 'Tinyflow'],
  authors: [{ name: 'AI工作流平台' }],
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
        </I18nProvider>
      </body>
    </html>
  );
}
