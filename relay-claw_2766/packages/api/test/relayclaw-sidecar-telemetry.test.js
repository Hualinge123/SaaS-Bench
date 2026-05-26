/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { getJsonDelimiterDelta, shouldForwardSidecarTelemetryJson } = await import(
  '../dist/domains/agents/services/agents/providers/relayclaw-sidecar.js'
);

describe('relayclaw sidecar telemetry forwarding', () => {
  test('matches OpenTelemetry console span JSON blocks', () => {
    const block = `{
    "name": "jiuwenclaw.agent.invoke",
    "context": {
        "trace_id": "0xbf5e219de12c50115146a41ea9c14033",
        "span_id": "0x1234567890abcdef"
    },
    "parent_id": "0xa755df227cc767c6"
}`;

    assert.equal(shouldForwardSidecarTelemetryJson(block), true);
  });

  test('matches OpenTelemetry console metric JSON blocks', () => {
    const block = `{
    "resource_metrics": [
        {
            "scope_metrics": []
        }
    ]
}`;

    assert.equal(shouldForwardSidecarTelemetryJson(block), true);
  });

  test('ignores unrelated JSON blocks', () => {
    assert.equal(shouldForwardSidecarTelemetryJson('{"status":"ok"}'), false);
  });

  test('counts JSON delimiters while ignoring strings', () => {
    assert.equal(getJsonDelimiterDelta('{'), 1);
    assert.equal(getJsonDelimiterDelta('"payload": "{not a delimiter}"'), 0);
    assert.equal(getJsonDelimiterDelta('    "items": [{"name": "x"}]'), 0);
    assert.equal(getJsonDelimiterDelta('}'), -1);
  });
});
