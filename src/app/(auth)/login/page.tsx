'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Video, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [feishuLoading, setFeishuLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const t = useT();

  const redirectUrl = searchParams.get('redirect') || '/';

  // 初始加载：检查 /api/auth/me，已登录则自动跳转
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { signal: AbortSignal.timeout(3000) });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.authenticated) {
          const inIframe = window.self !== window.top;
          if (inIframe) {
            window.open(redirectUrl, '_blank');
          } else {
            router.replace(redirectUrl);
          }
          return;
        }
      } catch {
        // 接口不存在或未登录，静默继续显示登录页
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError(t('login.enterUsernamePassword'));
      return;
    }
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error || t('login.loginFailed'));
        setLoading(false);
        return;
      }

      // 登录成功，跳转
      setLoading(false);
      const inIframe = typeof window !== 'undefined' && window.self !== window.top;
      if (inIframe) {
        window.open(redirectUrl, '_blank');
      } else {
        router.push(redirectUrl);
      }
    } catch {
      setError(t('login.networkError'));
      setLoading(false);
    }
  };

  const handleFeishuLogin = () => {
    // 飞书 OAuth 暂未接入
    setError(t('login.feishuUnavailable'));
  };

  // 飞书登录中加载态（整个卡片替换）
  if (feishuLoading) {
    return (
      <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Video className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <div className="flex flex-col items-center gap-2 text-primary">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-lg font-medium">{t('login.feishuLoading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-8 shadow-xl">
      {/* Logo */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Video className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">{t('app.name')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('app.tagline')}
        </p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 登录表单 */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          type="text"
          placeholder={t('login.username')}
          value={username}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
          className="h-11"
        />
        <Input
          type="password"
          placeholder={t('login.password')}
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          className="h-11"
        />
        <Button type="submit" className="h-11 w-full" disabled={loading || initializing}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('login.loggingIn')}
            </>
          ) : (
            t('login.login')
          )}
        </Button>
      </form>

      {/* 分割线 */}
      <div className="relative flex justify-center text-xs uppercase">
        <span className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </span>
        <span className="relative bg-card px-2 text-muted-foreground">{t('login.or')}</span>
      </div>

      {/* 飞书登录按钮 */}
      <Button
        variant="outline"
        className="h-11 w-full"
        onClick={handleFeishuLogin}
        disabled={loading}
      >
        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3.5 7.5C5.5 4.5 9 3 12 3c2 0 4.5.8 6.5 2.5 2 1.7 3 4 3 6.5 0 2.5-1 4.8-3 6.5-2 1.7-4.5 2.5-6.5 2.5-3 0-6.5-1.5-8.5-4.5-.3-.4-.2-1 .2-1.3.4-.3 1-.2 1.3.2C4.7 17.5 8 19 12 19c1.7 0 3.7-.6 5.3-2 1.6-1.4 2.7-3.2 2.7-5s-1-3.6-2.7-5C15.7 5.6 13.7 5 12 5 9 5 6.3 6.2 4.7 8.3c-.3.4-.9.5-1.3.2-.4-.3-.5-.9-.2-1.3zM12 8c.6 0 1 .4 1 1v3h3c.6 0 1 .4 1 1s-.4 1-1 1h-3v3c0 .6-.4 1-1 1s-1-.4-1-1v-3H8c-.6 0-1-.4-1-1s.4-1 1-1h3V9c0-.6.4-1 1-1z" />
        </svg>
        {t('login.feishuLogin')}
      </Button>

      {/* 底部提示 */}
      <p className="text-center text-xs text-muted-foreground">
        {t('login.agree')}
      </p>

      {/* 语言切换 */}
      <div className="flex justify-center">
        <LocaleSwitcher />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
      <Suspense
        fallback={
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
