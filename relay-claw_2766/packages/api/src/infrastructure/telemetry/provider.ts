/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Tracer and Meter provider access.
 * Lazy initialization after SDK startup.
 */

import { trace, metrics } from '@opentelemetry/api';
import type { Tracer, Meter } from '@opentelemetry/api';

let _tracerName = 'officeclaw';

/**
 * Set the tracer name (called during init).
 */
export function setTracerName(name: string): void {
  _tracerName = name;
}

/**
 * Get the tracer instance.
 */
export function getTracer(name?: string): Tracer {
  return trace.getTracer(name ?? _tracerName);
}

/**
 * Get the meter instance.
 */
export function getMeter(name?: string): Meter {
  return metrics.getMeter(name ?? _tracerName);
}

/**
 * Check if tracing is available (tracer provider registered).
 */
export function isTracingAvailable(): boolean {
  try {
    const tracer = trace.getTracer(_tracerName);
    return tracer !== undefined;
  } catch {
    return false;
  }
}