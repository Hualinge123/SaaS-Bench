/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Builtin Telemetry Provider.
 * Reads OTEL_* environment variables for backward compatibility.
 */

import type { TelemetryProvider } from '@openjiuwen/relay-api-server-contracts/telemetry-provider';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPTraceExporterHttp } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPMetricExporter as OTLPMetricExporterHttp } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import {
  loadTelemetryConfig,
  resolveTracesExporterConfig,
  resolveMetricsExporterConfig,
} from '../config.js';

/**
 * Create builtin telemetry provider that reads OTEL_* env vars.
 */
export function createBuiltinTelemetryProvider(env: NodeJS.ProcessEnv): TelemetryProvider {
  return {
    id: 'builtin-telemetry',
    displayName: 'Builtin Telemetry (OTLP/Console)',

    createTraceExporter() {
      const cfg = loadTelemetryConfig(env);
      if (!cfg.enabled) return null;

      const { exporter, endpoint, protocol } = resolveTracesExporterConfig(cfg);

      if (exporter === 'console') {
        return new ConsoleSpanExporter();
      }

      if (exporter === 'otlp') {
        if (protocol === 'http') {
          return new OTLPTraceExporterHttp({ url: endpoint });
        }
        return new OTLPTraceExporter({ url: endpoint });
      }

      // 'none' - disable tracing
      return null;
    },

    createMetricReader() {
      const cfg = loadTelemetryConfig(env);
      if (!cfg.enabled) return null;

      const { exporter, endpoint, protocol } = resolveMetricsExporterConfig(cfg);

      if (exporter === 'none') return null;

      if (exporter === 'console') {
        return new PeriodicExportingMetricReader({
          exporter: new ConsoleMetricExporter(),
          exportIntervalMillis: 30000,
        });
      }

      if (exporter === 'otlp') {
        const metricExporter = protocol === 'http'
          ? new OTLPMetricExporterHttp({ url: endpoint })
          : new OTLPMetricExporter({ url: endpoint });

        return new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 30000,
        });
      }

      return null;
    },

    createResource() {
      const cfg = loadTelemetryConfig(env);
      return resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: cfg.serviceName,
        ...(cfg.clawId ? { 'officeclaw.claw.id': cfg.clawId } : {}),
      });
    },

    getInstrumentations() {
      return [new HttpInstrumentation()];
    },
  };
}