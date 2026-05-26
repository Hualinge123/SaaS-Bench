import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMetricsProvider(value: unknown): value is MetricsProvider {
  return isRecord(value) && typeof value.id === 'string' && typeof value.resolveReporterConfig === 'function';
}

function collectModuleProviders(namespace: unknown): MetricsProvider[] {
  if (!isRecord(namespace)) return [];
  const providers: MetricsProvider[] = [];

  const push = (provider: MetricsProvider): void => {
    if (!providers.some((item) => item.id === provider.id)) providers.push(provider);
  };

  if (isMetricsProvider(namespace.default)) push(namespace.default);
  if (isMetricsProvider(namespace.metricsProvider)) push(namespace.metricsProvider);

  const candidates = namespace.metricsProviders;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (isMetricsProvider(candidate)) push(candidate);
    }
  }

  return providers;
}

export class MetricsProviderRegistry {
  private readonly providers = new Map<string, MetricsProvider>();

  register(provider: MetricsProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Metrics provider '${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): MetricsProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Metrics provider '${id}' not found. Registered: [${this.listIds().join(', ')}]`);
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
      throw new Error(`Metrics provider module '${specifier}' exported no metrics providers`);
    }
    for (const provider of providers) {
      this.register(provider);
    }
  }
}
