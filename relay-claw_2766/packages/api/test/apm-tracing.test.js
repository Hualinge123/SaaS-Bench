/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Metadata } from '@grpc/grpc-js';

test('sanitizeDiagArgs redacts sensitive fields and handles circular references', async () => {
  const { sanitizeDiagArgs } = await import('../dist/infrastructure/tracing/apm-tracing.js');

  const nested = { token: 'secret-token', value: 'safe' };
  const input = {
    authorization: 'Bearer secret',
    nested,
    repeated: nested,
    list: [],
  };
  input.self = input;
  input.list.push(input);

  const [sanitized] = sanitizeDiagArgs([input]);

  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
  assert.equal(sanitized.nested.value, 'safe');
  assert.equal(sanitized.repeated.value, 'safe');
  assert.equal(sanitized.self, '[Circular]');
  assert.equal(sanitized.list[0], '[Circular]');
});

test('sanitizeDiagArgs expands gRPC error metadata and redacts authentication values', async () => {
  const { sanitizeDiagArgs } = await import('../dist/infrastructure/tracing/apm-tracing.js');

  const metadata = new Metadata();
  metadata.set('grpc-status-details-bin', Buffer.from('diagnostic-detail'));
  metadata.set('x-request-id', 'request-1');
  metadata.set('Authentication', 'secret-auth');

  const error = new Error('2 UNKNOWN: ');
  error.code = 2;
  error.details = '';
  error.metadata = metadata;

  const [sanitized] = sanitizeDiagArgs([error]);

  assert.equal(sanitized.name, 'Error');
  assert.equal(sanitized.message, '2 UNKNOWN: ');
  assert.equal(sanitized.code, 2);
  assert.equal(sanitized.details, '');
  assert.equal(sanitized.metadata['x-request-id'], 'request-1');
  assert.equal(sanitized.metadata.authentication, '[REDACTED]');
  assert.equal(sanitized.metadata['grpc-status-details-bin'], '<Buffer 17 bytes>');
});

test('sanitizeDiagArgs parses JSON string diagnostics before logging', async () => {
  const { sanitizeDiagArgs } = await import('../dist/infrastructure/tracing/apm-tracing.js');

  const [sanitized] = sanitizeDiagArgs([
    JSON.stringify({
      message: '2 UNKNOWN: ',
      code: '2',
      metadata: '[object Object]',
      headers: { Authentication: 'secret-auth' },
    }),
  ]);

  assert.equal(sanitized.message, '2 UNKNOWN: ');
  assert.equal(sanitized.code, '2');
  assert.equal(sanitized.metadata, '[object Object]');
  assert.equal(sanitized.headers, '[REDACTED]');
});

test('tryRegisterApmAutoInstrumentationFromCode degrades when registration fails', async () => {
  const previousApmTracingEnabled = process.env.APM_TRACING_ENABLED;
  try {
    process.env.APM_TRACING_ENABLED = 'false';
    const { tryRegisterApmAutoInstrumentationFromCode } = await import(
      `../dist/infrastructure/tracing/apm-auto-register.js?test=${Date.now()}`
    );
    const warnings = [];
    const log = {
      warn(obj, msg) {
        warnings.push({ obj, msg });
      },
    };

    delete process.env.OFFICE_CLAW_OTEL_AUTO_REGISTERED;
    const registered = await tryRegisterApmAutoInstrumentationFromCode(log, async () => {
      throw new Error('bad collector setup');
    });

    assert.equal(registered, false);
    assert.equal(process.env.OFFICE_CLAW_OTEL_AUTO_REGISTERED, undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].msg, /auto-instrumentation registration failed/);
    assert.equal(warnings[0].obj.error.message, 'bad collector setup');
  } finally {
    if (previousApmTracingEnabled === undefined) {
      delete process.env.APM_TRACING_ENABLED;
    } else {
      process.env.APM_TRACING_ENABLED = previousApmTracingEnabled;
    }
  }
});

test('refreshApmRuntimeDefaults fills APM defaults without overriding explicit values', async () => {
  const {
    refreshApmRuntimeDefaults,
    prepareApmRuntimeEnvBeforeTelemetry,
  } = await import('../dist/infrastructure/tracing/apm-auto-register.js');
  const env = {
    APM_TRACING_DEBUG: '',
    OTEL_TRACES_EXPORTER: 'console',
    OTEL_METRICS_EXPORTER: '',
    OTEL_LOGS_EXPORTER: undefined,
    OTEL_NODE_DISABLED_INSTRUMENTATIONS: '',
    OTEL_EXPORTER_OTLP_PROTOCOL: '',
  };

  refreshApmRuntimeDefaults(env);

  assert.equal(env.APM_TRACING_DEBUG, 'false');
  assert.equal(env.OTEL_TRACES_EXPORTER, 'console');
  assert.equal(env.OTEL_METRICS_EXPORTER, 'none');
  assert.equal(env.OTEL_LOGS_EXPORTER, 'none');
  assert.equal(env.OTEL_NODE_DISABLED_INSTRUMENTATIONS, 'net,http,fastify,express,undici');
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, 'grpc');
  assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL, 'grpc');
  assert.equal(env.OTEL_NODE_RESOURCE_DETECTORS, 'env,host,os');

  const preinitEnv = {
    APM_TRACING_ENABLED: 'true',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  };
  prepareApmRuntimeEnvBeforeTelemetry(preinitEnv);
  assert.equal(preinitEnv.OTEL_TRACES_EXPORTER, 'none');
  assert.equal(preinitEnv.OTEL_METRICS_EXPORTER, 'none');
  assert.equal(preinitEnv.OTEL_LOGS_EXPORTER, 'none');
  assert.equal(preinitEnv.OTEL_EXPORTER_OTLP_PROTOCOL, 'grpc');
  assert.equal(preinitEnv.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL, 'grpc');
});

test('applyLoginTraceOtelEnv sets trace-specific OTLP config before auto instrumentation', async () => {
  const { applyLoginTraceOtelEnv } = await import('../dist/infrastructure/tracing/apm-login-config.js');
  const env = {
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
  };

  applyLoginTraceOtelEnv(
    {
      appTraceToken: 'token-1',
      apmApiUrlBase: 'https://apm-access.example.com',
    },
    'domain-1',
    env,
  );

  assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, 'https://apm-access.example.com/v1/traces');
  assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, 'https://apm-access.example.com/v1/traces');
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, 'Authentication=token-1');
  assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS, 'Authentication=token-1');
  assert.equal(env.OTEL_TRACES_EXPORTER, 'otlp');
  assert.equal(env.OTEL_METRICS_EXPORTER, 'none');
  assert.equal(env.OTEL_LOGS_EXPORTER, 'none');
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, 'grpc');
  assert.equal(env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL, 'grpc');
  assert.equal(env.OTEL_SERVICE_NAME, 'claw_domain-1.jiuwen-claw-client.prod');
});

test('telemetry config keeps signal-specific none instead of falling back to global exporter', async () => {
  const {
    loadTelemetryConfig,
    resolveMetricsExporterConfig,
    resolveTracesExporterConfig,
  } = await import('../dist/infrastructure/telemetry/config.js');
  const cfg = loadTelemetryConfig({
    OTEL_ENABLED: 'true',
    OTEL_EXPORTER_TYPE: 'otlp',
    OTEL_TRACES_EXPORTER: 'none',
    OTEL_METRICS_EXPORTER: 'none',
  });

  assert.equal(resolveTracesExporterConfig(cfg).exporter, 'none');
  assert.equal(resolveMetricsExporterConfig(cfg).exporter, 'none');
});

test('refreshApmRuntimeDefaults preserves custom disabled instrumentations while limiting HTTP auto spans', async () => {
  const { refreshApmRuntimeDefaults } = await import('../dist/infrastructure/tracing/apm-auto-register.js');
  const env = {
    OTEL_NODE_DISABLED_INSTRUMENTATIONS: 'fs,net',
  };

  refreshApmRuntimeDefaults(env);

  assert.equal(env.OTEL_NODE_DISABLED_INSTRUMENTATIONS, 'fs,net,http,fastify,express,undici');
});

test('clearApmRuntimeEnv removes only APM and OpenTelemetry runtime variables', async () => {
  const { clearApmRuntimeEnv } = await import('../dist/infrastructure/tracing/apm-runtime-env.js');
  const env = {
    APM_TRACING_ENABLED: 'true',
    APM_OTLP_ENDPOINT: 'https://collector.example',
    OTEL_TRACES_EXPORTER: 'otlp',
    OFFICE_CLAW_APM_TRACING_DEBUG: 'true',
    OFFICE_CLAW_OTEL_AUTO_REGISTERED: 'code',
    REDIS_URL: 'redis://127.0.0.1:6379',
  };

  clearApmRuntimeEnv(env);

  assert.deepEqual(env, {
    REDIS_URL: 'redis://127.0.0.1:6379',
  });
});

test('recordFeedbackTrace reports like and dislike feedback attributes to APM', async () => {
  const { trace } = await import('@opentelemetry/api');
  const spans = [];
  const provider = {
    getTracer() {
      return {
        startSpan(name, options, parentContext) {
          const span = {
            name,
            options,
            parentContext,
            events: [],
            status: null,
            ended: false,
            addEvent(eventName, attributes) {
              this.events.push({ name: eventName, attributes });
              return this;
            },
            setStatus(status) {
              this.status = status;
              return this;
            },
            setAttribute(key, value) {
              this.options.attributes[key] = value;
              return this;
            },
            setAttributes(attributes) {
              Object.assign(this.options.attributes, attributes);
              return this;
            },
            recordException() {
              return this;
            },
            spanContext() {
              return { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1 };
            },
            end() {
              this.ended = true;
            },
          };
          spans.push(span);
          return span;
        },
      };
    },
  };
  trace.setGlobalTracerProvider(provider);

  const { initApmTracingFromEnv, recordFeedbackTrace, shutdownApmTracing } = await import(
    '../dist/infrastructure/tracing/apm-tracing.js'
  );
  initApmTracingFromEnv({ APM_TRACING_ENABLED: 'true' });

  recordFeedbackTrace({
    threadId: 'thread-1',
    messageId: 'msg-1',
    userId: 'user-1',
    vote: -1,
    timestamp: 123,
    invocationId: 'inv-1',
    originalTraceId: '1'.repeat(32),
    originalSpanId: '2'.repeat(16),
    agentId: 'codex',
    model: 'claude',
    provider: 'anthropic',
    reason: 'not_complete',
    previousVote: 1,
    trajectory: {
      trajectoryId: 'traj-1',
      trajectoryEventIds: ['event-1', 'event-2'],
      trajectoryEventNames: ['assistant_message', 'done'],
    },
  });

  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.name, 'conversation.feedback');
  assert.equal(span.ended, true);
  assert.equal(span.options.attributes['jiuwen_claw.feedback.vote'], 'dislike');
  assert.equal(span.options.attributes['jiuwen_claw.feedback.vote_value'], -1);
  assert.equal(span.options.attributes['jiuwen_claw.feedback.previous_vote'], 'like');
  assert.equal(span.options.attributes['jiuwen_claw.feedback.reason'], 'not_complete');
  assert.equal(span.options.attributes['jiuwen_claw.invocation.id'], 'inv-1');
  assert.equal(span.options.attributes['jiuwen_claw.original_trace.id'], '1'.repeat(32));
  assert.equal(span.options.attributes['jiuwen_claw.original_span.id'], '2'.repeat(16));
  assert.equal(span.options.attributes['jiuwen_claw.agent.id'], 'codex');
  assert.equal(span.options.attributes['llm.request.model'], 'claude');
  assert.equal(span.options.attributes['llm.provider'], 'anthropic');
  assert.equal(span.options.attributes['trajectory.event.ids'], 'event-1,event-2');
  assert.equal(span.events[0].name, 'conversation.feedback');
  assert.equal(span.events[0].attributes['jiuwen_claw.feedback.vote'], 'dislike');
  const parentSpanContext = trace.getSpanContext(span.parentContext);
  assert.equal(parentSpanContext.traceId, '1'.repeat(32));
  assert.equal(parentSpanContext.spanId, '2'.repeat(16));

  await shutdownApmTracing();
});
