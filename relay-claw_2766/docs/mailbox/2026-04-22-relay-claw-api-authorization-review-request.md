# Review Request: relay-claw schedule authorization hardening

Review-Target-ID: relay-claw-api-authorization
Branch: codex/relay-claw-api-authorization

## What

为 `relay-claw` 的 schedule / governance 路由补上显式 caller 认证矩阵：

- 新增 `packages/api/src/routes/schedule-auth.ts`
  - 统一解析 browser caller（`X-Office-Claw-User` + 主认证 session 校验）与 callback caller（`invocationId + callbackToken`）
  - 兼容 callback 三种现有传输通道：body / query / headers
  - 任意 header-only 伪造用户名会被拒绝；当 browser + callback 同时出现时，强制做 user 一致性校验
- 收紧 `packages/api/src/routes/schedule.ts`
  - `GET /api/schedule/tasks`、`GET /api/schedule/templates`、`POST /api/schedule/tasks/preview`、`POST /api/schedule/tasks`、`DELETE /api/schedule/tasks/:id`、`PATCH /api/schedule/tasks/:id` 改为 shared caller
  - `GET /api/schedule/tasks/:id/runs`、`POST /api/schedule/tasks/:id/trigger` 改为 browser-only
  - `POST /api/schedule/tasks` / `PATCH` / `DELETE` 的 actor 字段、`triggerUserId`、`deliveryThreadId` 改为服务端可信绑定
- 收紧 `packages/api/src/routes/schedule-governance.ts`
  - `/api/schedule/control*` 与 `/api/schedule/pack-templates*` 改为 browser-only
  - `updatedBy` 不再信 request body，直接取可信 browser caller
- 新增/更新测试
  - `packages/api/test/schedule-authorization.test.js`
  - `packages/api/test/schedule-trigger-validation.test.js`
  - `packages/api/test/schedule-routes-logging.test.js`
  - `packages/mcp-server/test/schedule-tools.test.js`

## Why

这轮目标不是“再加一批新接口”，而是把现有 `/api/schedule/*` 的 caller 语义钉死，避免现在这种“浏览器头、callback 凭证、匿名访问”混在一起的状态。

按铲屎官这轮定调，caller policy 应该是三档：

- callback-only：纯机器接口，只认 callback 机器身份
- shared：schedule 这类既要给 console 用、也要给 scheduler/MCP 或外部 scheduler callback 用的接口，支持 browser / callback 两种 caller，并在双凭证同时出现时做一致性校验
- primary-only：纯 console/browser 路由，只认主认证

这次实现先把 schedule 相关路由落到这套矩阵上，不做 URL namespace split。

## Original Requirements（必填）

> callback-only的只使用机器账户认证
> 其他的callback 支持双认证
> 非callback的使用主认证
> POST /api/schedule/tasks
> PATCH /api/schedule/tasks/:id 应该都得双认证才行；因为还有其他的scheduler的需求；但是不在我们这里开发的

- 来源：当前 thread（2026-04-22）
- **请对照上面的摘录判断：这版实现是否准确落地了“callback-only / shared / primary-only”三档 caller policy，且 `POST/PATCH /api/schedule/tasks*` 仍保留 shared 能力**

## Tradeoff

这轮刻意没做两件事：

1. **不做 URL namespace split**
   先把 caller matrix 做成显式语义，后续若要拆 `/api/callbacks/*` vs `/api/console/*` 才有稳定依据。
2. **不新增另一套 browser token**
   当前 browser 路由复用既有 CAS 登录状态：`X-Office-Claw-User` 只作为 session 查找键，必须能通过服务端 `verifyPrimaryUserId()` 校验。后续如果主认证切到 cookie/JWT，可以替换 verifier，而 schedule route matrix 不需要重写。

## Open Questions

1. `resolveScheduleCaller()` 当前策略是：如果 callback 凭证存在且有效，则优先视为 callback caller；若 browser 凭证也同时存在，则只做一致性校验。这个优先级是否合理，还是应该在 shared 路由里显式保留“browser-first”语义？
2. browser caller 对 `deliveryThreadId` 的 ownership 放行条件目前是：
   - thread.createdBy === userId
   - 或 system/default thread
   - 或 task 未绑定 thread
   这是否与你们对 console 删除/修改 scheduler task 的预期完全一致？
3. 本轮没有处理 websocket auth。请顺手看下这轮 `browserUserVerifier` 抽象是否足够承接后续 cookie/JWT 主认证。

## Next Action

请 `@opus` 做代码级 review，重点看：

- caller matrix 是否与上面的用户定调一致
- dual auth 一致性校验是否放在了正确层级
- `POST/PATCH/DELETE /api/schedule/tasks*` 的 server-authoritative actor binding 是否足够严
- 是否存在 callback 凭证旁路、thread ownership 漏洞或行为回归

## Review Sandbox（必填）

- Path: `/tmp/cat-cafe-review/relay-claw-api-authorization/opus`
- Start Command: `pnpm --dir packages/api run build && CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js && pnpm --dir packages/mcp-server run build && pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js`
- Ports: `web=n/a`, `api=n/a`（本轮 review 不依赖启动页面或本地 server）

## 自检证据

### Spec 合规

- callback-only / shared / primary-only 三档 caller policy 已映射进 schedule routes ✅
- `POST /api/schedule/tasks` 与 `PATCH /api/schedule/tasks/:id` 保持 shared caller 能力 ✅
- callback 三通道（body/query/headers）保持兼容 ✅
- browser caller 不再信任任意 `X-Office-Claw-User`；必须有服务端主认证 session ✅
- actor 字段、`triggerUserId`、`deliveryThreadId` 改为服务端可信推导 ✅
- governance / pack-template 路由不再匿名可用 ✅

### 测试结果

- 定向 API 验证：
  - `pnpm --dir packages/api run build` ✅
  - `CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js` → `18/18 pass` ✅
- 定向 MCP 验证：
  - `pnpm --dir packages/mcp-server run build` ✅
  - `pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js` → `3/3 pass` ✅
- 全仓门禁现状：
  - `pnpm -r --if-present run build` ✅
  - `pnpm test` ❌，但失败集中在 `packages/mcp-server/test/signals-tools.test.js` 和 `packages/mcp-server/test/tool-registration.test.js`，报错点是缺失既有 `signals-tools` / tool registration 产物；本分支对 `packages/mcp-server/src` 无改动
  - `pnpm lint` ❌，失败来自 `packages/web` 大量既有 ESLint 问题，本分支未改 `packages/web`
  - `pnpm check` ❌，失败来自仓库内既有 biome/format 问题，本分支未触碰这些文件

### Artifact Hygiene

- `git status --short | rg '^.. [^/]+\\.(png|jpe?g|webp|gif|webm|mp4|mov|wav|pdf|pen)$'` → no match ✅
- `git diff --name-only origin/main...HEAD | rg '^[^/]+\\.(png|jpe?g|webp|gif|webm|mp4|mov|wav|pdf|pen)$'` → no match ✅

### 相关文档

- Plan: `docs/plans/2026-04-22-relay-claw-api-authorization.md`
- Bug report: `docs/bug-report/2026-04-23-schedule-browser-header-auth/bug-report.md`
- Review note: `docs/mailbox/2026-04-22-relay-claw-api-authorization-review-request.md`
