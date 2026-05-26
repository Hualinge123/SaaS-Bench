# Metric Label Provider Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

**Goal:** Add dynamic labels functionality to HTTP request metrics (`jiuwenclaw.request.count`, `jiuclaw.request.error.count`, `jiuwenclaw.request.duration`) through a plugin mechanism that allows users to customize label sources and content.

**Scope:**
- Applies only to HTTP request metrics (3 metrics), not agent invoke metrics
- Labels are exported as part of metric attributes to OpenTelemetry
- Single provider mode, activated via environment variable configuration

**Key Design Decisions:**
- Create independent `MetricLabelProvider` interface (follows existing MetricsProvider/AuthProvider pattern)
- Simple signature: `resolveLabels(request)` returns labels object or null
- Minimal implementation: direct loading in fastify-hook.ts, no separate module/registry

---

## Architecture

### File Structure

```
packages/plugin/api/src/
  └── metric-label-provider.ts    ← New interface definition (~20 lines)
  └── index.ts                    ← Export MetricLabelProvider

packages/api/src/infrastructure/telemetry/
  └── fastify-hook.ts             ← Load and invoke provider (~15 lines added)
  └── metric-label-providers/
      └── noop.ts                 ← Default provider (returns null) (~10 lines)
      └── x-userid.ts             ← Example implementation (~15 lines)
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `MetricLabelProvider` interface | Contract for dynamic label resolution |
| `fastify-hook.ts` | Load provider at startup, invoke on each request |
| `noop.ts` | Built-in fallback provider (no labels) |
| `x-userid.ts` | Example provider extracting x-userid header |

---

## Interface Definition

### MetricLabelProvider Contract

```typescript
// packages/plugin/api/src/metric-label-provider.ts

import type { FastifyRequest } from 'fastify';

/**
 * Metric Label Provider Plugin API — contract for dynamic metric labels.
 *
 * Provider resolves HTTP request into metric labels (key-value pairs).
 * The platform merges these labels into metric attributes during recording.
 */
export interface MetricLabelProvider {
  /** Unique provider identifier (runtime string, never hardcoded in platform). */
  readonly id: string;
  /** Human-readable name shown in logs and admin UI. */
  readonly displayName?: string;

  /**
   * Called once at startup. Use for provider-level initialization
   * (e.g., validate config, warm up connections).
   */
  bootstrap?(): Promise<void>;

  /**
   * Resolve metric labels from HTTP request.
   * Return null to skip adding labels.
   * Return object to merge into metric attributes.
   */
  resolveLabels(request: FastifyRequest): Promise<Record<string, string | number | boolean> | null>;

  /**
   * Called on shutdown. Use for cleanup.
   */
  shutdown?(): Promise<void>;
}
```

### Export to Plugin Index

```typescript
// packages/plugin/api/src/index.ts
export type { MetricLabelProvider } from './metric-label-provider.js';
```

---

## Implementation

### Provider Loading Logic

```typescript
// packages/api/src/infrastructure/telemetry/fastify-hook.ts

import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

let metricLabelProvider: MetricLabelProvider | null = null;
let providerLoaded = false;

async function loadMetricLabelProvider(): Promise<MetricLabelProvider> {
  const moduleSpecifier = process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE;
  if (!moduleSpecifier) {
    // Built-in noop provider
    return {
      id: 'noop',
      displayName: 'No Labels Provider',
      resolveLabels: async () => null,
    };
  }

  try {
    const module = await import(moduleSpecifier);
    // Support default export or metricLabelProvider export
    if (module.default?.id) return module.default;
    if (module.metricLabelProvider?.id) return module.metricLabelProvider;
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

// Initialize provider at module load time (called once)
async function ensureProviderLoaded(): Promise<void> {
  if (!providerLoaded) {
    metricLabelProvider = await loadMetricLabelProvider();
    await metricLabelProvider.bootstrap?.();
    providerLoaded = true;
  }
}
```

### Request Hook Integration

```typescript
// In onResponse hook (fastify-hook.ts)

// Ensure provider is loaded (first request triggers load)
await ensureProviderLoaded();

// Build base attributes
const baseAttributes = {
  [HTTP_METHOD]: request.method,
  [HTTP_ROUTE]: request.routerPath ?? '',
};

// Resolve dynamic labels from provider
let dynamicLabels: Record<string, string | number | boolean> | null = null;
try {
  dynamicLabels = await metricLabelProvider.resolveLabels(request);
} catch (error) {
  // Provider execution failure: use null fallback, don't block metrics
  console.warn(`MetricLabelProvider.resolveLabels failed:`, error);
  dynamicLabels = null;
}

// Merge labels into final attributes
const attributes = dynamicLabels
  ? { ...baseAttributes, ...dynamicLabels }
  : baseAttributes;

// Record metrics with merged attributes
getRequestCount().add(1, attributes);
getRequestDuration().record(duration, attributes);

if (reply.statusCode >= 500) {
  getRequestErrorCount().add(1, attributes);
}
```

---

## Built-in Providers

### noop Provider (Default)

```typescript
// packages/api/src/infrastructure/telemetry/metric-label-providers/noop.ts

import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'noop',
  displayName: 'No Labels Provider',
  resolveLabels: async () => null,
};
```

### x-userid Provider (Example)

```typescript
// packages/api/src/infrastructure/telemetry/metric-label-providers/x-userid.ts

import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'x-userid',
  displayName: 'X-UserID Header Label Provider',
  resolveLabels: async (request) => {
    const userId = request.headers['x-userid'] as string | undefined;
    return userId ? { 'officeclaw.user.id': userId } : null;
  },
};
```

---

## Data Flow

### Request Processing Flow

```
HTTP Request enters
    │
    ▼
fastify-hook.ts: onRequest
    ├── Create span
    ├── Store telemetryStartTime
    │
    ▼
fastify-hook.ts: onResponse
    ├── Build base attributes: {http.method, http.route}
    ├── Call metricLabelProvider.resolveLabels(request)
    │   ├── If returns object → merge into attributes
    │   └── If returns null → no additional labels
    ├── Record metrics:
    │   ├── getRequestCount().add(1, attributes)
    │   ├── getRequestDuration().record(duration, attributes)
    │   └── getRequestErrorCount().add(1, attributes) [if error]
    │
    ▼
OpenTelemetry Exporter
    └── Metric attributes contain base labels + provider labels
```

### Example Scenarios

**Scenario 1: Using x-userid provider**
```bash
# Environment: OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=./dist/infrastructure/telemetry/metric-label-providers/x-userid.js

# HTTP Request header: x-userid=alice
# Metric attributes: {http.method: 'GET', http.route: '/api/messages', officeclaw.user.id: 'alice'}
```

**Scenario 2: No provider configured (noop)**
```bash
# Environment: OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE not set

# HTTP Request header: x-userid=alice
# Metric attributes: {http.method: 'GET', http.route: '/api/messages'}  // No additional labels
```

---

## Third-party Integration

### Creating a Custom Provider

Third-party developers need to:
1. Install contracts package: `pnpm add @openjiuwen/relay-api-server-contracts`
2. Create provider implementation file

```typescript
// In third-party package: @my-company/my-metric-label-provider/src/index.ts
import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'my-custom-labels',
  displayName: 'My Custom Labels Provider',

  async resolveLabels(request) {
    // Third-party custom logic
    const tenantId = request.headers['x-tenant-id'];
    const featureFlag = request.headers['x-feature-flag'];

    if (!tenantId && !featureFlag) return null;

    return {
      'officeclaw.tenant.id': tenantId || 'unknown',
      'officeclaw.feature.flag': featureFlag || 'default',
    };
  },
};
```

3. Package and publish to npm or private registry

### Deploying with Custom Provider

```bash
# Environment configuration
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=@my-company/my-metric-label-provider

# Start API
pnpm start
```

Provider is automatically invoked by OfficeClaw's telemetry hook on each HTTP request.

---

## Error Handling

### Provider Load Failure

```typescript
// Load failure: fallback to noop, don't block service startup
try {
  metricLabelProvider = await loadMetricLabelProvider();
} catch (error) {
  console.warn('Failed to load MetricLabelProvider, using noop fallback:', error);
  metricLabelProvider = { id: 'noop-fallback', resolveLabels: async () => null };
}
```

### resolveLabels Execution Failure

```typescript
// Execution failure: use null fallback, don't block metrics recording
let labels = null;
try {
  labels = await metricLabelProvider.resolveLabels(request);
} catch (error) {
  console.warn('MetricLabelProvider.resolveLabels failed:', error);
  labels = null;
}
```

### Key Principles

- Provider load failure → fallback to noop, service continues
- resolveLabels execution failure → use null, metrics recorded normally
- Never block HTTP request processing or metrics export

---

## Testing Strategy

### Unit Tests

**Test files:**
- `packages/api/test/metric-label-provider-noop.test.ts` — noop behavior
- `packages/api/test/metric-label-provider-x-userid.test.ts` — x-userid behavior

**Example test:**
```typescript
// metric-label-provider-x-userid.test.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { metricLabelProvider } = await import('../dist/infrastructure/telemetry/metric-label-providers/x-userid.js');

describe('x-userid MetricLabelProvider', () => {
  test('should return officeclaw.user.id when x-userid header present', async () => {
    const request = { headers: { 'x-userid': 'alice' } };
    const labels = await metricLabelProvider.resolveLabels(request as any);
    assert.deepEqual(labels, { 'officeclaw.user.id': 'alice' });
  });

  test('should return null when x-userid header absent', async () => {
    const request = { headers: {} };
    const labels = await metricLabelProvider.resolveLabels(request as any);
    assert.equal(labels, null);
  });
});
```

### Integration Tests

**Test file:** `packages/api/test/metric-label-provider-integration.test.ts`

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import Fastify from 'fastify';

describe('MetricLabelProvider Integration', () => {
  let app: Fastify.FastifyInstance;
  let exporter: InMemoryMetricExporter;

  before(async () => {
    // Setup with x-userid provider (use compiled .js path)
    process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE = './dist/infrastructure/telemetry/metric-label-providers/x-userid.js';

    exporter = new InMemoryMetricExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 100,
    });

    // Initialize minimal telemetry for test
    const { initTelemetry } = await import('../dist/infrastructure/telemetry/init.js');
    await initTelemetry();

    app = Fastify();
    app.get('/test', async () => ({ ok: true }));

    const { registerTelemetryHook } = await import('../dist/infrastructure/telemetry/fastify-hook.js');
    registerTelemetryHook(app);
    await app.ready();
  });

  after(async () => {
    await app.close();
    delete process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE;
  });

  test('HTTP request metrics include dynamic labels from provider', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-userid': 'alice' },
    });

    assert.equal(response.statusCode, 200);

    // Wait for metrics export
    await new Promise(resolve => setTimeout(resolve, 150));

    const exportedMetrics = exporter.getMetrics();
    const requestCounter = exportedMetrics.find(m => m.descriptor.name === 'jiuwenclaw.request.count');

    assert.ok(requestCounter, 'Should have request.count metric');

    const dataPoint = requestCounter!.dataPoints.find(dp =>
      dp.attributes['http.route'] === '/test' &&
      dp.attributes['http.method'] === 'GET'
    );

    assert.ok(dataPoint, 'Should have data point for /test route');
    assert.equal(dataPoint!.attributes['officeclaw.user.id'], 'alice', 'Should include dynamic label from provider');
  });
});
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` | Module specifier for MetricLabelProvider | Built-in noop |

### Example Configuration

```bash
# Use built-in x-userid provider (use compiled .js path)
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=./dist/infrastructure/telemetry/metric-label-providers/x-userid.js

# Use third-party provider
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=@my-company/my-metric-label-provider

# No provider (noop)
# (unset OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE)
```

---

## Documentation Updates

Update `docs/feature/F-telemetry-metrics-analysis.md`:

Add section explaining MetricLabelProvider mechanism:
- How to configure provider via environment variable
- How dynamic labels are merged into metric attributes
- Example provider implementations (noop, x-userid)

---

## Success Criteria

- [ ] MetricLabelProvider interface defined in packages/plugin/api
- [ ] Provider loading logic in fastify-hook.ts
- [ ] Built-in noop provider
- [ ] Built-in x-userid provider (example)
- [ ] HTTP metrics include dynamic labels when provider configured
- [ ] HTTP metrics unchanged when provider not configured (noop)
- [ ] Agent metrics unchanged
- [ ] Error handling: provider failures don't block service
- [ ] Tests pass (unit + integration)
- [ ] Documentation updated

---

## Scope

**In scope:**
- MetricLabelProvider interface definition
- Minimal provider loading in fastify-hook.ts
- Built-in noop and x-userid providers
- HTTP request metrics (3 metrics)

**Out of scope:**
- Agent invoke metrics
- Span attributes
- Separate module/registry (using minimal implementation)
- Admin UI for provider configuration