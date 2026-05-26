/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Telemetry Provider Registry.
 * Mirrors AuthProviderRegistry pattern.
 */

import type { TelemetryProvider } from '@openjiuwen/relay-api-server-contracts/telemetry-provider';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Duck-type check — validates id and displayName only. */
function isTelemetryProvider(value: unknown): value is TelemetryProvider {
  return isRecord(value) && typeof value.id === 'string' && typeof value.displayName === 'string';
}

/** Collect providers from an ESM module's exports. */
function collectModuleProviders(namespace: unknown): TelemetryProvider[] {
  if (!isRecord(namespace)) return [];

  const providers: TelemetryProvider[] = [];

  // 1. default export
  const defaultExport = namespace.default;
  if (isTelemetryProvider(defaultExport)) providers.push(defaultExport);

  // 2. named export: telemetryProvider
  const namedProvider = namespace.telemetryProvider;
  if (isTelemetryProvider(namedProvider)) providers.push(namedProvider);

  // 3. named export: telemetryProviders (array)
  const namedProviders = namespace.telemetryProviders;
  if (Array.isArray(namedProviders)) {
    for (const candidate of namedProviders) {
      if (isTelemetryProvider(candidate)) providers.push(candidate);
    }
  }

  return providers;
}

export class TelemetryProviderRegistry {
  private readonly providers = new Map<string, TelemetryProvider>();

  register(provider: TelemetryProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Telemetry provider '${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): TelemetryProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Telemetry provider '${id}' not found. Registered: [${this.listIds().join(', ')}]`);
    }
    return provider;
  }

  listIds(): string[] {
    return [...this.providers.keys()];
  }

  async registerModule(specifier: string, moduleLoader: (specifier: string) => Promise<unknown>): Promise<void> {
    const namespace = await moduleLoader(specifier);
    const providers = collectModuleProviders(namespace);
    if (providers.length === 0) {
      throw new Error(`Telemetry provider module '${specifier}' exported no telemetry providers`);
    }
    for (const provider of providers) {
      this.register(provider);
    }
  }
}
