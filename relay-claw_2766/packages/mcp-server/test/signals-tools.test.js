/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('Retired MCP signal tools', () => {
  test('signal tools stay absent from the MCP package', async () => {
    const sourcePath = new URL('../src/tools/signals-tools.ts', import.meta.url);
    const distPath = new URL('../dist/tools/signals-tools.js', import.meta.url);

    assert.equal(existsSync(sourcePath), false);
    assert.equal(existsSync(distPath), false);
  });

  test('registerSignalToolset remains a no-op compatibility export', async () => {
    const { registerSignalToolset } = await import('../dist/server-toolsets.js');
    const server = new McpServer({ name: 'test-signals', version: '0.0.0' });

    registerSignalToolset(server);

    assert.deepEqual(Object.keys(server._registeredTools), []);
  });
});
