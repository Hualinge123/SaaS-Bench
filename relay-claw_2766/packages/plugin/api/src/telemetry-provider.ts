/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Telemetry Provider Plugin API — contract for telemetry SDK configuration.
 *
 * Design constraints:
 *   - Provider ID is a runtime string, never an enum/union.
 *   - All methods optional — provider can provide partial capabilities.
 *   - Returning null means the component is not enabled.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { Resource } from '@opentelemetry/resources';
import type { Instrumentation } from '@opentelemetry/instrumentation';

/**
 * The contract that every telemetry provider must satisfy.
 *
 * Required: id, displayName.
 * Optional: bootstrap, createTraceExporter, createMetricReader, createResource, getInstrumentations, shutdown.
 */
export interface TelemetryProvider {
  /** Unique provider identifier (runtime string, never hardcoded in platform). */
  readonly id: string;
  /** Human-readable name shown in logs and admin UI. */
  readonly displayName: string;

  /**
   * Called once at startup. Use for provider-level initialization
   * (e.g., validate config, warm up connections).
   */
  bootstrap?(): Promise<void>;

  /**
   * Create trace exporter for OpenTelemetry SDK.
   * Return null to disable tracing.
   */
  createTraceExporter?(): SpanExporter | null;

  /**
   * Create metric reader for OpenTelemetry SDK.
   * Return null to disable metrics.
   */
  createMetricReader?(): MetricReader | null;

  /**
   * Create resource attributes (service name, instance id, etc).
   * Return null to use default resource.
   */
  createResource?(): Resource | null;

  /**
   * Return instrumentation list for auto-instrumentation.
   * Return empty array for no auto-instrumentation.
   */
  getInstrumentations?(): Instrumentation[];

  /**
   * Called on shutdown. Use for cleanup (e.g., flush pending data).
   */
  shutdown?(): Promise<void>;
}