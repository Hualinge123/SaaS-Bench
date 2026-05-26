/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { AuthPageWrapper } from '@green/components/auth/AuthShell';
import { showToast } from '@green/components/toast';
import { apiFetch } from '@green/utils/api-client';
import { clearAuthIdentity, setAuthIdentity, setCanCreateModel, setIsSkipAuth, setSessionId } from '@green/utils/userId';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type InvitationResponse = {
  loginUrl?: string;
  sessionId?: string;
  success?: boolean;
  needCode?: boolean;
  pendingToken?: string;
  userId?: string;
  userName?: string;
  message?: string;
  errorCode?: string;
  redirectTo?: string;
  logoutUrl?: string;
  islogin?: boolean;
  pendingInvitation?: boolean;
  isskip?: boolean;
  canCreateModel?: boolean;
};

const INVITATION_LINK_URL = 'https://www.huaweicloud.com/product/agentarts/officeclaw.html';

function showInvitationError(message: string) {
  showToast({
    type: 'error',
    title: '邀请码校验失败',
    message,
    duration: 5000,
  });
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

function getTicketFromLocation(): string {
  if (typeof window === 'undefined') return '';
  return new URL(window.location.href).searchParams.get('ticket')?.trim() || '';
}

function getPendingUserId(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('officeclaw:pendingUserId') || '';
}

function getPendingToken(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('officeclaw:pendingToken') || '';
}

function clearPendingInvitationState(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('officeclaw:callbackTicket');
  sessionStorage.removeItem('officeclaw:pendingUserId');
  sessionStorage.removeItem('officeclaw:pendingToken');
}

export default function LoginInvitationPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [promotionCode, setPromotionCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReloginLoading, setIsReloginLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const handleRelogin = useCallback(async () => {
    setIsReloginLoading(true);

    try {
      const response = await apiFetch('/api/logout', {
        method: 'POST',
      });
      const data = (await response.json()) as InvitationResponse;
      clearAuthIdentity();
      clearPendingInvitationState();
      setIsSkipAuth(false);

      if (response.ok && data?.logoutUrl) {
        window.location.replace(data.logoutUrl);
        return;
      }
    } catch (err) {
      console.error('重新登录失败:', err);
    } finally {
      setIsReloginLoading(false);
    }

    clearAuthIdentity();
    clearPendingInvitationState();
    setIsSkipAuth(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (typeof window !== 'undefined') {
      const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
      if (isPreview) {
        setIsReady(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => {
          cancelled = true;
        };
      }
    }

    const checkState = async () => {
      try {
        const response = await apiFetch('/api/islogin');
        const data = (await response.json()) as InvitationResponse;
        if (cancelled) return;

        if (typeof data?.userId === 'string' && data.userId.trim()) {
          setAuthIdentity({
            userId: data.userId,
            userName: typeof data?.userName === 'string' ? data.userName : undefined,
          });
        }
        setIsSkipAuth(Boolean(data?.isskip));
        setCanCreateModel(Boolean(data?.canCreateModel));

        if (data?.islogin) {
          navigate(withAuthSuccessRedirect('/'), { replace: true });
          return;
        }

        const ticket = getTicketFromLocation();
        const pendingUserId = getPendingUserId();
        const pendingToken = getPendingToken();
        if (!data?.pendingInvitation && !ticket && !pendingUserId && !pendingToken) {
          clearAuthIdentity();
          clearPendingInvitationState();
          setIsSkipAuth(false);
          const loginUrl = typeof data?.loginUrl === 'string' ? data.loginUrl : '';
          if (loginUrl) window.location.replace(loginUrl);
          return;
        }

        setIsReady(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      } catch (err) {
        console.error('检查邀请码状态失败:', err);
        if (!cancelled) {
          clearAuthIdentity();
          clearPendingInvitationState();
          setIsSkipAuth(false);
        }
      }
    };

    void checkState();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = promotionCode.trim();
    if (!code) {
      showInvitationError('请输入邀请码');
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await apiFetch('/api/login/invitation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pendingToken: getPendingToken(), promotionCode: code }),
      });

      const data = (await response.json()) as InvitationResponse;
      if (!response.ok || !data?.success || !data.userId) {
        showInvitationError(data?.message || '邀请码校验失败，请稍后重试');
        if (data?.needCode) {
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }

      setAuthIdentity({ userId: data.userId, userName: data.userName });
      if (typeof data.sessionId === 'string' && data.sessionId.length > 0) {
        setSessionId(data.sessionId);
        clearPendingInvitationState();
      }
      navigate(withAuthSuccessRedirect(data.redirectTo || '/'), { replace: true });
    } catch (err) {
      console.error('提交邀请码失败:', err);
      showInvitationError('邀请码校验失败，请稍后重试');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageWrapper className="flex h-screen flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden px-6 py-10">
        <div className="pointer-events-none absolute inset-0">
          <img
            src="/images/invitation-background-4x.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
            decoding="async"
          />
        </div>

        <div className="relative mx-auto flex h-full max-w-[1080px] items-center justify-center">
          <div className="w-full max-w-[560px] text-center">
            <div className="space-y-5">
              <h1 className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 leading-none">
                <span
                  className="inline-block px-[2px] py-[2px] text-[48px] font-bold leading-[64px] tracking-[-0.045em] text-transparent [background-clip:text] [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]"
                  style={{
                    backgroundImage: 'linear-gradient(180deg, #FF8A17 0%, #FF5A00 100%)',
                  }}
                >
                  欢迎体验
                </span>
                <span className="inline-flex items-center pt-[2px]">
                  <img
                    src="/images/OfficeClaw.svg"
                    alt="OfficeClaw"
                    width={186}
                    height={54}
                    className="h-[65px] w-auto"
                    decoding="async"
                  />
                </span>
              </h1>
              <p className="mx-auto max-w-[430px] text-sm font-medium leading-6 text-[#191919]">
                产品邀测开放，期待与您一起，共创智能高效的办公方式
              </p>
            </div>

            <form className="mx-auto mt-11 w-full max-w-[462px] space-y-5 text-left" onSubmit={handleSubmit}>
              <div className="space-y-2.5">
                <label htmlFor="promotionCode" className="block text-[12px] text-[#191919]">
                  邀请码
                </label>
                <input
                  ref={inputRef}
                  id="promotionCode"
                  name="promotionCode"
                  type="text"
                  autoComplete="off"
                  disabled={!isReady || isSubmitting || isReloginLoading}
                  className="block h-[28px] w-full rounded-[6px] border border-[#C2C2C2] bg-white px-3 text-sm text-[#111827] shadow-[0_10px_28px_-24px_rgba(15,23,42,0.8)] outline-none transition placeholder:text-[#C6BBAF] focus:border-[#F08A40] focus:ring-4 focus:ring-[#FCE7D6] disabled:cursor-not-allowed disabled:bg-[#F6F3EF]"
                  placeholder="请输入"
                  value={promotionCode}
                  onChange={(event) => setPromotionCode(event.target.value)}
                />
                <p className="text-[12px] leading-5 text-[#808080]">
                  没有邀请码？可以去OfficeClaw官网获取产品体验邀请码
                  <a
                    href={INVITATION_LINK_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center gap-1 align-baseline font-medium text-[#1476ff] transition hover:text-[#0d62d9]"
                  >
                    获取邀请码
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 14 14"
                      className="h-[12px] w-[12px] shrink-0"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M5.2 1.6H4.4C2.8536 1.6 2.0804 1.6 1.6 2.0804C1.1196 2.5608 1.1196 3.334 1.1196 4.8804V9.6C1.1196 11.1464 1.1196 11.9196 1.6 12.4C2.0804 12.8804 2.8536 12.8804 4.4 12.8804H9.1196C10.666 12.8804 11.4392 12.8804 11.9196 12.4C12.4 11.9196 12.4 11.1464 12.4 9.6V8.8"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M7 1.6H12.4V7"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M12.4 1.6L5.8 8.2"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </p>
              </div>

              <div className="pt-7 text-center">
                <div className="mx-auto flex max-w-[250px] gap-3">
                  <button
                    type="button"
                    disabled={isReloginLoading || isSubmitting}
                    onClick={handleRelogin}
                    className="flex h-8 flex-1 items-center justify-center rounded-full border border-[#191919] bg-white px-6 text-[12px] font-normal text-[#191919] shadow-[0_18px_38px_-22px_rgba(17,24,39,0.95)] transition hover:-translate-y-0.5 hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:border-[#D1D5DB] disabled:text-[#9CA3AF] disabled:shadow-none"
                  >
                    {isReloginLoading ? '重新登录中...' : '退出登录'}
                  </button>
                  <button
                    type="submit"
                    disabled={!isReady || isSubmitting || isReloginLoading}
                    className="flex h-8 flex-1 items-center justify-center rounded-full bg-[#191919] px-6 text-[12px] font-normal text-white shadow-[0_18px_38px_-22px_rgba(17,24,39,0.95)] transition hover:-translate-y-0.5 hover:bg-[#242424] disabled:cursor-not-allowed disabled:bg-[#D1D5DB] disabled:shadow-none"
                  >
                    {isSubmitting ? '校验中...' : '立即体验'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </AuthPageWrapper>
  );
}
