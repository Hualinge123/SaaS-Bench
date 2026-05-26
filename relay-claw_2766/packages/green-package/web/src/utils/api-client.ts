/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Unified API client for green-package web (Vite).
 * 与主站 `packages/web` 行为对齐；401 时跳转本包 `/login`。
 */

import { readBuildEnv, readPublicEnv } from '@/utils/client-env';
import { getLegacyReadUserId, getSessionId, getUserId } from './userId';

/** Default API request timeout: 1 hour (matching backend CLI_TIMEOUT_MS) */
const DEFAULT_API_TIMEOUT_MS = 60 * 60 * 1000;

function getBrowserLocation(): Location | null {
  if (typeof globalThis !== 'object' || globalThis === null) return null;
  const candidate = (globalThis as { location?: Location }).location;
  return candidate ?? null;
}

function isLoopbackHost(hostname: string | undefined): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

const PROD_TUNNEL_API_URL = readPublicEnv('NEXT_PUBLIC_PROD_API_URL') ?? '';
const PROD_TUNNEL_FRONTEND_HOST = readPublicEnv('NEXT_PUBLIC_PROD_FRONTEND_HOST') ?? '';
const OFFICE_CLAW_CLOUD_API_HOST = readBuildEnv('API_CLOWDER_HOST');
const DEFAULT_API_CLIENT_URL = readBuildEnv('DEFAULT_API_CLIENT_URL');

function resolveApiUrl(): string {
  const location = getBrowserLocation();

  if (location?.hostname === PROD_TUNNEL_FRONTEND_HOST) {
    return OFFICE_CLAW_CLOUD_API_HOST;
  }
  if (isLoopbackHost(location?.hostname)) {
    const frontendPort = Number(location?.port ?? '') || 3003;
    const apiPort = frontendPort + 1;
    const protocol = location?.protocol ?? 'http:';
    const hostname = location?.hostname ?? '127.0.0.1';
    return `${protocol}//${hostname}:${apiPort}`;
  }
  const explicitPublic = readPublicEnv('NEXT_PUBLIC_API_URL') || readPublicEnv('VITE_API_URL');
  if (explicitPublic) return explicitPublic.replace(/\/+$/, '');
  if (typeof window === 'undefined') return DEFAULT_API_CLIENT_URL;
  const frontendPort = Number(location?.port ?? '') || 3001;
  const apiPort = frontendPort + 1;
  const protocol = location?.protocol ?? 'http:';
  const hostname = location?.hostname ?? 'localhost';
  return `${protocol}//${hostname}:${apiPort}`;
}
export const API_URL = resolveApiUrl();

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  suppressAuthRedirect?: boolean;
}

interface InternalApiFetchOptions extends ApiFetchOptions {
  __authRetried?: boolean;
}

function resolveRequestCredentials(explicitCredentials?: RequestCredentials): RequestCredentials {
  if (explicitCredentials) return explicitCredentials;

  const location = getBrowserLocation();
  if (!location) {
    return API_URL.includes(PROD_TUNNEL_API_URL) ? 'include' : 'same-origin';
  }

  try {
    const apiOrigin = new URL(API_URL, location.href).origin;
    return apiOrigin === location.origin ? 'same-origin' : 'include';
  } catch {
    return API_URL.includes(PROD_TUNNEL_API_URL) ? 'include' : 'same-origin';
  }
}

async function rawApiFetch(path: string, init?: ApiFetchOptions): Promise<Response> {
  const headers = new Headers(init?.headers);
  const primaryUserId = getUserId();
  const sessionId = getSessionId();
  headers.set('X-Office-Claw-User', primaryUserId);
  if (sessionId && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionId}`);
  }
  if (sessionId && !headers.has('X-Office-Claw-Session')) {
    headers.set('X-Office-Claw-Session', sessionId);
  }
  if (!headers.has('X-Trace-Id')) {
    headers.set('X-Trace-Id', crypto.randomUUID());
  }

  const timeoutMs = init?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const suppressAuthRedirect = init?.suppressAuthRedirect === true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = init?.signal;
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
      credentials: resolveRequestCredentials(init?.credentials),
    });

    if (shouldFallbackToLegacyRead(path, init, primaryUserId)) {
      const legacyUserId = getLegacyReadUserId();
      if (legacyUserId) {
        const shouldRetry = await shouldRetryWithLegacy(path, response);
        if (shouldRetry) {
          const legacyHeaders = new Headers(init?.headers);
          legacyHeaders.set('X-Office-Claw-User', legacyUserId);
          if (!legacyHeaders.has('X-Trace-Id')) {
            legacyHeaders.set('X-Trace-Id', crypto.randomUUID());
          }
          return await fetch(`${API_URL}${path}`, {
            ...init,
            headers: legacyHeaders,
            signal: controller.signal,
            credentials: resolveRequestCredentials(init?.credentials),
          });
        }
      }
    }

    if (response.status === 401 && !suppressAuthRedirect && !isAuthExemptPath(path)) {
      redirectToLogin();
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

async function tryRefreshToken(timeoutMs: number): Promise<boolean> {
  try {
    const response = await rawApiFetch('/api/login/refresh', {
      method: 'POST',
      timeoutMs,
      suppressAuthRedirect: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiFetch(path: string, init?: ApiFetchOptions): Promise<Response> {
  const options = init as InternalApiFetchOptions | undefined;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
  const response = await rawApiFetch(path, {
    ...init,
    suppressAuthRedirect: true,
  });

  if (
    response.status !== 401 ||
    options?.__authRetried ||
    isAuthControlPath(path) ||
    typeof window === 'undefined'
  ) {
    return response;
  }

  const refreshed = await tryRefreshToken(timeoutMs);
  if (!refreshed) {
    if (!options?.suppressAuthRedirect) {
      redirectToLogin();
    }
    return response;
  }

  return rawApiFetch(path, {
    ...init,
    timeoutMs,
    __authRetried: true,
  } as InternalApiFetchOptions);
}

const AUTH_EXEMPT_EXACT_PATHS = new Set(['/api/logout']);
const AUTH_EXEMPT_PREFIXES = ['/api/islogin', '/api/login/'];

function isAuthExemptPath(path: string): boolean {
  const pathname = path.split('?')[0] || path;
  return AUTH_EXEMPT_EXACT_PATHS.has(pathname) || AUTH_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthControlPath(path: string): boolean {
  const pathname = path.split('?')[0] || path;
  return pathname === '/api/islogin' || pathname === '/api/logout' || pathname.startsWith('/api/login/');
}

function shouldFallbackToLegacyRead(path: string, init: ApiFetchOptions | undefined, primaryUserId: string): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return false;
  const legacyUserId = getLegacyReadUserId();
  if (!legacyUserId || legacyUserId === primaryUserId) return false;
  const pathname = path.split('?')[0] || path;
  return pathname === '/api/threads' || pathname === '/api/messages';
}

async function shouldRetryWithLegacy(path: string, response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const data = (await response.clone().json()) as Record<string, unknown>;
    const pathname = path.split('?')[0] || path;
    if (pathname === '/api/threads') {
      const threads = data.threads;
      return Array.isArray(threads) && threads.length === 0;
    }
    if (pathname === '/api/messages') {
      const messages = data.messages;
      return Array.isArray(messages) && messages.length === 0;
    }
  } catch {
    return false;
  }
  return false;
}

let redirectScheduled = false;
function redirectToLogin(): void {
  if (redirectScheduled || typeof window === 'undefined') return;
  redirectScheduled = true;
  window.location.replace('/login');
}
