/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { AuthHeroShowcase, AuthPageWrapper } from '@green/components/auth/AuthShell';
import { LoadingPointStyle } from '@green/components/LoadingPointStyle';
import { showToast } from '@green/components/toast';
import { apiFetch } from '@green/utils/api-client';
import { clearAuthIdentity, setAuthIdentity, setIsSkipAuth, setSessionId } from '@green/utils/userId';
import { useEffect, useRef, useState } from 'react';

type CallbackResponse = {
  success?: boolean;
  needCode?: boolean;
  pendingToken?: string;
  userId?: string;
  userName?: string;
  sessionId?: string;
  message?: string;
  redirectTo?: string;
  error?: string;
};

type CallbackRequestResult = {
  ok: boolean;
  data: CallbackResponse;
};

const callbackRequestCache = new Map<string, Promise<CallbackRequestResult>>();
const CALLBACK_RESULT_CACHE_PREFIX = 'officeclaw:loginCallbackResult:';

function maskValue(value: string | undefined): string {
  if (!value) return '';
  return value.length <= 8 ? '***' : `...${value.slice(-8)}`;
}

function logStep(step: string, data: Record<string, unknown>): void {
  console.info(`【${step}】:${JSON.stringify(data, null, 2)}`);
}

function getTicketFromLocation(): string {
  if (typeof window === 'undefined') return '';
  return new URL(window.location.href).searchParams.get('ticket')?.trim() || '';
}

function getOauthCallbackParams(): { code: string; state: string; error: string } {
  if (typeof window === 'undefined') return { code: '', state: '', error: '' };
  const params = new URL(window.location.href).searchParams;
  return {
    code: params.get('code')?.trim() || '',
    state: params.get('state')?.trim() || '',
    error: params.get('error')?.trim() || '',
  };
}

function redirectToLogin(): void {
  clearAuthIdentity();
  setIsSkipAuth(false);
  window.location.replace('/login');
}

function stashPendingInvitationState(data: CallbackResponse): void {
  if (typeof window === 'undefined') return;

  if (typeof data.pendingToken === 'string' && data.pendingToken.trim()) {
    sessionStorage.setItem('officeclaw:pendingToken', data.pendingToken.trim());
  } else {
    sessionStorage.removeItem('officeclaw:pendingToken');
  }

  if (typeof data.userId === 'string' && data.userId.trim()) {
    sessionStorage.setItem('officeclaw:pendingUserId', data.userId.trim());
  } else {
    sessionStorage.removeItem('officeclaw:pendingUserId');
  }
}

function clearPendingInvitationState(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('officeclaw:callbackTicket');
  sessionStorage.removeItem('officeclaw:pendingUserId');
  sessionStorage.removeItem('officeclaw:pendingToken');
}

function withAuthSuccessRedirect(target: string): string {
  if (!target.startsWith('/')) return target;
  const [pathAndSearch, hash = ''] = target.split('#');
  const [pathname, search = ''] = pathAndSearch.split('?');
  const params = new URLSearchParams(search);
  params.set('authSuccess', '1');
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash ? `#${hash}` : ''}`;
}

function readStoredCallbackResult(cacheKey: string): CallbackRequestResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${CALLBACK_RESULT_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as CallbackResponse;
    if (data?.success || (data?.needCode && data.pendingToken && data.userId)) {
      logStep('前端读取回调缓存', {
        cacheKey,
        success: Boolean(data.success),
        needCode: Boolean(data.needCode),
        userId: data.userId,
        hasSessionId: Boolean(data.sessionId),
      });
      return { ok: true, data };
    }
  } catch {
    sessionStorage.removeItem(`${CALLBACK_RESULT_CACHE_PREFIX}${cacheKey}`);
  }
  return null;
}

function storeReusableCallbackResult(cacheKey: string, result: CallbackRequestResult): void {
  if (typeof window === 'undefined') return;
  const data = result.data;
  if (!result.ok || (!data?.success && !(data?.needCode && data.pendingToken && data.userId))) return;
  sessionStorage.setItem(`${CALLBACK_RESULT_CACHE_PREFIX}${cacheKey}`, JSON.stringify(data));
  logStep('前端写入回调缓存', {
    cacheKey,
    success: Boolean(data.success),
    needCode: Boolean(data.needCode),
    userId: data.userId,
    hasSessionId: Boolean(data.sessionId),
  });
}

async function requestCallbackResult(payload: { ticket?: string; code?: string; state?: string; error?: string }): Promise<CallbackRequestResult> {
  const cacheKey = JSON.stringify(payload);
  const storedResult = readStoredCallbackResult(cacheKey);
  if (storedResult) return storedResult;

  const cachedRequest = callbackRequestCache.get(cacheKey);
  if (cachedRequest) {
    logStep('前端复用进行中的回调请求', { cacheKey });
    return cachedRequest;
  }

  const requestPromise = (async () => {
    logStep('前端发送登录回调请求', {
      hasTicket: Boolean(payload.ticket),
      code: maskValue(payload.code),
      state: maskValue(payload.state),
      error: payload.error,
    });
    const response = await apiFetch('/api/login/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as CallbackResponse;
    logStep('前端收到登录回调响应', {
      httpOk: response.ok,
      status: response.status,
      success: Boolean(data.success),
      needCode: Boolean(data.needCode),
      userId: data.userId,
      hasSessionId: Boolean(data.sessionId),
      message: data.message,
      error: data.error,
      redirectTo: data.redirectTo,
    });
    return {
      ok: response.ok,
      data,
    };
  })().finally(() => {
    callbackRequestCache.delete(cacheKey);
  });

  const reusableRequest = requestPromise.then((result) => {
    storeReusableCallbackResult(cacheKey, result);
    return result;
  });
  callbackRequestCache.set(cacheKey, reusableRequest);
  return reusableRequest;
}

export default function LoginCallbackPage() {
  const [hasCallbackError, setHasCallbackError] = useState(false);
  const lastErrorToastRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    const reportCallbackError = (message: string) => {
      if (cancelled) return;
      setHasCallbackError(true);
      if (lastErrorToastRef.current === message) return;
      lastErrorToastRef.current = message;
      showToast({
        type: 'error',
        title: '登录失败',
        message,
        duration: 5000,
      });
    };

    const finalizeLogin = async () => {
      const ticket = getTicketFromLocation();
      const oauth = getOauthCallbackParams();
      logStep('前端解析登录回调参数', {
        href: window.location.href,
        hasTicket: Boolean(ticket),
        code: maskValue(oauth.code),
        state: maskValue(oauth.state),
        error: oauth.error,
      });
      if (!ticket && !oauth.code && !oauth.state && !oauth.error) {
        logStep('前端登录回调参数缺失', {});
        reportCallbackError('回调参数缺失，请重新登录');
        return;
      }

      try {
        const payload = ticket ? { ticket } : oauth.error ? { error: oauth.error } : { code: oauth.code, state: oauth.state };
        logStep('前端准备处理登录回调', {
          mode: ticket ? 'cas' : 'oauth',
          hasTicket: Boolean(ticket),
          code: maskValue('code' in payload ? payload.code : undefined),
          state: maskValue('state' in payload ? payload.state : undefined),
          error: 'error' in payload ? payload.error : undefined,
        });
        const { ok, data } = await requestCallbackResult(payload);
        if (cancelled) return;

        setIsSkipAuth(false);

        if (data?.needCode && data.pendingToken && data.userId) {
          logStep('前端登录回调进入邀请码流程', {
            userId: data.userId,
            hasPendingToken: Boolean(data.pendingToken),
          });
          setAuthIdentity({ userId: data.userId, userName: data.userName });
          stashPendingInvitationState(data);
          window.location.replace('/login/invitation');
          return;
        }

        if (!ok || !data?.success || !data.userId) {
          const message = data?.message || data?.error || '登录失败，请重试';
          console.error('登录回调失败:', message, data);
          logStep('前端登录回调判定失败', {
            httpOk: ok,
            success: Boolean(data?.success),
            userId: data?.userId,
            message,
          });
          reportCallbackError(message);
          return;
        }

        setAuthIdentity({ userId: data.userId, userName: data.userName });
        if (typeof data.sessionId === 'string') {
          setSessionId(data.sessionId);
        }
        logStep('前端写入登录身份', {
          userId: data.userId,
          userName: data.userName,
          hasSessionId: Boolean(data.sessionId),
        });
        stashPendingInvitationState(data);
        if (!data.needCode) {
          clearPendingInvitationState();
        }
        logStep('前端登录回调准备跳转', {
          target: data.needCode ? '/login/invitation' : withAuthSuccessRedirect(data.redirectTo || '/'),
        });
        window.location.replace(data.needCode ? '/login/invitation' : withAuthSuccessRedirect(data.redirectTo || '/'));
      } catch (err) {
        console.error('处理登录回调失败:', err);
        logStep('前端登录回调异常', {
          message: err instanceof Error ? err.message : String(err),
        });
        reportCallbackError('网络错误，请检查连接后重试');
      }
    };

    void finalizeLogin();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthPageWrapper className="bg-[radial-gradient(circle_at_top_left,_rgba(250,222,197,0.28),_transparent_38%),linear-gradient(135deg,_#FFF8F2_0%,_#FFFFFF_56%,_#FFF4EA_100%)] px-4 py-8 sm:px-6 md:px-8 lg:px-12 lg:py-10 xl:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1280px] items-center justify-center lg:min-h-[calc(100vh-5rem)]">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <AuthHeroShowcase layout="standalone" />

          <div className="mt-12 flex items-center gap-3 text-[16px] font-normal text-[#595959] sm:text-base">
            {hasCallbackError ? (
              <div className="flex flex-col items-center gap-5 text-center">
                <button
                  type="button"
                  onClick={redirectToLogin}
                  className="flex h-8 min-w-[120px] items-center justify-center rounded-full bg-[#191919] px-6 text-[12px] font-normal text-white shadow-[0_18px_38px_-22px_rgba(17,24,39,0.95)] transition hover:-translate-y-0.5 hover:bg-[#242424]"
                >
                  返回登录页
                </button>
              </div>
            ) : (
              <>
                <LoadingPointStyle className="h-5 w-5 flex-shrink-0" />
                <span>登录中...</span>
              </>
            )}
          </div>
        </div>
      </div>
    </AuthPageWrapper>
  );
}
