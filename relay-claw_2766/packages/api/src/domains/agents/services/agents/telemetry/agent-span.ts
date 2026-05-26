/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Agent invocation span helpers.
 * Creates CLIENT spans for downstream jiuwenclaw calls.
 */

import { context, trace, SpanStatusCode, SpanKind, type Span } from '@opentelemetry/api';
import { getTracer } from '../../../../../infrastructure/telemetry/provider.js';
import { getAgentInvokeCount, getAgentInvokeErrorCount, getAgentInvokeDuration } from '../../../../../infrastructure/telemetry/metrics.js';
import {
  GEN_AI_AGENT_NAME,
  GEN_AI_CONVERSATION_ID,
  OFFICECLAW_REQUEST_ID,
  OFFICECLAW_SESSION_ID,
  OFFICECLAW_AGENT_ID,
} from '../../../../../infrastructure/telemetry/attributes.js';

const tracer = getTracer('officeclaw.agent');

/**
 * Start an agent invocation span.
 * This span becomes the parent for downstream jiuwenclaw spans.
 * Inherits parent context from HTTP span if available.
 */
export function startAgentInvokeSpan(
  agentId: string,
  sessionId: string,
  requestId: string,
  threadId?: string,
): Span {
  // Use current active context as parent (will link to HTTP span if active)
  const currentContext = context.active();
  const parentSpan = trace.getSpan(currentContext);

  return tracer.startSpan('officeclaw.agent.invoke', {
    kind: SpanKind.CLIENT, // CLIENT because we call downstream service
    attributes: {
      [GEN_AI_AGENT_NAME]: agentId,
      [GEN_AI_CONVERSATION_ID]: threadId ?? '',
      [OFFICECLAW_SESSION_ID]: sessionId,
      [OFFICECLAW_REQUEST_ID]: requestId,
      [OFFICECLAW_AGENT_ID]: agentId,
    },
  }, currentContext); // Pass current context to inherit parent trace
}

/**
 * End an agent invocation span with success/failure status.
 */
export function endAgentInvokeSpan(span: Span, success: boolean, error?: Error): void {
  if (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

/**
 * Record agent invocation metrics.
 */
export function recordAgentInvokeMetrics(
  agentId: string,
  durationSeconds: number,
  success: boolean,
): void {
  const attributes = { [OFFICECLAW_AGENT_ID]: agentId };

  getAgentInvokeDuration().record(durationSeconds, attributes);
  getAgentInvokeCount().add(1, attributes);

  if (!success) {
    getAgentInvokeErrorCount().add(1, attributes);
  }
}

/**
 * Run a function within an active span context.
 * This ensures that trace propagation picks up the correct traceparent.
 */
export async function runWithActiveSpan<T>(span: Span, fn: () => Promise<T>): Promise<T> {
  return context.with(trace.setSpan(context.active(), span), fn);
}

/**
 * Run an async generator within an active span context.
 * Note: We set the span as active and then iterate the generator.
 */
export async function* runGeneratorWithActiveSpan<T>(
  span: Span,
  generator: AsyncIterable<T>,
): AsyncIterable<T> {
  // Set span as active in current context
  const ctx = trace.setSpan(context.active(), span);
  // Run iteration in the new context - use direct iteration
  const genIterator = generator[Symbol.asyncIterator]();
  for (;;) {
    const result = await context.with(ctx, async () => genIterator.next());
    if (result.done) break;
    yield result.value;
  }
}