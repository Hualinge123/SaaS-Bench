/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Custom telemetry provider fixture for E2E testing.
 */

export default {
  id: 'custom-telemetry',
  displayName: 'Custom Telemetry Provider',

  bootstrapCalled: false,
  async bootstrap() {
    this.bootstrapCalled = true;
  },

  shutdownCalled: false,
  async shutdown() {
    this.shutdownCalled = true;
  },

  traceExporterCreated: false,
  createTraceExporter() {
    this.traceExporterCreated = true;
    // Mock exporter
    return {
      export: (span, resultCallback) => resultCallback?.({ code: 0 }),
      shutdown: async () => {},
    };
  },

  createMetricReader() {
    return null; // Disable metrics in this fixture
  },

  createResource() {
    return {
      attributes: {
        'service.name': 'test-service',
        'test.attribute': 'fixture-value',
      },
    };
  },

  getInstrumentations() {
    return []; // No auto-instrumentation
  },
};