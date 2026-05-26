/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

const { resetLocalSecretBackendForTests, setLocalSecretBackendForTests } = await import(
  '../dist/config/local-secret-store.js'
);
const { setProtocolCredentialLookup } = await import('../dist/integrations/protocol-credential-adapter.js');

const tempDirs = [];

function createMemoryBackend() {
  const store = new Map();
  return {
    store,
    backend: {
      get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      getBatch(keys) {
        const result = new Map();
        for (const key of keys) {
          if (store.has(key)) result.set(key, store.get(key));
        }
        return result;
      },
      set(key, value) {
        store.set(key, value);
      },
      delete(key) {
        store.delete(key);
      },
    },
  };
}

function createProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'model-config-route-'));
  tempDirs.push(projectRoot);
  process.env.OFFICE_CLAW_GLOBAL_CONFIG_ROOT = projectRoot;
  writeFileSync(join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  return projectRoot;
}

async function seedHuaweiSession(userId = 'demo-user') {
  const { sessions } = await import('../dist/routes/auth.js');
  const modelInfo = {
    model_api_url_base: 'https://maas.example.com',
    model_auth_info: {
      model_app_key: 'app-key',
      model_app_secret: 'app-secret',
    },
  };
  sessions.set(userId, {
    userId,
    providerId: 'huawei-cas',
    sessionId: 'session-test',
    displayName: userId,
    createdAt: new Date().toISOString(),
    expiresAt: '2999-01-01T00:00:00.000Z',
    providerState: { modelInfo },
  });
  setProtocolCredentialLookup((protocol, uid) => {
    if (protocol !== 'huawei_maas') return null;
    const s = sessions.get(uid);
    const mi = s?.providerState?.modelInfo;
    if (!mi?.model_api_url_base) return null;
    const raw = mi.model_api_url_base.trim();
    const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
    return {
      baseUrl: base.endsWith('/v2') ? base : `${base}/v2`,
      apiKey: 'huawei-maas-session',
      defaultHeaders: {
        Authorization: `Basic ${Buffer.from(`${mi.model_auth_info.model_app_key}:${mi.model_auth_info.model_app_secret}`).toString('base64')}`,
      },
    };
  });
}

describe('model config profiles routes', () => {
  let savedGlobalRoot;

  beforeEach(() => {
    savedGlobalRoot = process.env.OFFICE_CLAW_GLOBAL_CONFIG_ROOT;
    setLocalSecretBackendForTests(null);
  });

  afterEach(() => {
    setProtocolCredentialLookup(undefined);
  });

  after(() => {
    resetLocalSecretBackendForTests();
    if (savedGlobalRoot === undefined) delete process.env.OFFICE_CLAW_GLOBAL_CONFIG_ROOT;
    else process.env.OFFICE_CLAW_GLOBAL_CONFIG_ROOT = savedGlobalRoot;
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST /api/model-config-profiles creates a custom source in ~/.office-claw/model.json and maas-models lists it', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);
    await app.register(maasModelsRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'my-openai-proxy',
        displayName: 'My OpenAI Proxy',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-proxy',
        headers: {
          'X-App-Id': 'office-claw',
        },
        models: ['gpt-4o-mini', 'deepseek-chat'],
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.equal(createBody.provider.id, 'my-openai-proxy');
    assert.equal(createBody.provider.displayName, 'My OpenAI Proxy');
    assert.deepEqual(createBody.provider.models, ['gpt-4o-mini', 'deepseek-chat']);

    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['my-openai-proxy'].protocol, 'openai');
    assert.equal(modelJson['my-openai-proxy'].displayName, 'My OpenAI Proxy');
    assert.equal(modelJson['my-openai-proxy'].baseUrl, 'https://proxy.example.com/v1');
    assert.equal(modelJson['my-openai-proxy'].apiKey, 'sk-proxy');
    assert.deepEqual(modelJson['my-openai-proxy'].headers, { 'X-App-Id': 'office-claw' });
    assert.deepEqual(modelJson['my-openai-proxy'].models, [{ id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }]);
    assert.equal(typeof modelJson['my-openai-proxy'].createdAt, 'string');
    assert.equal(typeof modelJson['my-openai-proxy'].updatedAt, 'string');

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.ok(Array.isArray(listBody.list));
    assert.ok(listBody.list.some((item) => item.id === 'model_config:my-openai-proxy:gpt-4o-mini'));
    assert.ok(listBody.list.some((item) => item.name === 'deepseek-chat' && item.provider === 'My OpenAI Proxy'));
  });

  it('POST /api/model-config-profiles preserves claw-plan serviceType and maas-models lists configured models', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);
    await app.register(maasModelsRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'huawei-maas-claw-plan',
        displayName: 'Claw Plan',
        baseUrl: 'https://api.modelarts-maas.com',
        apiKey: 'sk-claw',
        serviceType: 'claw-plan',
        models: ['glm-5', 'deepseek-v3.2', 'kimi-k2'],
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.equal(createBody.provider.serviceType, 'claw-plan');
    assert.deepEqual(createBody.provider.models, ['glm-5', 'deepseek-v3.2', 'kimi-k2']);

    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['huawei-maas-claw-plan'].serviceType, 'claw-plan');
    assert.equal(modelJson['huawei-maas-claw-plan'].baseUrl, 'https://api.modelarts-maas.com/plan');
    assert.deepEqual(modelJson['huawei-maas-claw-plan'].models, [
      { id: 'glm-5' },
      { id: 'deepseek-v3.2' },
      { id: 'kimi-k2' },
    ]);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    const clawPlanModels = listBody.list.filter((item) => item.serviceType === 'claw-plan');
    assert.deepEqual(
      clawPlanModels.map((item) => item.id),
      [
        'model_config:huawei-maas-claw-plan:glm-5',
        'model_config:huawei-maas-claw-plan:deepseek-v3.2',
        'model_config:huawei-maas-claw-plan:kimi-k2',
      ],
    );
    assert.deepEqual(
      clawPlanModels.map((item) => item.name),
      ['GLM-5', 'DeepSeek-V3.2', 'Kimi-K2'],
    );
  });

  it('GET /api/maas-models prefers cache when refresh header is not set', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');
    await seedHuaweiSession();

    mkdirSync(join(projectRoot, '.office-claw'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.office-claw', 'model.json'),
      JSON.stringify(
        {
          'huawei-maas': [
            {
              id: 'cached-model',
              name: 'Cached Model',
              description: 'from cache',
            },
          ],
        },
        null,
        2,
      ),
    );

    let fetchCount = 0;
    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            data: [{ id: 'remote-model', name: 'Remote Model' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
      headers: {
        'x-office-claw-user': 'demo-user',
      },
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.equal(fetchCount, 0);
    assert.ok(Array.isArray(listBody.list));
  });

  it('GET /api/maas-models bypasses cache when refresh header is true', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');
    await seedHuaweiSession();

    mkdirSync(join(projectRoot, '.office-claw'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.office-claw', 'model.json'),
      JSON.stringify(
        {
          'huawei-maas': [
            {
              id: 'cached-model',
              name: 'Cached Model',
            },
          ],
        },
        null,
        2,
      ),
    );

    let fetchCount = 0;
    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            data: [{ id: 'remote-model', name: 'Remote Model' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
      headers: {
        'x-office-claw-user': 'demo-user',
        'x-refresh': 'true',
      },
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.equal(fetchCount, 2);
    assert.ok(Array.isArray(listBody.list));
  });

  it('GET /api/maas-models refresh stores each MaaS model baseUrl', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');
    await seedHuaweiSession();

    const requestedUrls = [];
    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async (url) => {
        requestedUrls.push(String(url));
        const baseUrl = String(url).replace(/\/models$/, '');
        return new Response(
          JSON.stringify({
            data: baseUrl.endsWith('/v2')
              ? [{ id: 'glm-5', name: 'GLM-5' }]
              : [{ id: 'glm-5.1', name: 'GLM-5.1' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
      headers: {
        'x-office-claw-user': 'demo-user',
        'x-refresh': 'true',
      },
    });

    assert.equal(listRes.statusCode, 200);
    assert.deepEqual(requestedUrls, ['https://maas.example.com/v2/models', 'https://maas.example.com/v1/models']);
    const listBody = JSON.parse(listRes.body);
    assert.equal(
      listBody.list.find((item) => item.name === 'GLM-5')?.baseUrl,
      'https://maas.example.com/v2',
    );
    assert.equal(
      listBody.list.find((item) => item.name === 'GLM-5.1')?.baseUrl,
      'https://maas.example.com/v1',
    );

    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.deepEqual(modelJson['huawei-maas'], [
      { id: 'glm-5', name: 'GLM-5', baseUrl: 'https://maas.example.com/v2' },
      { id: 'glm-5.1', name: 'GLM-5.1', baseUrl: 'https://maas.example.com/v1' },
    ]);
  });

  it('POST /api/maas-models-query proxies v2 and v1 model lists with bearer auth', async () => {
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const requestedUrls = [];
    const requestedAuths = [];
    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async (url, init) => {
        requestedUrls.push(String(url));
        requestedAuths.push(init?.headers?.Authorization ?? init?.headers?.authorization ?? '');
        const baseUrl = String(url).replace(/\/models$/, '');
        return new Response(
          JSON.stringify({
            data: baseUrl.endsWith('/v2')
              ? [
                  { id: 'glm-5', name: 'GLM-5', object: 'model' },
                  { id: 'deepseek-v3.2' },
                  { name: 'missing id' },
                ]
              : [{ id: 'legacy-v1-model', name: 'Legacy V1 Model', object: 'model' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/maas-models-query',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.modelarts-maas.com/openai/v1/',
        apiKey: 'maas-secret',
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(requestedUrls, [
      'https://api.modelarts-maas.com/openai/v2/models',
      'https://api.modelarts-maas.com/openai/v1/models',
    ]);
    assert.deepEqual(requestedAuths, ['Bearer maas-secret', 'Bearer maas-secret']);
    assert.deepEqual(JSON.parse(res.body), {
      models: [
        { id: 'glm-5', name: 'GLM-5', object: 'model', baseUrl: 'https://api.modelarts-maas.com/openai/v2' },
        {
          id: 'deepseek-v3.2',
          name: 'deepseek-v3.2',
          object: 'model',
          baseUrl: 'https://api.modelarts-maas.com/openai/v2',
        },
        {
          id: 'legacy-v1-model',
          name: 'Legacy V1 Model',
          object: 'model',
          baseUrl: 'https://api.modelarts-maas.com/openai/v1',
        },
      ],
    });
  });

  it('POST /api/maas-models-query keeps a pasted bearer authorization value valid', async () => {
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const requestedUrls = [];
    const requestedAuths = [];
    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async (url, init) => {
        requestedUrls.push(String(url));
        requestedAuths.push(init?.headers?.Authorization ?? init?.headers?.authorization ?? '');
        return new Response(JSON.stringify({ data: [{ id: 'glm-5' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/maas-models-query',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.modelarts-maas.com',
        apiKey: 'Bearer maas-secret',
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(requestedUrls, [
      'https://api.modelarts-maas.com/v2/models',
      'https://api.modelarts-maas.com/v1/models',
    ]);
    assert.deepEqual(requestedAuths, ['Bearer maas-secret', 'Bearer maas-secret']);
  });

  it('POST /api/maas-test-connection retries ModelArts MaaS v2 and v1 using the stored key', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const requestedUrls = [];
    const requestedAuths = [];
    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);
    await app.register(maasModelsRoutes, {
      fetchImpl: async (url, init) => {
        requestedUrls.push(String(url));
        requestedAuths.push(init?.headers?.Authorization ?? init?.headers?.authorization ?? '');
        if (String(url) === 'https://api.modelarts-maas.com/v1/chat/completions') {
          return new Response(JSON.stringify({ id: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'paygo-source',
        displayName: 'Paygo Source',
        baseUrl: 'https://api.modelarts-maas.com',
        apiKey: 'sk-stored',
        serviceType: 'maas',
        models: ['legacy-v1-model'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    const testRes = await app.inject({
      method: 'POST',
      url: '/api/maas-test-connection',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'paygo-source',
        baseUrl: 'https://api.modelarts-maas.com',
        apiKey: '••••••••',
        model: 'legacy-v1-model',
      }),
    });

    assert.equal(testRes.statusCode, 200);
    assert.deepEqual(JSON.parse(testRes.body), {
      success: true,
      baseUrl: 'https://api.modelarts-maas.com/v1',
    });
    assert.deepEqual(requestedUrls, [
      'https://api.modelarts-maas.com/chat/completions',
      'https://api.modelarts-maas.com/v2/chat/completions',
      'https://api.modelarts-maas.com/v1/chat/completions',
    ]);
    assert.deepEqual(requestedAuths, ['Bearer sk-stored', 'Bearer sk-stored', 'Bearer sk-stored']);
  });

  it('POST /api/maas-models-query validates required fields', async () => {
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/maas-models-query',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://api.modelarts-maas.com' }),
    });

    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /Missing baseUrl or apiKey/);
  });

  it('POST /api/maas-models-query passes through upstream auth errors', async () => {
    const Fastify = (await import('fastify')).default;
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(maasModelsRoutes, {
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/maas-models-query',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.modelarts-maas.com',
        apiKey: 'bad-key',
      }),
    });

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'HTTP 401: unauthorized');
  });

  it('Huawei MaaS credential env uses the current model baseUrl when cached', async () => {
    const { buildHuaweiMaaSProtocolEnv } = await import('../dist/config/plugins/protocol-credential-helpers.js');

    const env = buildHuaweiMaaSProtocolEnv(
      () => ({
        baseUrl: 'https://api.modelarts-maas.com/v2',
        apiKey: 'huawei-maas-session',
        defaultHeaders: { Authorization: 'Basic encoded' },
      }),
      {
        agentId: 'office',
        provider: 'relayclaw',
        defaultModel: 'legacy-v1-model',
        resolvedAccount: null,
        effectiveProtocol: 'huawei_maas',
        configProjectRoot: createProjectRoot(),
        userId: 'demo-user',
        agentConfig: {},
        boundAccountRef: 'huawei-maas',
        modelConfigBinding: {
          id: 'huawei-maas',
          protocol: 'huawei_maas',
          models: ['glm-5', 'legacy-v1-model'],
          modelBaseUrls: {
            'legacy-v1-model': 'https://api.modelarts-maas.com/v1',
          },
        },
      },
    );

    assert.equal(env.OPENAI_BASE_URL, 'https://api.modelarts-maas.com/v1');
    assert.equal(env.OPENAI_API_BASE, 'https://api.modelarts-maas.com/v1');
    assert.equal(env.OFFICE_CLAW_HUAWEI_MAAS_BASE_URL, 'https://api.modelarts-maas.com/v1');
  });

  it('PUT /api/model-config-profiles/:sourceId updates an existing source', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    // Create a source first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'test-source',
        displayName: 'Test Source',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-a', 'model-b'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    // Update displayName and models
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/test-source',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        displayName: 'Updated Source',
        models: ['model-a', 'model-c', 'model-d'],
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    assert.equal(updateBody.provider.id, 'test-source');
    assert.equal(updateBody.provider.displayName, 'Updated Source');
    assert.deepEqual(updateBody.provider.models, ['model-a', 'model-c', 'model-d']);

    // Verify the file was updated
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['test-source'].displayName, 'Updated Source');
    assert.deepEqual(modelJson['test-source'].models, [{ id: 'model-a' }, { id: 'model-c' }, { id: 'model-d' }]);
    // Verify baseUrl and apiKey remain unchanged
    assert.equal(modelJson['test-source'].baseUrl, 'https://api.example.com/v1');
    assert.equal(modelJson['test-source'].apiKey, 'sk-test');
  });

  it('POST and PUT /api/model-config-profiles persist serviceType', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);
    await app.register(maasModelsRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'huawei-service',
        displayName: 'Huawei MaaS',
        baseUrl: 'https://api.modelarts-maas.com/openai/v1',
        apiKey: 'sk-test',
        models: ['glm-5'],
        serviceType: 'maas',
      }),
    });
    assert.equal(createRes.statusCode, 201);
    const maasCreateBody = JSON.parse(createRes.body);
    assert.equal(maasCreateBody.provider.serviceType, 'maas');

    let modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['huawei-service'].serviceType, 'maas');
    assert.equal(modelJson['huawei-service'].baseUrl, 'https://api.modelarts-maas.com/v2');

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/huawei-service',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        baseUrl: 'https://api.modelarts-maas.com/coding/v2',
        serviceType: 'claw-plan',
      }),
    });
    assert.equal(updateRes.statusCode, 200);
    assert.equal(JSON.parse(updateRes.body).provider.serviceType, 'claw-plan');

    modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['huawei-service'].serviceType, 'claw-plan');
    assert.equal(modelJson['huawei-service'].displayName, 'Huawei MaaS');
    assert.equal(modelJson['huawei-service'].baseUrl, 'https://api.modelarts-maas.com/plan');

    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/model-config-profiles?projectPath=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(profileRes.statusCode, 200);
    const profile = JSON.parse(profileRes.body).providers.find((item) => item.id === 'huawei-service');
    assert.equal(profile.serviceType, 'claw-plan');
    assert.equal(profile.baseUrl, 'https://api.modelarts-maas.com/plan');

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(listRes.statusCode, 200);
    const listItem = JSON.parse(listRes.body).list.find((item) => item.id === 'model_config:huawei-service:glm-5');
    assert.equal(listItem.serviceType, 'claw-plan');
    assert.equal(listItem.baseUrl, 'https://api.modelarts-maas.com/plan');
  });

  it('POST /api/model-config-profiles normalizes legacy CodingPlan values to Claw Plan', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'legacy-claw-plan',
        displayName: 'CodingPlan',
        baseUrl: 'https://api.modelarts-maas.com/coding/v2',
        apiKey: 'sk-test',
        models: ['glm-5'],
        serviceType: 'claw-plan',
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.equal(createBody.provider.displayName, 'Claw Plan');
    assert.equal(createBody.provider.serviceType, 'claw-plan');

    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['legacy-claw-plan'].displayName, 'Claw Plan');
    assert.equal(modelJson['legacy-claw-plan'].baseUrl, 'https://api.modelarts-maas.com/plan');
    assert.equal(modelJson['legacy-claw-plan'].serviceType, 'claw-plan');
  });

  it('PUT /api/model-config-profiles/:sourceId updates baseUrl and apiKey', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    // Create a source first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'test-source-2',
        displayName: 'Test Source 2',
        baseUrl: 'https://old-api.example.com/v1',
        apiKey: 'sk-old',
        models: ['model-x'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    // Update baseUrl and apiKey
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/test-source-2',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        baseUrl: 'https://new-api.example.com/v2',
        apiKey: 'sk-new-key',
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    assert.equal(updateBody.provider.id, 'test-source-2');

    // Verify the file was updated
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['test-source-2'].baseUrl, 'https://new-api.example.com/v2');
    assert.equal(modelJson['test-source-2'].apiKey, 'sk-new-key');
    // Verify other fields remain unchanged
    assert.equal(modelJson['test-source-2'].displayName, 'Test Source 2');
  });

  it('PUT /api/model-config-profiles/:sourceId returns 404 for non-existent source', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/non-existent',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        displayName: 'Should Not Work',
      }),
    });

    assert.equal(updateRes.statusCode, 400);
    const updateBody = JSON.parse(updateRes.body);
    assert.ok(updateBody.error.includes('not found'));
  });

  it('PUT /api/model-config-profiles/:sourceId rejects huawei-maas source', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/huawei-maas',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        displayName: 'Should Not Work',
      }),
    });

    assert.equal(updateRes.statusCode, 400);
    const updateBody = JSON.parse(updateRes.body);
    assert.ok(updateBody.error.includes('cannot be updated'));
  });

  it('DELETE /api/model-config-profiles/:sourceId deletes a source', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    // Create a source first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'to-delete',
        displayName: 'To Delete',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-delete',
        models: ['model-1'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    // Delete the source
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/model-config-profiles/to-delete?projectPath=${encodeURIComponent(projectRoot)}`,
    });

    assert.equal(deleteRes.statusCode, 200);
    const deleteBody = JSON.parse(deleteRes.body);
    assert.equal(deleteBody.success, true);

    // Verify the source is gone from the file
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['to-delete'], undefined);
  });

  // ─── description and icon field tests ────────────────────

  it('POST /api/model-config-profiles creates source with description and icon', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'with-desc-icon',
        displayName: 'Test Model',
        description: 'A test model description',
        icon: '/images/test.svg',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-1'],
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    assert.equal(createBody.provider.description, 'A test model description');
    assert.equal(createBody.provider.icon, '/images/test.svg');

    // Verify persisted in file
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['with-desc-icon'].description, 'A test model description');
    assert.equal(modelJson['with-desc-icon'].icon, '/images/test.svg');
  });

  it('POST /api/model-config-profiles creates source without displayName (uses id as fallback)', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'no-display-name',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-1'],
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const createBody = JSON.parse(createRes.body);
    // displayName should fallback to id
    assert.equal(createBody.provider.displayName, 'no-display-name');
    assert.equal(createBody.provider.name, 'no-display-name');
  });

  it('PUT /api/model-config-profiles/:sourceId clears description and icon with null', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    // Create with description and icon
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'clear-fields',
        displayName: 'Test',
        description: 'Original description',
        icon: '/images/original.svg',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-1'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    // Clear description and icon
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/clear-fields',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        description: null,
        icon: null,
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    assert.equal(updateBody.provider.description, undefined);
    assert.equal(updateBody.provider.icon, undefined);

    // Verify cleared in file
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['clear-fields'].description, undefined);
    assert.equal(modelJson['clear-fields'].icon, undefined);
  });

  it('PUT /api/model-config-profiles/:sourceId updates one model description and icon without changing siblings', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');
    const { maasModelsRoutes } = await import('../dist/routes/maas-models.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);
    await app.register(maasModelsRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'multi-model-metadata',
        displayName: 'Multi Model',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-a', 'model-b'],
        modelDescriptions: {
          'model-a': 'old a',
          'model-b': 'old b',
        },
        modelIcons: {
          'model-a': '/images/a.svg',
          'model-b': '/images/b.svg',
        },
      }),
    });
    assert.equal(createRes.statusCode, 201);

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/multi-model-metadata',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        models: ['model-a', 'model-b'],
        modelDescriptions: {
          'model-a': 'new a',
          'model-b': 'old b',
        },
        modelIcons: {
          'model-a': '/images/new-a.svg',
          'model-b': '/images/b.svg',
        },
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    assert.deepEqual(updateBody.provider.modelDescriptions, {
      'model-a': 'new a',
      'model-b': 'old b',
    });
    assert.deepEqual(updateBody.provider.modelIcons, {
      'model-a': '/images/new-a.svg',
      'model-b': '/images/b.svg',
    });

    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.deepEqual(modelJson['multi-model-metadata'].models, [
      { id: 'model-a', description: 'new a', icon: '/images/new-a.svg' },
      { id: 'model-b', description: 'old b', icon: '/images/b.svg' },
    ]);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/maas-models?projectPath=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.equal(
      listBody.list.find((item) => item.id === 'model_config:multi-model-metadata:model-a')?.description,
      'new a',
    );
    assert.equal(
      listBody.list.find((item) => item.id === 'model_config:multi-model-metadata:model-b')?.description,
      'old b',
    );
  });

  it('PUT /api/model-config-profiles/:sourceId clears displayName to empty string (uses id as fallback)', async () => {
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    // Create with displayName
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'clear-display',
        displayName: 'Original Display Name',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        models: ['model-1'],
      }),
    });
    assert.equal(createRes.statusCode, 201);

    // Clear displayName (empty string)
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/clear-display',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        displayName: '',
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const updateBody = JSON.parse(updateRes.body);
    // displayName should fallback to id when cleared
    assert.equal(updateBody.provider.displayName, 'clear-display');

    // Verify in file - displayName should be set to id (fallback behavior)
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['clear-display'].displayName, 'clear-display');
  });

  it('POST /api/model-config-profiles stores apiKey as ref when secret storage is enabled', async () => {
    const { backend } = createMemoryBackend();
    setLocalSecretBackendForTests(backend);
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'secret-proxy',
        displayName: 'Secret Proxy',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-secret-proxy',
        models: ['gpt-4o-mini'],
      }),
    });

    assert.equal(createRes.statusCode, 201);
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(typeof modelJson['secret-proxy'].apiKeyRef, 'string');
    assert.equal(modelJson['secret-proxy'].apiKey, undefined);
    assert.ok(!JSON.stringify(modelJson).includes('sk-secret-proxy'));
  });

  it('GET /api/model-config-profiles returns masked apiKey without plaintext', async () => {
    const { backend } = createMemoryBackend();
    setLocalSecretBackendForTests(backend);
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'masked-proxy',
        displayName: 'Masked Proxy',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-masked',
        models: ['gpt-4o-mini'],
      }),
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/model-config-profiles?projectPath=${encodeURIComponent(projectRoot)}`,
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    const provider = listBody.providers.find((item) => item.id === 'masked-proxy');
    assert.ok(provider);
    assert.equal(provider.hasApiKey, true);
    assert.equal(provider.apiKey, 'sk-m****sked');
    assert.ok(!listRes.body.includes('sk-masked'));
  });

  it('PUT /api/model-config-profiles/:sourceId keeps existing apiKey when masked value is submitted', async () => {
    const { backend, store } = createMemoryBackend();
    setLocalSecretBackendForTests(backend);
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'masked-update',
        displayName: 'Masked Update',
        baseUrl: 'https://proxy.example.com/v1',
        apiKey: 'sk-original-secret',
        models: ['gpt-4o-mini'],
      }),
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/model-config-profiles?projectPath=${encodeURIComponent(projectRoot)}`,
    });
    assert.equal(listRes.statusCode, 200);
    const maskedApiKey = JSON.parse(listRes.body).providers.find((item) => item.id === 'masked-update').apiKey;
    assert.equal(maskedApiKey, 'sk-o****cret');

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/masked-update',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        displayName: 'Masked Update Renamed',
        apiKey: maskedApiKey,
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    assert.equal(JSON.parse(updateRes.body).provider.apiKey, maskedApiKey);
    assert.equal([...store.values()][0], 'sk-original-secret');
  });

  it('PUT /api/model-config-profiles/:sourceId keeps apiKeyRef when secret storage is enabled', async () => {
    const { backend } = createMemoryBackend();
    setLocalSecretBackendForTests(backend);
    const projectRoot = createProjectRoot();
    const Fastify = (await import('fastify')).default;
    const { modelConfigProfilesRoutes } = await import('../dist/routes/model-config-profiles.js');

    const app = Fastify();
    await app.register(modelConfigProfilesRoutes);

    await app.inject({
      method: 'POST',
      url: '/api/model-config-profiles',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        sourceId: 'test-source-ref',
        displayName: 'Test Source Ref',
        baseUrl: 'https://old-api.example.com/v1',
        apiKey: 'sk-old',
        models: ['model-x'],
      }),
    });

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/model-config-profiles/test-source-ref',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectRoot,
        baseUrl: 'https://new-api.example.com/v2',
        apiKey: 'sk-new-key',
      }),
    });

    assert.equal(updateRes.statusCode, 200);
    const modelJson = JSON.parse(readFileSync(join(projectRoot, '.office-claw', 'model.json'), 'utf-8'));
    assert.equal(modelJson['test-source-ref'].baseUrl, 'https://new-api.example.com/v2');
    assert.equal(typeof modelJson['test-source-ref'].apiKeyRef, 'string');
    assert.equal(modelJson['test-source-ref'].apiKey, undefined);
  });
});
