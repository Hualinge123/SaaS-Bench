# Relay Claw API Authorization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden `relay-claw` schedule and callback authorization so browser callers and MCP callback callers are explicitly separated and validated, while preserving the current UI and MCP behavior.

**Architecture:** Keep the existing `/api/schedule/*` URLs for this pass, but stop treating authentication as optional. Introduce an explicit schedule-caller resolver that returns either a browser caller (`X-Office-Claw-User` after server-side primary session verification) or a callback caller (`invocationId + callbackToken`) and make each route declare which caller kinds are allowed. Derive `createdBy`, `updatedBy`, `requestedBy`, and default `deliveryThreadId` from trusted server-side identity instead of request bodies.

**Tech Stack:** Fastify, TypeScript, Zod, MCP callback tools, Node test runner, workspace packages `@openjiuwen/relay-api-server` and `@openjiuwen/relay-mcp-server`

---

### Task 1: Lock The Caller Matrix In Tests

**Files:**
- Create: `packages/api/test/schedule-authorization.test.js`
- Modify: `packages/api/test/schedule-trigger-validation.test.js`
- Reference: `packages/api/test/schedule-routes-logging.test.js`
- Reference: `packages/api/test/authorization-routes.test.js`

**Step 1: Write the failing test**

Add table-driven tests for the current caller matrix and credential transport:

- Callback caller transport must keep working through all three existing channels:
  - body: `invocationId + callbackToken`
  - query: `invocationId + callbackToken`
  - headers: `x-invocation-id + x-callback-token`
- `GET /api/schedule/tasks`
  - `401` when neither browser identity nor callback credentials are present
  - `401` for arbitrary `X-Office-Claw-User` values not backed by an active primary-auth session
  - `200` for browser caller with verified `X-Office-Claw-User`
  - `200` for callback caller with valid callback credentials
- `GET /api/schedule/control`
  - `401` without browser identity
  - `200` for browser caller
  - `403` or `401` for callback caller
- `GET /api/schedule/pack-templates`
  - `401` without browser identity
  - `200` for browser caller
  - `403` or `401` for callback caller
- `POST /api/schedule/tasks/preview`
  - `401` without identity
  - `200` for browser caller
  - `200` for callback caller
- `POST /api/schedule/tasks`
  - `401` without any accepted auth
  - `201` for browser caller with primary auth
  - `201` for callback caller with machine auth
  - `403` when both auth sources are present but inconsistent
  - assert persisted task uses trusted server-side actor fields
- `DELETE /api/schedule/tasks/:id`
  - `200` for callback caller
  - `200` for browser caller when browser caller owns the target `deliveryThreadId`
  - `403` for browser caller when browser caller does not own the target `deliveryThreadId`
  - `200` for browser caller when task has no `deliveryThreadId`
- `PATCH /api/schedule/tasks/:id`
  - `401` without any accepted auth
  - `200` for browser caller with primary auth
  - `200` for callback caller with machine auth
  - `403` when both auth sources are present but inconsistent

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/api run build
CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js
```

Expected: FAIL because the current routes still allow unauthenticated or ambiguously authenticated scheduler calls.

**Step 3: Commit**

```bash
git add packages/api/test/schedule-authorization.test.js packages/api/test/schedule-trigger-validation.test.js
git commit -m "test: add failing scheduler authorization matrix [砚砚/gpt-5.4🐾]"
```

### Task 2: Introduce Explicit Schedule Caller Resolution

**Files:**
- Create: `packages/api/src/routes/schedule-auth.ts`
- Modify: `packages/api/src/routes/schedule.ts`
- Modify: `packages/api/src/routes/schedule-governance.ts`
- Reference: `packages/api/src/utils/request-identity.ts`
- Reference: `packages/api/src/domains/cats/services/agents/invocation/InvocationRegistry.ts`

**Step 1: Write minimal caller-resolution helper**

Create a helper that returns a discriminated union:

```ts
type ScheduleCaller =
  | { kind: 'browser'; userId: string }
  | { kind: 'callback'; record: InvocationRecord };
```

The helper should:

- read browser identity from `resolveHeaderUserId(request)`
- read callback identity from the current three transport channels:
  - body `invocationId + callbackToken`
  - query `invocationId + callbackToken`
  - headers `x-invocation-id + x-callback-token`
- verify callback identity through `InvocationRegistry`
- when both browser and callback credentials are present, enforce consistency between the resolved browser user and the invocation record before allowing the request
- reject requests that match neither caller kind
- reject requests whose caller kind is not allowed by the current route

**Step 2: Migrate the existing schedule auth helpers into one place**

Move `resolveScheduleCallbackCredentials` and `resolveInvocationRecord` out of `schedule.ts` into `schedule-auth.ts`, then expand them into the new caller resolver so there is one authoritative implementation.

**Step 3: Define the route matrix in one place**

Encode the intended matrix in the helper or a local constant:

- `GET /api/schedule/tasks`: browser or callback
- `GET /api/schedule/tasks/:id/runs`: browser only
- `POST /api/schedule/tasks/:id/trigger`: browser only
- `GET /api/schedule/templates`: browser or callback
- `POST /api/schedule/tasks/preview`: browser or callback
- `POST /api/schedule/tasks`: browser or callback
- `DELETE /api/schedule/tasks/:id`: browser or callback
- `PATCH /api/schedule/tasks/:id`: browser or callback
- `/api/schedule/control*`: browser only
- `/api/schedule/pack-templates*`: browser only

**Step 4: Run test to verify the helper changes the failures**

Run:

```bash
pnpm --dir packages/api run build
CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js
```

Expected: fewer failures, with remaining failures isolated to route-specific authorization behavior and actor binding.

**Step 5: Commit**

```bash
git add packages/api/src/routes/schedule-auth.ts packages/api/src/routes/schedule.ts packages/api/src/routes/schedule-governance.ts
git commit -m "feat: add explicit scheduler caller resolution [砚砚/gpt-5.4🐾]"
```

### Task 3: Make Actor Fields Server-Authoritative

**Files:**
- Modify: `packages/api/src/routes/schedule.ts`
- Modify: `packages/api/src/routes/schedule-governance.ts`
- Modify: `packages/api/test/schedule-authorization.test.js`

**Step 1: Remove body-controlled actor fields**

Change route behavior so these values are always derived server-side:

- `requestedBy`
  - browser caller: `resolveHeaderUserId(request)`
  - callback caller: `record.userId`
- `createdBy`
  - callback caller: `record.catId`
  - browser caller: `resolveHeaderUserId(request)` for browser-created tasks
- `updatedBy`
  - browser caller: `resolveHeaderUserId(request)`
  - callback caller: `record.catId` or other machine principal derived from the validated invocation context

Also remove trust in:

- `body.createdBy`
- `body.updatedBy`
- browser-provided `params.triggerUserId`

**Step 2: Bind thread-scoped values to trusted caller context**

For callback-created tasks:

- default `deliveryThreadId` to `record.threadId`
- if the request explicitly passes a different `deliveryThreadId`, reject it unless there is an intentional allowlist rule

For browser routes that act on thread-bound scheduler state:

- require the current user to own the target `deliveryThreadId`
- if `deliveryThreadId` is null or points to a system/default thread, browser caller may proceed

For routes that accept both browser and callback auth:

- browser-only requests may proceed with primary auth alone
- machine-only requests may proceed with callback auth alone
- requests carrying both auth sources must pass a consistency check before authorization continues

For `DELETE /api/schedule/tasks/:id`:

- callback caller may delete directly after callback auth succeeds
- browser caller may delete only when the target task is unbound (`deliveryThreadId` absent) or its bound thread passes the browser ownership rule above

**Step 3: Run tests to verify trusted-field behavior**

Run:

```bash
pnpm --dir packages/api run build
CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js test/schedule-routes-logging.test.js
```

Expected: PASS for authorization-matrix assertions and actor-binding assertions.

**Step 4: Commit**

```bash
git add packages/api/src/routes/schedule.ts packages/api/src/routes/schedule-governance.ts packages/api/test/schedule-authorization.test.js
git commit -m "fix: bind scheduler actor fields to trusted auth context [砚砚/gpt-5.4🐾]"
```

### Task 4: Add MCP Regression Tests For Scheduler Callback Tools

**Files:**
- Create: `packages/mcp-server/test/schedule-tools.test.js`
- Reference: `packages/mcp-server/src/tools/schedule-tools.ts`
- Reference: `packages/mcp-server/src/tools/callback-tools.ts`

**Step 1: Write the failing MCP regression test**

Add tests that verify scheduler MCP tools keep sending callback credentials through the existing transport they already use:

- `office_claw_list_scheduled_tasks` sends callback credentials
- `office_claw_list_schedule_templates` sends callback credentials
- `office_claw_preview_scheduled_task` sends callback credentials
- `office_claw_register_scheduled_task` sends callback credentials in request body
- `office_claw_set_scheduled_task_enabled` sends `x-invocation-id + x-callback-token`
- `office_claw_remove_scheduled_task` sends `x-invocation-id + x-callback-token`

**Step 2: Run test to verify it fails if credential propagation breaks**

Run:

```bash
pnpm --dir packages/mcp-server run build
pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js
```

Expected: PASS once the credential behavior is locked; FAIL if the tool surface stops sending callback auth.

**Step 3: Commit**

```bash
git add packages/mcp-server/test/schedule-tools.test.js
git commit -m "test: lock scheduler mcp callback auth behavior [砚砚/gpt-5.4🐾]"
```

### Task 5: Final Verification And Cleanup

**Files:**
- Modify: `packages/api/src/routes/schedule.ts`
- Modify: `packages/api/src/routes/schedule-governance.ts`
- Modify: `packages/api/src/routes/schedule-auth.ts`
- Modify: `packages/api/test/schedule-authorization.test.js`
- Modify: `packages/api/test/schedule-trigger-validation.test.js`
- Modify: `packages/mcp-server/test/schedule-tools.test.js`

**Step 1: Run focused verification**

Run:

```bash
pnpm --dir packages/api lint
pnpm --dir packages/mcp-server lint
pnpm --dir packages/api run build
pnpm --dir packages/mcp-server run build
CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js
pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js
```

Expected: all targeted tests PASS, with no TypeScript errors.

**Step 2: Spot-check the current UI contract**

Manual checks:

- Scheduled tasks panel still loads task list and control state
- Browser caller can still pause/resume and delete through the panel
- MCP callback caller can still preview/register/toggle/remove tasks inside a cat invocation
- Browser caller can no longer hit callback-only scheduler routes
- Callback caller can no longer hit browser-only governance routes

**Step 3: Optional follow-up note (do not implement in this pass)**

Document a follow-up refactor candidate:

- move callback-only scheduler routes under `/api/callbacks/schedule/*`
- leave browser management under `/api/schedule/*`

This follow-up is intentionally out of scope for the first hardening patch.

**Step 4: Commit**

```bash
git add packages/api/src/routes/schedule.ts packages/api/src/routes/schedule-governance.ts packages/api/src/routes/schedule-auth.ts packages/api/test/schedule-authorization.test.js packages/api/test/schedule-trigger-validation.test.js packages/mcp-server/test/schedule-tools.test.js
git commit -m "fix: harden relay claw scheduler authorization boundaries [砚砚/gpt-5.4🐾]"
```
