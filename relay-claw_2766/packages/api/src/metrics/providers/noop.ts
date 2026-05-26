import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';

export function createNoopMetricsProvider(): MetricsProvider {
  return {
    id: 'noop',
    displayName: 'No-op Metrics (disabled)',
    async resolveReporterConfig() {
      return null;
    },
  };
}
