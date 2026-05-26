/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resourceFromAttributes } from '@opentelemetry/resources';

const { ResourceAttributesProcessor } = await import('../dist/infrastructure/telemetry/resource-attributes-processor.js');

describe('ResourceAttributesProcessor', () => {
  test('should inject resource attributes into metric attributes', () => {
    const resource = resourceFromAttributes({ 'service.name': 'test-service' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.deepEqual(result, {
      'service.name': 'test-service',
      'http.method': 'GET',
    });
  });

  test('should not override existing attributes', () => {
    const resource = resourceFromAttributes({ 'http.method': 'POST' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.equal(result['http.method'], 'GET');
  });

  test('should handle empty resource', () => {
    const resource = resourceFromAttributes({});
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.deepEqual(result, { 'http.method': 'GET' });
  });
});