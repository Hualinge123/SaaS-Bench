/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';

const { createAuthModule } = await import('../dist/auth/module.js');
const { createMetricsModule } = await import('../dist/metrics/module.js');

const greenPackageRoot = resolve(new URL('.', import.meta.url).pathname, '../../green-package/api/dist');

function greenPackageDistUrl(subpath) {
  return pathToFileURL(resolve(greenPackageRoot, subpath)).href;
}

describe('green-package provider plugins', () => {
  test('loads Huawei auth providers through the API external provider registry', async () => {
    const providersPluginUrl = greenPackageDistUrl('providers-plugin.js');
    const authModule = await createAuthModule({
      env: {
        OFFICE_CLAW_AUTH_PROVIDER: 'huawei-iam',
        OFFICE_CLAW_AUTH_PROVIDER_MODULES: providersPluginUrl,
      },
    });

    assert.equal(authModule.activeProviderId, 'huawei-iam');
    assert.equal(authModule.getActiveProvider().id, 'huawei-iam');
    assert.ok(authModule.providerRegistry.has('huawei-iam'));
    assert.ok(authModule.providerRegistry.has('huawei-cas'));
    assert.ok(authModule.providerRegistry.has('no-auth'));
  });

  test('loads AOM metrics provider through the API external metrics registry', async () => {
    const metricsPluginUrl = greenPackageDistUrl('metrics-plugin.js');
    const metricsModule = await createMetricsModule({
      env: {
        OFFICE_CLAW_METRICS_PROVIDER: 'aom',
        OFFICE_CLAW_METRICS_PROVIDER_MODULES: metricsPluginUrl,
      },
    });

    assert.equal(metricsModule.activeProviderId, 'aom');
    assert.equal(metricsModule.getActiveProvider().id, 'aom');
    assert.deepEqual(metricsModule.providerRegistry.listIds().sort(), ['aom', 'noop']);
  });
});
