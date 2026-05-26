# Resource Attributes to Metric Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject resource attributes (service.name, officeclaw.claw.id) into all metric labels using OpenTelemetry View API + custom AttributesProcessor.

**Architecture:** Create ResourceAttributesProcessor class that merges resource attributes into metric attributes. Configure View in SDK initialization to apply processor to all Counter and Histogram metrics.

**Tech Stack:** OpenTelemetry SDK Metrics 1.28, Node.js test runner, TypeScript

---

## File Structure

**New Files:**
- `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts` - Processor implementation (~40 lines)
- `packages/api/test/resource-attributes-processor.test.ts` - Unit tests (~30 lines)

**Modified Files:**
- `packages/api/src/infrastructure/telemetry/init.ts` - Add View configuration (~15 lines)

**No Changes Required:**
- `metrics.ts` - Metric definitions unchanged
- `fastify-hook.ts` - HTTP request metric recording unchanged
- `agent-span.ts` - Agent invoke metric recording unchanged

---

## Task 1: ResourceAttributesProcessor Implementation

**Files:**
- Create: `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts`
- Create: `packages/api/test/resource-attributes-processor.test.ts`

### Step 1.1: Write failing test for basic injection

- [ ] **Create test file with first test case**

Create `packages/api/test/resource-attributes-processor.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Resource } from '@opentelemetry/resources';

const { ResourceAttributesProcessor } = await import('../dist/infrastructure/telemetry/resource-attributes-processor.js');

describe('ResourceAttributesProcessor', () => {
  test('should inject resource attributes into metric attributes', () => {
    const resource = new Resource({ 'service.name': 'test-service' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.deepEqual(result, {
      'service.name': 'test-service',
      'http.method': 'GET',
    });
  });
});
```

### Step 1.2: Run test to verify it fails

- [ ] **Run test and confirm failure**

Run: `cd packages/api && pnpm run build && node --test test/resource-attributes-processor.test.ts`

Expected: FAIL with "Cannot find module '../dist/infrastructure/telemetry/resource-attributes-processor.js'"

### Step 1.3: Write ResourceAttributesProcessor implementation

- [ ] **Create processor implementation file**

Create `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts`:

```typescript
/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * AttributesProcessor that injects resource attributes into metric attributes.
 * Resource attributes are added as base labels for all metrics.
 */

import type { Attributes } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';

/**
 * AttributesProcessor that injects resource attributes into metric attributes.
 * Resource attributes are added as base labels for all metrics.
 */
export class ResourceAttributesProcessor {
  private resourceAttributes: Record<string, string | number | boolean>;

  constructor(resource: Resource) {
    this.resourceAttributes = resource.attributes;
  }

  /**
   * Process attributes by merging resource attributes.
   * Existing attributes take precedence (no overwrite).
   */
  process(attributes: Attributes): Attributes {
    return {
      ...this.resourceAttributes,  // Resource attributes as base
      ...attributes,                // Existing attributes override (priority)
    };
  }
}
```

### Step 1.4: Build and run test to verify it passes

- [ ] **Build TypeScript and run test**

Run: `cd packages/api && pnpm run build && node --test test/resource-attributes-processor.test.ts`

Expected: PASS

### Step 1.5: Add test for priority (existing attributes not overwritten)

- [ ] **Add priority test**

Edit `packages/api/test/resource-attributes-processor.test.ts`, add test:

```typescript
  test('should not override existing attributes', () => {
    const resource = new Resource({ 'http.method': 'POST' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.equal(result['http.method'], 'GET');  // Existing takes priority
  });
```

Run: `cd packages/api && node --test test/resource-attributes-processor.test.ts`

Expected: PASS (both tests)

### Step 1.6: Add test for empty resource

- [ ] **Add empty resource test**

Edit `packages/api/test/resource-attributes-processor.test.ts`, add test:

```typescript
  test('should handle empty resource', () => {
    const resource = new Resource({});
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    assert.deepEqual(result, { 'http.method': 'GET' });
  });
```

Run: `cd packages/api && node --test test/resource-attributes-processor.test.ts`

Expected: PASS (all 3 tests)

### Step 1.7: Commit processor implementation

- [ ] **Commit processor + tests**

```bash
cd packages/api
git add src/infrastructure/telemetry/resource-attributes-processor.ts
git add test/resource-attributes-processor.test.ts
git commit -m "feat(telemetry): add ResourceAttributesProcessor for injecting resource attributes into metric labels

- Create processor class that merges resource attributes into metric attributes
- Resource attributes as base, metric attributes take priority
- Unit tests verify injection, priority, and empty resource handling
"
```

---

## Task 2: Integrate Processor into SDK Initialization

**Files:**
- Modify: `packages/api/src/infrastructure/telemetry/init.ts`

### Step 2.1: Read current init.ts implementation

- [ ] **Read existing init.ts**

Run: `Read packages/api/src/infrastructure/telemetry/init.ts`

Observe: Current SDK initialization at line 54, no View configuration exists.

### Step 2.2: Add View configuration imports

- [ ] **Add View and InstrumentType imports**

Edit `packages/api/src/infrastructure/telemetry/init.ts`:

After line 6 (existing imports), add:

```typescript
import { View, InstrumentType } from '@opentelemetry/sdk-metrics';
import { ResourceAttributesProcessor } from './resource-attributes-processor.js';
```

### Step 2.3: Add View configuration to SDK initialization

- [ ] **Modify SDK initialization to include views**

Edit `packages/api/src/infrastructure/telemetry/init.ts`:

Replace the SDK creation block (lines 54-59):

```typescript
    // 4. Create SDK with View configuration for resource attributes
    _sdk = new NodeSDK({
      resource,
      traceExporter,
      metricReader,
      instrumentations,
      views: [
        // Apply to all Counter metrics
        new View({
          instrumentName: '*',
          instrumentType: InstrumentType.COUNTER,
          attributesProcessor: new ResourceAttributesProcessor(resource),
        }),
        // Apply to all Histogram metrics
        new View({
          instrumentName: '*',
          instrumentType: InstrumentType.HISTOGRAM,
          attributesProcessor: new ResourceAttributesProcessor(resource),
        }),
      ],
    });
```

### Step 2.4: Build and verify TypeScript compiles

- [ ] **Build API package**

Run: `cd packages/api && pnpm run build`

Expected: SUCCESS (no TypeScript errors)

### Step 2.5: Run existing telemetry tests

- [ ] **Run telemetry tests to verify no regression**

Run: `cd packages/api && node --test test/telemetry-provider-registry.test.js test/telemetry-provider-e2e.test.js`

Expected: PASS (all existing tests still pass)

### Step 2.6: Commit View integration

- [ ] **Commit init.ts modification**

```bash
git add packages/api/src/infrastructure/telemetry/init.ts
git commit -m "feat(telemetry): configure View to inject resource attributes into metrics

- Add View configuration in SDK initialization
- Apply ResourceAttributesProcessor to all Counter and Histogram metrics
- Resource attributes become labels on all telemetry metrics
"
```

---

## Task 3: Integration Test for Complete Flow

**Files:**
- Create: `packages/api/test/resource-attributes-metrics.test.ts`

### Step 3.1: Write integration test for HTTP request metrics

- [ ] **Create integration test file**

Create `packages/api/test/resource-attributes-metrics.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { Resource } from '@opentelemetry/resources';
import { InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { View, InstrumentType } from '@opentelemetry/sdk-metrics';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const { ResourceAttributesProcessor } = await import('../dist/infrastructure/telemetry/resource-attributes-processor.js');
const { getRequestCount } = await import('../dist/infrastructure/telemetry/metrics.js');

describe('Resource Attributes Metrics Integration', () => {
  let sdk: NodeSDK;
  let exporter: InMemoryMetricExporter;

  before(async () => {
    exporter = new InMemoryMetricExporter();
    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'test-officeclaw',
      'officeclaw.claw.id': 'test-claw-001',
    });

    sdk = new NodeSDK({
      resource,
      metricReader: new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 100, // Fast export for testing
      }),
      views: [
        new View({
          instrumentName: '*',
          instrumentType: InstrumentType.COUNTER,
          attributesProcessor: new ResourceAttributesProcessor(resource),
        }),
      ],
    });

    await sdk.start();
  });

  after(async () => {
    await sdk.shutdown();
  });

  test('HTTP request counter includes resource attributes', async () => {
    // Record a metric like HTTP request does
    getRequestCount().add(1, {
      'http.method': 'POST',
      'http.route': '/api/messages',
    });

    // Wait for export
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get exported metrics
    const metrics = exporter.getMetrics();
    assert.ok(metrics.length > 0, 'Should have exported metrics');

    // Find the request counter metric
    const requestCounter = metrics.find(m => m.descriptor.name === 'jiuwenclaw.request.count');
    assert.ok(requestCounter, 'Should have request.count metric');

    // Check data point attributes include both resource and metric attributes
    const dataPoint = requestCounter.dataPoints[0];
    assert.equal(dataPoint.attributes['service.name'], 'test-officeclaw');
    assert.equal(dataPoint.attributes['officeclaw.claw.id'], 'test-claw-001');
    assert.equal(dataPoint.attributes['http.method'], 'POST');
    assert.equal(dataPoint.attributes['http.route'], '/api/messages');
  });
});
```

### Step 3.2: Run integration test

- [ ] **Run integration test**

Run: `cd packages/api && node --test test/resource-attributes-metrics.test.ts`

Expected: PASS

### Step 3.3: Commit integration test

- [ ] **Commit integration test**

```bash
git add packages/api/test/resource-attributes-metrics.test.ts
git commit -m "test(telemetry): add integration test for resource attributes in metrics

- Verify resource attributes appear in exported metric data points
- Test complete flow: SDK init → metric record → export → verify labels
"
```

---

## Task 4: Manual Verification

**Files:**
- No file changes (manual testing only)

### Step 4.1: Start API with ConsoleMetricExporter

- [ ] **Configure ConsoleMetricExporter for manual verification**

Set environment variable: `OTEL_METRICS_EXPORTER=console`

Run: `cd packages/api && OTEL_METRICS_EXPORTER=console OTEL_SERVICE_NAME=manual-test-officeclaw OTEL_CLAW_ID=manual-test-claw-001 pnpm dev`

### Step 4.2: Send HTTP request and observe console output

- [ ] **Send test request and verify console output**

Send HTTP request: `curl http://localhost:3004/api/health`

Observe console output (metrics exported every 30 seconds):

Expected output format:
```
{
  descriptor: { name: 'jiuwenclaw.request.count', ... },
  dataPoints: [
    {
      attributes: {
        'service.name': 'manual-test-officeclaw',
        'officeclaw.claw.id': 'manual-test-claw-001',
        'http.method': 'GET',
        'http.route': '/api/health'
      },
      value: 1
    }
  ]
}
```

Verify: Resource attributes (`service.name`, `officeclaw.claw.id`) are present in attributes.

### Step 4.3: Stop dev server

- [ ] **Stop development server**

Press Ctrl+C to stop the dev server.

---

## Task 5: Documentation Update

**Files:**
- Modify: `docs/feature/F-telemetry-metrics-analysis.md`

### Step 5.1: Update metrics analysis document

- [ ] **Add resource attributes to labels section**

Edit `docs/feature/F-telemetry-metrics-analysis.md`:

In section "一、实际采集的指标（6 个）", add row to table:

| 指标名称 | 类型 | 单位 | Labels | 采集位置 |
|----------|------|------|--------|----------|
| ... (existing rows) ... |
| Resource Labels | - | - | `service.name`, `officeclaw.claw.id` | `resource-attributes-processor.ts` |

Add new section after section "九、总结":

```markdown
---

## 十、Resource Attributes 作为 Metric Labels

所有指标自动包含 Resource attributes 作为 labels：

| Label | 来源 | 说明 |
|-------|------|------|
| `service.name` | Resource | 服务实例名称 |
| `officeclaw.claw.id` | Resource | 实例标识符 |

**实现方式：**
- `ResourceAttributesProcessor` 在 metrics 采集时注入 resource attributes
- View 配置应用到所有 Counter 和 Histogram metrics
- 现有 metric labels 优先（不会被 resource attributes 覆盖）

**查询示例（Prometheus）：**
```promql
# 按服务实例查询请求计数
jiuwenclaw_request_count{service.name="officeclaw-api"}

# 按实例ID查询特定路由的请求延迟
jiuwenclaw_request_duration{officeclaw_claw_id="instance-001", http.route="/api/messages"}
```
```

### Step 5.2: Commit documentation update

- [ ] **Commit documentation**

```bash
git add docs/feature/F-telemetry-metrics-analysis.md
git commit -m "docs: document resource attributes as metric labels in telemetry analysis

- Add resource labels section to metrics table
- Explain ResourceAttributesProcessor implementation
- Provide Prometheus query examples using resource labels
"
```

---

## Final Verification

### Step 6.1: Run all telemetry tests

- [ ] **Run complete telemetry test suite**

Run: `cd packages/api && node --test test/resource-attributes-*.test.ts test/telemetry-*.test.js`

Expected: All tests PASS

### Step 6.2: Run full API test suite

- [ ] **Run API public test suite**

Run: `cd packages/api && pnpm run test:public`

Expected: All tests PASS (no regressions)

### Step 6.3: Final commit summary

- [ ] **Create summary commit**

```bash
git status
git log --oneline -5
```

Expected: See commits for:
1. ResourceAttributesProcessor + unit tests
2. View integration in init.ts
3. Integration test
4. Documentation update

---

## Success Criteria

✅ Resource attributes (`service.name`, `officeclaw.claw.id`) appear in all metric labels
✅ Existing metric labels preserved (priority maintained)
✅ All tests pass (unit + integration + existing)
✅ Documentation updated with resource labels explanation
✅ No regression in existing telemetry functionality

---

## Troubleshooting

**Issue: Metrics don't include resource attributes**

1. Check SDK initialization logs for View configuration
2. Verify resource is created with attributes
3. Ensure ResourceAttributesProcessor is imported correctly

**Issue: TypeScript compilation fails**

1. Check OpenTelemetry SDK Metrics version matches View API
2. Verify InstrumentType import path
3. Run `pnpm install` to ensure dependencies

**Issue: Test fails with "Cannot find module"**

1. Run `pnpm run build` to compile TypeScript
2. Check import path uses `.js` extension for compiled files
3. Verify file exists in `dist/` directory