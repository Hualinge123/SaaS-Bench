/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pkg from '@opentelemetry/sdk-metrics';
import Fastify from 'fastify';

const { InMemoryMetricExporter, PeriodicExportingMetricReader, MeterProvider } = pkg;

import { metrics } from '@opentelemetry/api';

const { registerTelemetryHook } = await import('../dist/infrastructure/telemetry/fastify-hook.js');

describe('x-userid metric label', () => {
  let app: Fastify.FastifyInstance;
  let exporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider;

  before(async () => {
    exporter = new InMemoryMetricExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 50, // Short interval for faster tests
    });

    // Create a meter provider for testing
    meterProvider = new MeterProvider({
      readers: [reader],
    });

    // Set the global meter provider
    metrics.setGlobalMeterProvider(meterProvider);

    app = Fastify();
    app.get('/test', async () => ({ ok: true }));
    // Error route that returns 500 status
    app.get('/error', async () => {
      throw new Error('test error');
    });
    registerTelemetryHook(app);
    await app.ready();
  });

  after(async () => {
    await app.close();
    await meterProvider.shutdown();
  });

  // Helper to wait for metrics and get request.count data points
  async function getRequestCountDataPoints() {
    // Wait for export
    await new Promise((resolve) => setTimeout(resolve, 100));

    const allExports = exporter.getMetrics();
    // Get the latest export
    const latest = allExports[allExports.length - 1];
    if (!latest) return [];

    const scopeMetrics = latest.scopeMetrics?.[0]?.metrics;
    if (!scopeMetrics) return [];

    const requestCounter = scopeMetrics.find((m) => m.descriptor.name === 'jiuwenclaw.request.count');
    return requestCounter?.dataPoints ?? [];
  }

  // Helper to wait for metrics and get request.duration data points
  async function getRequestDurationDataPoints() {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const allExports = exporter.getMetrics();
    const latest = allExports[allExports.length - 1];
    if (!latest) return [];

    const scopeMetrics = latest.scopeMetrics?.[0]?.metrics;
    if (!scopeMetrics) return [];

    const durationMetric = scopeMetrics.find((m) => m.descriptor.name === 'jiuwenclaw.request.duration');
    return durationMetric?.dataPoints ?? [];
  }

  // Helper to wait for metrics and get request.error.count data points
  async function getRequestErrorCountDataPoints() {
    await new Promise((resolve) => setTimeout(resolve, 100));

    const allExports = exporter.getMetrics();
    const latest = allExports[allExports.length - 1];
    if (!latest) return [];

    const scopeMetrics = latest.scopeMetrics?.[0]?.metrics;
    if (!scopeMetrics) return [];

    const errorCounter = scopeMetrics.find((m) => m.descriptor.name === 'officeclaw.request.error.count');
    return errorCounter?.dataPoints ?? [];
  }

  test('should include officeclaw.user.id when x-userid header present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-userid': 'alice' },
    });

    assert.equal(response.statusCode, 200);

    const dataPoints = await getRequestCountDataPoints();
    assert.ok(dataPoints.length > 0, 'Should have data points');

    const dataPoint = dataPoints.find(
      (dp) => dp.attributes['http.route'] === '/test' && dp.attributes['http.method'] === 'GET',
    );

    assert.ok(dataPoint, 'Should have data point for /test route');
    assert.equal(dataPoint?.attributes['officeclaw.user.id'], 'alice', 'Should include userId label');
  });

  test('should exclude officeclaw.user.id when x-userid header absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      // No x-userid header
    });

    assert.equal(response.statusCode, 200);

    const dataPoints = await getRequestCountDataPoints();

    // Find data point without userId attribute
    const dataPointWithoutUserId = dataPoints.find(
      (dp) =>
        dp.attributes['http.route'] === '/test' &&
        dp.attributes['http.method'] === 'GET' &&
        !('officeclaw.user.id' in dp.attributes),
    );

    assert.ok(dataPointWithoutUserId, 'Should have data point without userId label');
  });

  test('should include userId in request.duration metric', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-userid': 'bob' },
    });

    assert.equal(response.statusCode, 200);

    const dataPoints = await getRequestDurationDataPoints();
    assert.ok(dataPoints.length > 0, 'Should have duration data points');

    const dataPoint = dataPoints.find(
      (dp) => dp.attributes['http.route'] === '/test' && dp.attributes['http.method'] === 'GET',
    );

    assert.ok(dataPoint, 'Should have duration data point for /test route');
    assert.equal(dataPoint?.attributes['officeclaw.user.id'], 'bob', 'Should include userId label in duration metric');
  });

  test('should include userId in request.error.count metric', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/error',
      headers: { 'x-userid': 'charlie' },
    });

    assert.equal(response.statusCode, 500);

    const dataPoints = await getRequestErrorCountDataPoints();
    assert.ok(dataPoints.length > 0, 'Should have error count data points');

    const dataPoint = dataPoints.find(
      (dp) => dp.attributes['http.route'] === '/error' && dp.attributes['http.method'] === 'GET',
    );

    assert.ok(dataPoint, 'Should have error count data point for /error route');
    assert.equal(
      dataPoint?.attributes['officeclaw.user.id'],
      'charlie',
      'Should include userId label in error count metric',
    );
  });
});
