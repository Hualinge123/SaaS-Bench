# Review Request: relay-claw global cookie authorization gate

Review-Target-ID: relay-claw-api-authorization
Branch: codex/relay-claw-api-authorization
Target Commit: 7ef0df13 + follow-up packaging secret persistence commit
Base Reviewed Commit: ad29c1be (Phase 1 scheduler auth PASS by @opus)

## What

Phase 2 在已通过 review 的 scheduler auth 基础上新增全局 cookie-based API authorization：

- 安装 `@fastify/cookie@9.4.0`，匹配当前 Fastify 4 版本。
- 登录成功后签发 signed `oc_sid` cookie；退出登录时清除 cookie。
- 新增 `auth-policy.ts`，集中定义白名单和 callback bypass。
- 新增 `global-auth.ts`，在 `index.ts` 注册全局 `onRequest` hook。
- `resolveUserId()` / `resolveTrustedUserId()` 优先使用 `request.authenticatedUserId`。
- 增加 Fastify request 类型扩展 `authenticatedUserId?: string | null`。
- Cookie signing secret 不再要求用户手动配置：env 仍可 override；默认自动生成并持久化到 OS keychain，keychain 不可用时落到用户配置目录 0600 文件。
- 新增全局 auth policy 和 auth cookie 路由测试。

## Why

Phase 1 只收紧了 `/api/schedule/*` caller matrix；Phase 2 是铲屎官扩展后的范围，目标是让所有普通 browser API 默认受主认证保护，同时让 `<img>` / `<audio>` 这类无自定义 header 的请求依靠 cookie 自动通过认证。

## Original Requirements（必填）

> 全局 cookie-based 认证
> 登录时签发 HttpOnly SameSite=Strict cookie `oc_sid`
> 全局 onRequest hook 验 cookie → 检查 header 一致性
> 白名单仅 `/api/islogin`、`/api/login/*`、`/api/curversion`、`/health`
> uploads、connector-media、tts/audio 都不豁免

- 来源：当前 thread 2026-04-23 @opus 交接，转述铲屎官 2026-04-23 11:47-13:11 明确扩展范围
- **请对照上面的摘录判断：Phase 2 是否把普通 API 默认保护住，同时不破坏 callback / scheduler 机器认证通道**

Follow-up 产品约束（2026-04-23 铲屎官反馈）：

> 最终的形态是会打包成exe的安装包去部署
> 用户能做的就是扫码登录
> 难道还要要求登录前先打开安装目录去做配置?

## Tradeoff

1. `@fastify/cookie` 选择 `9.4.0` 而不是最新主版本，因为当前 API 包使用 Fastify 4，`@fastify/cookie@11` 对应 Fastify 5 生态。
2. Cookie secret 优先读已有 session/cookie env：`OFFICE_CLAW_SESSION_SECRET`、`CAT_CAFE_SESSION_SECRET`、`OFFICE_CLAW_COOKIE_SECRET`、`CAT_CAFE_COOKIE_SECRET`；未配置时自动生成安装级 secret 并持久化。默认优先写 OS keychain（Windows Credential Manager / macOS Keychain / Linux keyring），keychain 不可用时写入用户配置目录 0600 文件。这样 EXE 用户无需登录前手动配置。
3. 全局 hook 对 Phase 1 的 shared scheduler machine-auth routes 做了最小 passthrough。原因是这些路由的 callback credentials 可能在 body/query/header 中，必须留给 `schedule-auth.ts` 的 route-level machine auth 校验，否则会破坏现有 MCP scheduler 工具。

## Open Questions

1. `isSharedSchedulerMachineAuthRoute()` 的 passthrough 列表是否足够小？它当前只覆盖 Phase 1 已定义的 shared scheduler routes，并不放行 browser-only governance / task run / manual trigger routes。
2. keychain 不可用时的用户配置目录 0600 文件 fallback 是否满足 relay-claw 的本机威胁模型？它解决无 UI 配置问题，但无法抵御同一 OS 用户下的本地恶意进程。
3. pending invitation 流程现在也签发 cookie；`/api/login/invitation` 可用 cookie 找回 pending session，但 `verifyPrimaryUserId()` 仍拒绝 pending session 访问受保护 API。请确认这个边界符合登录 UX。

## Next Action

请 `@opus` 做 Phase 2 代码级 review，重点看：

- 全局 `onRequest` 的白名单、callback bypass、401/403 行为是否符合需求。
- `oc_sid` 的签发、验证、清除是否安全且不会和既有 CAS session 逻辑冲突。
- 无 env 的 EXE 安装包形态是否已经满足“扫码登录即可使用”，无需用户预配置 secret。
- `authenticatedUserId` 注入到 `request-identity.ts` 后是否存在旧 header/query identity 旁路。
- scheduler shared-route passthrough 是否仅保留机器认证兼容性，没有扩大匿名访问面。

## Review Sandbox（必填）

- Path: `/tmp/cat-cafe-review/relay-claw-api-authorization/opus`
- Start Command: `pnpm --dir packages/api run build && CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/auth-cookie.test.js test/global-auth-policy.test.js test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js && pnpm --dir packages/mcp-server run build && pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js`
- Ports: `web=n/a`, `api=n/a`（本轮 review 不依赖启动页面或本地 server）

## 自检证据

### Spec 合规

- `/api/login/callback` 和 `/api/login/invitation` 成功后签发 `HttpOnly; SameSite=Strict; Path=/` signed `oc_sid` cookie ✅
- `/api/logout` 清除 `oc_sid` ✅
- 全局 `onRequest` hook 验证 cookie；无 cookie / 伪造 cookie 返回 `401` ✅
- 有效 cookie + 不一致 `X-Office-Claw-User` 返回 `403` ✅
- 有效 cookie + 无 header 的 embedded media 场景返回 `200` ✅
- 白名单仅 `/api/islogin`、`/api/login/*`、`/api/curversion`、`/health` ✅
- `/uploads/*` 无 cookie 返回 `401`；media route 不再匿名豁免 ✅
- `CAT_CAFE_SKIP_AUTH=1` 放行全局 auth gate ✅
- 未配置 env 时自动生成并持久化安装级 cookie signing secret，EXE 用户无需登录前手动配置 secret ✅
- 说明：这不改变既有 CAS session 生命周期；`auth.ts` 仍用 `serverStartId` 让持久化 session 在服务重启后失效 ✅
- callback routes 不受全局 browser cookie gate 影响 ✅
- Phase 1 scheduler route-level auth 测试不回归 ✅

### 验证命令

- `pnpm --dir packages/api lint` ✅
- `pnpm --dir packages/api run build` ✅
- `pnpm --dir packages/mcp-server run build` ✅
- `CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/auth-cookie.test.js test/global-auth-policy.test.js test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js` → `29/29 pass` ✅
- `pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js` → `3/3 pass` ✅
- `git diff --check` ✅

### Artifact Hygiene

- `find designs -name '*.pen' -print | rg 'relay|claw|auth|authorization|cookie|schedule'` → `find: designs: No such file or directory`（无设计稿目录，本轮无 UI 改动）✅
- `git status --short | rg '^.. [^/]+\\.(png|jpe?g|webp|gif|webm|mp4|mov|wav|pdf|pen)$'` → no match ✅
- `git diff --name-only origin/main...HEAD | rg '^[^/]+\\.(png|jpe?g|webp|gif|webm|mp4|mov|wav|pdf|pen)$'` → no match ✅

### 相关文档

- Phase 1 plan: `docs/plans/2026-04-22-relay-claw-api-authorization.md`
- Phase 1 bug report: `docs/bug-report/2026-04-23-schedule-browser-header-auth/bug-report.md`
- Phase 1 review request: `docs/mailbox/2026-04-22-relay-claw-api-authorization-review-request.md`
- Phase 2 review request: `docs/mailbox/2026-04-23-relay-claw-global-cookie-auth-review-request.md`
