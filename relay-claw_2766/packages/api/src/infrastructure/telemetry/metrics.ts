/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Metric definitions for OfficeClaw API.
 * Matches jiuwenclaw/telemetry/metrics.py pattern.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, ObservableGauge } from '@opentelemetry/api';
import { getMeter } from './provider.js';

// --- Request Metrics ---

/** Total HTTP request count */
export function createRequestCount(): Counter {
  return getMeter().createCounter('jiuwenclaw.request.count', {
    unit: '{request}',
    description: 'Total HTTP request count',
  });
}

/** Failed HTTP request count */
export function createRequestErrorCount(): Counter {
  return getMeter().createCounter('officeclaw.request.error.count', {
    unit: '{request}',
    description: 'Failed HTTP request count',
  });
}

/** HTTP request duration histogram */
export function createRequestDuration(): Histogram {
  return getMeter().createHistogram('jiuwenclaw.request.duration', {
    unit: 's',
    description: 'HTTP request processing duration',
  });
}

// --- Agent Metrics ---

/** Agent invocation count */
export function createAgentInvokeCount(): Counter {
  return getMeter().createCounter('jiuwenclaw.agent.invoke.count', {
    unit: '{invoke}',
    description: 'Total agent invocation count',
  });
}

/** Agent invocation error count */
export function createAgentInvokeErrorCount(): Counter {
  return getMeter().createCounter('officeclaw.agent.invoke.error.count', {
    unit: '{invoke}',
    description: 'Failed agent invocation count',
  });
}

/** Agent invocation duration histogram */
export function createAgentInvokeDuration(): Histogram {
  return getMeter().createHistogram('jiuwenclaw.agent.invoke.duration', {
    unit: 's',
    description: 'Agent invocation duration',
  });
}

// --- LLM Metrics (matching OpenTelemetry GenAI semantic conventions) ---

/** LLM call duration */
export function createLlmCallDuration(): Histogram {
  return getMeter().createHistogram('gen_ai.client.operation.duration', {
    unit: 's',
    description: 'LLM call duration',
  });
}

/** LLM token usage by type */
export function createLlmTokenUsage(): Counter {
  return getMeter().createCounter('gen_ai.client.token.usage', {
    unit: '{token}',
    description: 'LLM token usage by type',
  });
}

/** LLM call count */
export function createLlmCallCount(): Counter {
  return getMeter().createCounter('gen_ai.client.operation.count', {
    unit: '{call}',
    description: 'LLM call count',
  });
}

// --- Invocation Metrics ---

/** Active invocations gauge (observable) */
export function createActiveInvocationGauge(observeFn: () => number): ObservableGauge {
  const gauge = getMeter().createObservableGauge('officeclaw.invocation.active', {
    unit: '{invocation}',
    description: 'Current active invocation count',
  });
  gauge.addCallback((observableResult) => {
    observableResult.observe(observeFn());
  });
  return gauge;
}

// --- Lazy-initialized metric instances ---

let _requestCount: Counter | null = null;
let _requestErrorCount: Counter | null = null;
let _requestDuration: Histogram | null = null;
let _agentInvokeCount: Counter | null = null;
let _agentInvokeErrorCount: Counter | null = null;
let _agentInvokeDuration: Histogram | null = null;

export function getRequestCount(): Counter {
  if (!_requestCount) _requestCount = createRequestCount();
  return _requestCount;
}

export function getRequestErrorCount(): Counter {
  if (!_requestErrorCount) _requestErrorCount = createRequestErrorCount();
  return _requestErrorCount;
}

export function getRequestDuration(): Histogram {
  if (!_requestDuration) _requestDuration = createRequestDuration();
  return _requestDuration;
}

export function getAgentInvokeCount(): Counter {
  if (!_agentInvokeCount) _agentInvokeCount = createAgentInvokeCount();
  return _agentInvokeCount;
}

export function getAgentInvokeErrorCount(): Counter {
  if (!_agentInvokeErrorCount) _agentInvokeErrorCount = createAgentInvokeErrorCount();
  return _agentInvokeErrorCount;
}

export function getAgentInvokeDuration(): Histogram {
  if (!_agentInvokeDuration) _agentInvokeDuration = createAgentInvokeDuration();
  return _agentInvokeDuration;
}
