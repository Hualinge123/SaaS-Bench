# Metric Label Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic labels functionality to HTTP request metrics through MetricLabelProvider plugin mechanism.

**Architecture:** Minimal implementation — MetricLabelProvider interface in packages/plugin/api, direct provider loading in fastify-hook.ts, built-in noop and x-userid providers.

**Tech Stack:** TypeScript, Fastify, OpenTelemetry Metrics API, Node.js test runner

---

## File Structure

**New Files:**
- `packages/plugin/api/src/metric-label-provider.ts` — MetricLabelProvider interface definition
- `packages/api/src/infrastructure/telemetry/metric-label-providers/noop.ts` — Default provider (returns null)
- `packages/api/src/infrastructure/telemetry/metric-label-providers/x-userid.ts` — Example provider (extracts x-userid header)
- `packages/api/test/metric-label-provider-noop.test.ts` — Unit test for noop provider
- `packages/api/test/metric-label-provider-x-userid.test.ts` — Unit test for x-userid provider
- `packages/api/test/metric-label-provider-integration.test.ts` — Integration test for provider loading

**Modified Files:**
- `packages/plugin/api/src/index.ts` — Export MetricLabelProvider type
- `packages/api/src/infrastructure/telemetry/fastify-hook.ts` — Add provider loading and invocation logic
- `docs/feature/F-telemetry-metrics-analysis.md` — Document MetricLabelProvider mechanism

---

## Task 1: MetricLabelProvider Interface Definition

**Files:**
- Create: `packages/plugin/api/src/metric-label-provider.ts`
- Modify: `packages/plugin/api/src/index.ts`

### Step 1.1: Create MetricLabelProvider interface file

- [ ] **Create interface definition file**

Create `packages/plugin/api/src/metric-label-provider.ts`:

```typescript
/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Metric Label Provider Plugin API — contract for dynamic metric labels.
 *
 * Provider resolves HTTP request into metric labels (key-value pairs).
 * The platform merges these labels into metric attributes during recording.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Metric Label Provider contract.
 *
 * Extension point for dynamic HTTP request metric labels.
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

### Step 1.2: Export MetricLabelProvider from plugin index

- [ ] **Add export to index.ts**

Edit `packages/plugin/api/src/index.ts`:

Add line after line 64 (after TelemetryProvider export):

```typescript
export type { MetricLabelProvider } from './metric-label-provider.js';
```

### Step 1.3: Build plugin package

- [ ] **Build to verify TypeScript compiles**

Run: `cd packages/plugin/api && pnpm run build`

Expected: SUCCESS (no TypeScript errors)

### Step 1.4: Commit interface definition

- [ ] **Commit interface definition**

```bash
git add packages/plugin/api/src/metric-label-provider.ts
git add packages/plugin/api/src/index.ts
git commit -m "feat(plugin): add MetricLabelProvider interface for dynamic metric labels

- Define MetricLabelProvider contract in packages/plugin/api
- Support resolveLabels(request) returning key-value pairs or null
- Optional bootstrap/shutdown lifecycle methods
- Export MetricLabelProvider type from plugin index"
```

---

## Task 2: noop Provider Implementation

**Files:**
- Create: `packages/api/src/infrastructure/telemetry/metric-label-providers/noop.ts`
- Create: `packages/api/test/metric-label-provider-noop.test.ts`

### Step 2.1: Write failing test for noop provider

- [ ] **Create test file with first test case**

Create `packages/api/test/metric-label-provider-noop.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { metricLabelProvider } = await import('../dist/infrastructure/telemetry/metric-label-providers/noop.js');

describe('noop MetricLabelProvider', () => {
  test('should return null (no labels)', async () => {
    const request = { headers: {} };
    const labels = await metricLabelProvider.resolveLabels(request as any);
    assert.equal(labels, null);
  });

  test('should have id "noop"', () => {
    assert.equal(metricLabelProvider.id, 'noop');
  });

  test('should have displayName', () => {
    assert.equal(metricLabelProvider.displayName, 'No Labels Provider');
  });
});
```

### Step 2.2: Run test to verify it fails

- [ ] **Run test and confirm failure**

Run: `cd packages/api && node --test test/metric-label-provider-noop.test.ts`

Expected: FAIL with "Cannot find module '../dist/infrastructure/telemetry/metric-label-providers/noop.js'"

### Step 2.3: Create noop provider implementation

- [ ] **Create noop provider file**

Create `packages/api/src/infrastructure/telemetry/metric-label-providers/noop.ts`:

```typescript
/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * noop MetricLabelProvider — default provider that returns no labels.
 */

import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'noop',
  displayName: 'No Labels Provider',
  resolveLabels: async () => null,
};
```

### Step 2.4: Build and run test to verify it passes

- [ ] **Build TypeScript and run test**

Run: `cd packages/api && pnpm run build && node --test test/metric-label-provider-noop.test.ts`

Expected: PASS (all 3 tests)

### Step 2.5: Commit noop provider

- [ ] **Commit noop provider + tests**

```bash
git add packages/api/src/infrastructure/telemetry/metric-label-providers/noop.ts
git add packages/api/test/metric-label-provider-noop.test.ts
git commit -m "feat(telemetry): add noop MetricLabelProvider (default provider)

- noop provider returns null (no dynamic labels)
- Unit tests verify null return and metadata"
```

---

## Task 3: x-userid Provider Implementation

**Files:**
- Create: `packages/api/src/infrastructure/telemetry/metric-label-providers/x-userid.ts`
- Create: `packages/api/test/metric-label-provider-x-userid.test.ts`

### Step 3.1: Write failing test for x-userid provider

- [ ] **Create test file with test cases**

Create `packages/api/test/metric-label-provider-x-userid.test.ts`:

```typescript
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

  test('should return null when x-userid header is empty string', async () => {
    const request = { headers: { 'x-userid': '' } };
    const labels = await metricLabelProvider.resolveLabels(request as any);
    assert.equal(labels, null);
  });

  test('should have id "x-userid"', () => {
    assert.equal(metricLabelProvider.id, 'x-userid');
  });

  test('should have displayName', () => {
    assert.equal(metricLabelProvider.displayName, 'X-UserID Header Label Provider');
  });
});
```

### Step 3.2: Run test to verify it fails

- [ ] **Run test and confirm failure**

Run: `cd packages/api && node --test test/metric-label-provider-x-userid.test.ts`

Expected: FAIL with "Cannot find module '../dist/infrastructure/telemetry/metric-label-providers/x-userid.js'"

### Step 3.3: Create x-userid provider implementation

- [ ] **Create x-userid provider file**

Create `packages/api/src/infrastructure/telemetry/metric-label-providers/x-userid.ts`:

```typescript
/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * x-userid MetricLabelProvider — extracts x-userid header as officeclaw.user.id label.
 */

import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'x-userid',
  displayName: 'X-UserID Header Label Provider',
  resolveLabels: async (request) => {
    const userId = request.headers['x-userid'] as string | undefined;
    // Return null if userId is undefined or empty string
    return userId && userId.length > 0 ? { 'officeclaw.user.id': userId } : null;
  },
};
```

### Step 3.4: Build and run test to verify it passes

- [ ] **Build TypeScript and run test**

Run: `cd packages/api && pnpm run build && node --test test/metric-label-provider-x-userid.test.ts`

Expected: PASS (all 5 tests)

### Step 3.5: Commit x-userid provider

- [ ] **Commit x-userid provider + tests**

```bash
git add packages/api/src/infrastructure/telemetry/metric-label-providers/x-userid.ts
git add packages/api/test/metric-label-provider-x-userid.test.ts
git commit -m "feat(telemetry): add x-userid MetricLabelProvider (example provider)

- Extract x-userid header as officeclaw.user.id label
- Return null when header absent or empty
- Unit tests verify presence/absence/empty scenarios"
```

---

## Task 4: Provider Loading Logic in fastify-hook.ts

**Files:**
- Modify: `packages/api/src/infrastructure/telemetry/fastify-hook.ts`
- Create: `packages/api/test/metric-label-provider-loading.test.ts`

### Step 4.1: Write failing test for provider loading

- [ ] **Create test file for provider loading**

Create `packages/api/test/metric-label-provider-loading.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';

describe('MetricLabelProvider Loading', () => {
  test('should load noop provider when env var not set', async () => {
    delete process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE;

    // Import fresh module to trigger load
    const modulePath = '../dist/infrastructure/telemetry/fastify-hook.js';
    const module = await import(modulePath);

    // Provider should be noop (returns null)
    const provider = await module.getMetricLabelProvider();
    assert.equal(provider.id, 'noop');
    const labels = await provider.resolveLabels({ headers: { 'x-userid': 'alice' } } as any);
    assert.equal(labels, null);
  });

  test('should load x-userid provider when env var set', async () => {
    process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE = './dist/infrastructure/telemetry/metric-label-providers/x-userid.js';

    // Import fresh module to trigger load
    // Note: Node.js module cache may require restart for different env
    const { metricLabelProvider } = await import('./dist/infrastructure/telemetry/metric-label-providers/x-userid.js');

    const labels = await metricLabelProvider.resolveLabels({ headers: { 'x-userid': 'alice' } } as any);
    assert.deepEqual(labels, { 'officeclaw.user.id': 'alice' });

    delete process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE;
  });

  test('should fallback to noop when module load fails', async () => {
    process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE = './nonexistent-module.js';

    // Import the loading function
    const module = await import('../dist/infrastructure/telemetry/fastify-hook.js');
    const provider = await module.loadMetricLabelProvider();

    // Should fallback to noop
    assert.equal(provider.id, 'noop-fallback');
    const labels = await provider.resolveLabels({ headers: {} } as any);
    assert.equal(labels, null);

    delete process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE;
  });
});
```

### Step 4.2: Run test to verify it fails

- [ ] **Run test and confirm failure**

Run: `cd packages/api && node --test test/metric-label-provider-loading.test.ts`

Expected: FAIL with "Cannot find module '../dist/infrastructure/telemetry/fastify-hook.js'" or missing functions

### Step 4.3: Read current fastify-hook.ts

- [ ] **Read existing implementation**

Run: Read `packages/api/src/infrastructure/telemetry/fastify-hook.ts`

Observe: Current implementation has no provider loading logic.

### Step 4.4: Add provider loading imports

- [ ] **Add MetricLabelProvider import and state variables**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts`:

After line 15 (after imports from OpenTelemetry), add:

```typescript
import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';
```

After line 33 (after TelemetryFastifyRequest interface), add state variables:

```typescript
// MetricLabelProvider state
let _metricLabelProvider: MetricLabelProvider | null = null;
let _providerLoaded = false;
```

### Step 4.5: Add provider loading function

- [ ] **Add loadMetricLabelProvider and getMetricLabelProvider functions**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts`:

Before line 39 (before registerTelemetryHook function), add:

```typescript
/**
 * Load MetricLabelProvider from environment variable or fallback to noop.
 */
export async function loadMetricLabelProvider(): Promise<MetricLabelProvider> {
  const moduleSpecifier = process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE?.trim();
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

/**
 * Get the loaded MetricLabelProvider (lazy load on first access).
 */
export async function getMetricLabelProvider(): Promise<MetricLabelProvider> {
  if (!_providerLoaded) {
    _metricLabelProvider = await loadMetricLabelProvider();
    await _metricLabelProvider.bootstrap?.();
    _providerLoaded = true;
  }
  return _metricLabelProvider!;
}
```

### Step 4.6: Modify onResponse hook to use provider

- [ ] **Refactor onResponse hook to merge dynamic labels**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts`:

Replace lines 84-105 (metric recording block):

```typescript
  // onResponse: End span with status and record metrics
  app.addHook('onResponse', async (request: TelemetryFastifyRequest, reply: FastifyReply) => {
    const span = request.telemetrySpan;
    if (!span) return;

    const startTime = request.telemetryStartTime ?? Date.now();
    const duration = (Date.now() - startTime) / 1000;

    // Build base attributes
    const baseAttributes = {
      [HTTP_METHOD]: request.method,
      [HTTP_ROUTE]: request.routerPath ?? '',
    };

    // Resolve dynamic labels from MetricLabelProvider
    let dynamicLabels: Record<string, string | number | boolean> | null = null;
    try {
      const provider = await getMetricLabelProvider();
      dynamicLabels = await provider.resolveLabels(request);
    } catch (error) {
      // Provider execution failure: use null fallback, don't block metrics
      console.warn('MetricLabelProvider.resolveLabels failed:', error);
      dynamicLabels = null;
    }

    // Merge labels into final attributes
    const attributes = dynamicLabels
      ? { ...baseAttributes, ...dynamicLabels }
      : baseAttributes;

    // Record metrics with merged attributes
    getRequestCount().add(1, attributes);
    getRequestDuration().record(duration, attributes);

    // Set span status
    span.setAttribute(HTTP_STATUS_CODE, reply.statusCode);

    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      getRequestErrorCount().add(1, attributes);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  });
```

### Step 4.7: Build and run test to verify it passes

- [ ] **Build TypeScript and run test**

Run: `cd packages/api && pnpm run build && node --test test/metric-label-provider-loading.test.ts`

Expected: PASS (all 3 tests)

### Step 4.8: Commit provider loading logic

- [ ] **Commit fastify-hook.ts modification**

```bash
git add packages/api/src/infrastructure/telemetry/fastify-hook.ts
git add packages/api/test/metric-label-provider-loading.test.ts
git commit -m "feat(telemetry): integrate MetricLabelProvider loading in fastify-hook

- Add loadMetricLabelProvider and getMetricLabelProvider functions
- Load provider from OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE env var
- Fallback to noop on load failure
- Merge dynamic labels into metric attributes in onResponse hook
- Tests verify loading behavior and fallback logic"
```

---

## Task 5: Integration Test

**Files:**
- Create: `packages/api/test/metric-label-provider-integration.test.ts`

### Step 5.1: Write integration test

- [ ] **Create integration test file**

Create `packages/api/test/metric-label-provider-integration.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import Fastify from 'fastify';

describe('MetricLabelProvider Integration', () => {
  let app: Fastify.FastifyInstance;
  let sdk: NodeSDK;
  let exporter: InMemoryMetricExporter;

  before(async () => {
    // Setup with x-userid provider
    process.env.OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE = './dist/infrastructure/telemetry/metric-label-providers/x-userid.js';

    exporter = new InMemoryMetricExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 100,
    });

    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'test-officeclaw',
    });

    sdk = new NodeSDK({
      resource,
      metricReader: reader,
    });

    await sdk.start();

    // Import fastify-hook after SDK started
    const { registerTelemetryHook } = await import('../dist/infrastructure/telemetry/fastify-hook.js');

    app = Fastify();
    app.get('/test', async () => ({ ok: true }));
    registerTelemetryHook(app);
    await app.ready();
  });

  after(async () => {
    await app.close();
    await sdk.shutdown();
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
    await new Promise(resolve => setTimeout(resolve, 200));

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

  test('HTTP request metrics exclude dynamic labels when header absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    assert.equal(response.statusCode, 200);

    // Wait for metrics export
    await new Promise(resolve => setTimeout(resolve, 200));

    const exportedMetrics = exporter.getMetrics();
    const requestCounter = exportedMetrics.find(m => m.descriptor.name === 'jiuwenclaw.request.count');

    assert.ok(requestCounter, 'Should have request.count metric');

    // Find data point without userId
    const dataPoint = requestCounter!.dataPoints.find(dp =>
      dp.attributes['http.route'] === '/test' &&
      dp.attributes['http.method'] === 'GET' &&
      !('officeclaw.user.id' in dp.attributes)
    );

    assert.ok(dataPoint, 'Should have data point without userId label');
  });
});
```

### Step 5.2: Build and run integration test

- [ ] **Build and run integration test**

Run: `cd packages/api && pnpm run build && node --test test/metric-label-provider-integration.test.ts`

Expected: PASS (both tests)

### Step 5.3: Commit integration test

- [ ] **Commit integration test**

```bash
git add packages/api/test/metric-label-provider-integration.test.ts
git commit -m "test(telemetry): add integration test for MetricLabelProvider

- Verify dynamic labels appear in HTTP request metrics
- Verify labels absent when header not provided
- Complete flow: SDK init → HTTP request → metric export → label verification"
```

---

## Task 6: Documentation Update

**Files:**
- Modify: `docs/feature/F-telemetry-metrics-analysis.md`

### Step 6.1: Read current documentation

- [ ] **Read existing telemetry metrics analysis doc**

Run: Read `docs/feature/F-telemetry-metrics-analysis.md`

Observe: Document describes current HTTP metrics with fixed labels (http.method, http.route).

### Step 6.2: Add MetricLabelProvider section

- [ ] **Add section explaining dynamic labels mechanism**

Edit `docs/feature/F-telemetry-metrics-analysis.md`:

After section "十、Resource Attributes 作为 Metric Labels" (around line 243), add new section:

```markdown
---

## 十一、动态 Metric Labels (MetricLabelProvider)

HTTP 请求指标支持通过 MetricLabelProvider 插件添加动态 labels。

### 插件机制

| Label | 来源 | 说明 |
|-------|------|------|
| 动态 labels | MetricLabelProvider | 插件根据 HTTP request 返回 key-value pairs |

**实现方式：**
- MetricLabelProvider 接口定义在 `packages/plugin/api/src/metric-label-provider.ts`
- Provider 通过 `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` 环境变量加载
- Labels 在 `fastify-hook.ts` 的 onResponse 钩子中合并到 metric attributes
- Provider 执行失败时 fallback 到 noop，不影响 metrics 记录

**内置 Provider：**

| Provider ID | 说明 | Labels |
|-------------|------|--------|
| `noop` | 默认 provider | 无（返回 null） |
| `x-userid` | 提取 x-userid header | `officeclaw.user.id` |

### 配置示例

```bash
# 使用 x-userid provider（使用编译后的 .js 路径）
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=./dist/infrastructure/telemetry/metric-label-providers/x-userid.js

# 使用第三方 provider
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=@my-company/my-metric-label-provider

# 不使用动态 labels（默认 noop）
# （不设置 OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE）
```

### 自定义 Provider

第三方可以创建自定义 MetricLabelProvider：

```typescript
import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'my-custom-labels',
  displayName: 'My Custom Labels Provider',
  resolveLabels: async (request) => {
    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) return null;
    return { 'officeclaw.tenant.id': tenantId };
  },
};
```

### 查询示例（Prometheus）

```promql
# 查询特定用户的请求计数（使用 x-userid provider）
jiuwenclaw_request_count{officeclaw_user_id="alice"}

# 查询特定租户的请求延迟（使用自定义 provider）
jiuwenclaw_request_duration{officeclaw_tenant_id="tenant-001"}
```
```

### Step 6.3: Update HTTP metrics table

- [ ] **Update HTTP metrics table to mention dynamic labels**

Edit `docs/feature/F-telemetry-metrics-analysis.md`:

In section "一、实际采集的指标（6 个）" (lines 5-12), update HTTP metrics rows:

Replace:
```markdown
| 指标名称 | 类型 | 单位 | Labels | 采集位置 |
|----------|------|------|--------|----------|
| `jiuwenclaw.request.count` | Counter | `{request}` | `http.method`, `http.route` | `fastify-hook.ts:84` |
| `jiuclaw.request.error.count` | Counter | `{request}` | `http.method`, `http.route` | `fastify-hook.ts:99` |
| `jiuwenclaw.request.duration` | Histogram | `s` | `http.method`, `http.route` | `fastify-hook.ts:89` |
```

With:
```markdown
| 指标名称 | 类型 | 单位 | Labels | 采集位置 |
|----------|------|------|--------|----------|
| `jiuwenclaw.request.count` | Counter | `{request}` | `http.method`, `http.route`, 动态 labels (可选) | `fastify-hook.ts` |
| `jiuclaw.request.error.count` | Counter | `{request}` | `http.method`, `http.route`, 动态 labels (可选) | `fastify-hook.ts` |
| `jiuwenclaw.request.duration` | Histogram | `s` | `http.method`, `http.route`, 动态 labels (可选) | `fastify-hook.ts` |
```

### Step 6.4: Commit documentation update

- [ ] **Commit documentation**

```bash
git add docs/feature/F-telemetry-metrics-analysis.md
git commit -m "docs: document MetricLabelProvider mechanism for dynamic metric labels

- Add section explaining MetricLabelProvider plugin
- Document built-in noop and x-userid providers
- Explain configuration via environment variable
- Provide custom provider example and Prometheus query examples
- Update HTTP metrics table to mention dynamic labels"
```

---

## Task 7: Final Verification

### Step 7.1: Run all provider tests

- [ ] **Run complete provider test suite**

Run: `cd packages/api && node --test test/metric-label-provider*.test.ts`

Expected: All tests PASS

### Step 7.2: Run API public tests

- [ ] **Run API public test suite**

Run: `cd packages/api && pnpm run test:public`

Expected: All tests PASS (no regressions)

### Step 7.3: Check TypeScript compilation

- [ ] **Verify TypeScript compiles without errors**

Run: `cd packages/api && pnpm run build`

Expected: SUCCESS (no TypeScript errors)

### Step 7.4: Final commit summary

- [ ] **Create summary commit**

```bash
git status
git log --oneline -7
```

Expected: See commits for:
1. MetricLabelProvider interface
2. noop provider + tests
3. x-userid provider + tests
4. Provider loading in fastify-hook.ts
5. Integration test
6. Documentation update

---

## Success Criteria

✅ MetricLabelProvider interface defined in packages/plugin/api
✅ Provider loading logic in fastify-hook.ts
✅ Built-in noop provider
✅ Built-in x-userid provider (example)
✅ HTTP metrics include dynamic labels when provider configured
✅ HTTP metrics unchanged when provider not configured (noop)
✅ Agent metrics unchanged
✅ Error handling: provider failures don't block service
✅ Tests pass (unit + integration)
✅ Documentation updated

---

## Troubleshooting

**Issue: Metrics don't include dynamic labels**

1. Check `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` environment variable is set
2. Verify provider module path is correct (use compiled `.js` path)
3. Check provider resolves labels correctly (test with unit test)

**Issue: Provider load fails**

1. Check module path exists in `dist/` directory
2. Verify provider exports `metricLabelProvider` or has `default` export
3. Check provider has `id` property

**Issue: TypeScript compilation fails**

1. Check MetricLabelProvider import path
2. Verify FastifyRequest type import
3. Run `pnpm install` to ensure dependencies

**Issue: Test fails with "Cannot find module"**

1. Run `pnpm run build` to compile TypeScript
2. Check import path uses `.js` extension for compiled files
3. Verify file exists in `dist/` directory