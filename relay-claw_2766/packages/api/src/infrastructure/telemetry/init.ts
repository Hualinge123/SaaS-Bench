/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * OpenTelemetry SDK initialization.
 * Graceful degradation: failures are logged and silently ignored.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { InstrumentType } from '@opentelemetry/sdk-metrics';
import { createModuleLogger } from '../../infrastructure/logger.js';
import { createTelemetryModule, type TelemetryModule } from './telemetry-module.js';
import { setTracerName } from './provider.js';
import { ResourceAttributesProcessor } from './resource-attributes-processor.js';

const log = createModuleLogger('telemetry');

let _initialized = false;
let _sdk: NodeSDK | null = null;
let _telemetryModule: TelemetryModule | null = null;

/**
 * Initialize OpenTelemetry SDK.
 * Non-blocking: returns immediately, errors are logged.
 */
export async function initTelemetry(): Promise<void> {
  if (_initialized) {
    log.debug('Telemetry already initialized');
    return;
  }

  try {
    // 1. Create telemetry module (load providers, select active)
    _telemetryModule = await createTelemetryModule();
    const activeProvider = _telemetryModule.getActiveProvider();

    log.info(
      { providerId: activeProvider.id, displayName: activeProvider.displayName },
      'Telemetry provider selected',
    );

    // 2. Get components from provider
    const traceExporter = activeProvider.createTraceExporter?.() ?? undefined;
    const metricReader = activeProvider.createMetricReader?.() ?? undefined;
    const resource = activeProvider.createResource?.() ?? undefined;
    const instrumentations = activeProvider.getInstrumentations?.() ?? [];

    // 3. Set tracer name from resource
    const serviceName = resource?.attributes?.['service.name'] ?? 'officeclaw';
    setTracerName(String(serviceName));

    // 4. Create SDK with View configuration for resource attributes
    // Note: In OpenTelemetry SDK 2.0+, NodeSDK accepts ViewOptions objects (not View instances)
    // and uses 'attributesProcessors' (plural, array) instead of 'attributesProcessor' (singular)
    _sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations,
      views: resource
        ? [
            // Apply to all Counter metrics
            {
              instrumentName: '*',
              instrumentType: InstrumentType.COUNTER,
              attributesProcessors: [new ResourceAttributesProcessor(resource)],
            },
            // Apply to all Histogram metrics
            {
              instrumentName: '*',
              instrumentType: InstrumentType.HISTOGRAM,
              attributesProcessors: [new ResourceAttributesProcessor(resource)],
            },
          ]
        : undefined,
    });

    // 5. Start SDK
    await _sdk.start();
    _initialized = true;

    log.info({ providerId: activeProvider.id }, 'Telemetry initialized');
  } catch (error) {
    log.warn({ error: String(error) }, 'Telemetry initialization failed, continuing without telemetry');
  }
}

/**
 * Shutdown telemetry SDK (for graceful shutdown).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!_sdk) return;

  try {
    await _sdk.shutdown();

    // Call provider's shutdown
    const activeProvider = _telemetryModule?.getActiveProvider();
    await activeProvider?.shutdown?.();

    log.info('Telemetry shutdown complete');
  } catch (error) {
    log.warn({ error: String(error) }, 'Telemetry shutdown failed');
  }
}

/**
 * Check if telemetry is initialized.
 */
export function isTelemetryInitialized(): boolean {
  return _initialized;
}

/**
 * Get the telemetry module (for diagnostics).
 */
export function getTelemetryModule(): TelemetryModule | null {
  return _telemetryModule;
}