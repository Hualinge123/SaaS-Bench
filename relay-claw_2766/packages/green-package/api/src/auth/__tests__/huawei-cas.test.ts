import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createHuaweiCasAuthProvider } from '../huawei-cas.js';

function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    access: 'ak-test',
    domain_id: 'domain-001',
    secret: 'sk-test',
    sts_token: 'sts-token-test',
    user_id: 'user-001',
    user_name: 'alice',
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function decryptWithSecret<T>(raw: string, secret: string): T {
  const payload = JSON.parse(raw) as {
    version: 1;
    alg: 'aes-256-gcm';
    iv: string;
    tag: string;
    data: string;
  };
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64url')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

describe('createHuaweiCasAuthProvider', () => {
  test('builds the customized Huawei CAS login URL by default', () => {
    const provider = createHuaweiCasAuthProvider({ env: {} });

    const redirectUrl = provider.presentation.redirectUrl ?? '';
    const url = new URL(redirectUrl);

    assert.equal(url.origin + url.pathname, 'https://auth.huaweicloud.com/authui/login.html');
    assert.equal(url.searchParams.get('locale'), 'zh-cn');
    assert.equal(url.searchParams.get('hide_banner'), 'true');
    assert.equal(url.searchParams.get('hide_foot'), 'true');
    assert.equal(
      url.searchParams.get('background_img_url'),
      'https://res.hc-cdn.com/AgentArts-Console/26.3.2/hws/assets/login/bg2.png',
    );
    assert.equal(
      url.searchParams.get('portal_img_url'),
      'https://res.hc-cdn.com/AgentArts-Console/26.3.2/hws/assets/login/ad2.png',
    );
    assert.equal(
      url.searchParams.get('service'),
      'https://versatile.cn-north-4.myhuaweicloud.com/v1/claw/cas/login/callback',
    );
    assert.equal(url.hash, '#/login');
  });

  test('allows an explicit CAS login URL override', () => {
    const provider = createHuaweiCasAuthProvider({
      env: { OFFICE_CLAW_CAS_LOGIN_URL: 'https://login.example.test/custom' },
    });

    assert.equal(provider.presentation.redirectUrl, 'https://login.example.test/custom');
  });

  test('returns needCode and does not create a principal when ticket is valid but model info is missing', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      let subscriptionCalls = 0;
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) return response(buildProfile());
          if (String(url).includes('/client-subscription')) {
            subscriptionCalls += 1;
            return response({ model_info: { model_api_url_base: 'https://maas.example.com' } });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1' });

      assert.equal(result?.success, false);
      assert.equal((result as { needCode?: boolean; userId?: string; pendingToken?: string }).needCode, true);
      assert.equal((result as { needCode?: boolean; userId?: string; pendingToken?: string }).userId, 'domain-001:user-001');
      assert.match((result as { pendingToken?: string }).pendingToken ?? '', /^[A-Za-z0-9_-]{32,}$/);
      assert.equal(subscriptionCalls, 0);
      assert.equal(await provider.restoreSession?.('domain-001:user-001'), null);
      const files = await readdir(secureConfigDir);
      const pendingRaw = await readFile(join(secureConfigDir, files.find((file) => file.startsWith('pending-')) ?? ''), 'utf8');
      assert.doesNotMatch(pendingRaw, /sk-test|sts-token-test|ak-test|alice/);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('treats a non-null ticket-validate subscription as already subscribed', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      let subscriptionCalls = 0;
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) {
            return response({ ...buildProfile(), model_info: undefined, subscription: {} });
          }
          if (String(url).includes('/client-subscription')) {
            subscriptionCalls += 1;
            return response({ model_info: { model_api_url_base: 'https://maas.example.com' } });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1' });

      assert.equal(result?.success, true);
      if (!result?.success) throw new Error('expected success');
      assert.equal(result.principal.userId, 'domain-001:user-001');
      assert.deepEqual((result.principal.providerState as { modelInfo?: Record<string, unknown> }).modelInfo, {});
      assert.equal(subscriptionCalls, 0);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('extracts ticket-validate model info from nested subscription payloads', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) {
            return response({
              ...buildProfile(),
              model_info: undefined,
              subscription: { model_info: { model_api_url_base: 'https://maas.example.com' } },
            });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1' });

      assert.equal(result?.success, true);
      if (!result?.success) throw new Error('expected success');
      assert.deepEqual((result.principal.providerState as { modelInfo?: Record<string, unknown> }).modelInfo, {
        model_api_url_base: 'https://maas.example.com',
      });
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('uses promotionCode to subscribe and returns stable domain:user identity', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      let subscriptionBody: unknown = null;
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url, init) => {
          if (String(url).includes('/ticket-validate')) return response(buildProfile());
          if (String(url).includes('/client-subscription')) {
            subscriptionBody = JSON.parse(String(init?.body));
            assert.equal((init?.headers as Record<string, string>)['X-Security-Token'], 'sts-token-test');
            assert.match((init?.headers as Record<string, string>).Authorization, /^SDK-HMAC-SHA256 Access=ak-test,/);
            return response({ model_info: { model_api_url_base: 'https://maas.example.com' } });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1', promotionCode: 'promo-123' });

      assert.equal(result?.success, true);
      if (!result?.success) throw new Error('expected success');
      assert.equal(result.principal.userId, 'domain-001:user-001');
      assert.deepEqual(subscriptionBody, { promotion_code: 'promo-123' });
      assert.equal((await provider.restoreSession?.('domain-001:user-001'))?.userId, 'domain-001:user-001');
      const files = await readdir(secureConfigDir);
      const storedRaw = await readFile(
        join(secureConfigDir, files.find((file) => file.endsWith('.json') && !file.startsWith('pending-')) ?? ''),
        'utf8',
      );
      assert.doesNotMatch(storedRaw, /sk-test|sts-token-test|ak-test|alice/);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('keeps invalid promotionCode pending without creating a session principal', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) return response(buildProfile());
          if (String(url).includes('/client-subscription')) return response({ error_code: 'AgentArts.11000008' }, 400);
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1', promotionCode: 'bad-code' });

      assert.equal(result?.success, false);
      assert.equal((result as { needCode?: boolean; userId?: string; pendingToken?: string; errorCode?: string }).needCode, true);
      assert.equal((result as { needCode?: boolean; userId?: string; pendingToken?: string; errorCode?: string }).userId, 'domain-001:user-001');
      assert.equal((result as { errorCode?: string }).errorCode, 'AgentArts.11000008');
      assert.match((result as { message?: string }).message ?? '', /href="https:\/\/www\.huaweicloud\.com\/product\/agentarts\/officeclaw\.html"/);
      assert.match((result as { pendingToken?: string }).pendingToken ?? '', /^[A-Za-z0-9_-]{32,}$/);
      assert.equal(await provider.restoreSession?.('domain-001:user-001'), null);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('returns account status links when backend reports account status error', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) return response(buildProfile());
          if (String(url).includes('/client-subscription')) return response({ error_code: 'common.01010004' }, 400);
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1', promotionCode: 'bad-code' });

      assert.equal(result?.success, false);
      assert.equal((result as { errorCode?: string }).errorCode, 'common.01010004');
      assert.match((result as { message?: string }).message ?? '', /璇风‘璁よ处鍙风姸鎬/);
      assert.match((result as { message?: string }).message ?? '', /瀹炲悕璁よ瘉/);
      assert.match((result as { message?: string }).message ?? '', /闈炴瑺璐/);
      assert.match((result as { message?: string }).message ?? '', /href="https:\/\/support\.huaweicloud\.com\/usermanual-account\/account_auth_00001\.html"/);
      assert.match((result as { message?: string }).message ?? '', /href="https:\/\/support\.huaweicloud\.com\/billing_faq\/billing_faq_1000000\.html"/);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('completes pending invitation by pendingToken without revalidating the CAS ticket', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      let ticketValidateCalls = 0;
      let subscriptionCalls = 0;
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url, init) => {
          if (String(url).includes('/ticket-validate')) {
            ticketValidateCalls += 1;
            return response(buildProfile());
          }
          if (String(url).includes('/client-subscription')) {
            subscriptionCalls += 1;
            assert.deepEqual(JSON.parse(String(init?.body)), { promotion_code: 'promo-123' });
            return response({ model_info: { model_api_url_base: 'https://maas.example.com' } });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const pending = await provider.handleCallback?.({ ticket: 'one-time-ticket' });
      assert.equal(pending?.success, false);
      assert.equal((pending as { needCode?: boolean; userId?: string }).needCode, true);
      assert.equal((pending as { needCode?: boolean; userId?: string }).userId, 'domain-001:user-001');
      const pendingToken = (pending as { pendingToken?: string }).pendingToken;
      assert.match(pendingToken ?? '', /^[A-Za-z0-9_-]{32,}$/);

      const hijackAttempt = await provider.handleCallback?.({ userId: 'domain-001:user-001', promotionCode: 'promo-123' });
      assert.equal(hijackAttempt?.success, false);

      const completed = await provider.handleCallback?.({ pendingToken: pendingToken ?? '', promotionCode: 'promo-123' });

      assert.equal(completed?.success, true);
      if (!completed?.success) throw new Error('expected success');
      assert.equal(completed.principal.userId, 'domain-001:user-001');
      assert.equal(ticketValidateCalls, 1);
      assert.equal(subscriptionCalls, 1);
      assert.equal((await readdir(secureConfigDir)).some((file) => file.startsWith('pending-')), false);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('uses a reusable per-install encryption key when no env key is configured', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      const env = { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir };
      const provider = createHuaweiCasAuthProvider({
        env,
        fetchImpl: async (url, init) => {
          if (String(url).includes('/ticket-validate')) return response(buildProfile());
          if (String(url).includes('/client-subscription')) {
            assert.deepEqual(JSON.parse(String(init?.body)), { promotion_code: 'promo-123' });
            return response({ model_info: { model_api_url_base: 'https://maas.example.com' } });
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
        subscriptionUrl: 'https://example.test/client-subscription',
      });

      const result = await provider.handleCallback?.({ ticket: 'ticket-1', promotionCode: 'promo-123' });
      assert.equal(result?.success, true);

      const files = await readdir(secureConfigDir);
      const keySecret = await readFile(join(secureConfigDir, '.cas-profile-encryption-key'), 'utf8');
      const storedRaw = await readFile(
        join(secureConfigDir, files.find((file) => file.endsWith('.json') && !file.startsWith('pending-')) ?? ''),
        'utf8',
      );
      assert.equal(decryptWithSecret<{ user_name?: string }>(storedRaw, keySecret.trim()).user_name, 'alice');
      assert.throws(() => decryptWithSecret(storedRaw, 'office-claw-huawei-cas-local-secure-config'));

      const nextProvider = createHuaweiCasAuthProvider({ env });
      assert.equal((await nextProvider.restoreSession?.('domain-001:user-001'))?.userId, 'domain-001:user-001');
      assert.equal(await readFile(join(secureConfigDir, '.cas-profile-encryption-key'), 'utf8'), keySecret);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });

  test('generates different per-install encryption keys for different config directories', async () => {
    const firstDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    const secondDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      for (const secureConfigDir of [firstDir, secondDir]) {
        const provider = createHuaweiCasAuthProvider({
          env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
          fetchImpl: async (url) => {
            if (String(url).includes('/ticket-validate')) {
              return response(buildProfile({ model_info: { model_api_url_base: 'https://maas.example.com' } }));
            }
            throw new Error(`Unexpected fetch: ${url}`);
          },
          ticketValidateUrl: 'https://example.test/ticket-validate',
        });
        assert.equal((await provider.handleCallback?.({ ticket: 'ticket-1' }))?.success, true);
      }

      const firstKey = await readFile(join(firstDir, '.cas-profile-encryption-key'), 'utf8');
      const secondKey = await readFile(join(secondDir, '.cas-profile-encryption-key'), 'utf8');
      assert.notEqual(firstKey, secondKey);
    } finally {
      await rm(firstDir, { recursive: true, force: true });
      await rm(secondDir, { recursive: true, force: true });
    }
  });

  test('fails closed instead of replacing an empty per-install encryption key', async () => {
    const secureConfigDir = await mkdtemp(join(tmpdir(), 'office-claw-cas-test-'));
    try {
      await writeFile(join(secureConfigDir, '.cas-profile-encryption-key'), '', { encoding: 'utf8', mode: 0o600 });
      const provider = createHuaweiCasAuthProvider({
        env: { OFFICE_CLAW_SECURE_CONFIG_DIR: secureConfigDir },
        fetchImpl: async (url) => {
          if (String(url).includes('/ticket-validate')) {
            return response(buildProfile({ model_info: { model_api_url_base: 'https://maas.example.com' } }));
          }
          throw new Error(`Unexpected fetch: ${url}`);
        },
        ticketValidateUrl: 'https://example.test/ticket-validate',
      });

      await assert.rejects(() => provider.handleCallback?.({ ticket: 'ticket-1' }) ?? Promise.resolve(), /file is empty/);
    } finally {
      await rm(secureConfigDir, { recursive: true, force: true });
    }
  });
});
