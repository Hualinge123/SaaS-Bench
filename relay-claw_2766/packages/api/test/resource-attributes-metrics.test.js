/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { InMemoryMetricExporter, PeriodicExportingMetricReader, InstrumentType, AggregationTemporality, } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
const { ResourceAttributesProcessor } = await import('../dist/infrastructure/telemetry/resource-attributes-processor.js');
const { getRequestCount } = await import('../dist/infrastructure/telemetry/metrics.js');
describe('Resource Attributes Metrics Integration', () => {
    let sdk;
    let exporter;
    before(async () => {
        exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
        const resource = resourceFromAttributes({
            [SEMRESATTRS_SERVICE_NAME]: 'test-officeclaw',
            'officeclaw.claw.id': 'test-claw-001',
        });
        // Note: In OpenTelemetry SDK 2.0+, NodeSDK accepts ViewOptions objects (not View instances)
        // and uses 'attributesProcessors' (plural, array) instead of 'attributesProcessor' (singular)
        sdk = new NodeSDK({
            resource,
            metricReader: new PeriodicExportingMetricReader({
                exporter,
                exportIntervalMillis: 100, // Fast export for testing
            }),
            views: [
                {
                    instrumentName: '*',
                    instrumentType: InstrumentType.COUNTER,
                    attributesProcessors: [new ResourceAttributesProcessor(resource)],
                },
            ],
        });
        await sdk.start();
    });
    after(async () => {
        await sdk.shutdown();
    });
    test('HTTP request counter includes resource attributes', async () => {
        // Record a metric like HTTP request does
        getRequestCount().add(1, {
            'http.method': 'POST',
            'http.route': '/api/messages',
        });
        // Wait for export
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Get exported metrics
        const resourceMetrics = exporter.getMetrics();
        assert.ok(resourceMetrics.length > 0, 'Should have exported metrics');
        // Navigate through scopeMetrics to find the actual metric
        const scopeMetrics = resourceMetrics[0].scopeMetrics;
        assert.ok(scopeMetrics.length > 0, 'Should have scope metrics');
        const requestCounter = scopeMetrics[0].metrics.find((m) => m.descriptor.name === 'jiuwenclaw.request.count');
        assert.ok(requestCounter, 'Should have request.count metric');
        // Check data point attributes include both resource and metric attributes
        const dataPoint = requestCounter.dataPoints[0];
        assert.equal(dataPoint.attributes['service.name'], 'test-officeclaw');
        assert.equal(dataPoint.attributes['officeclaw.claw.id'], 'test-claw-001');
        assert.equal(dataPoint.attributes['http.method'], 'POST');
        assert.equal(dataPoint.attributes['http.route'], '/api/messages');
    });
});
