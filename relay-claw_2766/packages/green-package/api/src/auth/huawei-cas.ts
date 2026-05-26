import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AuthenticateOutcome, AuthProvider, AuthSessionInfo, ExternalPrincipal } from '@openjiuwen/relay-api-server-contracts/auth';
import { resolveHuaweiMaaSRuntimeConfig } from '../integrations/huawei-maas.js';
import { HttpRequest, Signer } from '../utils/signer.js';

const SERVER_STARTUP_TOKEN = randomBytes(16).toString('hex');
const CAS_AUTH_UI_LOGIN_URL = 'https://auth.huaweicloud.com/authui/login.html';
const CAS_AUTH_UI_LOGOUT_URL = 'https://auth.huaweicloud.com/authui/logout';
const DEFAULT_CAS_BASE_URL = CAS_AUTH_UI_LOGIN_URL;
const DEFAULT_CAS_SERVICE_CALLBACK_URL = 'https://versatile.cn-north-4.myhuaweicloud.com/v1/claw/cas/login/callback';
const DEFAULT_CAS_BACKGROUND_IMAGE_URL = 'https://res.hc-cdn.com/AgentArts-Console/26.3.2/hws/assets/login/bg2.png';
const DEFAULT_CAS_PORTAL_IMAGE_URL = 'https://res.hc-cdn.com/AgentArts-Console/26.3.2/hws/assets/login/ad2.png';
const DEFAULT_TICKET_VALIDATE_URL = 'https://versatile.cn-north-4.myhuaweicloud.com/v1/claw/cas/login/ticket-validate';
const DEFAULT_SUBSCRIPTION_URL = 'https://versatile.cn-north-4.myhuaweicloud.com/v1/claw/client-subscription';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const INVITATION_HTML_ERROR_CODE = 'common.01010004';
const INVITATION_HTML_ERROR_MESSAGE =
  '请确认账号状态，是否已<a href="https://support.huaweicloud.com/usermanual-account/account_auth_00001.html" target="_blank" rel="noreferrer">实名认证</a>或<a href="https://support.huaweicloud.com/billing_faq/billing_faq_1000000.html" target="_blank" rel="noreferrer">非欠费</a>状态。';
const PROMOTION_CODE_ERROR_CODES = new Set(['AgentArts.11000008', 'AgentArts.11000009', INVITATION_HTML_ERROR_CODE]);
const PROMOTION_CODE_ERROR_MESSAGES: Record<string, string> = {
  'AgentArts.11000008': '邀请码无效，请重新输入',
  'AgentArts.11000009': '邀请码不存在或者今日邀请码配额已用完',
  [INVITATION_HTML_ERROR_CODE]: INVITATION_HTML_ERROR_MESSAGE,
};

interface HuaweiCasProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  casBaseUrl?: string;
  serviceCallbackUrl?: string;
  backgroundImageUrl?: string;
  portalImageUrl?: string;
  ticketValidateUrl?: string;
  subscriptionUrl?: string;
  sessionTtlMs?: number;
  pendingTtlMs?: number;
  canCreateModel?: boolean;
}

interface CasUserProfile {
  user_id: string;
  user_name?: string;
  domain_id?: string;
  domain_name?: string;
  access?: string;
  secret?: string;
  sts_token?: string;
  model_info?: Record<string, unknown>;
  trace_info?: TraceInfo;
  expiresAt: number;
  serverStartId: string;
  [key: string]: unknown;
}

interface TraceInfo {
  appTraceToken: string;
  apmApiUrlBase: string;
}

interface HuaweiCasProviderState extends Omit<CasUserProfile, 'model_info' | 'trace_info'> {
  modelInfo: Record<string, unknown>;
  traceInfo?: TraceInfo;
}

interface PendingCasProfile {
  profile: CasUserProfile;
  expiresAt: number;
  attempts: number;
}

interface EncryptedPayload {
  version: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

interface SubscriptionResult {
  modelInfo?: Record<string, unknown>;
  traceInfo?: TraceInfo;
  errorCode?: string;
  errorMessage?: string;
}

function getSecureConfigDir(env: NodeJS.ProcessEnv): string {
  return readEnv(env, 'OFFICE_CLAW_SECURE_CONFIG_DIR') ?? join(env.HOME ?? process.cwd(), '.config', 'secure-config-nodejs');
}

function getSecureConfigPath(env: NodeJS.ProcessEnv, userId: string): string {
  return join(getSecureConfigDir(env), `${encodeURIComponent(userId)}.json`);
}

function hashPendingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = readEnv(env, 'OFFICE_CLAW_SECURE_CONFIG_ENCRYPTION_KEY') ?? readEnv(env, 'OFFICE_CLAW_SESSION_SECRET') ?? readInstallSecret(env);
  return createHash('sha256').update(configured).digest();
}

function isNoEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

function readInstallSecret(env: NodeJS.ProcessEnv): string {
  const filePath = join(getSecureConfigDir(env), '.cas-profile-encryption-key');
  try {
    const existing = readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
    throw new Error(`Failed to read CAS profile encryption key file: ${filePath}; file is empty`);
  } catch (error) {
    if (!isNoEntryError(error)) {
      throw error;
    }
  }

  const secret = randomBytes(32).toString('base64url');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function encryptJson(env: NodeJS.ProcessEnv, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const payload: EncryptedPayload = {
    version: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };
  return JSON.stringify(payload);
}

function decryptJson<T>(env: NodeJS.ProcessEnv, raw: string): T {
  const payload = JSON.parse(raw) as EncryptedPayload;
  if (payload.version !== 1 || payload.alg !== 'aes-256-gcm') throw new Error('Unsupported encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(env), Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64url')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

function getPendingConfigPath(env: NodeJS.ProcessEnv, pendingTokenHash: string): string {
  return join(getSecureConfigDir(env), `pending-${pendingTokenHash}.json`);
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.data)) return value.data;
  if (isRecord(value.result)) return value.result;
  return value;
}

function extractModelInfo(payload: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  if (isRecord(payload.model_info)) return payload.model_info;

  const subscriptionPayload = unwrapPayload(payload.subscription);
  if (isRecord(subscriptionPayload?.model_info)) return subscriptionPayload.model_info;

  return undefined;
}

function readString(record: Record<string, unknown> | null | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractTraceInfo(payload: Record<string, unknown> | null): TraceInfo | undefined {
  if (!payload) return undefined;
  const tracePayload =
    isRecord(payload.trace_info) ? payload.trace_info : isRecord(payload.traceInfo) ? payload.traceInfo : undefined;
  const subscriptionPayload = unwrapPayload(payload.subscription);
  const subscriptionTracePayload =
    isRecord(subscriptionPayload?.trace_info)
      ? subscriptionPayload.trace_info
      : isRecord(subscriptionPayload?.traceInfo)
        ? subscriptionPayload.traceInfo
        : undefined;
  const source = tracePayload ?? subscriptionTracePayload;
  if (!isRecord(source)) return undefined;

  const appTraceToken = readString(source, 'appTraceToken', 'apm_trace_token');
  const apmApiUrlBase = readString(source, 'apmApiUrlBase', 'apm_api_url_base');
  if (!appTraceToken || !apmApiUrlBase) return undefined;
  return { appTraceToken, apmApiUrlBase };
}

function hasActiveSubscription(payload: Record<string, unknown> | null): boolean {
  if (!payload) return false;
  return payload.subscription !== null && payload.subscription !== undefined;
}

function resolveCasServiceCallbackUrl(options: HuaweiCasProviderOptions): string {
  const env = options.env ?? process.env;
  return (
    options.serviceCallbackUrl ??
    readEnv(env, 'OFFICE_CLAW_CAS_SERVICE_CALLBACK_URL') ??
    readEnv(env, 'CAS_CALLBACK_SERVICE_URL') ??
    DEFAULT_CAS_SERVICE_CALLBACK_URL
  );
}

function resolveCasVisualAssets(options: HuaweiCasProviderOptions): { backgroundImageUrl: string; portalImageUrl: string } {
  const env = options.env ?? process.env;
  const backgroundImageUrl =
    options.backgroundImageUrl ??
    readEnv(env, 'OFFICE_CLAW_CAS_BACKGROUND_IMAGE_URL') ??
    readEnv(env, 'CAS_BACKGROUND_IMAGE_URL') ??
    DEFAULT_CAS_BACKGROUND_IMAGE_URL;
  const portalImageUrl =
    options.portalImageUrl ??
    readEnv(env, 'OFFICE_CLAW_CAS_PORTAL_IMAGE_URL') ??
    readEnv(env, 'CAS_PORTAL_IMAGE_URL') ??
    DEFAULT_CAS_PORTAL_IMAGE_URL;
  return { backgroundImageUrl, portalImageUrl };
}

function buildCasLoginUrl(options: HuaweiCasProviderOptions): string {
  const env = options.env ?? process.env;
  const configuredLoginUrl = readEnv(env, 'OFFICE_CLAW_CAS_LOGIN_URL') ?? readEnv(env, 'CAS_LOGIN_URL');
  if (configuredLoginUrl) return configuredLoginUrl;

  const casBaseUrl = options.casBaseUrl ?? readEnv(env, 'OFFICE_CLAW_CAS_BASE_URL') ?? DEFAULT_CAS_BASE_URL;
  const serviceCallbackUrl = resolveCasServiceCallbackUrl(options);
  const { backgroundImageUrl, portalImageUrl } = resolveCasVisualAssets(options);
  const url = new URL(casBaseUrl);

  if (!url.searchParams.has('locale')) url.searchParams.set('locale', 'zh-cn');
  if (!url.searchParams.has('hide_banner')) url.searchParams.set('hide_banner', 'true');
  if (!url.searchParams.has('hide_foot')) url.searchParams.set('hide_foot', 'true');
  url.searchParams.set('background_img_url', backgroundImageUrl);
  url.searchParams.set('portal_img_url', portalImageUrl);
  url.searchParams.set('service', serviceCallbackUrl);
  if (!url.hash) url.hash = '/login';
  return url.toString();
}

function buildCasLogoutUrl(options: HuaweiCasProviderOptions): string {
  const env = options.env ?? process.env;
  const configuredLogoutUrl = readEnv(env, 'OFFICE_CLAW_CAS_LOGOUT_URL') ?? readEnv(env, 'CAS_LOGOUT_URL');
  if (configuredLogoutUrl) return configuredLogoutUrl;

  const serviceCallbackUrl = resolveCasServiceCallbackUrl(options);
  const { backgroundImageUrl, portalImageUrl } = resolveCasVisualAssets(options);

  const loginService =
    `${CAS_AUTH_UI_LOGIN_URL}?locale=zh-cn&hide_banner=true&hide_foot=true` +
    `&background_img_url=${backgroundImageUrl}&portal_img_url=${portalImageUrl}&service=${serviceCallbackUrl}#/login`;

  return `${CAS_AUTH_UI_LOGOUT_URL}?service=${encodeURIComponent(loginService)}`;
}

function normalizeProfile(raw: unknown, expiresAt: number): CasUserProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const userId = typeof record.user_id === 'string' ? record.user_id : typeof record.userId === 'string' ? record.userId : '';
  if (!userId.trim()) return null;
  const userName = typeof record.user_name === 'string' ? record.user_name : typeof record.userName === 'string' ? record.userName : userId;
  return {
    ...record,
    user_id: userId,
    user_name: userName,
    expiresAt,
    serverStartId: SERVER_STARTUP_TOKEN,
  };
}

function getStableUserId(profile: CasUserProfile): string {
  const domain = profile.domain_id || profile.domain_name;
  const user = profile.user_id || profile.user_name;
  return domain ? `${domain}:${user}` : profile.user_id;
}

async function readStoredProfile(env: NodeJS.ProcessEnv, userId: string): Promise<CasUserProfile | null> {
  try {
    const raw = await readFile(getSecureConfigPath(env, userId), 'utf8');
    return decryptJson<CasUserProfile>(env, raw);
  } catch {
    return null;
  }
}

async function readPendingProfile(env: NodeJS.ProcessEnv, pendingToken: string): Promise<PendingCasProfile | null> {
  try {
    const raw = await readFile(getPendingConfigPath(env, hashPendingToken(pendingToken)), 'utf8');
    return decryptJson<PendingCasProfile>(env, raw);
  } catch {
    return null;
  }
}

async function writeStoredProfile(env: NodeJS.ProcessEnv, profile: CasUserProfile): Promise<void> {
  const filePath = getSecureConfigPath(env, getStableUserId(profile));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encryptJson(env, profile), { encoding: 'utf8', mode: 0o600 });
}

async function writePendingProfile(env: NodeJS.ProcessEnv, pendingToken: string, profile: CasUserProfile, pendingTtlMs: number): Promise<void> {
  const filePath = getPendingConfigPath(env, hashPendingToken(pendingToken));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encryptJson(env, { profile, expiresAt: Date.now() + pendingTtlMs, attempts: 0 }), { encoding: 'utf8', mode: 0o600 });
}

async function deleteStoredProfile(env: NodeJS.ProcessEnv, userId: string): Promise<void> {
  await rm(getSecureConfigPath(env, userId), { force: true });
}

async function deletePendingProfile(env: NodeJS.ProcessEnv, pendingToken: string): Promise<void> {
  await rm(getPendingConfigPath(env, hashPendingToken(pendingToken)), { force: true });
}

function createPendingFailure(message: string, userId: string, pendingToken: string, errorCode?: string): AuthenticateOutcome & { userId: string; pendingToken: string; errorCode?: string } {
  return { success: false, needCode: true, message, userId, pendingToken, ...(errorCode ? { errorCode } : {}) } as AuthenticateOutcome & { userId: string; pendingToken: string; errorCode?: string };
}

function getSubscriptionErrorCode(value: unknown): string {
  const payload = unwrapPayload(value);
  const raw = payload?.error_code ?? payload?.errorCode ?? payload?.code;
  return typeof raw === 'string' ? raw : '';
}

function getPromotionCodeErrorMessage(errorCode: string): string | undefined {
  return PROMOTION_CODE_ERROR_MESSAGES[errorCode];
}

async function validateCasTicket(
  fetchImpl: typeof fetch,
  ticketValidateUrl: string,
  ticket: string,
  serviceCallbackUrl: string | undefined,
  expiresAt: number,
): Promise<CasUserProfile | null> {
  const url = new URL(ticketValidateUrl);
  url.searchParams.set('ticket', ticket);
  if (serviceCallbackUrl) url.searchParams.set('service', serviceCallbackUrl);
  const response = await fetchImpl(url.toString(), { method: 'GET' });

  if (!response.ok) return null;
  const data = (await response.json()) as unknown;
  const payload = unwrapPayload(data);
  const profilePayload = payload && 'user' in payload ? payload.user : payload;
  const profile = normalizeProfile(profilePayload, expiresAt);
  if (!profile) return null;

  const profileRecord = unwrapPayload(profilePayload);
  const modelInfo = extractModelInfo(payload) ?? extractModelInfo(profileRecord);
  const traceInfo = extractTraceInfo(payload) ?? extractTraceInfo(profileRecord);
  if (modelInfo || hasActiveSubscription(payload) || hasActiveSubscription(profileRecord)) {
    profile.model_info = modelInfo ?? {};
  }
  if (traceInfo) {
    profile.trace_info = traceInfo;
  }
  return profile;
}

function toPrincipal(profile: CasUserProfile): ExternalPrincipal {
  const { model_info: modelInfo = {}, trace_info: traceInfo, ...providerStateRest } = profile;
  const providerState: HuaweiCasProviderState = {
    ...providerStateRest,
    modelInfo,
    ...(traceInfo ? { traceInfo } : {}),
  };
  return {
    userId: getStableUserId(profile),
    displayName: profile.user_name,
    expiresAt: new Date(profile.expiresAt),
    providerState,
  };
}

function hasModelInfo(profile: CasUserProfile): boolean {
  return Boolean(profile.model_info && typeof profile.model_info === 'object');
}

async function subscribeWithPromotionCode(
  fetchImpl: typeof fetch,
  subscriptionUrl: string,
  profile: CasUserProfile,
  promotionCode: string,
): Promise<SubscriptionResult | null> {
  if (!profile.access || !profile.secret) return null;

  const body = JSON.stringify({ promotion_code: promotionCode });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=utf8',
    ...(profile.sts_token ? { 'X-Security-Token': profile.sts_token } : {}),
  };
  const signer = new Signer();
  signer.Key = profile.access;
  signer.Secret = profile.secret;
  const signed = signer.Sign(new HttpRequest('POST', subscriptionUrl, headers, body));
  const response = await fetchImpl(subscriptionUrl, {
    method: 'POST',
    headers: signed.headers,
    body,
  });
  if (!response.ok) {
    try {
      const errorBody = await response.json();
      const errorCode = getSubscriptionErrorCode(errorBody);
      const errorMessage = getPromotionCodeErrorMessage(errorCode);
      console.warn('[Huawei CAS] subscribeWithPromotionCode failed', {
        subscriptionUrl,
        status: response.status,
        errorCode,
        errorMessage,
        errorBody,
      });
      return { errorCode, errorMessage };
    } catch (err) {
      console.warn('[Huawei CAS] subscribeWithPromotionCode failed to parse error response', err);
      return { errorCode: '' };
    }
  }
  const data = (await response.json()) as Record<string, unknown>;
  const subscription = data.subscription && typeof data.subscription === 'object' ? (data.subscription as Record<string, unknown>) : null;
  const modelInfo = data.model_info ?? subscription?.model_info;
  const traceInfo = extractTraceInfo(data) ?? extractTraceInfo(subscription);
  console.debug('[Huawei CAS] subscribeWithPromotionCode response', {
    subscriptionUrl,
    subscription,
    modelInfoPresent: Boolean(modelInfo && typeof modelInfo === 'object'),
    traceInfoPresent: Boolean(traceInfo),
  });
  if (!modelInfo || typeof modelInfo !== 'object') return traceInfo ? { traceInfo } : null;
  return { modelInfo: modelInfo as Record<string, unknown>, ...(traceInfo ? { traceInfo } : {}) };
}

export function createHuaweiCasAuthProvider(options: HuaweiCasProviderOptions = {}): AuthProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const ticketValidateUrl = options.ticketValidateUrl ?? readEnv(env, 'OFFICE_CLAW_CAS_TICKET_VALIDATE_URL') ?? DEFAULT_TICKET_VALIDATE_URL;
  const subscriptionUrl = options.subscriptionUrl ?? readEnv(env, 'OFFICE_CLAW_CAS_SUBSCRIPTION_URL') ?? DEFAULT_SUBSCRIPTION_URL;
  const serviceCallbackUrl = options.serviceCallbackUrl ?? readEnv(env, 'OFFICE_CLAW_CAS_SERVICE_CALLBACK_URL');
  const configuredSessionTtlMs = Number(readEnv(env, 'OFFICE_CLAW_CAS_SESSION_TTL_MS'));
  const sessionTtlMs = options.sessionTtlMs ?? (Number.isFinite(configuredSessionTtlMs) && configuredSessionTtlMs > 0 ? configuredSessionTtlMs : DEFAULT_SESSION_TTL_MS);
  const configuredPendingTtlMs = Number(readEnv(env, 'OFFICE_CLAW_CAS_PENDING_TTL_MS'));
  const pendingTtlMs = options.pendingTtlMs ?? (Number.isFinite(configuredPendingTtlMs) && configuredPendingTtlMs > 0 ? configuredPendingTtlMs : DEFAULT_PENDING_TTL_MS);
  const canCreateModel = options.canCreateModel ?? readEnv(env, 'CAN_CREATE_MODEL') === '1';
  const loginUrl = buildCasLoginUrl(options);
  const logoutUrl = buildCasLogoutUrl(options);

  return {
    id: 'huawei-cas',
    displayName: 'Huawei Cloud (CAS)',
    presentation: {
      mode: 'redirect',
      redirectUrl: loginUrl,
      fields: [],
      description: 'Sign in with your Huawei Cloud account',
    },

    async authenticate(): Promise<AuthenticateOutcome> {
      return { success: false, message: 'Use callback flow for CAS provider' };
    },

    async handleCallback(params): Promise<AuthenticateOutcome> {
      const ticket = params.ticket?.trim();
      const promotionCode = params.promotionCode?.trim();
      const pendingToken = params.pendingToken?.trim();
      if (!ticket && promotionCode && pendingToken) {
        const pending = await readPendingProfile(env, pendingToken);
        if (!pending || pending.expiresAt < Date.now()) {
          await deletePendingProfile(env, pendingToken);
          return { success: false, needCode: true, message: '登录状态已失效，请重新登录' };
        }
        const userId = getStableUserId(pending.profile);
        const subscription = await subscribeWithPromotionCode(fetchImpl, subscriptionUrl, pending.profile, promotionCode);
        if (!subscription?.modelInfo) {
          pending.attempts += 1;
          if (pending.attempts >= 5) {
            await deletePendingProfile(env, pendingToken);
            return { success: false, needCode: true, message: '邀请码错误次数过多，请重新登录' };
          }
          await writeFile(getPendingConfigPath(env, hashPendingToken(pendingToken)), encryptJson(env, pending), { encoding: 'utf8', mode: 0o600 });
          if (subscription?.errorCode === INVITATION_HTML_ERROR_CODE) {
            // Trusted static backend text for common.01010004 only; no external input is interpolated.
            return createPendingFailure(INVITATION_HTML_ERROR_MESSAGE, userId, pendingToken, INVITATION_HTML_ERROR_CODE);
          }
          return createPendingFailure(subscription?.errorMessage ?? '邀请码无效，请重新输入', userId, pendingToken, subscription?.errorCode);
        }
        pending.profile.model_info = subscription.modelInfo;
        if (subscription.traceInfo) {
          pending.profile.trace_info = subscription.traceInfo;
        }
        await writeStoredProfile(env, pending.profile);
        await deletePendingProfile(env, pendingToken);
        return { success: true, principal: toPrincipal(pending.profile) };
      }
      if (!ticket) return { success: false, message: 'Missing CAS ticket' };

      const profile = await validateCasTicket(fetchImpl, ticketValidateUrl, ticket, serviceCallbackUrl, Date.now() + sessionTtlMs);
      if (!profile) return { success: false, message: 'Invalid CAS ticket' };

      const userId = getStableUserId(profile);
      const nextPendingToken = randomBytes(32).toString('base64url');
      if (!hasModelInfo(profile) && promotionCode) {
        const subscription = await subscribeWithPromotionCode(fetchImpl, subscriptionUrl, profile, promotionCode);
        if (!subscription?.modelInfo) {
          await writePendingProfile(env, nextPendingToken, profile, pendingTtlMs);
          if (subscription?.errorCode === INVITATION_HTML_ERROR_CODE) {
            // Trusted static backend text for common.01010004 only; no external input is interpolated.
            return createPendingFailure(INVITATION_HTML_ERROR_MESSAGE, userId, nextPendingToken, INVITATION_HTML_ERROR_CODE);
          }
          return createPendingFailure(subscription?.errorMessage ?? '邀请码无效，请重新输入', userId, nextPendingToken, subscription?.errorCode);
        }
        profile.model_info = subscription.modelInfo;
        if (subscription.traceInfo) {
          profile.trace_info = subscription.traceInfo;
        }
      }

      if (!hasModelInfo(profile)) {
        await writePendingProfile(env, nextPendingToken, profile, pendingTtlMs);
        return createPendingFailure('请输入邀请码后再登录', userId, nextPendingToken);
      }

      await writeStoredProfile(env, profile);
      return { success: true, principal: toPrincipal(profile) };
    },

    async restoreSession(userId): Promise<ExternalPrincipal | null> {
      const stored = await readStoredProfile(env, userId);
      if (!stored) return null;
      if (stored.serverStartId !== SERVER_STARTUP_TOKEN || stored.expiresAt < Date.now()) {
        await deleteStoredProfile(env, userId);
        return null;
      }
      return toPrincipal(stored);
    },

    async logout(session): Promise<void> {
      await deleteStoredProfile(env, session.userId);
    },

    async getPublicConfig(): Promise<Record<string, unknown>> {
      return { hascode: true, canCreateModel, loginUrl, logoutUrl };
    },

    resolveProtocolCredential(protocol: string, session: AuthSessionInfo) {
      if (protocol !== 'huawei_maas') return null;
      try {
        return resolveHuaweiMaaSRuntimeConfig(session.userId, () => ({
          providerState: session.providerState,
        }));
      } catch {
        return null;
      }
    },
  };
}
