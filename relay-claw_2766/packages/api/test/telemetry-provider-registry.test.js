import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { TelemetryProviderRegistry } = await import('../dist/infrastructure/telemetry/provider-registry.js');

describe('TelemetryProviderRegistry', () => {
  test('register and get provider', () => {
    const registry = new TelemetryProviderRegistry();
    const provider = {
      id: 'test-provider',
      displayName: 'Test Provider',
    };
    registry.register(provider);
    assert.ok(registry.has('test-provider'));
    assert.equal(registry.get('test-provider').id, 'test-provider');
  });

  test('throws on duplicate registration', () => {
    const registry = new TelemetryProviderRegistry();
    const provider = {
      id: 'duplicate',
      displayName: 'Duplicate Provider',
    };
    registry.register(provider);
    assert.throws(() => registry.register(provider), /already registered/);
  });

  test('throws on unknown provider', () => {
    const registry = new TelemetryProviderRegistry();
    assert.throws(() => registry.get('unknown'), /not found/);
  });

  test('listIds returns all registered ids', () => {
    const registry = new TelemetryProviderRegistry();
    registry.register({ id: 'a', displayName: 'A' });
    registry.register({ id: 'b', displayName: 'B' });
    assert.deepEqual(registry.listIds(), ['a', 'b']);
  });

  test('registerModule collects default export', async () => {
    const registry = new TelemetryProviderRegistry();
    const provider = { id: 'default-export', displayName: 'Default Export' };
    await registry.registerModule('test-module', async () => ({ default: provider }));
    assert.ok(registry.has('default-export'));
  });

  test('registerModule collects named telemetryProvider export', async () => {
    const registry = new TelemetryProviderRegistry();
    const provider = { id: 'named-export', displayName: 'Named Export' };
    await registry.registerModule('test-module', async () => ({ telemetryProvider: provider }));
    assert.ok(registry.has('named-export'));
  });

  test('registerModule collects telemetryProviders array', async () => {
    const registry = new TelemetryProviderRegistry();
    const providers = [
      { id: 'array-a', displayName: 'Array A' },
      { id: 'array-b', displayName: 'Array B' },
    ];
    await registry.registerModule('test-module', async () => ({ telemetryProviders: providers }));
    assert.ok(registry.has('array-a'));
    assert.ok(registry.has('array-b'));
  });

  test('registerModule throws on no providers', async () => {
    const registry = new TelemetryProviderRegistry();
    await assert.rejects(
      () => registry.registerModule('empty-module', async () => ({ foo: 'bar' })),
      /exported no telemetry providers/
    );
  });

  test('duck-type check ignores invalid objects', async () => {
    const registry = new TelemetryProviderRegistry();
    // Missing displayName
    await assert.rejects(
      () => registry.registerModule('invalid', async () => ({ default: { id: 'test' } })),
      /exported no telemetry providers/
    );
    // Missing id
    await assert.rejects(
      () => registry.registerModule('invalid2', async () => ({ default: { displayName: 'Test' } })),
      /exported no telemetry providers/
    );
  });
});