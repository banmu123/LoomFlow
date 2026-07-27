'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

type FeishuStatus = 'loading' | 'success' | 'error';

export default function FeishuLoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<FeishuStatus>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const t = useT();

  const tryLogin = () => {
    setStatus('loading');
    setErrorMsg('');
    // 模拟飞书自动登录流程
    setTimeout(() => {
      setStatus('success');
      setTimeout(() => {
        router.push('/');
      }, 1000);
    }, 1500);
  };

  useEffect(() => {
    tryLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted">
      <div className="space-y-4 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-lg font-medium">{t('login.feishuLoading')}</p>
            <p className="text-sm text-muted-foreground">{t('login.pleaseWait')}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
            <p className="text-lg font-medium text-green-600">{t('login.loginSuccess')}</p>
            <p className="text-sm text-muted-foreground">{t('login.redirecting')}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-red-600" />
            <p className="text-lg font-medium text-red-600">{t('login.loginFailed')}</p>
            <p className="text-sm text-muted-foreground">{errorMsg || t('login.unknownError')}</p>
            <Button
              className="mt-4 px-4 py-2"
              onClick={tryLogin}
            >
              {t('login.retry')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
