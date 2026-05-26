/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Telemetry configuration loading.
 * Environment variables take precedence over defaults.
 * Matches jiuwenclaw/telemetry/config.py pattern.
 */

export interface TelemetryConfig {
  /** Enable/disable telemetry */
  enabled: boolean;
  /** Global exporter type */
  exporter: 'otlp' | 'console' | 'none';
  /** OTLP collector endpoint */
  endpoint: string;
  /** Protocol for OTLP (grpc/http) */
  protocol: 'grpc' | 'http';
  /** Traces-specific exporter (overrides global) */
  tracesExporter: string;
  /** Traces-specific endpoint (overrides global) */
  tracesEndpoint: string;
  /** Traces-specific protocol (overrides global) */
  tracesProtocol: string;
  /** Metrics-specific exporter (overrides global) */
  metricsExporter: string;
  /** Metrics-specific endpoint (overrides global) */
  metricsEndpoint: string;
  /** Metrics-specific protocol (overrides global) */
  metricsProtocol: string;
  /** Service name for resource */
  serviceName: string;
  /** Instance identifier (optional) */
  clawId?: string;
}

/**
 * Load telemetry config from environment variables.
 * Priority: env var > default
 * @param env - Environment variables object (defaults to process.env)
 */
export function loadTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const enabled = env.OTEL_ENABLED === 'true';
  const exporterType = (env.OTEL_EXPORTER_TYPE ?? 'none') as TelemetryConfig['exporter'];

  return {
    enabled,
    exporter: exporterType,
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
    protocol: (env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'grpc') as TelemetryConfig['protocol'],
    tracesExporter: env.OTEL_TRACES_EXPORTER ?? exporterType,
    tracesEndpoint: env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '',
    tracesProtocol: env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? '',
    metricsExporter: env.OTEL_METRICS_EXPORTER ?? exporterType,
    metricsEndpoint: env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? '',
    metricsProtocol: env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ?? '',
    serviceName: env.OTEL_SERVICE_NAME ?? 'officeclaw-api',
    clawId: env.OTEL_CLAW_ID,
  };
}

/**
 * Resolve effective traces exporter config.
 */
export function resolveTracesExporterConfig(cfg: TelemetryConfig): {
  exporter: string;
  endpoint: string;
  protocol: 'grpc' | 'http';
} {
  return {
    exporter: cfg.tracesExporter,
    endpoint: cfg.tracesEndpoint || cfg.endpoint,
    protocol: (cfg.tracesProtocol || cfg.protocol) as 'grpc' | 'http',
  };
}

/**
 * Resolve effective metrics exporter config.
 */
export function resolveMetricsExporterConfig(cfg: TelemetryConfig): {
  exporter: string;
  endpoint: string;
  protocol: 'grpc' | 'http';
} {
  return {
    exporter: cfg.metricsExporter,
    endpoint: cfg.metricsEndpoint || cfg.endpoint,
    protocol: (cfg.metricsProtocol || cfg.protocol) as 'grpc' | 'http',
  };
}
