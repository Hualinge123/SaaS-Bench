import { AuthHeroShowcase, AuthPageWrapper } from '@green/components/auth/AuthShell';
import { LoadingPointStyle } from '@green/components/LoadingPointStyle';
import { showToast } from '@green/components/toast';
import { apiFetch } from '@green/utils/api-client';
import type { AuthProviderInfo } from '@green/utils/auth-provider';
import { setIsSkipAuth, setUserId } from '@green/utils/userId';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type IsLoginResponse = {
  islogin?: boolean;
  userId?: string | null;
  isskip?: boolean;
  provider?: AuthProviderInfo;
  loginUrl?: string;
};

type AuthorizeResponse = {
  authorizeUrl?: string;
  state?: string;
  message?: string;
};

function isLocalLoginUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin && url.pathname === '/login';
  } catch {
    return value === '/login';
  }
}

function openExternalUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [provider, setProvider] = useState<AuthProviderInfo | null>(null);
  const [fetchingAuthorizeUrl, setFetchingAuthorizeUrl] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkLoginStatus = async () => {
      try {
        const response = await apiFetch('/api/islogin');
        const data = (await response.json()) as IsLoginResponse;
        if (cancelled) return;

        setIsSkipAuth(Boolean(data?.isskip));
        setProvider(data?.provider ?? null);

        if (data?.islogin) {
          if (typeof data.userId === 'string' && data.userId.length > 0) {
            setUserId(data.userId);
          }
          navigate('/', { replace: true });
          return;
        }

        const redirectUrl = data?.provider?.mode === 'redirect' ? data.provider.redirectUrl || data.loginUrl : data.loginUrl;
        if (redirectUrl && !isLocalLoginUrl(redirectUrl)) {
          window.location.replace(redirectUrl);
          return;
        }

        if (data?.provider?.id === 'huawei-oauth' || isLocalLoginUrl(redirectUrl)) {
          return;
        }

        showToast({
          type: 'error',
          title: '登录失败',
          message: '未获取到登录跳转地址，请重试',
          duration: 4000,
        });
      } catch (err) {
        console.error('检查登录状态失败:', err);
        if (!cancelled) {
          showToast({
            type: 'error',
            title: '登录失败',
            message: '网络异常，无法发起登录跳转',
            duration: 4000,
          });
        }
      }
    };

    void checkLoginStatus();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleAuthorize = useCallback(() => {
    if (fetchingAuthorizeUrl) return;
    setFetchingAuthorizeUrl(true);
    void (async () => {
      try {
        const response = await apiFetch('/api/login/authorize', {
          method: 'POST',
          timeoutMs: 8000,
          suppressAuthRedirect: true,
        });
        const data = (await response.json()) as AuthorizeResponse;
        if (!response.ok || !data.authorizeUrl) {
          showToast({
            type: 'error',
            title: '登录失败',
            message: data.message || '无法获取授权地址，请刷新重试',
            duration: 4000,
          });
          return;
        }
        openExternalUrl(data.authorizeUrl);
        setWaiting(true);
      } catch {
        showToast({
          type: 'error',
          title: '登录失败',
          message: '网络请求失败，请检查连接后重试',
          duration: 4000,
        });
      } finally {
        setFetchingAuthorizeUrl(false);
      }
    })();
  }, [fetchingAuthorizeUrl]);

  const isOauthProvider = provider?.id === 'huawei-oauth';

  return (
    <AuthPageWrapper className="bg-[radial-gradient(circle_at_top_left,_rgba(250,222,197,0.28),_transparent_38%),linear-gradient(135deg,_#FFF8F2_0%,_#FFFFFF_56%,_#FFF4EA_100%)] px-4 py-8 sm:px-6 md:px-8 lg:px-12 lg:py-10 xl:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1280px] items-center justify-center lg:min-h-[calc(100vh-5rem)]">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <AuthHeroShowcase layout="standalone" />

          {isOauthProvider ? (
            <div className="mt-12 flex flex-col items-center gap-4">
              {waiting ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-3 text-[16px] font-normal text-[#595959]">
                    <LoadingPointStyle className="h-5 w-5 flex-shrink-0" />
                    <span>授权中，等待回调...</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAuthorize}
                    disabled={fetchingAuthorizeUrl}
                    className="mt-2 text-[13px] text-[#999] underline underline-offset-2 hover:text-[#191919] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {fetchingAuthorizeUrl ? '准备中...' : '重新发起授权'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAuthorize}
                  disabled={fetchingAuthorizeUrl}
                  className="flex h-8 min-w-[120px] items-center justify-center rounded-full bg-[#191919] px-6 text-[12px] font-normal text-white shadow-[0_18px_38px_-22px_rgba(17,24,39,0.95)] transition hover:-translate-y-0.5 hover:bg-[#242424] disabled:cursor-not-allowed disabled:bg-[#D1D5DB] disabled:shadow-none"
                >
                  {fetchingAuthorizeUrl ? '登录中...' : '登 录'}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-12 flex items-center gap-3 text-[16px] font-normal text-[#595959] sm:text-base">
              <LoadingPointStyle className="h-5 w-5 flex-shrink-0" />
              <span>加载中...</span>
            </div>
          )}
        </div>
      </div>
    </AuthPageWrapper>
  );
}
