/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import {
  context,
  diag,
  type DiagLogger,
  DiagLogLevel,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Span,
  type SpanContext,
} from '@opentelemetry/api';

type LoggerLike = {
  info?(obj: unknown, msg?: string): void;
  info?(msg: string): void;
  warn?(obj: unknown, msg?: string): void;
  warn?(msg: string): void;
  error?(obj: unknown, msg?: string): void;
  error?(msg: string): void;
  debug?(obj: unknown, msg?: string): void;
  debug?(msg: string): void;
};

type TraceProtocol = 'http/protobuf' | 'grpc';

export interface InvocationTraceHandle {
  readonly invocationId: string;
  readonly span: Span;
  addEvent(name: string, attributes?: Attributes): void;
  setAttributes(attributes: Attributes): void;
  endOk(attributes?: Attributes): void;
  endError(error: unknown, attributes?: Attributes): void;
  unregister(): void;
}

export interface ApiTraceHandle {
  readonly span: Span;
  readonly context: ReturnType<typeof trace.setSpan>;
  addEvent(name: string, attributes?: Attributes): void;
  setAttributes(attributes: Attributes): void;
  endOk(attributes?: Attributes): void;
  endError(error: unknown, attributes?: Attributes): void;
}

export interface ApiTraceInput {
  spanName: string;
  route: string;
  actualRoute?: string;
  method?: string;
  threadId?: string;
  messageId?: string;
  userId?: string;
  invocationId?: string;
  parentTraceId?: string;
  parentSpanId?: string;
  attributes?: Attributes;
}

export interface FeedbackTraceInput {
  threadId: string;
  messageId: string;
  userId: string;
  vote: 1 | -1;
  timestamp?: number;
  invocationId?: string;
  originalTraceId?: string;
  originalSpanId?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  reason?: string | null;
  previousVote?: 1 | -1 | null;
  trajectory?: {
    trajectoryId?: string;
    trajectoryRunId?: string;
    trajectoryStepId?: string;
    trajectoryEventIds?: string[];
    trajectoryEventNames?: string[];
  };
}

let started = false;
let debugEnabled = false;
let activeLogger: LoggerLike | undefined;
let activeOtlpEndpoint: string | undefined;
let activeOtlpProtocol: TraceProtocol | undefined;
let activeOtlpHeaderKeys: string[] = [];
let activeServiceName: string | undefined;
const invocationSpanContexts = new Map<string, SpanContext>();

export function isApmTracingEnabled(): boolean {
  return started;
}

export function initApmTracingFromEnv(env: NodeJS.ProcessEnv = process.env, log?: LoggerLike): boolean {
  if (started) {
    log?.warn?.(getApmOtlpConfigForDiagnostics(), '[apm-tracing] OpenTelemetry tracing already configured');
    return true;
  }

  if (!isStandardApmTracingEnabled(env)) return false;
  debugEnabled = parseBoolean(env.APM_TRACING_DEBUG ?? env.OFFICE_CLAW_APM_TRACING_DEBUG);
  activeLogger = log;

  const serviceName = env.OTEL_SERVICE_NAME?.trim() || env.APM_SERVICE_NAME?.trim() || 'jiuwen-claw-api';
  const protocol = normalizeProtocol(env.OTEL_EXPORTER_OTLP_PROTOCOL ?? env.APM_OTLP_PROTOCOL);
  const headers = parseHeaders(
    env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS ?? env.APM_OTLP_HEADERS,
  );
  const endpoint = normalizeEndpoint(
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT ?? env.APM_OTLP_ENDPOINT,
  );
  if (debugEnabled) diag.setLogger(new PinoDiagLogger(log), DiagLogLevel.DEBUG);

  activeOtlpEndpoint = endpoint ?? undefined;
  activeOtlpProtocol = protocol;
  activeOtlpHeaderKeys = Object.keys(headers);
  activeServiceName = serviceName;
  started = true;
  log?.warn?.(
    {
      endpoint,
      protocol,
      serviceName,
      debug: debugEnabled,
      headerKeys: Object.keys(headers),
      autoInstrumentationRegistered: isAutoInstrumentationRegistered(env),
    },
    '[apm-tracing] OpenTelemetry standard tracing configured',
  );
  if (!isAutoInstrumentationRegistered(env)) {
    log?.warn?.(
      '[apm-tracing] tracing is enabled, but NODE_OPTIONS does not include @opentelemetry/auto-instrumentations-node/register',
    );
  }
  return true;
}

export function tryInitApmTracingFromEnv(env: NodeJS.ProcessEnv = process.env, log?: LoggerLike): boolean {
  try {
    return initApmTracingFromEnv(env, log);
  } catch (err) {
    log?.warn?.({ error: sanitizeDiagArgs([err])[0] }, '[apm-tracing] initialization failed; APM disabled');
    return false;
  }
}

export async function shutdownApmTracing(log?: LoggerLike): Promise<void> {
  if (!started) return;
  log?.info?.('[apm-tracing] OpenTelemetry SDK shutdown is managed by auto-instrumentations register');
  started = false;
  debugEnabled = false;
  activeLogger = undefined;
  activeOtlpEndpoint = undefined;
  activeOtlpProtocol = undefined;
  activeOtlpHeaderKeys = [];
  activeServiceName = undefined;
  invocationSpanContexts.clear();
}

export function startInvocationTrace(input: {
  invocationId: string;
  agentId: string;
  threadId: string;
  userId: string;
  parentInvocationId?: string;
  isLastAgent?: boolean;
}): InvocationTraceHandle | null {
  if (!started) return null;

  const tracer = trace.getTracer('jiuwen-claw.agent');
  const span = tracer.startSpan('agent.invocation', {
    kind: SpanKind.INTERNAL,
    attributes: cleanAttributes({
      'jiuwen_claw.invocation.id': input.invocationId,
      'jiuwen_claw.agent.id': input.agentId,
      'jiuwen_claw.thread.id': input.threadId,
      'jiuwen_claw.user.id': input.userId,
      'jiuwen_claw.parent_invocation.id': input.parentInvocationId,
      'jiuwen_claw.invocation.is_last_agent': input.isLastAgent,
    }),
  });
  invocationSpanContexts.set(input.invocationId, span.spanContext());
  debugLog({ spanName: 'agent.invocation', invocationId: input.invocationId, ...span.spanContext() }, '[apm-tracing] span started');

  const setInvocationAttributes = (attributes: Attributes): void => {
    const cleaned = cleanAttributes(attributes);
    span.setAttributes(cleaned);
    debugLog({ spanName: 'agent.invocation', invocationId: input.invocationId, attributes: cleaned }, '[apm-tracing] span attributes set');
  };

  return {
    invocationId: input.invocationId,
    span,
    addEvent(name, attributes) {
      const cleaned = cleanAttributes(attributes ?? {});
      span.addEvent(name, cleaned);
      recordTrajectoryEventSpan(tracer, span, input.invocationId, name, cleaned);
      debugLog({ spanName: 'agent.invocation', invocationId: input.invocationId, eventName: name, attributes: cleaned }, '[apm-tracing] span event added');
    },
    setAttributes(attributes) {
      setInvocationAttributes(attributes);
    },
    endOk(attributes) {
      if (attributes) setInvocationAttributes(attributes);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      invocationSpanContexts.delete(input.invocationId);
    },
    endError(error, attributes) {
      if (attributes) setInvocationAttributes(attributes);
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
      span.end();
      invocationSpanContexts.delete(input.invocationId);
    },
    unregister() {
      invocationSpanContexts.delete(input.invocationId);
    },
  };
}

export function startApiTrace(input: ApiTraceInput): ApiTraceHandle | null {
  if (!started) return null;

  let span: Span;
  let parentContext: ReturnType<typeof trace.setSpanContext>;
  const tracer = trace.getTracer('jiuwen-claw.api');
  try {
    const method = input.method ?? 'POST';
    const attributes = cleanAttributes({
      'http.method': method,
      'http.request.method': method,
      'http.route': input.route,
      'http.target': input.actualRoute ?? input.route,
      'url.path': input.actualRoute ?? input.route,
      'jiuwen_claw.api.route': input.route,
      'jiuwen_claw.api.actual_route': input.actualRoute,
      'jiuwen_claw.thread.id': input.threadId,
      'jiuwen_claw.message.id': input.messageId,
      'jiuwen_claw.user.id': input.userId,
      'jiuwen_claw.invocation.id': input.invocationId,
      ...input.attributes,
    });
    parentContext =
      isValidTraceId(input.parentTraceId) && isValidSpanId(input.parentSpanId)
        ? trace.setSpanContext(context.active(), {
            traceId: input.parentTraceId,
            spanId: input.parentSpanId,
            traceFlags: TraceFlags.SAMPLED,
          })
        : context.active();
    span = tracer.startSpan(
      input.spanName,
      {
        kind: SpanKind.SERVER,
        attributes,
      },
      parentContext,
    );
    debugLog({ spanName: input.spanName, attributes, ...span.spanContext() }, '[apm-tracing] api span started');
  } catch (err) {
    logTraceOperationFailure('api span start', err, { spanName: input.spanName, route: input.route });
    return null;
  }

  const setApiAttributes = (nextAttributes: Attributes): void => {
    const cleaned = cleanAttributes(nextAttributes);
    span.setAttributes(cleaned);
    debugLog({ spanName: input.spanName, attributes: cleaned }, '[apm-tracing] api span attributes set');
  };

  return {
    span,
    context: trace.setSpan(parentContext, span),
    addEvent(name, nextAttributes) {
      try {
        const cleaned = cleanAttributes(nextAttributes ?? {});
        span.addEvent(name, cleaned);
        debugLog({ spanName: input.spanName, eventName: name, attributes: cleaned }, '[apm-tracing] api span event added');
      } catch (err) {
        logTraceOperationFailure('api span event', err, { spanName: input.spanName, eventName: name });
      }
    },
    setAttributes(attributesToSet) {
      try {
        setApiAttributes(attributesToSet);
      } catch (err) {
        logTraceOperationFailure('api span attributes', err, { spanName: input.spanName });
      }
    },
    endOk(attributesToSet) {
      try {
        if (attributesToSet) setApiAttributes(attributesToSet);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      } catch (err) {
        logTraceOperationFailure('api span end ok', err, { spanName: input.spanName });
      }
    },
    endError(error, attributesToSet) {
      try {
        if (attributesToSet) setApiAttributes(attributesToSet);
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
        span.end();
      } catch (err) {
        logTraceOperationFailure('api span end error', err, { spanName: input.spanName });
      }
    },
  };
}

export async function runDispatchTrace<T>(
  sourceInvocationId: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parentSpanContext = invocationSpanContexts.get(sourceInvocationId);
  const parentContext = parentSpanContext ? trace.setSpanContext(context.active(), parentSpanContext) : context.active();
  const tracer = trace.getTracer('jiuwen-claw.agent');

  return context.with(parentContext, async () => {
    const span = tracer.startSpan('agent.dispatch_task', {
      kind: SpanKind.INTERNAL,
      attributes: cleanAttributes({ 'jiuwen_claw.source_invocation.id': sourceInvocationId, ...attributes }),
    });
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export function recordFeedbackTrace(input: FeedbackTraceInput): void {
  if (!started) return;

  const tracer = trace.getTracer('jiuwen-claw.feedback');
  const voteLabel = input.vote === 1 ? 'like' : 'dislike';
  const attributes = cleanAttributes({
    'jiuwen_claw.feedback.vote': voteLabel,
    'jiuwen_claw.feedback.vote_value': input.vote,
    'jiuwen_claw.feedback.previous_vote': input.previousVote === 1 ? 'like' : input.previousVote === -1 ? 'dislike' : undefined,
    'jiuwen_claw.feedback.reason': input.reason ?? undefined,
    'jiuwen_claw.feedback.timestamp_ms': input.timestamp,
    'jiuwen_claw.thread.id': input.threadId,
    'jiuwen_claw.message.id': input.messageId,
    'jiuwen_claw.user.id': input.userId,
    'jiuwen_claw.invocation.id': input.invocationId,
    'jiuwen_claw.original_trace.id': input.originalTraceId,
    'jiuwen_claw.original_span.id': input.originalSpanId,
    'jiuwen_claw.agent.id': input.agentId,
    'llm.request.model': input.model,
    'llm.provider': input.provider,
    'trajectory.id': input.trajectory?.trajectoryId,
    'trajectory.run.id': input.trajectory?.trajectoryRunId,
    'trajectory.step.id': input.trajectory?.trajectoryStepId,
    'trajectory.event.ids': input.trajectory?.trajectoryEventIds?.join(','),
    'trajectory.event.names': input.trajectory?.trajectoryEventNames?.join(','),
  });

  const parentContext =
    isValidTraceId(input.originalTraceId) && isValidSpanId(input.originalSpanId)
      ? trace.setSpanContext(context.active(), {
          traceId: input.originalTraceId,
          spanId: input.originalSpanId,
          traceFlags: TraceFlags.SAMPLED,
        })
      : context.active();
  const span = tracer.startSpan(
    'conversation.feedback',
    {
      kind: SpanKind.INTERNAL,
      attributes,
    },
    parentContext,
  );
  span.addEvent('conversation.feedback', attributes);
  span.setStatus({ code: SpanStatusCode.OK });
  debugLog({ spanName: 'conversation.feedback', attributes }, '[apm-tracing] feedback span recorded');
  span.end();
}

function recordTrajectoryEventSpan(
  tracer: ReturnType<typeof trace.getTracer>,
  parentSpan: Span,
  invocationId: string,
  eventName: string,
  attributes: Attributes,
): void {
  if (!eventName.startsWith('trajectory.')) return;

  const childSpan = tracer.startSpan(
    buildTrajectoryChildSpanName(eventName, attributes),
    { kind: SpanKind.INTERNAL, attributes: cleanAttributes({ ...attributes, 'trajectory.event.original_name': eventName }) },
    trace.setSpan(context.active(), parentSpan),
  );
  const eventType = String(attributes['trajectory.event.type'] ?? '').toLowerCase();
  const status = String(attributes.status ?? '').toLowerCase();
  if (eventType === 'error' || status === 'error') {
    childSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: typeof attributes['error.message'] === 'string' ? attributes['error.message'] : undefined,
    });
  } else if (eventType === 'done' || status === 'ok') {
    childSpan.setStatus({ code: SpanStatusCode.OK });
  }
  debugLog({ spanName: childSpan.spanContext().spanId, invocationId, attributes }, '[apm-tracing] trajectory child span added');
  childSpan.end();
}

function buildTrajectoryChildSpanName(eventName: string, attributes: Attributes): string {
  const rawSeq = attributes['trajectory.event.seq'];
  const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? String(rawSeq).padStart(3, '0') : 'unknown';
  const rawType = attributes['trajectory.event.type'];
  const type =
    typeof rawType === 'string' && rawType.trim()
      ? rawType.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')
      : eventName.replace(/^trajectory\./, '').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `trajectory.${seq}.${type}`;
}

function isValidTraceId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/i.test(value) && !/^0{32}$/.test(value);
}

function isValidSpanId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value) && !/^0{16}$/.test(value);
}

class PinoDiagLogger implements DiagLogger {
  constructor(private readonly log?: LoggerLike) {}
  verbose(...args: unknown[]): void {
    this.log?.debug?.({ args: sanitizeDiagArgs(args) }, '[apm-tracing] otel verbose');
  }
  debug(...args: unknown[]): void {
    this.log?.debug?.({ args: sanitizeDiagArgs(args) }, '[apm-tracing] otel debug');
  }
  info(...args: unknown[]): void {
    this.log?.info?.({ args: sanitizeDiagArgs(args) }, '[apm-tracing] otel info');
  }
  warn(...args: unknown[]): void {
    this.log?.warn?.({ args: sanitizeDiagArgs(args), otlp: getApmOtlpConfigForDiagnostics() }, '[apm-tracing] otel warn');
  }
  error(...args: unknown[]): void {
    this.log?.error?.({ args: sanitizeDiagArgs(args), otlp: getApmOtlpConfigForDiagnostics() }, '[apm-tracing] otel error');
  }
}

export function getApmOtlpConfigForDiagnostics(): {
  endpoint?: string;
  protocol?: TraceProtocol;
  serviceName?: string;
  headerKeys: string[];
  hasAuthenticationHeader: boolean;
} {
  return {
    endpoint: activeOtlpEndpoint,
    protocol: activeOtlpProtocol,
    serviceName: activeServiceName,
    headerKeys: activeOtlpHeaderKeys,
    hasAuthenticationHeader: activeOtlpHeaderKeys.some((key) => key.toLowerCase() === 'authentication'),
  };
}

function debugLog(obj: Record<string, unknown>, msg: string): void {
  if (!debugEnabled) return;
  activeLogger?.info?.(redactConversationContentForLog(obj), msg);
}

function logTraceOperationFailure(operation: string, error: unknown, fields: Record<string, unknown> = {}): void {
  activeLogger?.warn?.(
    { ...fields, error: sanitizeDiagArgs([error])[0], otlp: getApmOtlpConfigForDiagnostics() },
    `[apm-tracing] ${operation} failed; continuing without blocking request`,
  );
}

export function sanitizeDiagArgs(args: unknown[]): unknown[] {
  return args.map(sanitizeDiagArg);
}

function sanitizeDiagArg(arg: unknown): unknown {
  if (arg instanceof Error) return serializeError(arg);
  if (typeof arg === 'string') return sanitizeDiagString(arg);
  if (typeof arg !== 'object' || arg === null) return arg;
  return redactObject(arg);
}

function sanitizeDiagString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return redactObject(JSON.parse(trimmed));
  } catch {
    return value;
  }
}

function serializeError(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack };
  const record = error as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    output[key] = redactObject(record[key]);
  }
  return output;
}

function redactObject(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  const metadata = serializeGrpcMetadata(value);
  if (metadata) return redactObject(metadata, seen);
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => redactObject(entry, seen));
    seen.delete(value);
    return output;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = /authorization|authentication|token|key|secret|password|headers/i.test(key)
      ? '[REDACTED]'
      : redactObject(entry, seen);
  }
  seen.delete(value);
  return output;
}

function redactConversationContentForLog(value: unknown, seen = new WeakSet<object>()): Record<string, unknown> {
  const redacted = redactDebugLogValue(value, seen);
  return typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted) ? redacted as Record<string, unknown> : {};
}

function redactDebugLogValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => redactDebugLogValue(entry, seen));
    seen.delete(value);
    return output;
  }
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    output[key] = shouldRedactConversationLogField(key, record) ? '[REDACTED_FROM_LOG]' : redactDebugLogValue(entry, seen);
  }
  seen.delete(value);
  return output;
}

function shouldRedactConversationLogField(key: string, record: Record<string, unknown>): boolean {
  if (key === 'jiuwen_claw.conversation.content' || key === 'office_claw.conversation.content') return true;
  if (/^(jiuwen_claw|office_claw)\.conversation\.(user|assistant)\.content$/.test(key)) return true;
  if (/^(jiuwen_claw|office_claw)\.tool\.(input|result)$/.test(key)) return true;
  if (/^(jiuwen_claw|office_claw)\.search\.(query|input|result)$/.test(key)) return true;
  if (/^(jiuwen_claw|office_claw)\.feedback\.reason$/.test(key)) return true;
  if (key === 'jiuwen_claw.error.message' || key === 'office_claw.error.message' || key === 'error.message') return true;
  if (/^(tool|search)\.(input|result|query)$/.test(key)) return true;
  if (key !== 'content') return false;
  const eventType = record['trajectory.event.type'];
  if (eventType === 'user_message' || eventType === 'assistant_message') return true;
  const role = record.role;
  return role === 'user' || role === 'assistant';
}

function serializeGrpcMetadata(value: object): Record<string, unknown> | null {
  if (!('getMap' in value) || typeof value.getMap !== 'function') return null;
  const metadataMap = value.getMap() as Record<string, unknown>;
  return Object.fromEntries(Object.entries(metadataMap).map(([key, entry]) => [key, serializeMetadataValue(entry)]));
}

function serializeMetadataValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (Array.isArray(value)) return value.map(serializeMetadataValue);
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return Boolean(value && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()));
}

function isStandardApmTracingEnabled(env: NodeJS.ProcessEnv): boolean {
  return parseBoolean(env.APM_TRACING_ENABLED ?? env.OFFICE_CLAW_APM_TRACING_ENABLED);
}

function isAutoInstrumentationRegistered(env: NodeJS.ProcessEnv): boolean {
  if (env.OFFICE_CLAW_OTEL_AUTO_REGISTERED === 'code') return true;
  const nodeOptions = env.NODE_OPTIONS ?? '';
  return nodeOptions.includes('@opentelemetry') && nodeOptions.includes('auto-instrumentations-node') && nodeOptions.includes('register');
}

function normalizeProtocol(value: string | undefined): TraceProtocol {
  return value?.trim().toLowerCase() === 'grpc' ? 'grpc' : 'http/protobuf';
}

function normalizeEndpoint(value: string | undefined): string | null {
  const endpoint = value?.trim();
  if (!endpoint) return null;
  return (/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`).replace(/\/+$/, '');
}

function parseHeaders(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  return Object.fromEntries(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      })
      .filter(([key]) => key.length > 0),
  );
}

function cleanAttributes(attributes: Attributes): Attributes {
  const cleaned: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
