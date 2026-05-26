/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { isApmUploadEnabled } from '../../config/apm-settings.js';
import {
  refreshApmRuntimeDefaults,
  tryRegisterApmAutoInstrumentationFromCode,
} from './apm-auto-register.js';
import {
  getApmOtlpConfigForDiagnostics,
  isApmTracingEnabled,
  shutdownApmTracing,
  tryInitApmTracingFromEnv,
} from './apm-tracing.js';

type LoggerLike = {
  info?(obj: unknown, msg?: string): void;
  info?(msg: string): void;
  warn?(obj: unknown, msg?: string): void;
  warn?(msg: string): void;
};

export interface LoginTraceInfo {
  appTraceToken: string;
  apmApiUrlBase: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractTraceInfo(providerState: unknown): LoginTraceInfo | null {
  if (!isRecord(providerState)) return null;
  const rawTraceInfo = providerState.traceInfo ?? providerState.trace_info;
  if (!isRecord(rawTraceInfo)) return null;

  const appTraceToken = readString(rawTraceInfo, 'appTraceToken', 'apm_trace_token');
  const apmApiUrlBase = readString(rawTraceInfo, 'apmApiUrlBase', 'apm_api_url_base');
  if (!appTraceToken || !apmApiUrlBase) return null;
  return { appTraceToken, apmApiUrlBase };
}

function extractDomainId(providerState: unknown): string | null {
  if (!isRecord(providerState)) return null;
  return readString(providerState, 'domain_id', 'domainId') ?? null;
}

function normalizeOtlpEndpoint(apmApiUrlBase: string): string {
  const trimmed = apmApiUrlBase.trim().replace(/\/+$/, '');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.endsWith('/v1/traces') ? withProtocol : `${withProtocol}/v1/traces`;
}

function buildApmServiceName(domainId: string | null): string {
  const normalizedDomainId = domainId?.trim() || 'unknown';
  return `claw_${normalizedDomainId}.jiuwen-claw-client.prod`;
}

export function applyLoginTraceOtelEnv(
  traceInfo: LoginTraceInfo,
  domainId: string | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const endpoint = normalizeOtlpEndpoint(traceInfo.apmApiUrlBase);
  const headers = `Authentication=${traceInfo.appTraceToken}`;
  const serviceName = buildApmServiceName(domainId);

  env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
  env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = endpoint;
  env.OTEL_EXPORTER_OTLP_HEADERS = headers;
  env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = headers;
  env.OTEL_TRACES_EXPORTER = 'otlp';
  env.OTEL_METRICS_EXPORTER = 'none';
  env.OTEL_LOGS_EXPORTER = 'none';
  env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
  env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'grpc';
  env.OTEL_SERVICE_NAME = serviceName;
}

export async function configureApmTracingFromProviderState(
  providerState: unknown,
  log?: LoggerLike,
): Promise<void> {
  const traceInfo = extractTraceInfo(providerState);
  if (!traceInfo) {
    log?.info?.('[apm-tracing] login trace_info missing; skipping runtime APM configuration');
    return;
  }

  refreshApmRuntimeDefaults();
  process.env.APM_TRACING_ENABLED = isApmUploadEnabled() ? 'true' : 'false';
  applyLoginTraceOtelEnv(traceInfo, extractDomainId(providerState));

  if (!isApmUploadEnabled()) {
    log?.info?.('[apm-tracing] login trace_info captured; upload disabled by settings');
    return;
  }

  if (isApmTracingEnabled()) {
    await shutdownApmTracing(log);
  }
  const registered = await tryRegisterApmAutoInstrumentationFromCode(log);
  if (registered) {
    tryInitApmTracingFromEnv(process.env, log);
    log?.info?.(getApmOtlpConfigForDiagnostics(), '[apm-tracing] login trace_info applied');
  }
}
