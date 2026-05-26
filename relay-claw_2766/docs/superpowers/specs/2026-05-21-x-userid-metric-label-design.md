# x-userid Header as Metric Label Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Extract `x-userid` from HTTP request headers and add it as `officeclaw.user.id` label to the three HTTP request metrics:
- `jiuwenclaw.request.count`
- `jiuclaw.request.error.count`
- `jiuwenclaw.request.duration`

**Agent metrics remain unchanged.**

---

## Requirements

1. When header contains `x-userid`, add `officeclaw.user.id` label to HTTP metrics
2. When header does NOT contain `x-userid`, do NOT add the label (keep metrics unchanged)
3. Only modify HTTP request metrics (not agent invoke metrics)

---

## Architecture

### Data Flow

```
HTTP Request (header: x-userid=alice)
    │
    ▼
fastify-hook.ts: onRequest
    ├── Extract x-userid from header
    ├── Store in request.telemetryUserId
    │
    ▼
fastify-hook.ts: onResponse
    ├── Build base attributes: {http.method, http.route}
    ├── If telemetryUserId exists:
    │   └── Add officeclaw.user.id to attributes
    ├── Record metrics with attributes
    │   ├── getRequestCount().add(1, attributes)
    │   ├── getRequestDuration().record(duration, attributes)
    │   └── getRequestErrorCount().add(1, attributes) [if error]
```

### Decision Logic

```typescript
const baseAttributes = {
  [HTTP_METHOD]: request.method,
  [HTTP_ROUTE]: request.routerPath ?? '',
};

const attributes = request.telemetryUserId
  ? { ...baseAttributes, [OFFICECLAW_USER_ID]: request.telemetryUserId }
  : baseAttributes;
```

---

## Implementation

### File Changes

**Single file modification:**
- `packages/api/src/infrastructure/telemetry/fastify-hook.ts`

### Step-by-Step Changes

#### 1. Extend Request Interface

Add `telemetryUserId` field to `TelemetryFastifyRequest` interface (line 28-33):

```typescript
interface TelemetryFastifyRequest extends FastifyRequest {
  telemetrySpan?: Span;
  telemetryStartTime?: number;
  telemetryContext?: Context;
  telemetryTracer?: ReturnType<typeof getTracer>;
  telemetryUserId?: string;  // NEW
}
```

#### 2. Extract userId in onRequest Hook

After span creation in `onRequest` hook (around line 55), extract userId:

```typescript
// Extract userId from header for telemetry labels
request.telemetryUserId = request.headers['x-userid'] as string | undefined;
```

#### 3. Add userId to Metrics in onResponse Hook

Refactor metric recording in `onResponse` hook (lines 84-105):

**Before (current):**
```typescript
getRequestCount().add(1, {
  [HTTP_METHOD]: request.method,
  [HTTP_ROUTE]: request.routerPath ?? '',
});

getRequestDuration().record(duration, {
  [HTTP_METHOD]: request.method,
  [HTTP_ROUTE]: request.routerPath ?? '',
});

if (reply.statusCode >= 500) {
  getRequestErrorCount().add(1, {
    [HTTP_METHOD]: request.method,
    [HTTP_ROUTE]: request.routerPath ?? '',
  });
}
```

**After (refactored):**
```typescript
// Build metric attributes
const baseAttributes = {
  [HTTP_METHOD]: request.method,
  [HTTP_ROUTE]: request.routerPath ?? '',
};

const attributes = request.telemetryUserId
  ? { ...baseAttributes, [OFFICECLAW_USER_ID]: request.telemetryUserId }
  : baseAttributes;

getRequestCount().add(1, attributes);
getRequestDuration().record(duration, attributes);

if (reply.statusCode >= 500) {
  getRequestErrorCount().add(1, attributes);
}
```

---

## Testing

### Unit Test Strategy

Create integration test to verify:
1. Metrics include `officeclaw.user.id` when header present
2. Metrics exclude `officeclaw.user.id` when header absent

**Test file:** `packages/api/test/x-userid-metric-label.test.ts`

```typescript
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('x-userid metric label', () => {
  test('should include officeclaw.user.id when x-userid header present', async () => {
    // Mock request with x-userid header
    // Verify metric attributes contain officeclaw.user.id
  });

  test('should exclude officeclaw.user.id when x-userid header absent', async () => {
    // Mock request without x-userid header
    // Verify metric attributes do not contain officeclaw.user.id
  });
});
```

### Manual Verification

1. Start API server with ConsoleMetricExporter
2. Send request with `x-userid` header:
   ```bash
   curl -H "x-userid: alice" http://localhost:3004/api/health
   ```
3. Observe metric output includes `officeclaw.user.id: alice`

4. Send request without header:
   ```bash
   curl http://localhost:3004/api/health
   ```
5. Observe metric output excludes `officeclaw.user.id`

---

## Documentation Update

Update `docs/feature/F-telemetry-metrics-analysis.md`:

In section "一、实际采集的指标（6 个）", update HTTP metric rows:

| 指标名称 | 类型 | 单位 | Labels | 采集位置 |
|----------|------|------|--------|----------|
| `jiuwenclaw.request.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:84` |
| `jiuclaw.request.error.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:99` |
| `jiuwenclaw.request.duration` | Histogram | `s` | `http.method`, `http.route`, `officeclaw.user.id` (optional) | `fastify-hook.ts:89` |

Add note:
> `officeclaw.user.id` label is optional — only present when `x-userid` header exists in request.

---

## Success Criteria

- [ ] HTTP metrics include `officeclaw.user.id` when header present
- [ ] HTTP metrics exclude label when header absent
- [ ] Agent metrics unchanged
- [ ] Tests pass
- [ ] Documentation updated

---

## Scope

**In scope:**
- Extract `x-userid` from HTTP request headers
- Add to 3 HTTP request metrics as `officeclaw.user.id` label

**Out of scope:**
- Agent invoke metrics
- Span attributes
- Other telemetry components