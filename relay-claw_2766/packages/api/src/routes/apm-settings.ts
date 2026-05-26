/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readApmSettings, writeApmSettings } from '../config/apm-settings.js';
import { tryRegisterApmAutoInstrumentationFromCode } from '../infrastructure/tracing/apm-auto-register.js';
import { isApmTracingEnabled, shutdownApmTracing, tryInitApmTracingFromEnv } from '../infrastructure/tracing/apm-tracing.js';
import { resolveActiveProjectRoot } from '../utils/active-project-root.js';

const patchSchema = z.object({
  enabled: z.boolean(),
});

function resolveOperator(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof first === 'string') return first.trim();
  }
  return null;
}

function buildApmSettingsResponse(projectRoot = resolveActiveProjectRoot()) {
  const settings = readApmSettings(projectRoot);
  const endpoint =
    process.env.APM_OTLP_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers =
    process.env.APM_OTLP_HEADERS ??
    process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ??
    process.env.OTEL_EXPORTER_OTLP_HEADERS;
  return {
    settings,
    runtime: {
      enabled: isApmTracingEnabled(),
      endpointConfigured: Boolean(endpoint?.trim()),
      authenticationConfigured: /(^|,)\s*Authentication\s*=/i.test(headers ?? ''),
      protocol: process.env.APM_OTLP_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'grpc',
      metricsExporter: process.env.OTEL_METRICS_EXPORTER ?? 'none',
      logsExporter: process.env.OTEL_LOGS_EXPORTER ?? 'none',
    },
  };
}

function hasLoginTraceApmRuntimeConfig(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() &&
      /(^|,)\s*Authentication\s*=/i.test(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? '') &&
      /^claw_.+\.(?:office|jiuwen)-claw-client\.prod$/.test(process.env.OTEL_SERVICE_NAME?.trim() ?? ''),
  );
}

export const apmSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/apm-settings', async () => buildApmSettingsResponse());

  app.post('/api/apm-tracing-enabled', async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { success: false, message: 'enabled must be boolean', details: parsed.error.issues };
    }

    const operator = resolveOperator(request.headers['x-office-claw-user'] ?? request.headers['x-cat-cafe-user']);
    if (!operator) {
      reply.status(400);
      return { success: false, message: 'Identity required (X-Office-Claw-User header)' };
    }

    const projectRoot = resolveActiveProjectRoot();
    const settings = writeApmSettings({ enabled: parsed.data.enabled }, projectRoot);
    if (settings.enabled) {
      process.env.APM_TRACING_ENABLED = 'true';
      if (hasLoginTraceApmRuntimeConfig()) {
        const registered = await tryRegisterApmAutoInstrumentationFromCode(request.log);
        if (registered) {
          tryInitApmTracingFromEnv(process.env, request.log);
        }
      } else {
        request.log.info('[apm-tracing] upload enabled; waiting for login trace_info before initializing OpenTelemetry');
      }
    } else {
      process.env.APM_TRACING_ENABLED = 'false';
      await shutdownApmTracing(request.log);
    }

    return { success: true, enabled: settings.enabled };
  });

  app.patch('/api/apm-settings', async (request, reply) => {
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.issues };
    }

    const operator = resolveOperator(request.headers['x-office-claw-user'] ?? request.headers['x-cat-cafe-user']);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Office-Claw-User header)' };
    }

    const projectRoot = resolveActiveProjectRoot();
    const settings = writeApmSettings({ enabled: parsed.data.enabled }, projectRoot);
    if (settings.enabled) {
      process.env.APM_TRACING_ENABLED = 'true';
      if (hasLoginTraceApmRuntimeConfig()) {
        const registered = await tryRegisterApmAutoInstrumentationFromCode(request.log);
        if (registered) {
          tryInitApmTracingFromEnv(process.env, request.log);
        }
      } else {
        request.log.info('[apm-tracing] upload enabled; waiting for login trace_info before initializing OpenTelemetry');
      }
    } else {
      process.env.APM_TRACING_ENABLED = 'false';
      await shutdownApmTracing(request.log);
    }

    return buildApmSettingsResponse(projectRoot);
  });
};
