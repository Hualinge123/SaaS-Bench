import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createHuaweiOauthAuthProvider } from '../huawei-oauth.js';

describe('createHuaweiOauthAuthProvider', () => {
  test('creates mock authorization URL and completes OAuth callback without external fetches', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-oauth-test-'));
    try {
      let fetchCalls = 0;
      const provider = createHuaweiOauthAuthProvider({
        env: {
          OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir,
          OAUTH_MOCK: '1',
          MOCK_FRONTEND_BASE: 'http://127.0.0.1:3003',
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error('mock OAuth flow should not call external services');
        },
      });

      const authorization = await provider.createAuthorizationRequest?.();
      assert.ok(authorization);
      const authorizeUrl = new URL(authorization.authorizeUrl);
      assert.equal(authorizeUrl.origin + authorizeUrl.pathname, 'http://127.0.0.1:3003/login/authorize-test');
      assert.equal(authorizeUrl.searchParams.get('state'), authorization.state);
      assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'SHA-256');
      assert.equal(authorizeUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:3003/login/auth-test');

      const result = await provider.handleCallback?.({
        code: 'mock_code_0123456789abcdef0123456789abcdef',
        state: authorization.state,
      });

      assert.equal(result?.success, true);
      if (!result?.success) throw new Error('expected success');
      assert.match(result.principal.userId, /^mock-user-/);
      assert.deepEqual((result.principal.providerState as { modelInfo?: unknown }).modelInfo, {
        plan: 'dev',
        model: 'mock',
      });
      assert.equal(fetchCalls, 0);

      const duplicateResult = await provider.handleCallback?.({
        code: 'mock_code_0123456789abcdef0123456789abcdef',
        state: authorization.state,
      });
      assert.deepEqual(duplicateResult, result);

      const restored = await provider.restoreSession?.(result.principal.userId);
      assert.equal(restored?.userId, result.principal.userId);

      const refreshed = await provider.refresh?.({
        sessionId: 'session-1',
        providerId: 'huawei-oauth',
        userId: result.principal.userId,
        providerState: result.principal.providerState,
        expiresAt: result.principal.expiresAt,
      });
      assert.equal(refreshed?.userId, result.principal.userId);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('returns rich invitation message for common.01010004 subscription errors', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-oauth-test-'));
    try {
      const provider = createHuaweiOauthAuthProvider({
        env: {
          OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir,
          OAUTH_IAM_BASE_URL: 'https://sts.example.test',
          HUAWEI_CLAW_URL: 'https://claw.example.test',
          OAUTH_CLIENT_ID: 'client-officeclaw',
          OAUTH_REDIRECT_URI: 'http://127.0.0.1:3003/login/auth-test',
        },
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.includes('/v1/oauth2/tokens')) {
            return new Response(
              JSON.stringify({
                credentials: {
                  access_key_id: 'ak',
                  expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  secret_access_key: 'sk',
                  security_token: 'st',
                  project_id: 'project-id',
                },
                refresh_token: 'refresh-token',
                id_token: 'header.eyJzdWIiOiJvYXV0aC11c2VyIiwicHJlZmVycmVkX3VzZXJuYW1lIjoib2F1dGgtdXNlciJ9.',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.includes('/v1/claw/client-permission-validate')) {
            return new Response(
              JSON.stringify({
                data: {
                  account_id: 'account-id',
                  principal_urn: 'iam::domain-id:user:oauth-user',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.includes('/v1/claw/client-subscription')) {
            return new Response(JSON.stringify({ error_code: 'common.01010004' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
      });

      const authorization = await provider.createAuthorizationRequest?.();
      assert.ok(authorization);

      const callbackResult = await provider.handleCallback?.({
        code: 'authorization-code',
        state: authorization.state,
      });

      assert.equal(callbackResult?.success, false);
      if (callbackResult?.success) throw new Error('expected pending invitation');
      assert.equal(callbackResult?.needCode, true);
      const pendingToken = (callbackResult as { pendingToken?: string }).pendingToken;
      assert.ok(pendingToken);

      const invitationResult = await provider.handleCallback?.({
        pendingToken,
        promotionCode: 'bad-code',
      });

      assert.equal(invitationResult?.success, false);
      if (invitationResult?.success) throw new Error('expected invitation failure');
      assert.equal(invitationResult.needCode, true);
      assert.equal((invitationResult as { errorCode?: string }).errorCode, 'common.01010004');
      assert.match(invitationResult.message ?? '', /href="https:\/\/support\.huaweicloud\.com\/usermanual-account\/account_auth_00001\.html"/);
      assert.match(invitationResult.message ?? '', /href="https:\/\/support\.huaweicloud\.com\/billing_faq\/billing_faq_1000000\.html"/);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });
});
