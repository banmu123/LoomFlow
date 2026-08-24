import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/server-auth';
import { MainLayoutClient } from '@/components/MainLayoutClient';

// 主界面布局：服务端鉴权——未登录直接跳登录页（不渲染任何主界面内容）
// 避免客户端 SessionGuard 的"先渲染后跳转"闪现，以及无鉴权请求时停留在未登录状态
export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  if (!user) {
    // 带上当前路径，登录成功后跳回
    const pathname = (await headers()).get('x-pathname') ?? '/';
    redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
  }

  return <MainLayoutClient>{children}</MainLayoutClient>;
}
