import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { createTelemetryModule } = await import('../dist/infrastructure/telemetry/telemetry-module.js');

describe('telemetry provider e2e', () => {
  function createDemoProvider() {
    return {
      id: 'demo-telemetry',
      displayName: 'Demo Telemetry',
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
        return { export: () => {}, shutdown: async () => {} };
      },
      createMetricReader() {
        return null;
      },
      createResource() {
        return { attributes: { 'service.name': 'demo-service' } };
      },
      getInstrumentations() {
        return [];
      },
    };
  }

  test('loads and bootstraps external provider', async () => {
    const demoProvider = createDemoProvider();
    const module = await createTelemetryModule({
      env: {
        OFFICE_CLAW_TELEMETRY_PROVIDER: 'demo-telemetry',
        OFFICE_CLAW_TELEMETRY_PROVIDER_MODULES: '@test/demo',
      },
      moduleLoader: async (specifier) => {
        if (specifier === '@test/demo') return { default: demoProvider };
        throw new Error(`Unknown: ${specifier}`);
      },
    });
    assert.equal(module.activeProviderId, 'demo-telemetry');
    assert.equal(demoProvider.bootstrapCalled, true);
  });

  test('selects builtin-telemetry by default', async () => {
    const module = await createTelemetryModule({ env: {} });
    assert.equal(module.activeProviderId, 'builtin-telemetry');
  });

  test('throws on unknown provider', async () => {
    await assert.rejects(
      () =>
        createTelemetryModule({
          env: { OFFICE_CLAW_TELEMETRY_PROVIDER: 'unknown' },
        }),
      /not found/,
    );
  });

  test('provider methods called during init', async () => {
    const demoProvider = createDemoProvider();
    const module = await createTelemetryModule({
      env: { OFFICE_CLAW_TELEMETRY_PROVIDER: 'demo-telemetry' },
      providers: [demoProvider],
    });
    const provider = module.getActiveProvider();
    provider.createTraceExporter?.();
    assert.equal(demoProvider.traceExporterCreated, true);
  });

  test('supports named export telemetryProvider', async () => {
    const provider = { id: 'named', displayName: 'Named' };
    const module = await createTelemetryModule({
      env: {
        OFFICE_CLAW_TELEMETRY_PROVIDER: 'named',
        OFFICE_CLAW_TELEMETRY_PROVIDER_MODULES: '@test/named',
      },
      moduleLoader: async () => ({ telemetryProvider: provider }),
    });
    assert.equal(module.activeProviderId, 'named');
  });

  test('supports telemetryProviders array', async () => {
    const providers = [
      { id: 'a', displayName: 'A' },
      { id: 'b', displayName: 'B' },
    ];
    const module = await createTelemetryModule({
      env: {
        OFFICE_CLAW_TELEMETRY_PROVIDER: 'a',
        OFFICE_CLAW_TELEMETRY_PROVIDER_MODULES: '@test/array',
      },
      moduleLoader: async () => ({ telemetryProviders: providers }),
    });
    assert.ok(module.providerRegistry.has('a'));
    assert.ok(module.providerRegistry.has('b'));
  });

  test('backward compat: OTEL_* with builtin', async () => {
    const module = await createTelemetryModule({
      env: {
        OTEL_ENABLED: 'true',
        OTEL_EXPORTER_TYPE: 'console',
        OTEL_SERVICE_NAME: 'test-name',
      },
    });
    const provider = module.getActiveProvider();
    assert.equal(provider.id, 'builtin-telemetry');
    const resource = provider.createResource?.();
    assert.equal(resource?.attributes?.['service.name'], 'test-name');
  });
});