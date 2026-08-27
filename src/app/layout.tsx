import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'LoomFlow',
    template: '%s | LoomFlow',
  },
  description: 'LoomFlow - AI-native workflow platform',
  keywords: ['LoomFlow', 'AI workflow', 'workflow orchestration'],
  authors: [{ name: 'LoomFlow' }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased`}>
        <I18nProvider>
          {children}
          {/* 全局 toast（此前未挂载导致所有 toast 静默失效——接口错误不显示） */}
          <Toaster position="top-center" richColors />
        </I18nProvider>
      </body>
    </html>
  );
}
