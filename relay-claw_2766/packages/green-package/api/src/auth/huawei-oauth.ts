import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AuthenticateOutcome, AuthProvider, AuthSessionInfo, ExternalPrincipal } from '@openjiuwen/relay-api-server-contracts/auth';
import { resolveHuaweiMaaSRuntimeConfig } from '../integrations/huawei-maas.js';
import { getAuthFlowTlsFetchOptions, isAuthFlowTlsRejectUnauthorized } from '../utils/auth-flow-tls.js';
import { HttpRequest, Signer } from '../utils/signer.js';
import {
  generateDpopJwt,
  generateDpopKeyPair,
  generatePkce,
  generateState,
  importDpopPrivateKey,
  type DpopJwk,
} from './oauth-crypto.js';

const DEFAULT_IAM_BASE = 'https://sts.cn-north-4.myhuaweicloud.com';
const DEFAULT_AUTH_BASE = 'https://auth.huaweicloud.com';
const DEFAULT_HUAWEI_CLAW_BASE = 'https://versatile.cn-north-4.myhuaweicloud.com';
const DEFAULT_CLIENT_ID = 'pdp5_for_agentarts';
const DEFAULT_REDIRECT_URI = 'officeclaw://oauth/callback';
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_ATTEMPTS = 5;
const INVITATION_HTML_ERROR_CODE = 'common.01010004';
const INVITATION_HTML_ERROR_MESSAGE =
  '请确认账号状态，是否已<a href="https://support.huaweicloud.com/usermanual-account/account_auth_00001.html" target="_blank" rel="noreferrer">实名认证</a>或<a href="https://support.huaweicloud.com/billing_faq/billing_faq_1000000.html" target="_blank" rel="noreferrer">非欠费</a>状态。';
const PROMOTION_CODE_ERROR_CODES = new Set(['AgentArts.00000104', 'AgentArts.11000008', 'AgentArts.11000009', INVITATION_HTML_ERROR_CODE]);
const PROMOTION_CODE_ERROR_MESSAGES: Record<string, string> = {
  'AgentArts.00000104': '您的权限不足，请配置对应的权限',
  'AgentArts.11000008': '邀请码无效，请重新输入',
  'AgentArts.11000009': '邀请码不存在或者今日邀请码配额已用完',
  [INVITATION_HTML_ERROR_CODE]: INVITATION_HTML_ERROR_MESSAGE,
};

interface HuaweiOauthProviderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  stateTtlMs?: number;
  pendingTtlMs?: number;
}

interface IamCredential {
  access: string;
  expires_at: string;
  secret: string;
  securityToken: string;
  project_id: string;
}

interface IamCredentialsV2 {
  access_key_id: string;
  expiration: string;
  secret_access_key: string;
  security_token: string;
  project_id?: string;
}

interface IamTokenResponse {
  credentials: IamCredentialsV2;
  credential?: IamCredential;
  refresh_token?: string;
  id_token?: string;
}

interface OAuthCredential {
  access: string;
  secret: string;
  sts_token: string;
  project_id: string;
  expires_at: string;
  refresh_token?: string;
}

interface HuaweiOauthProviderState {
  authType: 'huawei-oauth';
  accountId: string;
  principalUrn?: string;
  userName?: string;
  credential: OAuthCredential;
  modelInfo?: Record<string, unknown>;
  dpop?: {
    privateJwk: DpopJwk;
    publicJwk: DpopJwk;
  };
}

interface PendingAuthState {
  codeVerifier: string;
  dpopPrivateJwk: DpopJwk;
  dpopPublicJwk: DpopJwk;
  expiresAt: number;
}

interface ConsumedAuthState {
  result: AuthenticateOutcome;
  expiresAt: number;
}

interface PendingOauthProfile {
  providerState: HuaweiOauthProviderState;
  expiresAt: number;
  attempts: number;
}

interface PermissionIdentity {
  accountId: string;
  principalUrn: string;
  userName: string;
}

interface PermissionCheckResult {
  identity: PermissionIdentity | null;
  modelInfo?: Record<string, unknown>;
  errorMessage?: string;
}

interface SubscriptionResult {
  success: boolean;
  modelInfo?: Record<string, unknown>;
  message?: string;
  needCode?: boolean;
  errorCode?: string;
}

interface EncryptedPayload {
  version: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

type AuthProviderWithAuthorize = AuthProvider & {
  createAuthorizationRequest?: () => Promise<{ authorizeUrl: string; state: string }>;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function isEnvFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function readPositiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = Number(readEnv(env, key));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getSecureConfigDir(env: NodeJS.ProcessEnv): string {
  return readEnv(env, 'OFFICE_CLAW_SECURE_CONFIG_DIR') ?? join(env.HOME ?? process.cwd(), '.config', 'secure-config-nodejs');
}

function isNoEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

function readInstallSecret(env: NodeJS.ProcessEnv): string {
  const filePath = join(getSecureConfigDir(env), '.oauth-profile-encryption-key');
  try {
    const existing = readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
    throw new Error(`Failed to read OAuth profile encryption key file: ${filePath}; file is empty`);
  } catch (error) {
    if (!isNoEntryError(error)) throw error;
  }

  const secret = randomBytes(32).toString('base64url');
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function getEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = readEnv(env, 'OFFICE_CLAW_SECURE_CONFIG_ENCRYPTION_KEY') ?? readEnv(env, 'OFFICE_CLAW_SESSION_SECRET') ?? readInstallSecret(env);
  return createHash('sha256').update(configured).digest();
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

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getStoredProfilePath(env: NodeJS.ProcessEnv, userId: string): string {
  return join(getSecureConfigDir(env), `oauth-${encodeURIComponent(userId)}.json`);
}

function getPendingProfilePath(env: NodeJS.ProcessEnv, pendingToken: string): string {
  return join(getSecureConfigDir(env), `oauth-pending-${hashValue(pendingToken)}.json`);
}

async function writeStoredProfile(env: NodeJS.ProcessEnv, userId: string, providerState: HuaweiOauthProviderState): Promise<void> {
  const filePath = getStoredProfilePath(env, userId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encryptJson(env, providerState), { encoding: 'utf8', mode: 0o600 });
}

async function readStoredProfile(env: NodeJS.ProcessEnv, userId: string): Promise<HuaweiOauthProviderState | null> {
  try {
    return decryptJson<HuaweiOauthProviderState>(env, await readFile(getStoredProfilePath(env, userId), 'utf8'));
  } catch (error) {
    if (isNoEntryError(error)) return null;
    throw error;
  }
}

async function deleteStoredProfile(env: NodeJS.ProcessEnv, userId: string): Promise<void> {
  await rm(getStoredProfilePath(env, userId), { force: true });
}

async function writePendingProfile(
  env: NodeJS.ProcessEnv,
  pendingToken: string,
  providerState: HuaweiOauthProviderState,
  pendingTtlMs: number,
): Promise<void> {
  const filePath = getPendingProfilePath(env, pendingToken);
  const pending: PendingOauthProfile = {
    providerState,
    expiresAt: Date.now() + pendingTtlMs,
    attempts: 0,
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encryptJson(env, pending), { encoding: 'utf8', mode: 0o600 });
}

async function readPendingProfile(env: NodeJS.ProcessEnv, pendingToken: string): Promise<PendingOauthProfile | null> {
  try {
    return decryptJson<PendingOauthProfile>(env, await readFile(getPendingProfilePath(env, pendingToken), 'utf8'));
  } catch (error) {
    if (isNoEntryError(error)) return null;
    throw error;
  }
}

async function rewritePendingProfile(env: NodeJS.ProcessEnv, pendingToken: string, pending: PendingOauthProfile): Promise<void> {
  const filePath = getPendingProfilePath(env, pendingToken);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, encryptJson(env, pending), { encoding: 'utf8', mode: 0o600 });
}

async function deletePendingProfile(env: NodeJS.ProcessEnv, pendingToken: string): Promise<void> {
  await rm(getPendingProfilePath(env, pendingToken), { force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
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

function tryParseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function truncate(value: string, max = 400): string {
  return value.length <= max ? value : `${value.slice(0, max)}...<truncated>`;
}

function maskValue(value: string | undefined): string {
  if (!value) return '';
  return value.length <= 8 ? '***' : `...${value.slice(-8)}`;
}

function logStep(step: string, data: Record<string, unknown>): void {
  console.info(`【${step}】:${JSON.stringify(data, null, 2)}`);
}

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) details.stack = error.stack;

  const errorWithCause = error as Error & { code?: string; cause?: unknown };
  if (errorWithCause.code) details.code = errorWithCause.code;
  if (errorWithCause.cause instanceof Error) {
    const cause = errorWithCause.cause as Error & {
      code?: string;
      errno?: number;
      syscall?: string;
      hostname?: string;
      host?: string;
      port?: number;
      address?: string;
    };
    details.cause = {
      name: cause.name,
      message: cause.message,
      ...(cause.code ? { code: cause.code } : {}),
      ...(cause.errno ? { errno: cause.errno } : {}),
      ...(cause.syscall ? { syscall: cause.syscall } : {}),
      ...(cause.hostname ? { hostname: cause.hostname } : {}),
      ...(cause.host ? { host: cause.host } : {}),
      ...(cause.port ? { port: cause.port } : {}),
      ...(cause.address ? { address: cause.address } : {}),
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
  } else if (errorWithCause.cause) {
    details.cause = errorWithCause.cause;
  }
  return details;
}

async function readErrorMessage(response: Response): Promise<{ errorCode: string; errorMessage: string }> {
  const text = await response.text().catch(() => '');
  const data = tryParseBody(text);
  const record = isRecord(data) ? data : {};
  return {
    errorCode: readString(record, 'error_code') || String(response.status),
    errorMessage: readString(record, 'error_message') || readString(record, 'error_msg') || truncate(text) || response.statusText,
  };
}

function normalizeIamTokenResponse(raw: IamTokenResponse): IamTokenResponse {
  if (!isRecord(raw.credentials)) {
    throw new Error('IAM token response missing `credentials` payload');
  }

  const credential: IamCredential = {
    access: readString(raw.credentials, 'access_key_id'),
    expires_at: readString(raw.credentials, 'expiration'),
    secret: readString(raw.credentials, 'secret_access_key'),
    securityToken: readString(raw.credentials, 'security_token'),
    project_id: readString(raw.credentials, 'project_id'),
  };

  return { ...raw, credential };
}

function extractIdTokenClaims(idToken: string): { sub?: string; preferred_username?: string; name?: string } {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return {};
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
      preferred_username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return {};
  }
}

function parseUserNameFromPrincipalUrn(principalUrn: string): string {
  const urn = principalUrn.trim();
  const iamMatch = /^iam::[^:]+:user:(.+)$/i.exec(urn);
  if (iamMatch?.[1]) return iamMatch[1].trim();
  const assumedAgencyMatch = /^sts::[^:]+:assumed-agency:[^/]+\/(.+)$/i.exec(urn);
  if (assumedAgencyMatch?.[1]) return assumedAgencyMatch[1].trim();
  const externalUserMatch = /^sts::[^:]+:external-user:[^/]+\/(.+)$/i.exec(urn);
  if (externalUserMatch?.[1]) return externalUserMatch[1].trim();
  return '';
}

function extractPermissionIdentity(value: unknown): PermissionIdentity | null {
  const payload = unwrapPayload(value);
  if (!payload) return null;
  const accountId = readString(payload, 'account_id').trim();
  const principalUrn = readString(payload, 'principal_urn').trim();
  const userName = parseUserNameFromPrincipalUrn(principalUrn);
  if (!accountId || !principalUrn || !userName) return null;
  return { accountId, principalUrn, userName };
}

function resolveCredential(providerState: HuaweiOauthProviderState): {
  accessKey: string;
  secretKey: string;
  securityToken: string;
  projectId: string;
} {
  return {
    accessKey: providerState.credential.access || '',
    secretKey: providerState.credential.secret || '',
    securityToken: providerState.credential.sts_token || '',
    projectId: providerState.credential.project_id || '',
  };
}

function signHuaweiRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  bodyText: string,
  accessKey: string,
  secretKey: string,
) {
  const request = new HttpRequest(method, url, headers, bodyText);
  const sig = new Signer();
  sig.Key = accessKey;
  sig.Secret = secretKey;
  return sig.Sign(request);
}

function buildProviderStateFromToken(tokenResponse: IamTokenResponse, dpop?: { privateJwk: DpopJwk; publicJwk: DpopJwk }): HuaweiOauthProviderState {
  const normalized = normalizeIamTokenResponse(tokenResponse);
  const credential = normalized.credential;
  if (!credential) throw new Error('IAM token response missing normalized credential');

  const claims = tokenResponse.id_token ? extractIdTokenClaims(tokenResponse.id_token) : {};
  const fallbackUserId = claims.sub || `oauth-${randomBytes(8).toString('hex')}`;
  const userName = claims.preferred_username || claims.name;

  return {
    authType: 'huawei-oauth',
    accountId: fallbackUserId,
    ...(userName ? { userName } : {}),
    credential: {
      access: credential.access,
      secret: credential.secret,
      sts_token: credential.securityToken,
      project_id: credential.project_id || '',
      expires_at: credential.expires_at,
      ...(normalized.refresh_token ? { refresh_token: normalized.refresh_token } : {}),
    },
    ...(dpop ? { dpop } : {}),
  };
}

function applyPermissionIdentity(providerState: HuaweiOauthProviderState, identity: PermissionIdentity): HuaweiOauthProviderState {
  return {
    ...providerState,
    accountId: identity.accountId,
    principalUrn: identity.principalUrn,
    userName: identity.userName,
  };
}

function toPrincipal(providerState: HuaweiOauthProviderState): ExternalPrincipal {
  return {
    userId: providerState.accountId,
    displayName: providerState.userName,
    expiresAt: providerState.credential.expires_at ? new Date(providerState.credential.expires_at) : null,
    providerState,
  };
}

function isExpired(providerState: HuaweiOauthProviderState): boolean {
  const expiresAt = new Date(providerState.credential.expires_at).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function createPendingFailure(
  message: string,
  userId: string,
  pendingToken: string,
  errorCode?: string,
): AuthenticateOutcome & { userId: string; pendingToken: string; errorCode?: string } {
  return { success: false, needCode: true, message, userId, pendingToken, ...(errorCode ? { errorCode } : {}) } as AuthenticateOutcome & {
    userId: string;
    pendingToken: string;
    errorCode?: string;
  };
}

function isMockAuthorizationCode(code: string): boolean {
  return /^mock_code_[a-f0-9]{32}$/i.test(code.trim());
}

function generateMockIdToken(userId: string, userName: string): string {
  const header = { typ: 'JWT', alg: 'none' };
  const payload = {
    sub: userId,
    preferred_username: userName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7200,
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${headerB64}.${payloadB64}.`;
}

function generateMockTokenResponse(): IamTokenResponse {
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const userId = `mock-user-${randomBytes(4).toString('hex')}`;
  return {
    credentials: {
      access_key_id: `mock-ak-${randomBytes(8).toString('hex')}`,
      expiration: expires,
      secret_access_key: `mock-sk-${randomBytes(16).toString('hex')}`,
      security_token: `mock-st-${randomBytes(32).toString('hex')}`,
      project_id: 'mock-project-id',
    },
    refresh_token: `mock-rt-${randomBytes(32).toString('hex')}`,
    id_token: generateMockIdToken(userId, 'mock-dev-user'),
  };
}

export function createHuaweiOauthAuthProvider(options: HuaweiOauthProviderOptions = {}): AuthProviderWithAuthorize {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const authBase = stripTrailingSlash(readEnv(env, 'OAUTH_AUTH_BASE') ?? DEFAULT_AUTH_BASE);
  const iamBase = stripTrailingSlash(readEnv(env, 'OAUTH_IAM_BASE_URL') ?? DEFAULT_IAM_BASE);
  const huaweiClawBase = stripTrailingSlash(readEnv(env, 'HUAWEI_CLAW_URL') ?? DEFAULT_HUAWEI_CLAW_BASE);
  const tokenUrl = `${iamBase}/v1/oauth2/tokens`;
  const permissionValidateUrl = `${huaweiClawBase}/v1/claw/client-permission-validate`;
  const subscriptionUrl = `${huaweiClawBase}/v1/claw/client-subscription`;
  const clientId = readEnv(env, 'OAUTH_CLIENT_ID') ?? DEFAULT_CLIENT_ID;
  const oauthMock = isEnvFlagEnabled(readEnv(env, 'OAUTH_MOCK'));
  const mockBase = stripTrailingSlash(readEnv(env, 'MOCK_FRONTEND_BASE') ?? 'http://127.0.0.1:3003');
  const redirectUri = readEnv(env, 'OAUTH_REDIRECT_URI') ?? (oauthMock ? `${mockBase}/login/auth-test` : DEFAULT_REDIRECT_URI);
  const stateTtlMs = options.stateTtlMs ?? readPositiveNumber(env, 'OAUTH_STATE_TTL_MS', DEFAULT_STATE_TTL_MS);
  const pendingTtlMs = options.pendingTtlMs ?? readPositiveNumber(env, 'OAUTH_PENDING_TTL_MS', DEFAULT_PENDING_TTL_MS);
  const canCreateModel = isEnvFlagEnabled(readEnv(env, 'CAN_CREATE_MODEL'));
  const configuredRefreshThresholdMs = Number(readEnv(env, 'OFFICE_CLAW_OAUTH_REFRESH_THRESHOLD_MS'));
  // Default to 2 hours if not provided or invalid
  const refreshThresholdMs = Number.isFinite(configuredRefreshThresholdMs) && configuredRefreshThresholdMs > 0 ? configuredRefreshThresholdMs : 2 * 60 * 60 * 1000;
  const pendingAuthStates = new Map<string, PendingAuthState>();
  const consumedAuthStates = new Map<string, ConsumedAuthState>();

  function pruneExpiredStates(): void {
    const now = Date.now();
    for (const [state, pending] of pendingAuthStates) {
      if (pending.expiresAt <= now) pendingAuthStates.delete(state);
    }
    for (const [state, consumed] of consumedAuthStates) {
      if (consumed.expiresAt <= now) consumedAuthStates.delete(state);
    }
  }

  function rememberConsumedState(state: string, result: AuthenticateOutcome): AuthenticateOutcome {
    consumedAuthStates.set(state, {
      result,
      expiresAt: Date.now() + stateTtlMs,
    });
    logStep('OAuth记录已消费state', {
      state: maskValue(state),
      success: result.success,
      consumedStateCount: consumedAuthStates.size,
    });
    return result;
  }

  async function createAuthorizationRequest(): Promise<{ authorizeUrl: string; state: string }> {
    pruneExpiredStates();
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkce();
    const { privateJwk, publicJwk } = await generateDpopKeyPair();

    pendingAuthStates.set(state, {
      codeVerifier,
      dpopPrivateJwk: privateJwk,
      dpopPublicJwk: publicJwk,
      expiresAt: Date.now() + stateTtlMs,
    });

    const oauthParams = new URLSearchParams({
      client_id: clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'SHA-256',
      state,
      scope: 'openid',
      redirect_uri: redirectUri,
      response_type: 'code',
    });

    if (oauthMock) {
      const authorizeUrl = `${mockBase}/login/authorize-test?${oauthParams.toString()}`;
      logStep('OAuth生成授权地址', {
        oauthMock,
        state: maskValue(state),
        pendingStateCount: pendingAuthStates.size,
        redirectUri,
        authorizeUrl,
      });
      return { authorizeUrl, state };
    }

    const innerUrl = `${authBase}/authui/v1/oauth2/authorize?${oauthParams.toString()}`;
    const authorizeUrl = `${authBase}/authui/login.html?service=${encodeURIComponent(innerUrl)}`;
    logStep('OAuth生成授权地址', {
      oauthMock,
      state: maskValue(state),
      pendingStateCount: pendingAuthStates.size,
      redirectUri,
      authBase,
      authorizeUrl,
    });
    return { authorizeUrl, state };
  }

  async function exchangeCode(code: string, state: string): Promise<HuaweiOauthProviderState> {
    pruneExpiredStates();
    const pending = pendingAuthStates.get(state);
    const allowManualMockCallback = oauthMock && isMockAuthorizationCode(code);
    logStep('OAuth开始授权码交换', {
      oauthMock,
      code: maskValue(code),
      state: maskValue(state),
      pendingFound: Boolean(pending),
      pendingExpiresAt: pending?.expiresAt,
      pendingStateCount: pendingAuthStates.size,
      allowManualMockCallback,
    });
    if ((!pending || pending.expiresAt <= Date.now()) && !allowManualMockCallback) {
      pendingAuthStates.delete(state);
      logStep('OAuth授权码交换state无效', {
        state: maskValue(state),
        pendingFound: Boolean(pending),
        pendingExpiresAt: pending?.expiresAt,
        now: Date.now(),
      });
      throw new Error('state 无效或已过期，请重新发起登录');
    }
    if (pending) pendingAuthStates.delete(state);

    let tokenResponse: IamTokenResponse;
    if (oauthMock) {
      logStep('OAuth生成MockToken', {
        state: maskValue(state),
      });
      tokenResponse = generateMockTokenResponse();
    } else {
      if (!pending) throw new Error('state 无效或已过期，请重新发起登录');
      const privateKey = await importDpopPrivateKey(pending.dpopPrivateJwk);
      const dpopJwt = await generateDpopJwt(privateKey, pending.dpopPublicJwk, 'POST', tokenUrl);
      const tokenBody = new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: pending.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
      const tokenHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopJwt };
      logStep('OAuth发送IAMToken请求', {
        state: maskValue(state),
        url: tokenUrl,
        method: 'POST',
        clientId,
        redirectUri,
        oauthTlsRejectUnauthorized: isAuthFlowTlsRejectUnauthorized(env),
        bodyKeys: [...tokenBody.keys()],
        hasDpop: Boolean(dpopJwt),
      });
      let response: Response;
      try {
        response = await fetchImpl(tokenUrl, {
          ...getAuthFlowTlsFetchOptions(env),
          method: 'POST',
          headers: tokenHeaders,
          body: tokenBody.toString(),
        });
      } catch (error) {
        logStep('OAuth IAMToken请求异常', {
          state: maskValue(state),
          url: tokenUrl,
          redirectUri,
          oauthTlsRejectUnauthorized: isAuthFlowTlsRejectUnauthorized(env),
          error: getErrorDetails(error),
        });
        throw error;
      }
      const responseText = await response.text().catch(() => '');
      logStep('OAuth收到IAMToken响应', {
        state: maskValue(state),
        status: response.status,
        ok: response.ok,
        body: truncate(responseText),
      });
      if (!response.ok) {
        throw new Error(`授权码交换失败，请重新登录: ${truncate(responseText)}`);
      }
      tokenResponse = normalizeIamTokenResponse(tryParseBody(responseText) as IamTokenResponse);
    }

    return buildProviderStateFromToken(
      tokenResponse,
      pending ? { privateJwk: pending.dpopPrivateJwk, publicJwk: pending.dpopPublicJwk } : undefined,
    );
  }

  async function checkPermission(providerState: HuaweiOauthProviderState): Promise<PermissionCheckResult> {
    const { accessKey, secretKey, securityToken, projectId } = resolveCredential(providerState);
    logStep('OAuth开始权限校验', {
      accountId: providerState.accountId,
      hasAccessKey: Boolean(accessKey),
      hasSecretKey: Boolean(secretKey),
      hasSecurityToken: Boolean(securityToken),
      projectId,
    });
    if (!accessKey || !secretKey || !securityToken) {
      return { identity: null };
    }

    const headers: Record<string, string> = {};
    if (securityToken) headers['X-Security-Token'] = securityToken;
    if (projectId) headers['X-Project-ID'] = projectId;
    const signedRequest = signHuaweiRequest('GET', permissionValidateUrl, headers, '', accessKey, secretKey);
    const response = await fetchImpl(permissionValidateUrl, {
      ...getAuthFlowTlsFetchOptions(env),
      method: signedRequest.method,
      headers: signedRequest.headers,
    });
    const responseText = await response.text().catch(() => '');
    const parsed = tryParseBody(responseText);

    if (!response.ok) {
      const record = isRecord(parsed) ? parsed : {};
      logStep('OAuth权限校验失败', {
        accountId: providerState.accountId,
        status: response.status,
        body: truncate(responseText),
      });
      return {
        identity: null,
        errorMessage: readString(record, 'error_msg') || readString(record, 'error_message') || '权限校验失败',
      };
    }

    const payload = unwrapPayload(parsed);
    const identity = extractPermissionIdentity(parsed);
    const modelInfo = extractModelInfo(payload);
    logStep('OAuth权限校验成功', {
      accountId: providerState.accountId,
      hasIdentity: Boolean(identity),
      identityAccountId: identity?.accountId,
      userName: identity?.userName,
      hasModelInfo: Boolean(modelInfo),
    });
    return {
      identity,
      modelInfo,
    };
  }

  async function subscriptionClaw(providerState: HuaweiOauthProviderState, promotionCode: string): Promise<SubscriptionResult> {
    const { accessKey, secretKey, securityToken, projectId } = resolveCredential(providerState);
    if (!accessKey || !secretKey || !securityToken) {
      return { success: false, message: '缺少登录凭证，请重新登录' };
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json;charset=utf8' };
    if (securityToken) headers['X-Security-Token'] = securityToken;
    if (projectId) headers['X-Project-ID'] = projectId;
    const body = JSON.stringify({ promotion_code: promotionCode });
    const signedRequest = signHuaweiRequest('POST', subscriptionUrl, headers, body, accessKey, secretKey);
    const response = await fetchImpl(subscriptionUrl, {
      ...getAuthFlowTlsFetchOptions(env),
      method: signedRequest.method,
      headers: signedRequest.headers,
      body,
    });
    const responseText = await response.text().catch(() => '');
    const parsed = tryParseBody(responseText);

    if (!response.ok) {
      const record = isRecord(parsed) ? parsed : {};
      const errorCode = readString(record, 'error_code');
      const needCode = PROMOTION_CODE_ERROR_CODES.has(errorCode);
      return {
        success: false,
        needCode,
        errorCode,
        message: PROMOTION_CODE_ERROR_MESSAGES[errorCode] || (needCode ? '邀请码无效，请重新输入' : '开通失败'),
      };
    }

    const payload = unwrapPayload(parsed);
    const modelInfo = extractModelInfo(payload);
    if (!modelInfo) return { success: false, message: '开通成功，但未返回模型信息' };
    return { success: true, modelInfo };
  }

  async function finishLogin(providerState: HuaweiOauthProviderState): Promise<AuthenticateOutcome> {
    logStep('OAuth开始完成登录', {
      oauthMock,
      accountId: providerState.accountId,
      userName: providerState.userName,
      expiresAt: providerState.credential.expires_at,
      hasRefreshToken: Boolean(providerState.credential.refresh_token),
    });
    if (oauthMock) {
      const nextState = { ...providerState, modelInfo: { plan: 'dev', model: 'mock' } };
      await writeStoredProfile(env, nextState.accountId, nextState);
      logStep('OAuth完成Mock登录', {
        accountId: nextState.accountId,
        hasModelInfo: Boolean(nextState.modelInfo),
      });
      return { success: true, principal: toPrincipal(nextState) };
    }

    const permission = await checkPermission(providerState);
    if (!permission.identity && permission.errorMessage) {
      logStep('OAuth完成登录权限失败', {
        accountId: providerState.accountId,
        message: permission.errorMessage,
      });
      return { success: false, message: permission.errorMessage };
    }

    let nextState = providerState;
    if (permission.identity) {
      nextState = applyPermissionIdentity(nextState, permission.identity);
    }
    if (permission.modelInfo) {
      nextState = { ...nextState, modelInfo: permission.modelInfo };
    }

    if (nextState.modelInfo) {
      await writeStoredProfile(env, nextState.accountId, nextState);
      logStep('OAuth完成登录成功', {
        accountId: nextState.accountId,
        userName: nextState.userName,
        hasModelInfo: Boolean(nextState.modelInfo),
      });
      return { success: true, principal: toPrincipal(nextState) };
    }

    const pendingToken = randomBytes(32).toString('base64url');
    await writePendingProfile(env, pendingToken, nextState, pendingTtlMs);
    logStep('OAuth完成登录进入邀请码流程', {
      accountId: nextState.accountId,
      pendingToken: maskValue(pendingToken),
      pendingTtlMs,
    });
    return createPendingFailure('当前账号尚未开通 OPT，请填写邀请码后继续', nextState.accountId, pendingToken);
  }

  async function handleInvitation(pendingToken: string, promotionCode: string): Promise<AuthenticateOutcome> {
    const pending = await readPendingProfile(env, pendingToken);
    if (!pending || pending.expiresAt <= Date.now()) {
      await deletePendingProfile(env, pendingToken);
      return { success: false, needCode: true, message: '登录状态已失效，请重新登录' };
    }

    const result = await subscriptionClaw(pending.providerState, promotionCode);
    if (!result.success || !result.modelInfo) {
      pending.attempts += 1;
      if (pending.attempts >= MAX_PENDING_ATTEMPTS) {
        await deletePendingProfile(env, pendingToken);
        return { success: false, needCode: true, message: '邀请码错误次数过多，请重新登录' };
      }
      await rewritePendingProfile(env, pendingToken, pending);
      return createPendingFailure(result.message || '邀请码校验失败', pending.providerState.accountId, pendingToken, result.errorCode);
    }

    const nextState = { ...pending.providerState, modelInfo: result.modelInfo };
    await writeStoredProfile(env, nextState.accountId, nextState);
    await deletePendingProfile(env, pendingToken);
    return { success: true, principal: toPrincipal(nextState) };
  }

  async function refreshPrincipal(session: AuthSessionInfo): Promise<ExternalPrincipal | null> {
    const providerState = isRecord(session.providerState)
      ? (session.providerState as unknown as HuaweiOauthProviderState)
      : await readStoredProfile(env, session.userId);
    if (!providerState?.credential.refresh_token || !providerState.dpop) return null;
    if (oauthMock) return toPrincipal(providerState);

    const privateKey = await importDpopPrivateKey(providerState.dpop.privateJwk);
    const dpopJwt = await generateDpopJwt(privateKey, providerState.dpop.publicJwk, 'POST', tokenUrl);
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: providerState.credential.refresh_token,
    });
    const response = await fetchImpl(tokenUrl, {
      ...getAuthFlowTlsFetchOptions(env),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpopJwt },
      body: tokenBody.toString(),
    });
    if (!response.ok) return null;
    const tokenResponse = normalizeIamTokenResponse(tryParseBody(await response.text()) as IamTokenResponse);
    const credential = tokenResponse.credential;
    if (!credential) return null;

    const nextState: HuaweiOauthProviderState = {
      ...providerState,
      credential: {
        access: credential.access,
        secret: credential.secret,
        sts_token: credential.securityToken,
        project_id: credential.project_id || providerState.credential.project_id,
        expires_at: credential.expires_at,
        refresh_token: tokenResponse.refresh_token || providerState.credential.refresh_token,
      },
    };
    await writeStoredProfile(env, nextState.accountId, nextState);
    return toPrincipal(nextState);
  }

  return {
    id: 'huawei-oauth',
    displayName: 'Huawei OAuth2',
    presentation: {
      mode: 'redirect',
      redirectUrl: '/login',
      fields: [],
      submitLabel: '登录',
      description: 'Sign in with Huawei OAuth2.',
    },

    async getPublicConfig() {
      return { hascode: false, canCreateModel, loginUrl: '/login', logoutUrl: '/login' };
    },

    async authenticate(): Promise<AuthenticateOutcome> {
      return { success: false, message: 'Use authorization callback flow for OAuth provider' };
    },

    async handleCallback(params): Promise<AuthenticateOutcome> {
      const pendingToken = params.pendingToken?.trim() ?? '';
      const promotionCode = params.promotionCode?.trim() || params.code?.trim() || params.inviteCode?.trim() || '';
      logStep('OAuth收到回调参数', {
        hasPendingToken: Boolean(pendingToken),
        hasPromotionCode: Boolean(promotionCode),
        code: maskValue(params.code),
        state: maskValue(params.state),
        error: params.error,
      });
      if (pendingToken && promotionCode) {
        return handleInvitation(pendingToken, promotionCode);
      }

      const error = params.error?.trim();
      if (error) {
        logStep('OAuth回调包含错误', { error });
        return { success: false, message: error === 'access_denied' ? '已取消登录，请重新发起授权' : `授权被拒绝：${error}` };
      }

      const code = params.code?.trim() ?? '';
      const state = params.state?.trim() ?? '';
      if (!code || !state) return { success: false, message: 'OAuth 回调参数缺失，请重新登录' };

      try {
        pruneExpiredStates();
        const consumed = consumedAuthStates.get(state);
        if (consumed) {
          logStep('OAuth命中已消费state', {
            state: maskValue(state),
            success: consumed.result.success,
          });
          return consumed.result;
        }

        const providerState = await exchangeCode(code, state);
        const result = await finishLogin(providerState);
        logStep('OAuth回调处理完成', {
          state: maskValue(state),
          success: result.success,
          userId: result.success ? result.principal.userId : undefined,
          message: result.success ? undefined : result.message,
          needCode: result.success ? undefined : result.needCode,
        });
        return rememberConsumedState(state, result);
      } catch (error) {
        logStep('OAuth回调处理异常', {
          state: maskValue(state),
          message: error instanceof Error ? error.message : String(error),
        });
        return { success: false, message: error instanceof Error ? error.message : '授权码交换失败，请重新登录' };
      }
    },

    async restoreSession(userId): Promise<ExternalPrincipal | null> {
      const stored = await readStoredProfile(env, userId);
      if (!stored) return null;
      // If credential already expired, try to refresh; otherwise, if it's near expiry (within refreshThresholdMs), refresh proactively
      const expiresAt = Number.isFinite(Number(stored?.credential?.expires_at))
        ? Number(stored.credential.expires_at)
        : new Date(stored.credential.expires_at).getTime() || 0;
      const now = Date.now();
      if (isExpired(stored)) {
        const refreshed = await refreshPrincipal({
          sessionId: 'restore',
          userId,
          providerId: 'huawei-oauth',
          providerState: stored,
          expiresAt: new Date(stored.credential.expires_at),
        });
        if (refreshed) return refreshed;
        await deleteStoredProfile(env, userId);
        return null;
      }

      // If token will expire within the refresh threshold, attempt refresh to extend it
      if (expiresAt && expiresAt - now <= refreshThresholdMs) {
        const refreshed = await refreshPrincipal({
          sessionId: 'restore-proactive',
          userId,
          providerId: 'huawei-oauth',
          providerState: stored,
          expiresAt: new Date(stored.credential.expires_at),
        });
        if (refreshed) return refreshed;
        // If refresh failed but token still valid, fallback to current principal
      }

      return toPrincipal(stored);
    },

    async refresh(session): Promise<ExternalPrincipal | null> {
      return refreshPrincipal(session);
    },

    async logout(session): Promise<void> {
      await deleteStoredProfile(env, session.userId);
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

    createAuthorizationRequest,
  };
}
