/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Unified frontend identity store.
 *
 * `userId` is the display identifier sent via X-Office-Claw-User.
 * Authentication itself is carried by the signed `oc_sid` cookie.
 */

const STORAGE_KEY = 'office-claw-userId';
const LEGACY_READ_USER_ID_KEY = 'office-claw-legacy-read-userId';
const SESSION_ID_KEY = 'office-claw-sessionId';
const SKIP_AUTH_KEY = 'office-claw-isskip';
const CAN_CREATE_MODEL_KEY = 'can-create-model';
const USER_NAME_KEY = 'office-claw-userName';
const DEFAULT_USER = 'default-user';

const LEGACY_STORAGE_KEY = 'cat-cafe-userId';
const LEGACY_USER_NAME_KEY = 'cat-cafe-userName';
const LEGACY_SKIP_AUTH_KEY = 'cat-cafe-isskip';

function readWithLegacyFallback(currentKey: string, legacyKey: string): string | null {
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  localStorage.setItem(currentKey, legacy);
  localStorage.removeItem(legacyKey);
  return legacy;
}

export function getUserId(): string {
  if (typeof window === 'undefined') return DEFAULT_USER;

  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('userId');
  if (fromUrl) {
    localStorage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }

  return readWithLegacyFallback(STORAGE_KEY, LEGACY_STORAGE_KEY) ?? DEFAULT_USER;
}

export function setUserId(id: string): void {
  if (typeof window !== 'undefined') {
    const prev = localStorage.getItem(STORAGE_KEY);
    const next = id.trim();
    if (prev && next && prev !== next) {
      const prevDomain = prev.split(':')[0] ?? '';
      const nextDomain = next.split(':')[0] ?? '';
      if (prevDomain && nextDomain && prevDomain === nextDomain) {
        localStorage.setItem(LEGACY_READ_USER_ID_KEY, prev);
      }
    }
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function getLegacyReadUserId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(LEGACY_READ_USER_ID_KEY)?.trim() ?? '';
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(SESSION_ID_KEY)?.trim() ?? '';
}

export function setSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  const normalized = sessionId.trim();
  if (normalized) {
    localStorage.setItem(SESSION_ID_KEY, normalized);
  } else {
    localStorage.removeItem(SESSION_ID_KEY);
  }
}

export function clearUserId(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function getUserName(): string {
  if (typeof window === 'undefined') return '';
  const stored = readWithLegacyFallback(USER_NAME_KEY, LEGACY_USER_NAME_KEY);
  if (stored) return stored;

  const userId = readWithLegacyFallback(STORAGE_KEY, LEGACY_STORAGE_KEY) ?? '';
  const parts = userId.split(':');
  return parts.length > 1 ? parts[1] || parts[0] : userId;
}

export function getDomainId(): string {
  const userId = getUserId();
  const separatorIndex = userId.indexOf(':');
  return separatorIndex > 0 ? userId.slice(0, separatorIndex) : '';
}

export function setUserName(name: string): void {
  if (typeof window !== 'undefined') {
    if (name.trim()) {
      localStorage.setItem(USER_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(USER_NAME_KEY);
    }
  }
}

export function setAuthIdentity({ userId, userName }: { userId: string; userName?: string }): void {
  setUserId(userId);
  if (typeof userName === 'string') {
    setUserName(userName);
  }
}

export function clearAuthIdentity(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_READ_USER_ID_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(USER_NAME_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_USER_NAME_KEY);
  }
}

export function getIsSkipAuth(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = readWithLegacyFallback(SKIP_AUTH_KEY, LEGACY_SKIP_AUTH_KEY);
  return raw === '1' || raw === 'true';
}

export function setIsSkipAuth(value: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(SKIP_AUTH_KEY, value ? '1' : '0');
  }
}

export function getCanCreateModel(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(CAN_CREATE_MODEL_KEY);
  return raw === '1' || raw === 'true';
}

export function setCanCreateModel(value: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(CAN_CREATE_MODEL_KEY, value ? '1' : '0');
  }
}
