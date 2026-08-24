import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 登录保护：未登录访问主界面（非 auth/api 路径）→ 重定向登录页
// 服务端强制跳转，避免客户端 SessionGuard 的"先渲染后跳转"闪现
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静态资源/API/登录相关路径放行
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/screenshots') ||
    pathname === '/login' ||
    pathname === '/feishu-login' ||
    pathname === '/share' ||
    pathname.startsWith('/share/')
  ) {
    return NextResponse.next();
  }

  // 检查登录 cookie（与 auth.ts 的 COOKIE_NAME 一致）
  const token = request.cookies.get('forgeflow_token')?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // 排除静态资源与 API
  matcher: ['/((?!api|_next|favicon.ico|screenshots).*)'],
};
