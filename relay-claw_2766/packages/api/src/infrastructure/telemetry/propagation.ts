/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * W3C TraceContext propagation utilities.
 * Inject/extract traceparent and tracestate headers.
 *
 * Format: traceparent = "00-{32-char-trace-id}-{16-char-span-id}-{2-char-flags}"
 * Example: "00-3036877aed0022c04f7717bd04d9d3d2-06d036427a0af7b0-01"
 */

import { context, propagation, trace } from '@opentelemetry/api';
import type { Context } from '@opentelemetry/api';

/**
 * Inject current trace context into a carrier object.
 * Used before sending WebSocket messages to jiuwenclaw.
 *
 * Result: carrier will contain 'traceparent' and optionally 'tracestate'.
 */
export function injectTraceContext(carrier: Record<string, string>): void {
  propagation.inject(context.active(), carrier);
}

/**
 * Extract trace context from a carrier object.
 * Used when receiving context from upstream (if needed).
 */
export function extractTraceContext(carrier: Record<string, string> | null): Context {
  if (!carrier) return context.active();
  return propagation.extract(context.active(), carrier);
}

/**
 * Build trace context object for E2A channel_context.
 * Returns object with traceparent/tracestate keys suitable for E2AEnvelope.channel_context.
 */
export function buildTraceContextForE2A(): Record<string, string> {
  const carrier: Record<string, string> = {};
  injectTraceContext(carrier);
  return carrier;
}

/**
 * Get current trace ID from active span (if available).
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().traceId;
}

/**
 * Get current span ID from active span (if available).
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  return span.spanContext().spanId;
}