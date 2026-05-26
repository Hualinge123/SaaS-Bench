import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createHuaweiIamAuthProvider } from '../huawei-iam.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('createHuaweiIamAuthProvider', () => {
  test('uses stable principal userId from IAM user lookup when token user.id is mutable', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).includes('/v3/auth/tokens')) {
        const req = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const auth = req.auth as Record<string, unknown>;
        const identity = auth.identity as Record<string, unknown>;
        const passwordObj = identity.password as Record<string, unknown>;
        const user = passwordObj.user as Record<string, unknown>;
        const name = String(user.name ?? '');
        return response(
          {
            token: {
              expires_at: '2030-01-01T00:00:00Z',
              user: {
                id: name,
                name,
                domain: { id: 'domain-001' },
              },
            },
          },
          200,
          { 'x-subject-token': `token-${name}` },
        );
      }

      if (String(url).includes('/v3/users')) {
        return response({
          users: [{ id: 'iam-user-001', name: 'alice-renamed', domain_id: 'domain-001' }],
        });
      }

      if (String(url).includes('/client-subscription')) {
        return response({ model_info: {} });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const provider = createHuaweiIamAuthProvider({ fetchImpl });

    const first = await provider.authenticate({
      credentials: {
        userType: 'iam',
        domainName: 'tenant-a',
        userName: 'alice-renamed',
        password: 'pw',
      },
    });
    assert.equal(first.success, true);
    if (!first.success) throw new Error('expected first auth success');
    assert.equal(first.principal.userId, 'domain-001:iam-user-001');
    assert.equal(first.principal.displayName, 'alice-renamed');
  });

  test('fails authentication when stable IAM user id cannot be resolved', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).includes('/v3/auth/tokens')) {
        const req = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const auth = req.auth as Record<string, unknown>;
        const identity = auth.identity as Record<string, unknown>;
        const passwordObj = identity.password as Record<string, unknown>;
        const user = passwordObj.user as Record<string, unknown>;
        const name = String(user.name ?? '');
        return response(
          {
            token: {
              expires_at: '2030-01-01T00:00:00Z',
              user: {
                id: name,
                name,
                domain: { id: 'domain-001' },
              },
            },
          },
          200,
          { 'x-subject-token': 'token-a' },
        );
      }

      if (String(url).includes('/v3/users')) {
        return response({ users: [{ id: 'user-test', name: 'alice', domain_id: 'domain-001' }] });
      }

      if (String(url).includes('/client-subscription')) {
        return response({ model_info: {} });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };

    const provider = createHuaweiIamAuthProvider({ fetchImpl });
    const result = await provider.authenticate({
      credentials: {
        userType: 'iam',
        domainName: 'tenant-a',
        userName: 'alice',
        password: 'pw',
      },
    });
    assert.equal(result.success, false);
    if (result.success) throw new Error('expected auth failure');
    assert.match(result.message ?? '', /稳定.*用户id/i);
  });
});
