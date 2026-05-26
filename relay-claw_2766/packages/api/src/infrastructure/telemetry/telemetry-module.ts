/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Telemetry Module — provider loading and selection.
 * Mirrors auth/module.ts pattern.
 */

import type { TelemetryProvider } from '@openjiuwen/relay-api-server-contracts/telemetry-provider';
import { TelemetryProviderRegistry } from './provider-registry.js';
import { createBuiltinTelemetryProvider } from './providers/builtin-telemetry.js';

export interface TelemetryModule {
  activeProviderId: string;
  providerRegistry: TelemetryProviderRegistry;
  getActiveProvider(): TelemetryProvider;
}

export interface CreateTelemetryModuleOptions {
  env?: NodeJS.ProcessEnv;
  moduleLoader?: (specifier: string) => Promise<unknown>;
  providers?: TelemetryProvider[];
}

function parseModuleSpecifiers(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OFFICE_CLAW_TELEMETRY_PROVIDER_MODULES?.trim();
  if (!raw) return [];
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

export function resolveConfiguredTelemetryProviderId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OFFICE_CLAW_TELEMETRY_PROVIDER?.trim();
  if (explicit) return explicit;
  return 'builtin-telemetry';
}

export async function createTelemetryModule(options: CreateTelemetryModuleOptions = {}): Promise<TelemetryModule> {
  const env = options.env ?? process.env;
  const moduleLoader = options.moduleLoader ?? ((specifier: string) => import(specifier));
  const providerRegistry = new TelemetryProviderRegistry();

  // 1. Register builtin provider
  providerRegistry.register(createBuiltinTelemetryProvider(env));

  // 2. Register explicitly passed providers (used by tests)
  for (const provider of options.providers ?? []) {
    providerRegistry.register(provider);
  }

  // 3. Load external provider modules from env
  for (const moduleSpecifier of parseModuleSpecifiers(env)) {
    await providerRegistry.registerModule(moduleSpecifier, moduleLoader);
  }

  // 4. Select active provider
  const activeProviderId = resolveConfiguredTelemetryProviderId(env);
  const activeProvider = providerRegistry.get(activeProviderId);

  // 5. Call bootstrap if defined
  await activeProvider.bootstrap?.();

  return {
    activeProviderId,
    providerRegistry,
    getActiveProvider() {
      return activeProvider;
    },
  };
}