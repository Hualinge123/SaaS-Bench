---
feature_ids: [F140]
topics: [merge-audit, broken-merge, de-cat, type-y]
doc_kind: audit-results
created: 2026-05-07
author: 缅因猫/砚砚 (@gpt55)
subject_commit: 9e49fb6b6a9d35328c2f1a2bd2a5beb765b5b68f
base_main_parent: 63be2362407697eddec308811a2b07e25a5915f3
audited_head: 1da68021c1e266e53dea8244d682b4d75770e84b
source_audit_doc: docs/discussions/2026-05-07-9e49fb6b-merge-audit.md
---

# 9e49fb6b Type Y Audit Results

## TL;DR

Static audit found **one blocking integration break** and **one should-fix regression candidate**:

- **P1 blocking**: auth merge result is internally inconsistent. Current `routes/auth.ts` exposes only `/api/login`, but global auth does not whitelist exact `/api/login`, browser callback/invitation pages still call removed endpoints, and the global cookie gate still runs before Bearer-session middleware. Login/browser auth can fail before the new auth route is reachable.
- **P2 should fix**: `huawei-maas.ts` dropped main's "fallback to the one active MaaS session for connector/external user IDs" logic. Exact-user browser flows may still work, but connector-triggered Huawei MaaS invocations can regress when inbound identity differs from the local login user ID.

No other audited high-diff conflict file showed an mjs-style unresolved reference pattern. API TypeScript compile passed.

## Scope And Method

Audited current branch HEAD `1da68021` against merge parent main `63be2362`, focusing on the conflict files listed in `docs/discussions/2026-05-07-9e49fb6b-merge-audit.md`.

Primary commands:

```bash
git diff --numstat -M70 63be2362 HEAD -- <conflict files>
git diff --unified=40 -M70 63be2362 HEAD -- <high-risk files>
pnpm --filter @openjiuwen/relay-api-server run lint
```

High-risk files were selected by asymmetric diffs and removed main feature markers (`Fxxx`, `#issue`, `auth`, `session`, `MaaS`, `vote`, `game`, `signal`). Deletions explicitly covered by F140 Phase F were not counted as broken-merge findings.

## Findings

### P1 Blocking — Auth Conflict Result Breaks Login/Auth Flow

**Files**:

- `packages/api/src/routes/auth.ts`
- `packages/api/src/routes/auth-policy.ts`
- `packages/api/src/index.ts`
- `packages/web/src/app/login/callback/page.tsx`
- `packages/web/src/app/login/invitation/page.tsx`
- `packages/web/src/utils/api-client.ts`

**Evidence**:

- Current auth routes only register `GET /api/islogin`, `POST /api/login`, and `POST /api/logout` (`routes/auth.ts:89-163`).
- `auth-policy.ts` whitelists exact `/api/islogin`, `/api/logout`, `/api/curversion`, `/health`, plus paths starting with `/api/login/`; exact `/api/login` is **not** whitelisted (`auth-policy.ts:3-15`).
- `index.ts` registers `registerGlobalAuthHook(...)` before `registerAuthMiddleware(...)` (`index.ts:322-349`). The global hook requires signed cookie auth; the later middleware is the code that understands Bearer session IDs.
- Browser code still posts to removed endpoints:
  - `/api/login/callback` in `login/callback/page.tsx:84`
  - `/api/login/invitation` in `login/invitation/page.tsx:150`
- Frontend redirect-exempt paths also omit exact `/api/login` (`api-client.ts:127`), so a 401 from login can trigger auth redirect behavior.
- Main parent `63be2362` had CAS callback, invitation, auth cookie attach/clear, session renewal, and post-login MaaS refresh in `routes/auth.ts`. The merge result selected the unified auth route but did not reconcile the surrounding browser/global-auth contract.

**Judgment**: feature lost / integration broken. This is not a pure naming issue and not a simple rename-only repair.

**Recommended repair direction**:

Pick one auth architecture explicitly:

1. If unified `AuthProvider` auth is the desired direction, make exact `/api/login` whitelisted, make global auth accept the same session credential model as `registerAuthMiddleware` or run middleware before global auth and consult `request.auth`, remove or redirect the stale callback/invitation pages, and update tests.
2. If main CAS auth is still required, port `/api/login/callback` and `/api/login/invitation` into the provider architecture or restore the main CAS endpoints with OfficeClaw naming and cookie/session compatibility.

Do not apply Type X string cleanup before this is resolved; auth flow needs a coherent contract first.

### P2 Should Fix — Huawei MaaS Connector Fallback Was Dropped

**Files**:

- `packages/api/src/integrations/huawei-maas.ts`
- `packages/green-package/src/integrations/huawei-maas.ts`

**Evidence**:

- Main parent had explicit connector fallback logic: if `default-user`/`debug-user` or an external connector user ID did not match a logged-in MaaS session, it used the newest active session, or the only active session to avoid ambiguity (`63be2362:packages/api/src/integrations/huawei-maas.ts:58-95`).
- Current `packages/api/src/integrations/huawei-maas.ts` delegates to green-package with only `authSessionStore.getByUserId(uid)` (`huawei-maas.ts:1-12`).
- Current green-package resolver only performs exact `getSession(userId)` and reads `providerState.modelInfo`; it has no equivalent fallback (`green-package/src/integrations/huawei-maas.ts:42-64`).
- Call sites still resolve MaaS runtime config from the invocation `userId` (`invoke-single-agent.ts:879`, `agent-teams-bundle.ts:115`). Connector-triggered flows can carry owner/external identities that do not match the local login principal exactly.

**Judgment**: likely main feature regression, but narrower blast radius than auth. Browser flows with exact login user IDs can still work.

**Recommended repair direction**:

Reintroduce the safe fallback against `authSessionStore.sessionsByUserId`, adapted to `AuthSessionRecord.providerState.modelInfo`: ignore fallback users, require exactly one active non-fallback session for ambiguous external IDs, and keep exact-user lookup as the first choice.

## Non-Findings / Intentional Drift

These looked risky in raw diff, but match F140 Phase F or are rename-only after inspection:

- `route-parallel.ts` / `route-serial.ts`: F079 vote interception was removed. F140 Phase F says Voting is removed and route-level vote/game interception is dead/no-risk after entry points are sealed. Not a Type Y blocker.
- `messages.ts` / `index.ts`: F101 game interception and game route wiring were removed. This aligns with F140 Phase F API/UX feature pruning.
- `AgentRouter.ts` / `route-serial.ts`: F091 Signal context lookup was removed. F140 Phase F removes Signals user/API/MCP entry points; remaining prompt injection is documented as dead code/Tier 2 cleanup.
- `capabilities.ts`, queue/invocation files, provider event transforms, socket hooks, chat components/tests: large diffs are mostly `catId`/`agentId`, path, or deleted-feature cleanup. No unresolved function-reference pattern found.

## Verification

- `pnpm --filter @openjiuwen/relay-api-server run lint` passed (`tsc --noEmit`).
- No tests were run, per audit assignment ("static analysis, do not run tests").
- Existing dirty worktree files before this audit were not touched: `office-claw-config.json`, `pnpm-lock.yaml`, `.cat-cafe/`, `.kimi/`, `BACKLOG.md`, `KIMI.md`.

---

## Update 2026-05-07 19:25 — 状态归档

> By 布偶猫/宪宪 (@opus-47). 砚砚的 P1 / P2 finding 经独立核实后，状态如下。原诊断保留作为审计轨迹。

### P1 Blocking Auth → 已被独立 plan 覆盖

砚砚列出的 5 处 auth 证据（路由不全 / whitelist 不放精确 `/api/login` / 中间件顺序错 / 前端调已删除接口 / `setCookie` 完全缺失），全部对应 [`docs/plans/2026-05-07-platform-cookie-restoration.md`](../plans/2026-05-07-platform-cookie-restoration.md) 的修复点：

| 砚砚证据 | plan 对应章节 |
|---|---|
| `auth.ts` 缺 callback / invitation 路由 | §4.2.3 新增 `POST /api/login/callback`、§4.5 改 `/login/invitation/page.tsx`、§4.7 注册 `huawei-cas` provider |
| 中间件顺序错（Bearer middleware 跑不到）| §1.2 步骤 5 已诊断、§6 D6 决策给 SSOT 修复方案 |
| 前端调已删除接口 | §4.3 AppAuthBootstrap 分流、§4.5 invitation 改造 |
| `setCookie` 完全缺失 | §4.2 4 个 cookie 注入点 + 新 helper |
| dev cross-port cookie（同根因第二个 bug）| §1.4 + §4.6 next.config.js dev proxy |

该 plan **status: ready-for-implementation**，决策 D1-D7 已锁定，含实施 Checkpoint。**P1 auth 不需在本 audit 范围内单独修——等 plan 实施。**

### P2 Should-Fix Huawei MaaS Fallback → F140 解耦的有意决策，不需恢复

砚砚的诊断"main 有 fallback、HEAD 没了"事实成立，但归因解释要补：

main parent 上 `huawei-maas.ts` 的 fallback hack（`pickActiveSessionForConnectorFallback` / `shouldFallbackToAnyActiveSession` / "如果只有一个活跃 session 就用那个"）本质是补丁——补 main 上 huawei-maas 自己持有独立 `sessions: Map` 跟 platform auth session 是两套不同步 store 的歧义。

F140 通过有意 commit 解耦了这层：

- `3ee8a28f feat: extract Huawei integrations to @office-claw/green-package` — huawei 整体提取到独立 package
- `174255ab fix: decouple session expiration status check before invoking MaaS models`
- 设计文档：[`docs/discussions/2026-04-21-provider-runtime-decoupling-replay-summary.md`](2026-04-21-provider-runtime-decoupling-replay-summary.md)

解耦后 `green-package/src/integrations/huawei-maas.ts` 用依赖注入 `getSession: SessionLookup`，自身不再持 session，统一查 `authSessionStore.getByUserId(uid)` — **session 来源唯一，没有"两套不一致"歧义，fallback 也就不需要了**。

如果 connector-triggered 流真的需要外部 user ID → 本地 user ID 的映射，应在 connector router 层做（owner 解析），不应让 huawei-maas 用启发式 fallback 兜底（多用户环境会随机命中错误用户）。这个边角已超出 9e49fb6b audit scope，建议另立讨论。

**P2 huawei-maas fallback 不恢复。**

### Type X 修复策略

详见 [上游 audit 文档 § Strategy Update 2026-05-07 19:25](2026-05-07-9e49fb6b-merge-audit.md#strategy-update-2026-05-07-1925)。简要：

- **Tier A（4 处 runtime 已坏）**：`/api/cats/` 路由调用 + `cat-cafe:threads-refresh` dispatcher + `catcafe:chat-layout-changed` dispatcher → 立即修
- **Tier B（阻塞）**：`cat_cafe_mcp` 字段 — jiuwenclaw vendor 后端依赖，需后端先改
- **Tier C（配对一致）**：bridge-script source/data — dispatcher/listener 都用旧名字，runtime OK，延后双方同改
- **Tier D（用户态 + fallback）**：localStorage key
- **Tier E（代码质量）**：`catId` 类型/变量批量重命名（`compat/agentid-field-migration.ts` 已处理 Redis/config 持久化层迁移）

[宪宪/Opus-47🐾]

[砚砚/GPT-5.5🐾]
