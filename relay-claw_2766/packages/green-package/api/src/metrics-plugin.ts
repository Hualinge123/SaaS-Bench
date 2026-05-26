import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';
import {
  extractRegion,
  buildAomEndpoint,
  ensurePrometheusInstance,
  fetchAomAccessCode,
  type CasCredential,
} from './metrics/aom-access-code-client.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const metricsProviders: MetricsProvider[] = [createAomMetricsProvider()];

function createAomMetricsProvider(): MetricsProvider {
  return {
    id: 'aom',
    displayName: 'Huawei Cloud AOM',

    async resolveReporterConfig(input) {
      const log = input.log;
      const ps = isRecord(input.providerState) ? input.providerState : null;
      if (!ps) return null;

      const credential: CasCredential = {
        access: String(ps.access ?? ''),
        secret: String(ps.secret ?? ''),
        sts_token: String(ps.sts_token ?? ''),
        project_id: String(ps.project_id ?? ''),
      };

      if (!credential.access || !credential.secret || !credential.sts_token || !credential.project_id) {
        log?.warn('[AomMetricsProvider] Missing CAS credential fields, skipping');
        return null;
      }

      const region = extractRegion(input.baseUrl);
      const instances = await ensurePrometheusInstance(credential, region, log);
      if (!instances) {
        log?.warn('[AomMetricsProvider] No Prometheus instance available');
        return null;
      }

      const result = await fetchAomAccessCode(credential, region, log);
      if (!result) {
        log?.warn('[AomMetricsProvider] Failed to fetch AOM access code');
        return null;
      }

      log?.info('[AomMetricsProvider] AOM credentials resolved successfully');
      return {
        endpoint: buildAomEndpoint(region, credential.project_id),
        token: result.accessCode,
        projectId: credential.project_id,
      };
    },
  };
}
