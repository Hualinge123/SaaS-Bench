/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { AgentRegistry } = await import('../dist/domains/agents/services/agents/registry/AgentRegistry.js');
const { AgentRegistrySynchronizer } = await import(
  '../dist/domains/agents/services/agents/registry/AgentRegistrySynchronizer.js'
);

function createConfig(overrides = {}) {
  return {
    id: 'office',
    name: 'Office',
    displayName: 'Office',
    avatar: 'office.png',
    color: 'blue',
    mentionPatterns: ['@office'],
    provider: 'relayclaw',
    defaultModel: 'gpt-5.4',
    mcpSupport: true,
    contextBudget: { maxPromptTokens: 1000 },
    roleDescription: 'Office agent',
    personality: 'Helpful',
    ...overrides,
  };
}

function createDisposableService(onDispose) {
  return {
    async *invoke() {
      yield { type: 'done', agentId: 'office', timestamp: Date.now() };
    },
    dispose: onDispose,
  };
}

describe('AgentRegistrySynchronizer', () => {
  it('reuses an existing service when only presentation fields change', async () => {
    const registry = new AgentRegistry();
    let createCount = 0;
    let disposeCount = 0;
    const synchronizer = new AgentRegistrySynchronizer({
      registry,
      createService: async () => {
        createCount++;
        return createDisposableService(() => {
          disposeCount++;
        });
      },
    });

    await synchronizer.sync({ office: createConfig() });
    const firstService = registry.get('office');

    await synchronizer.sync({
      office: createConfig({
        name: 'Office Prime',
        displayName: 'Office Prime',
        nickname: 'Prime',
        avatar: 'office-prime.png',
        color: 'green',
        mentionPatterns: ['@office-prime'],
        roleDescription: 'Updated roster copy',
        personality: 'Still helpful',
      }),
    });

    assert.equal(registry.get('office'), firstService);
    assert.equal(createCount, 1);
    assert.equal(disposeCount, 0);
  });

  it('recreates and disposes an existing service when runtime fields change', async () => {
    const registry = new AgentRegistry();
    let disposeCount = 0;
    const synchronizer = new AgentRegistrySynchronizer({
      registry,
      createService: async () =>
        createDisposableService(() => {
          disposeCount++;
        }),
    });

    await synchronizer.sync({ office: createConfig() });
    const firstService = registry.get('office');

    await synchronizer.sync({ office: createConfig({ defaultModel: 'gpt-5.5' }) });

    assert.notEqual(registry.get('office'), firstService);
    assert.equal(disposeCount, 1);
  });

  it('serializes overlapping sync calls', async () => {
    const registry = new AgentRegistry();
    const order = [];
    let releaseFirst;
    let resolveFirstStarted;
    const firstStarted = new Promise((resolve) => {
      resolveFirstStarted = resolve;
    });
    const synchronizer = new AgentRegistrySynchronizer({
      registry,
      createService: async (_id, config) => {
        order.push(`create:${config.defaultModel}`);
        if (config.defaultModel === 'slow-model') {
          resolveFirstStarted();
          await new Promise((release) => {
            releaseFirst = release;
          });
        }
        return createDisposableService(() => {});
      },
    });

    const first = synchronizer.sync({ office: createConfig({ defaultModel: 'slow-model' }) });
    const second = synchronizer.sync({ office: createConfig({ defaultModel: 'fast-model' }) });
    const both = Promise.all([first, second]);

    await firstStarted;
    assert.deepEqual(order, ['create:slow-model']);

    releaseFirst();
    await both;

    assert.deepEqual(order, ['create:slow-model', 'create:fast-model']);
  });
});
