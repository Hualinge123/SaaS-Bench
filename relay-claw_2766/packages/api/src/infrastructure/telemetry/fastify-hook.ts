/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Fastify HTTP telemetry hook.
 * Creates SERVER spans for each HTTP request.
 */

import { type Context, context, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';
import {
  HTTP_METHOD,
  HTTP_ROUTE,
  HTTP_STATUS_CODE,
  HTTP_URL,
  OFFICECLAW_THREAD_ID,
} from './attributes.js';
import { getRequestCount, getRequestDuration, getRequestErrorCount } from './metrics.js';
import { getTracer } from './provider.js';

const _logLevel = 10; // debug level marker for pino

// Augment FastifyRequest type for telemetry span storage
interface TelemetryFastifyRequest extends FastifyRequest {
  telemetrySpan?: Span;
  telemetryStartTime?: number;
  telemetryContext?: Context;
  telemetryTracer?: ReturnType<typeof getTracer>;
}

// MetricLabelProvider state (Promise-based locking pattern)
let _providerLoadPromise: Promise<MetricLabelProvider> | null = null;

/**
 * Load MetricLabelProvider from environment variable or fallback to noop.
 */
export async function loadMetricLabelProvider(): Promise<MetricLabelProvider> {
  const moduleSpecifier = process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE?.trim();
  if (!moduleSpecifier) {
    // Built-in noop provider
    console.debug('[telemetry] MetricLabelProvider: using built-in noop (no OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE set)');
    return {
      id: 'noop',
      displayName: 'No Labels Provider',
      resolveLabels: async () => null,
    };
  }

  try {
    console.debug(`[telemetry] MetricLabelProvider: loading from ${moduleSpecifier}`);
    const module = await import(moduleSpecifier);
    // Support default export or metricLabelProvider export
    if (module.default?.id) {
      console.debug(`[telemetry] MetricLabelProvider: loaded ${module.default.id} (default export)`);
      return module.default;
    }
    if (module.metricLabelProvider?.id) {
      console.debug(`[telemetry] MetricLabelProvider: loaded ${module.metricLabelProvider.id} (metricLabelProvider export)`);
      return module.metricLabelProvider;
    }
    throw new Error(`No MetricLabelProvider found in module ${moduleSpecifier}`);
  } catch (error) {
    // Fallback to noop on load failure
    console.warn(`Failed to load MetricLabelProvider from ${moduleSpecifier}, using noop fallback:`, error);
    return {
      id: 'noop-fallback',
      displayName: 'No Labels Provider (Fallback)',
      resolveLabels: async () => null,
    };
  }
}

/**
 * Get the loaded MetricLabelProvider (lazy load on first access).
 * Uses Promise-based locking to prevent race conditions during concurrent access.
 */
export async function getMetricLabelProvider(): Promise<MetricLabelProvider> {
  if (!_providerLoadPromise) {
    _providerLoadPromise = (async () => {
      const provider = await loadMetricLabelProvider();
      if (provider.bootstrap) {
        console.debug(`[telemetry] MetricLabelProvider: calling bootstrap for ${provider.id}`);
        await provider.bootstrap();
        console.debug(`[telemetry] MetricLabelProvider: bootstrap completed for ${provider.id}`);
      }
      return provider;
    })();
  }
  return _providerLoadPromise;
}

/**
 * Register telemetry hooks on Fastify instance.
 * Creates spans for each HTTP request and records metrics.
 */
export function registerTelemetryHook(app: FastifyInstance): void {
  const tracer = getTracer('officeclaw.http');

  // onRequest: Start span and store in request
  app.addHook('onRequest', async (request: TelemetryFastifyRequest) => {
    const spanName = `${request.method} ${request.routerPath || request.url}`;

    const span = tracer.startSpan(spanName, {
      kind: SpanKind.SERVER,
      attributes: {
        [HTTP_METHOD]: request.method,
        [HTTP_URL]: request.url,
        [HTTP_ROUTE]: request.routerPath ?? '',
      },
    });

    request.telemetrySpan = span;
    request.telemetryStartTime = Date.now();
    request.telemetryTracer = tracer;

    // Add thread_id from body if available
    if (request.body && typeof request.body === 'object' && 'threadId' in request.body) {
      span.setAttribute(OFFICECLAW_THREAD_ID, request.body.threadId as string);
    }
  });

  // preHandler: Set span as active context for downstream handlers
  // This ensures agent spans inherit the HTTP span's trace context
  app.addHook('preHandler', async (request: TelemetryFastifyRequest) => {
    const span = request.telemetrySpan;
    if (span) {
      // Store the context with span for downstream use
      request.telemetryContext = trace.setSpan(context.active(), span);
    }
  });

  // onResponse: End span with status and record metrics
  app.addHook('onResponse', async (request: TelemetryFastifyRequest, reply: FastifyReply) => {
    const span = request.telemetrySpan;
    if (!span) return;

    const startTime = request.telemetryStartTime ?? Date.now();
    const duration = (Date.now() - startTime) / 1000;

    // Build base attributes
    const baseAttributes: Record<string, string | number | boolean> = {
      [HTTP_METHOD]: request.method,
      [HTTP_ROUTE]: request.routerPath ?? '',
    };

    // Resolve dynamic labels from MetricLabelProvider
    let dynamicLabels: Record<string, string | number | boolean> | null = null;
    try {
      const provider = await getMetricLabelProvider();
      dynamicLabels = await provider.resolveLabels(request);
      if (dynamicLabels) {
        console.debug(`[telemetry] MetricLabelProvider: ${provider.id} returned labels:`, JSON.stringify(dynamicLabels));
      } else {
        console.debug(`[telemetry] MetricLabelProvider: ${provider.id} returned null (no labels for this request)`);
      }
    } catch (error) {
      console.warn('[telemetry] MetricLabelProvider.resolveLabels failed:', error);
      dynamicLabels = null;
    }

    // Merge labels
    const attributes = dynamicLabels
      ? { ...baseAttributes, ...dynamicLabels }
      : baseAttributes;

    console.debug(`[telemetry] MetricLabelProvider: merged attributes for metrics:`, JSON.stringify(attributes));

    // Record metrics with merged attributes
    getRequestCount().add(1, attributes);
    getRequestDuration().record(duration, attributes);

    // Set span status
    span.setAttribute(HTTP_STATUS_CODE, reply.statusCode);

    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      getRequestErrorCount().add(1, attributes);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  });

  // onError: Record exception
  app.addHook('onError', async (request: TelemetryFastifyRequest, _reply: FastifyReply, error: Error) => {
    const span = request.telemetrySpan;
    if (!span) return;

    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  });
}
