# x-userid Header as Metric Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `x-userid` from HTTP request headers and add it as `officeclaw.user.id` label to the three HTTP request metrics.

**Architecture:** Modify `fastify-hook.ts` to extract userId in onRequest hook and conditionally add it to metric attributes in onResponse hook.

**Tech Stack:** TypeScript, Fastify, OpenTelemetry Metrics API, Node.js test runner

---

## File Structure

**Modified Files:**
- `packages/api/src/infrastructure/telemetry/fastify-hook.ts` — Extract userId and add to metric labels (~20 lines modified)

**Created Files:**
- `packages/api/test/x-userid-metric-label.test.ts` — Integration test for userId label behavior (~50 lines)

**Documentation:**
- `docs/feature/F-telemetry-metrics-analysis.md` — Update metric labels table

---

## Task 1: Implement userId Extraction and Metric Label

**Files:**
- Modify: `packages/api/src/infrastructure/telemetry/fastify-hook.ts`
- Create: `packages/api/test/x-userid-metric-label.test.ts`

### Step 1.1: Write failing test for userId in metric labels

- [ ] **Create test file with first test case**

Create `packages/api/test/x-userid-metric-label.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { InMemoryMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import Fastify from 'fastify';

const { registerTelemetryHook } = await import('../dist/infrastructure/telemetry/fastify-hook.js');
const { initTelemetry } = await import('../dist/infrastructure/telemetry/init.js');

describe('x-userid metric label', () => {
  let app: Fastify.FastifyInstance;
  let exporter: InMemoryMetricExporter;

  before(async () => {
    exporter = new InMemoryMetricExporter();
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 100,
    });

    await initTelemetry();

    app = Fastify();
    app.get('/test', async () => ({ ok: true }));
    registerTelemetryHook(app);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('should include officeclaw.user.id when x-userid header present', async () => {
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
    assert.equal(dataPoint!.attributes['officeclaw.user.id'], 'alice', 'Should include userId label');
  });
});
```

### Step 1.2: Build and run test to verify it fails

- [ ] **Run test and confirm failure**

Run: `cd packages/api && pnpm run build && node --test test/x-userid-metric-label.test.ts`

Expected: FAIL — `officeclaw.user.id` not present in metric attributes

### Step 1.3: Extend TelemetryFastifyRequest interface

- [ ] **Add telemetryUserId field to interface**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts` at line 28-33:

Replace:
```typescript
interface TelemetryFastifyRequest extends FastifyRequest {
  telemetrySpan?: Span;
  telemetryStartTime?: number;
  telemetryContext?: Context;
  telemetryTracer?: ReturnType<typeof getTracer>;
}
```

With:
```typescript
interface TelemetryFastifyRequest extends FastifyRequest {
  telemetrySpan?: Span;
  telemetryStartTime?: number;
  telemetryContext?: Context;
  telemetryTracer?: ReturnType<typeof getTracer>;
  telemetryUserId?: string;
}
```

### Step 1.4: Extract userId in onRequest hook

- [ ] **Add userId extraction after span creation**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts` at line 55-57:

After `request.telemetryTracer = tracer;` line, add:
```typescript
    request.telemetryUserId = request.headers['x-userid'] as string | undefined;
```

### Step 1.5: Add userId to metric attributes in onResponse hook

- [ ] **Refactor metric recording to use conditional userId**

Edit `packages/api/src/infrastructure/telemetry/fastify-hook.ts` at line 83-105:

Replace:
```typescript
    // Record metrics
    getRequestCount().add(1, {
      [HTTP_METHOD]: request.method,
      [HTTP_ROUTE]: request.routerPath ?? '',
    });

    getRequestDuration().record(duration, {
      [HTTP_METHOD]: request.method,
      [HTTP_ROUTE]: request.routerPath ?? '',
    });

    // Set span status
    span.setAttribute(HTTP_STATUS_CODE, reply.statusCode);

    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      getRequestErrorCount().add(1, {
        [HTTP_METHOD]: request.method,
        [HTTP_ROUTE]: request.routerPath ?? '',
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
```

With:
```typescript
    // Build metric attributes
    const baseAttributes = {
      [HTTP_METHOD]: request.method,
      [HTTP_ROUTE]: request.routerPath ?? '',
    };

    const attributes = request.telemetryUserId
      ? { ...baseAttributes, [OFFICECLAW_USER_ID]: request.telemetryUserId }
      : baseAttributes;

    // Record metrics
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
```

### Step 1.6: Build and run test to verify it passes

- [ ] **Build TypeScript and run test**

Run: `cd packages/api && pnpm run build && node --test test/x-userid-metric-label.test.ts`

Expected: PASS — `officeclaw.user.id: 'alice'` present in metric attributes

### Step 1.7: Add test for absent userId

- [ ] **Add test case when header absent**

Edit `packages/api/test/x-userid-metric-label.test.ts`, add test:

```typescript
  test('should exclude officeclaw.user.id when x-userid header absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    assert.equal(response.statusCode, 200);

    // Wait for metrics export
    await new Promise(resolve => setTimeout(resolve, 150));

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
```

### Step 1.8: Run both tests to verify behavior

- [ ] **Run complete test suite**

Run: `cd packages/api && node --test test/x-userid-metric-label.test.ts`

Expected: PASS (both tests)

### Step 1.9: Commit implementation

- [ ] **Commit code changes**

```bash
cd packages/api
git add src/infrastructure/telemetry/fastify-hook.ts
git add test/x-userid-metric-label.test.ts
git commit -m "feat(telemetry): add x-userid header as metric label

- Extract x-userid from HTTP request headers in onRequest hook
- Add officeclaw.user.id label to HTTP request metrics when header present
- Skip label when header absent (no empty/unknown placeholder)
- Tests verify both presence and absence scenarios"
```

---

## Task 2: Update Documentation

**Files:**
- Modify: `docs/feature/F-telemetry-metrics-analysis.md`

### Step 2.1: Update metrics analysis document

- [ ] **Update HTTP metric labels in table**

Edit `docs/feature/F-telemetry-metrics-analysis.md` at line 5-12:

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
| `jiuwenclaw.request.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:84` |
| `jiuclaw.request.error.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:99` |
| `jiuwenclaw.request.duration` | Histogram | `s` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:89` |
```

### Step 2.2: Add explanatory note

- [ ] **Add note about optional userId label**

Edit `docs/feature/F-telemetry-metrics-analysis.md` after line 12:

Add:
```markdown

**Note:** `officeclaw.user.id` label is optional — only present when `x-userid` header exists in HTTP request.
```

### Step 2.3: Commit documentation update

- [ ] **Commit documentation**

```bash
git add docs/feature/F-telemetry-metrics-analysis.md
git commit -m "docs(telemetry): document x-userid header as optional metric label

- Update HTTP metrics table to include officeclaw.user.id (optional)
- Add note explaining conditional presence based on header"
```

---

## Task 3: Final Verification

### Step 3.1: Run all telemetry tests

- [ ] **Run complete telemetry test suite**

Run: `cd packages/api && node --test test/x-userid-metric-label.test.ts test/telemetry-*.test.js`

Expected: All tests PASS

### Step 3.2: Run API public tests

- [ ] **Run API public test suite**

Run: `cd packages/api && pnpm run test:public`

Expected: All tests PASS (no regressions)

### Step 3.3: Check TypeScript compilation

- [ ] **Verify TypeScript compiles without errors**

Run: `cd packages/api && pnpm run build`

Expected: SUCCESS (no TypeScript errors)

---

## Success Criteria

✅ HTTP metrics include `officeclaw.user.id` when header present
✅ HTTP metrics exclude label when header absent
✅ Agent metrics unchanged
✅ All tests pass
✅ Documentation updated

---

## Troubleshooting

**Issue: Test fails with "officeclaw.user.id not present"**

1. Verify `x-userid` header is sent in test request
2. Check header extraction code in `onRequest` hook
3. Ensure `OFFICECLAW_USER_ID` constant is imported

**Issue: TypeScript compilation fails**

1. Check `TelemetryFastifyRequest` interface has `telemetryUserId` field
2. Verify `OFFICECLAW_USER_ID` import path

**Issue: Metrics not exported in test**

1. Wait longer before checking exporter (increase timeout to 200ms)
2. Verify `PeriodicExportingMetricReader` is configured correctly