/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

type LoggerLike = {
  warn?(obj: unknown, msg?: string): void;
  warn?(msg: string): void;
};

type AutoInstrumentationImporter = () => Promise<unknown>;

const APM_RUNTIME_DEFAULTS = {
  APM_TRACING_DEBUG: 'false',
  OTEL_TRACES_EXPORTER: 'otlp',
  OTEL_METRICS_EXPORTER: 'none',
  OTEL_LOGS_EXPORTER: 'none',
  OTEL_NODE_DISABLED_INSTRUMENTATIONS: 'net,http,fastify,express,undici',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'grpc',
  OTEL_NODE_RESOURCE_DETECTORS: 'env,host,os',
} as const;

let autoInstrumentationRegistered = false;

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function defaultAutoInstrumentationImporter(): Promise<unknown> {
  return import('@opentelemetry/auto-instrumentations-node/register');
}

function setDefaultIfMissing(env: NodeJS.ProcessEnv, key: string, value: string): void {
  if (!env[key]?.trim()) env[key] = value;
}

function mergeCommaList(existing: string | undefined, defaults: string): string {
  const values = new Set(
    [existing, defaults]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean)),
  );
  return [...values].join(',');
}

export function refreshApmRuntimeDefaults(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(APM_RUNTIME_DEFAULTS)) {
    if (key === 'OTEL_NODE_DISABLED_INSTRUMENTATIONS') {
      env[key] = mergeCommaList(env[key], value);
    } else {
      setDefaultIfMissing(env, key, value);
    }
  }
}

export function prepareApmRuntimeEnvBeforeTelemetry(env: NodeJS.ProcessEnv = process.env): void {
  if (!parseBoolean(env.APM_TRACING_ENABLED ?? env.OFFICE_CLAW_APM_TRACING_ENABLED)) return;

  env.OTEL_TRACES_EXPORTER = 'none';
  env.OTEL_METRICS_EXPORTER = 'none';
  env.OTEL_LOGS_EXPORTER = 'none';
  env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
  env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = 'grpc';
}

export async function registerApmAutoInstrumentationFromCode(
  importer: AutoInstrumentationImporter = defaultAutoInstrumentationImporter,
): Promise<boolean> {
  if (autoInstrumentationRegistered) return true;
  refreshApmRuntimeDefaults();
  await importer();
  process.env.OFFICE_CLAW_OTEL_AUTO_REGISTERED = 'code';
  autoInstrumentationRegistered = true;
  return true;
}

export async function tryRegisterApmAutoInstrumentationFromCode(
  log?: LoggerLike,
  importer?: AutoInstrumentationImporter,
): Promise<boolean> {
  try {
    return await registerApmAutoInstrumentationFromCode(importer);
  } catch (err) {
    log?.warn?.(
      { error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) },
      '[apm-tracing] auto-instrumentation registration failed; APM disabled',
    );
    return false;
  }
}
