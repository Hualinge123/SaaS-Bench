/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * OpenTelemetry Telemetry Module Entry Point.
 */

export * from './attributes.js';
export { loadTelemetryConfig, type TelemetryConfig } from './config.js';
export { registerTelemetryHook } from './fastify-hook.js';
export { initTelemetry, isTelemetryInitialized, shutdownTelemetry, getTelemetryModule } from './init.js';
export {
  getAgentInvokeCount,
  getAgentInvokeDuration,
  getAgentInvokeErrorCount,
  getRequestCount,
  getRequestDuration,
  getRequestErrorCount,
} from './metrics.js';
export {
  buildTraceContextForE2A,
  extractTraceContext,
  getCurrentSpanId,
  getCurrentTraceId,
  injectTraceContext,
} from './propagation.js';
export { getMeter, getTracer, setTracerName } from './provider.js';

export {
  createTelemetryModule,
  type TelemetryModule,
  type CreateTelemetryModuleOptions,
} from './telemetry-module.js';

export { TelemetryProviderRegistry } from './provider-registry.js';

export { createBuiltinTelemetryProvider } from './providers/builtin-telemetry.js';
