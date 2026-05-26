import { AuthHeroShowcase } from '@green/components/auth/AuthShell';
import { LoadingPointStyle } from '@green/components/LoadingPointStyle';
import { apiFetch } from '@green/utils/api-client';
import { lazy, Suspense, useEffect, useState } from 'react';

type IsLoginResponse = { islogin?: boolean };

const WebApp = lazy(() => import('@/App'));

function clearAuthSuccessFlag(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('authSuccess')) return;
  url.searchParams.delete('authSuccess');
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl || '/');
}

export default function PostLoginRedirect() {
  const [attempt, setAttempt] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      try {
        const response = await apiFetch('/api/islogin');
        const data = (await response.json()) as IsLoginResponse;
        if (cancelled) return;
        if (data?.islogin) {
          clearAuthSuccessFlag();
          setIsLoggedIn(true);
          return;
        }
        window.location.replace('/login');
      } catch {
        if (cancelled) return;
        if (attempt < 2) {
          retryTimer = setTimeout(() => {
            if (!cancelled) setAttempt((prevAttempt) => prevAttempt + 1);
          }, 1200);
        } else {
          window.location.replace('/login');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [attempt]);

  if (isLoggedIn) {
    return (
      <Suspense fallback={<PostLoginLoadingPanel message="正在进入首页..." />}>
        <WebApp />
      </Suspense>
    );
  }

  return (
    <PostLoginLoadingPanel
      message={attempt === 0 ? '正在跳转...' : '网络异常，正在重试...'}
    />
  );
}

function PostLoginLoadingPanel({ message = '正在跳转...' }: { message?: string }) {
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top_left,_rgba(250,222,197,0.28),_transparent_38%),linear-gradient(135deg,_#FFF8F2_0%,_#FFFFFF_56%,_#FFF4EA_100%)] px-4 py-8 sm:px-6 md:px-8 lg:px-12 lg:py-10 xl:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1280px] items-center justify-center lg:min-h-[calc(100vh-5rem)]">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <AuthHeroShowcase layout="standalone" />
          <div className="mt-12 flex items-center gap-3 text-[16px] font-normal text-[#595959] sm:text-base">
            <LoadingPointStyle className="h-5 w-5 flex-shrink-0" />
            <span>{message}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
