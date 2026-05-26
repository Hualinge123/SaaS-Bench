import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';
import { createNoopMetricsProvider } from './providers/noop.js';
import { MetricsProviderRegistry } from './provider-registry.js';

export interface MetricsModule {
  activeProviderId: string;
  providerRegistry: MetricsProviderRegistry;
  getActiveProvider(): MetricsProvider;
}

export interface CreateMetricsModuleOptions {
  env?: NodeJS.ProcessEnv;
  moduleLoader?: (specifier: string) => Promise<unknown>;
  providers?: MetricsProvider[];
}

function parseModuleSpecifiers(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OFFICE_CLAW_METRICS_PROVIDER_MODULES?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveConfiguredMetricsProviderId(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OFFICE_CLAW_METRICS_PROVIDER?.trim();
  if (explicit) return explicit;
  return 'noop';
}

export async function createMetricsModule(options: CreateMetricsModuleOptions = {}): Promise<MetricsModule> {
  const env = options.env ?? process.env;
  const moduleLoader = options.moduleLoader ?? ((specifier: string) => import(specifier));
  const providerRegistry = new MetricsProviderRegistry();

  providerRegistry.register(createNoopMetricsProvider());
  for (const provider of options.providers ?? []) {
    providerRegistry.register(provider);
  }
  for (const moduleSpecifier of parseModuleSpecifiers(env)) {
    await providerRegistry.registerModule(moduleSpecifier, moduleLoader);
  }

  const activeProviderId = resolveConfiguredMetricsProviderId(env);
  const activeProvider = providerRegistry.get(activeProviderId);
  await activeProvider.bootstrap?.();

  return {
    activeProviderId,
    providerRegistry,
    getActiveProvider() {
      return activeProvider;
    },
  };
}
