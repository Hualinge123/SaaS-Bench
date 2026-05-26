---
title: Platform Cookie Restoration + huawei-cas Provider
created: 2026-05-07
authors: [opus47/宪宪🐾, co-creator]
status: ready-for-implementation
related:
  - docs/plans/2026-04-21-auth-provider-replay-on-main.md
  - docs/features/F140-de-cat-branding.md
  - docs/discussions/2026-04-21-provider-runtime-decoupling-replay-summary.md
---

# Platform Cookie Restoration + huawei-cas Provider

> 给实现者：本文档可独立交接。**先读"实施 Checkpoint"，签名后才能动 packages/api/src/routes/auth.ts。**

## 1. 背景

### 1.1 症状描述

`feat/decat-and-decouple-merge-main` 分支上：

- 浏览器访问 `/api/threads`（或任何受保护路径）→ **401 死循环**
- 前端 `apiFetch` 拦截到 401 → `redirectToLogin()` → 进 `/login` 又调 `/api/islogin` 重新拿 provider config → 用户登入"成功"后再访问 `/api/threads` → 又 401。
- 唯一让 dev 跑起来的方式是 `OFFICE_CLAW_SKIP_AUTH=1`（关掉鉴权门禁），导致 bug 长期被掩盖

### 1.2 用 no-auth 作为最简案例追踪因果链

no-auth 是设计上"零用户交互"的 provider——直觉上它**绝不应该 401**（用户什么都没做，没有"输错密码"这种失败路径）。但实际上 no-auth 也 401。把这条链路逐跳走一遍，根因就一目了然：

#### 步骤 1：浏览器进入 OfficeClaw

```
浏览器加载 React app → AppAuthBootstrap useEffect 触发
  → fetch('/api/islogin')
```

#### 步骤 2：`/api/islogin` 路由处理（**关键现场**）

`packages/api/src/routes/auth.ts:90-99`（174 行版）：

```typescript
app.get('/api/islogin', async (request) => {  // ← 注意：没有 reply 参数
  const status = await buildPublicStatus(provider);
  const session = await resolveCurrentSession(request, provider, sessionStore);
  if (!session) {
    return { islogin: false, userId: null, ...status };
  }
  return { islogin: true, userId: session.userId, sessionId: session.sessionId, ...status };
});
```

`resolveCurrentSession` 内部（`auth.ts:64-69`）检测到 `provider.presentation.mode === 'auto'`：

```typescript
if (provider.presentation.mode === 'auto') {
  const result = await provider.authenticate({ credentials: {} });
  if (!result.success) return null;
  const existing = sessionStore.getByUserId(result.principal.userId);
  return existing ?? sessionStore.create(provider.id, result.principal);
}
```

**这一段的语义是**：no-auth 隐式认证 → 创建 session → **session 真的存在 sessionStore 里**。

#### 步骤 3：响应返回浏览器（**第一个现场**）

`/api/islogin` 返回 `{ islogin: true, userId: 'default-user', sessionId: 'sess_xxx' }`，HTTP 200。

**但是！** 整个 `/api/islogin` 路由代码内**零次调用** `reply.setCookie(...)`：

```bash
$ git show HEAD:packages/api/src/routes/auth.ts | grep -nE '(setCookie|signCookie|signed:)'
# (空输出 — 0 次命中)
```

所以响应**没有 `Set-Cookie: oc_sid=...` 头**，浏览器 cookie jar **空**。

#### 步骤 4：浏览器接着访问 `/api/threads`（**第二个现场**）

浏览器 cookie jar 里没有 `oc_sid`，所以请求里**不带 Cookie 头**。

`packages/api/src/routes/global-auth.ts:171-187` 的 `onRequest` hook：

```typescript
app.addHook('onRequest', async (request, reply) => {
  if (options.isSkipAuthEnabled?.() ?? isGlobalAuthSkipEnabled()) return;
  if (isAuthWhitelisted(request.url) || isCallbackAuthBypassRoute(request.url)) return;

  const sessionUserId = resolveSignedAuthCookieUserId(request, cookieName);
  if (!sessionUserId) {
    if (isSharedSchedulerMachineAuthRoute(request)) return;
    sendAuthError(reply, 401, 'Authentication required');  // ← 这里短路
    return;
  }
  // ...
});
```

`resolveSignedAuthCookieUserId` 读 cookie → 没有 → 返回 null → `sendAuthError(reply, 401, 'Authentication required')` → fastify hook 队列短路。

#### 步骤 5：Bearer middleware 永远跑不到

后注册的 `auth/middleware.ts:registerAuthMiddleware` (在 `index.ts:347` 注册，**晚于** global-auth 的 `index.ts:322`) 本来负责读 `Authorization: Bearer <sessionId>` 装饰 `request.auth`——但 fastify hook 是串行 + 短路语义，**前一个 hook `reply.send` 后，后续 hook 全部跳过**。

#### 步骤 6：循环

前端 `apiFetch` 看到 401 → 触发 `redirectToLogin()` → 跳 `/login` → `/login` 又调 `/api/islogin`（白名单内，能进）→ no-auth 又"成功创建 session"但还是没 cookie → 再访问 `/api/threads` → 又 401 → 死循环。

#### 因果总结

```
症状: 401
  ↓
直接原因: global-auth hook 短路（没 cookie）
  ↓
中间原因: cookie 不存在
  ↓
直接根因: /api/islogin 路由内代码零次 setCookie
  ↓
代码层根因: F140 replay (08d28853) 把 main auth.ts 第 580-600 行
           setCookie / clearCookie / refreshAuthSessionCookie 三个 helper 整批砍掉，
           但没有补 platform-side 等价实现
```

**no-auth 是最干净的案例，因为它的失败路径里"用户什么都没做"——彻底排除"用户输错凭据"的混淆变量，直接定位到 platform 层 cookie 写入缺失。**

### 1.3 推广到所有 provider 都有同样问题

| Provider | 隐式认证时机 | 应在哪 setCookie | 当前是否 setCookie |
|---|---|---|---|
| **no-auth** (auto) | `/api/islogin` 内部 `resolveCurrentSession` | `/api/islogin` 响应 | ❌ 无 |
| **huawei-iam** (form) | `/api/login` 表单提交成功 | `/api/login` 响应 | ❌ 无 |
| **huawei-cas** (redirect, 待实现) | `/api/login/callback` 处理 ticket 成功 | `/api/login/callback` 响应 | ❌ 路由都没有 |

**三条路径都有同样的"sessionStore 创建了 session 但浏览器没拿到 cookie"问题**。这是同一根因——platform 层 cookie 写入逻辑被一次性砍掉。

### 1.4 第二个独立 Bug：dev 环境 cookie 回不来

即使把上面的 cookie 注入补回去，dev 环境下还有第二个独立 bug。

`packages/web/src/utils/api-client.ts:109`：

```typescript
credentials: API_URL.includes(PROD_API_HOST) ? 'include' : (init?.credentials ?? 'same-origin'),
//                  prod path → 'include'           dev path → 'same-origin'
```

dev 模式 web 在 `localhost:3003`，API 在 `localhost:3004`——**cross-port = cross-origin**。`credentials: 'same-origin'` 在 cross-origin 下不会发 cookie。

所以即使 platform 层补完 setCookie 让浏览器**收到** Set-Cookie 写进 cookie jar——下次请求是 cross-port，浏览器**也不会回带 cookie**——global-auth hook 仍然 401。

### 1.5 部署模型对照

| 维度 | dev / local prod | cloud prod |
|---|---|---|
| 前端 host | `localhost:{FRONTEND_PORT}` | `${PROD_FRONTEND_HOST}` (e.g. `app.office-claw.com`) |
| API host | `localhost:{FRONTEND_PORT+1}` | `${OFFICE_CLAW_API_HOST}` (e.g. `api.office-claw.com`) |
| 同源吗 | ❌ cross-port | ❌ cross-subdomain |
| api-client credentials 决策 | ~~`'same-origin'`~~ → **D1-R: `resolveRequestCredentials()` 检测跨域 → `'include'`** | `'include'`（cookie 送）|
| Cookie 共享机制 | **`credentials: 'include'` + CORS `credentials: true`**（与 main 对等） | Domain=`.office-claw.com` 子域共享 |
| 边界鉴权兜底 | n/a | Cloudflare Access (`CF_Authorization` cookie) |

**结论**：

- **cloud prod**: 只有 Bug A 起作用——cookie 路线本来就通，补 setCookie 立刻工作
- **dev / local prod**: Bug A 补完后，D1-R 恢复了 main 的跨域直连路径（`credentials: 'include'`），Bug B 不再存在

### 1.6 两个独立 Bug 总结

| Bug | 描述 | 触发环境 | 修复方式（决策见 §3）|
|---|---|---|---|
| **A** | `auth.ts` 174 行版没有 `setCookie` 调用，登录成功后浏览器永远拿不到 `oc_sid` | dev + prod | 在 4 个路由点补 setCookie（§4.2）|
| **B** | `api-client.ts:109` 在 dev 模式默认 `credentials: 'same-origin'`，cross-port 下浏览器不会回带 cookie | dev only | Next.js dev proxy 让 same-origin 真成立（§4.6）|

### 1.7 5 层根因分析（独立 thread 已完成，仅作摘要）

代码层因果链已在 §1.2 走完。流程层根因（独立调研）：

| 层 | 内容 |
|---|---|
| 1. 表层 | `/api/threads → 401` |
| 2. 直接原因 | global-auth hook 短路 fastify 队列 |
| 3. 中层冲突 | 两套 auth (cookie + Bearer) AND 语义不对称 |
| 4. 深层 | 没有 SSOT（Single Source of Truth）协调 auth 接入。`app.addHook('onRequest', ...)` 自由叠加，无运行时唯一性约束 |
| 5. 流程根因 | F140 spec 没把 auth security model 列入 explicit scope；`08d28853` (replay) 砍掉 main 的 platform-side cookie 实现没有 explicit 决策 → 没有 review 触发 |

层 4-5 的修复方案见 **D6 决策**（§3 + §6 实施 Checkpoint）—— 由实现者裁决是否在本次 PR 一并做。

## 2. 目标 / 非目标

### 2.1 目标

- 让 `no-auth` / `huawei-iam` / `huawei-cas` 三种 provider 在 **dev 和 prod** 都能在 global-auth hook 启用下工作（`OFFICE_CLAW_SKIP_AUTH=1` 不再是 dev 必需开关）
- 新增 `huawei-cas` provider，行为与 main 上 CAS 委托流**对等**
- **不改** `packages/plugin-api/src/auth.ts` contract（已经设计够用）

### 2.2 非目标

- 不修 SSOT 架构层（`registerAuthSystem` 单入口）—— 见决策 6
- 不动 main 的安全语义（`serverStartId`、`sameSite=strict`、Origin allowlist 全部沿用）
- 不做 dev → prod 老 session 数据迁移（main 自己也是重启失效，无迁移需求）
- 不在本次 PR 里加新的鉴权方式（OAuth2 PKCE 等）

## 3. 决策记录（7 项已锁定）

| # | 决策 | 选定方案 | 备注 |
|---|---|---|---|
| D1 | dev cross-port cookie 死局 | ~~C2: Next.js dev proxy~~ → **D1-R: 恢复 main 跨域直连** | 见 §3.2 D1 修订记录 |
| D2 | `canCreateModel` 字段链路 | **D2-A: 保留并迁移** | provider 在 `getPublicConfig()` 返回，平台 `/api/islogin` 透传 |
| D3 | `/login/invitation` 路由 | **D3-A: 保留** | redirect-mode provider 必需的 post-auth-pre-authorization 中间页 |
| D4 | secure-config 数据 schema | **D4-A: 沿用 main schema** | huawei-cas 的 `restoreSession` 反序列化 main 的 `UserInfo` |
| D5 | MaaS 后处理位置 | **D5-A: 全放 provider `postLoginInit`** | 4 个动作全部上报到华为 AOM，0 平台共性 |
| D6 | SSOT 修复时机 | **D6-B: 留作下一 PR + ADR**，**实现者必须 explicit 签名裁决** | 见第 6 节 Checkpoint |
| D7 | 测试同步 | **D7-A: 一并修** | 测试和实现同步是 review 信任的前提 |

### 3.2 D1 修订记录（2026-05-08 实施验证中发现）

**原方案 C2**：`api-client.ts` localhost 返回空字符串 + `next.config.js` dev-only rewrite 代理。

**问题**：设计时部署模型表（§1.5）只列了 dev / prod 两行，遗漏了 `pnpm start:direct`（`--prod-web`，`NODE_ENV=production`）场景。该场景是本地跨端口但 production 模式——dev proxy 被 `NODE_ENV` 条件排除，又没有 prod 的子域 cookie 共享，两头落空。实测 `/api/islogin` 返回 404（Next.js 无匹配路由）。

**修订后部署模型表**：

| 环境 | NODE_ENV | 同源 | cookie 机制 |
|---|---|---|---|
| dev (`pnpm dev`) | development | ❌ cross-port | dev rewrite proxy（仍保留作为便利） |
| **local prod (`start:direct`)** | **production** | **❌ cross-port** | **原方案落空 → 改为跨域直连** |
| cloud prod | production | ❌ cross-subdomain | `Domain=.office-claw.com` + `credentials: 'include'` |

**修订方案 D1-R**：恢复 main 的跨域直连路径——`resolveApiUrl()` 对 localhost 返回 `http://localhost:{frontendPort+1}`（跨域），新增 `resolveRequestCredentials()` 检测跨域自动切 `credentials: 'include'`。

**与 main 对比**：auth header 逻辑保持分支实现（Bearer token + skip-auth），仅恢复 URL 解析和 credentials 策略。

修订签名: 宪宪/Opus-46🐾  日期: 2026-05-08

### 3.1 决策推导备注

**D3 为什么保留**：form mode 和 redirect mode 的本质差异决定不能砍。

| Provider mode | 邀请码错误处理 |
|---|---|
| `auto` (no-auth) | n/a（无邀请码概念）|
| `form` (huawei-iam) | 主登录页 inline `needCode` 提示，重填同页提交 |
| `redirect` (huawei-cas) | callback 失败 → `router.replace('/login/invitation')` → 仅收邀请码独立页面 |

redirect mode 的用户**已在外部 IdP 完成主认证**（手里有 STS token），但 OfficeClaw 这边 MaaS 开通失败——这是"已认证未授权"的中间态。不能让用户重走 CAS（多余且 token 已发），必须有独立的"仅收邀请码"入口。

`/login/invitation` 是 **redirect-mode 通用基础设施**，不是 huawei-cas 专属——未来任何"OAuth2/CAS + 附加凭据"的 provider 都会复用。

**D5 为什么全放 provider**：4 个动作全部依赖华为云端点 + STS 凭证，0 平台共性：

```
reportMetric                     → aom-access.cn-north-4.myhuaweicloud.com:8443
initMetricsServiceFromCredential → 华为 AOM client init
startTokenUsageReporter          → 华为 AOM 上报
subscriptionClaw                 → versatile.../claw/client-subscription
```

未来如果加 `aliyun` provider 走自家 metrics → 它的 provider 内放自家上报。**当前不预设抽象**。

## 4. 修改清单（6 个文件，1 个新增）

### 4.1 新增：`packages/green-package/src/auth/huawei-cas.ts`

**职责**：把 main 的 CAS 委托流按现有 `AuthProvider` contract 包装。

**关键实现要点**：

```typescript
import type { AuthProvider } from '@openjiuwen/relay-api-server-contracts/auth';
import { randomBytes } from 'node:crypto';

// 进程级常量：每次启动新生成，沿用 main 安全语义
const SERVER_STARTUP_TOKEN = randomBytes(16).toString('hex');

interface HuaweiCasProviderOptions {
  fetchImpl?: typeof fetch;
  // env 注入的 URL 模板
  casBaseUrl?: string;
  serviceCallbackUrl?: string;
  backgroundImageUrl?: string;
  portalImageUrl?: string;
  ticketValidateUrl?: string;
  sessionTtlMs?: number;
  // canCreateModel 等配置
  canCreateModel?: boolean;
}

export function createHuaweiCasAuthProvider(opts: HuaweiCasProviderOptions = {}): AuthProvider {
  const casLoginUrl = buildCasLoginUrl(opts);  // 静态拼接，不带 state（沿用 main 行为）
  const sessionTtl = opts.sessionTtlMs ?? 12 * 60 * 60 * 1000;
  
  return {
    id: 'huawei-cas',
    displayName: 'Huawei Cloud (CAS)',
    presentation: {
      mode: 'redirect',
      redirectUrl: casLoginUrl,
      fields: [],  // redirect mode 无表单字段
      description: 'Sign in with your Huawei Cloud account',
    },
    
    async authenticate(): Promise<AuthenticateOutcome> {
      // redirect mode 不会被调到——用户从不通过表单提交
      return { success: false, message: 'Use callback flow for CAS provider' };
    },
    
    async handleCallback(params): Promise<AuthenticateOutcome> {
      const ticket = params.ticket;
      if (!ticket) return { success: false, message: 'Missing CAS ticket' };
      
      const profile = await validateCasTicket(opts.fetchImpl ?? fetch, ticket);
      if (!profile) return { success: false, message: 'Invalid CAS ticket' };
      
      // 写盘——沿用 main 的 secure-config + serverStartId
      await writeSecureConfig(profile.user_id, {
        ...profile,
        expiresAt: Date.now() + sessionTtl,
        serverStartId: SERVER_STARTUP_TOKEN,
      });
      
      return {
        success: true,
        principal: {
          userId: profile.user_id,
          displayName: profile.user_name,
          expiresAt: new Date(Date.now() + sessionTtl),
          providerState: { ...profile, serverStartId: SERVER_STARTUP_TOKEN },
        },
      };
    },
    
    async restoreSession(userId): Promise<ExternalPrincipal | null> {
      const stored = await readSecureConfig(userId);
      if (!stored) return null;
      // ★ 沿用 main 安全语义：进程重启即失效
      if (stored.serverStartId !== SERVER_STARTUP_TOKEN) {
        await deleteSecureConfig(userId);
        return null;
      }
      if (stored.expiresAt < Date.now()) {
        await deleteSecureConfig(userId);
        return null;
      }
      return {
        userId,
        expiresAt: new Date(stored.expiresAt),
        providerState: stored,
      };
    },
    
    async postLoginInit(session): Promise<void> {
      // D5: huawei AOM 4 件套 + MaaS 开通
      const profile = session.providerState as CasUserProfile;
      await Promise.allSettled([
        subscriptionClaw(profile),
        initMetricsServiceFromCredential(profile),
        reportMetric('login.success', { userId: session.userId }),
        startTokenUsageReporter(profile),
      ]);
    },
    
    async logout(session): Promise<void> {
      await deleteSecureConfig(session.userId);
      // optional: 调华为云 logout
    },
    
    async getPublicConfig(): Promise<Record<string, unknown>> {
      return {
        hascode: true,
        canCreateModel: opts.canCreateModel ?? false,  // D2: 在 getPublicConfig 透出
        logoutUrl: buildCasLogoutUrl(opts),
      };
    },
  };
}
```

**辅助函数（与 main 行为对等）**：
- `buildCasLoginUrl(opts)`：静态拼接 `auth.huaweicloud.com/authui/login.html?service=...&background_img_url=...&portal_img_url=...`
- `validateCasTicket(fetch, ticket)`：POST `${ticketValidateUrl}` → CasUserProfile
- `readSecureConfig` / `writeSecureConfig` / `deleteSecureConfig`：用 `cross-keychain` + `Conf` + `envPaths('secure-config', { suffix: 'nodejs' })`，**复用 main 上 auth.ts:140-160 的实现搬过来**

**注意**：huawei-cas 实现本身**不引用任何 cookie / reply / session ID**。这是 contract 边界。

### 4.2 修改：`packages/api/src/routes/auth.ts`

**当前问题**：174 行版本完全没有 cookie 操作，且无 `/api/login/callback` 路由。

**改动**：

```typescript
// 顶部 import 增补
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_SESSION_COOKIE_NAME } from './global-auth.js';

// 新增 helper（参考 main auth.ts:580-600）
function setSignedSessionCookie(reply: FastifyReply, userId: string, expiresAt: Date | null): void {
  const setCookie = (reply as FastifyReply & {
    setCookie?: (name: string, value: string, options?: Record<string, unknown>) => FastifyReply;
  }).setCookie;
  if (!setCookie) return;
  
  setCookie.call(reply, AUTH_SESSION_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    signed: true,
    ...(expiresAt ? { expires: expiresAt } : {}),  // expiresAt=null → session cookie
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  const clearCookie = (reply as FastifyReply & {
    clearCookie?: (name: string, options?: Record<string, unknown>) => FastifyReply;
  }).clearCookie;
  clearCookie?.call(reply, AUTH_SESSION_COOKIE_NAME, { path: '/' });
}
```

**4 个 cookie 注入点 + 1 个新路由**：

#### 4.2.1 `GET /api/islogin` —— auto mode 注入

```typescript
app.get('/api/islogin', async (request, reply) => {  // ← 加 reply
  const status = await buildPublicStatus(provider);
  const session = await resolveCurrentSession(request, provider, sessionStore);
  
  if (!session) {
    return { islogin: false, userId: null, ...status };
  }
  
  // ★ D2: canCreateModel 透传
  const publicConfig = (await provider.getPublicConfig?.()) ?? {};
  
  // ★ auto mode 在这里注入 cookie（no-auth 唯一时机）
  if (provider.presentation.mode === 'auto') {
    setSignedSessionCookie(reply, session.userId, null);  // session cookie，关浏览器即清
  }
  
  return {
    islogin: true,
    userId: session.userId,
    sessionId: session.sessionId,
    canCreateModel: Boolean(publicConfig.canCreateModel),  // ★ D2
    ...status,
  };
});
```

#### 4.2.2 `POST /api/login` —— form mode 注入

```typescript
app.post('/api/login', async (request, reply) => {
  const rawPayload = (request.body ?? {}) as Record<string, unknown>;
  const result = await provider.authenticate({ credentials: rawPayload });
  if (!result.success) {
    return result;  // 包括 needCode 等
  }
  
  const session = sessionStore.create(provider.id, result.principal);
  
  // ★ form mode cookie 注入
  setSignedSessionCookie(reply, session.userId, result.principal.expiresAt);
  
  // postLoginInit + onPostLogin 维持原状
  if (provider.postLoginInit) {
    try { await provider.postLoginInit(toSessionInfo(session)); } catch (e) { request.log.warn(...); }
  }
  if (opts.onPostLogin) {
    try { await opts.onPostLogin(request, session); } catch (e) { request.log.warn(...); }
  }
  
  reply.header('X-Session-Id', session.sessionId);
  
  return {
    success: true,
    userId: session.userId,
    sessionId: session.sessionId,
    providerId: provider.id,
    message: '登录成功',
  };
});
```

#### 4.2.3 **新增** `POST /api/login/callback` —— redirect mode 注入

```typescript
app.post('/api/login/callback', async (request, reply) => {
  if (!provider.handleCallback) {
    return reply.code(404).send({ message: 'Provider does not support callback flow' });
  }
  
  const params = (request.body ?? {}) as Record<string, string>;
  const result = await provider.handleCallback(params);
  
  if (!result.success) {
    // D3: needCode 触发 invitation 重定向流程
    if ('needCode' in result && result.needCode) {
      return { success: false, needCode: true, message: result.message };
    }
    return result;
  }
  
  const session = sessionStore.create(provider.id, result.principal);
  
  // ★ redirect mode cookie 注入
  setSignedSessionCookie(reply, session.userId, result.principal.expiresAt);
  
  // postLoginInit + onPostLogin 同 /api/login
  if (provider.postLoginInit) {
    try { await provider.postLoginInit(toSessionInfo(session)); } catch (e) { request.log.warn(...); }
  }
  if (opts.onPostLogin) {
    try { await opts.onPostLogin(request, session); } catch (e) { request.log.warn(...); }
  }
  
  reply.header('X-Session-Id', session.sessionId);
  
  return {
    success: true,
    userId: session.userId,
    sessionId: session.sessionId,
    providerId: provider.id,
  };
});
```

#### 4.2.4 `POST /api/logout` —— clearCookie

```typescript
app.post('/api/logout', async (request, reply) => {
  const userId = resolveHeaderUserId(request);
  if (userId) {
    const session = sessionStore.deleteByUserId(userId);
    if (session && provider.logout) {
      try { await provider.logout(toSessionInfo(session)); } catch (e) { console.warn(...); }
    }
  }
  
  // ★ 清除 cookie
  clearSessionCookie(reply);
  
  return { success: true, message: '退出登录成功' };
});
```

### 4.3 修改：`packages/web/src/components/AppAuthBootstrap.tsx`

当前 (第 76 行) 无脑 `window.location.replace('/login')`。需要根据 provider mode 分流。

```typescript
// 现有：
clearAuthIdentity();
window.location.replace('/login');

// 改为：
clearAuthIdentity();
if (data?.provider?.mode === 'redirect' && data.provider.redirectUrl) {
  // redirect mode: 直接外跳
  window.location.replace(data.provider.redirectUrl);
} else {
  // form / auto mode: 进本地登录页
  window.location.replace('/login');
}
```

### 4.4 修改：`packages/web/src/app/login/page.tsx`

当前 (408 行) 只 handle form mode。需要补 redirect mode 兜底（防用户直接访问 /login）。

在 `useEffect` 检查 islogin 之后增加：

```typescript
if (data?.provider?.mode === 'redirect' && data.provider.redirectUrl) {
  window.location.replace(data.provider.redirectUrl);
  return;
}
```

并在 form 渲染条件加 `data.provider?.mode !== 'redirect'` 防御。

### 4.5 修改：`packages/web/src/app/login/invitation/page.tsx`

D3 决策保留此路由。当前实现还在引用 `loginUrl` 等旧字段（main 兼容期残留）。改造为：

- 调用 `/api/login/callback` 重新提交 `{ ticket, promotionCode }` 或对应的"补充凭据" payload
- 失败仍 inline 提示，不再依赖 `pendingInvitation` 流程
- 兼容旧字段读取——临时期能从老 session 数据推回 invitation 状态

### 4.6 修改：`packages/web/src/utils/api-client.ts` —— D1-R 跨域直连恢复

> ⚠️ 原 §4.6 方案（dev proxy + `return ''`）已被 D1-R 替代，见 §3.2。

**实际实现（D1-R）**：恢复 main 的跨域直连路径，改动两处：

#### 4.6.1 `resolveApiUrl()` localhost 分支

```typescript
// 原（commit 14a8e6b3）:
if (isLoopbackHost(location?.hostname)) {
  return '';  // same-origin，依赖 Next.js rewrite proxy
}

// D1-R 修订后:
if (isLoopbackHost(location?.hostname)) {
  const frontendPort = Number(location?.port ?? '') || 3003;
  const apiPort = frontendPort + 1;
  const protocol = location?.protocol ?? 'http:';
  const hostname = location?.hostname ?? '127.0.0.1';
  return `${protocol}//${hostname}:${apiPort}`;  // 跨域直连
}
```

#### 4.6.2 新增 `resolveRequestCredentials()`

```typescript
function resolveRequestCredentials(explicitCredentials?: RequestCredentials): RequestCredentials {
  if (explicitCredentials) return explicitCredentials;
  const location = getBrowserLocation();
  if (!location) {
    return API_URL.includes(PROD_API_HOST) ? 'include' : 'same-origin';
  }
  try {
    const apiOrigin = new URL(API_URL, location.href).origin;
    return apiOrigin === location.origin ? 'same-origin' : 'include';
  } catch {
    return API_URL.includes(PROD_API_HOST) ? 'include' : 'same-origin';
  }
}
```

`apiFetch()` 中 `credentials` 改为 `resolveRequestCredentials(init?.credentials)`。

#### 4.6.3 `next.config.js`

dev-only `/api/:path*` rewrite 保留为便利设施（`pnpm dev` 下可选），但**不再是 cookie 流的关键路径**。

### 4.7 修改：`packages/api/src/auth/module.ts`

注册 huawei-cas provider，env 切换：

```typescript
import { createHuaweiIamAuthProvider } from '@office-claw/green-package/auth';
import { createHuaweiCasAuthProvider } from '@office-claw/green-package/auth';  // ★ 新增 export
import { createNoAuthProvider } from './providers/no-auth.js';

const PROVIDER_FACTORIES = {
  'huawei-iam': createHuaweiIamAuthProvider,
  'huawei-cas': createHuaweiCasAuthProvider,  // ★
  'no-auth': createNoAuthProvider,
};

const activeProviderId = process.env.OFFICE_CLAW_AUTH_PROVIDER ?? 'no-auth';
```

`packages/green-package/src/index.ts` 同步 export `createHuaweiCasAuthProvider`。

### 4.8 测试同步（D7）

| 文件 | 改造 |
|---|---|
| `packages/web/src/app/login/__tests__/page.test.tsx` | 补 redirect mode 测试 + 验证 form mode `needCode` 内联提示 |
| `packages/web/src/app/login/callback/__tests__/page.test.tsx` | 改 mock `/api/login/callback` 的新响应结构（无 `loginUrl`）|
| `packages/web/src/app/login/invitation/__tests__/page.test.tsx` | 改 mock 无 `canCreateModel` 字段（已通过 D2 在 islogin 透出，invitation 不再单独读）|
| `packages/api/test/auth-routes.test.js` | 新增：`/api/login` 成功后 `Set-Cookie: oc_sid=...; HttpOnly; SameSite=Strict; Path=/` 断言 |
| `packages/api/test/auth-routes.test.js` | 新增：`/api/login/callback` 路由覆盖（含 needCode 失败、success 成功）|
| `packages/api/test/auth-routes.test.js` | 新增：`/api/logout` 后 `Set-Cookie: oc_sid=; Max-Age=0` 清除断言 |
| `packages/green-package/src/auth/__tests__/huawei-cas.test.ts` | 新增：构造 + handleCallback + restoreSession + serverStartId 验证 |

## 5. 不修的部分（明确声明）

- ❌ `packages/plugin-api/src/auth.ts` contract —— 不动
- ❌ `packages/api/src/routes/global-auth.ts` —— 一字不动（main 已有完整 CSRF 加固）
- ❌ `packages/api/src/auth/middleware.ts` —— 不动（继续作为 Bearer 路径，不与 cookie 路径冲突）
- ❌ `packages/api/src/services/metrics/*` —— 不动（D5 决定全在 provider 调用）
- ❌ `OFFICE_CLAW_SKIP_AUTH=1` 环境变量 —— 保留作为开发兜底，但本次修复后**不应再依赖它跑 dev**

## 6. 实施 Checkpoint —— 必须在写代码前完成（D6）

> ⚠️ **未签名 → 不得动 packages/api/src/routes/auth.ts**

实现者动手前，必须在本设计文档下方追加签名块：

```
## 6.x 实现者裁决记录

我已阅读决策 D6 的方案空间，以及第 7 节"SSOT 缺失风险"。
我对 SSOT (registerAuthSystem 单入口 + hook 装饰唯一性自检) 在本次 PR 的态度是：

[ ] 一并实施 — 在本 PR 内追加 packages/api/src/auth/auth-system.ts，
              所有 onRequest hook 走它注册，启动时校验唯一性。
              预估 +200 行架构代码 + 对应测试。
              
[ ] 分次实施 — 仅本次只补 cookie + dev proxy + huawei-cas，
              SSOT 在下一次独立 PR 实现，承诺日期: ____________
              并在 docs/decisions/ 创建 ADR 文档说明决策。
              
[ ] 不实施 —— 我接受流程根因不修复的后果。
              并在 packages/api/src/index.ts 的 hook 注册段
              添加监控注释（"两个 onRequest auth hook 共存
              是历史遗留 — 未来新增任何 auth 实现时必须 audit"）。

实现者签名: ___________  日期: ___________
推荐理由: 默认 D6-B（分次实施）以控制本次 PR review 复杂度，
        但裁决权交给实现者基于代码现状评估。
```

## 6.1 实现者裁决记录

我已阅读决策 D6 的方案空间，以及第 7 节"SSOT 缺失风险"。
我对 SSOT (registerAuthSystem 单入口 + hook 装饰唯一性自检) 在本次 PR 的态度是：

[ ] 一并实施 — 在本 PR 内追加 packages/api/src/auth/auth-system.ts，
              所有 onRequest hook 走它注册，启动时校验唯一性。
              预估 +200 行架构代码 + 对应测试。

[x] 分次实施 — 仅本次只补 cookie + dev proxy + huawei-cas，
              SSOT 在下一次独立 PR 实现，承诺日期: 2026-05-15
              并在 docs/decisions/ 创建 ADR 文档说明决策。

[ ] 不实施 —— 我接受流程根因不修复的后果。
              并在 packages/api/src/index.ts 的 hook 注册段
              添加监控注释（"两个 onRequest auth hook 共存
              是历史遗留 — 未来新增任何 auth 实现时必须 audit"）。

实现者签名: Codex / OpenCode  日期: 2026-05-08

## 7. SSOT 缺失风险（供 D6 决策参考）

如果选 [分次实施] 或 [不实施]，需理解以下风险：

1. **再次发生同类事故的可能性**：fastify `addHook('onRequest', ...)` 是开放接口，下一次有人想加新 auth/CSRF/CORS 实现时，仍然不会被任何运行时机制拦下来 audit
2. **防御机制建议（最低成本）**：
   - 在 `packages/api/src/index.ts` 启动末尾打印 `app.printRoutes()` + 已注册 hook 列表到日志
   - 加一个测试 `packages/api/test/hook-registry.test.js`：白名单已知 hook 名，未知 hook 启动失败
3. **完整 SSOT 抽象的样子**（D6-A 选项）：

```typescript
// packages/api/src/auth/auth-system.ts
export function registerAuthSystem(app: FastifyInstance, opts: {
  cookieGate?: CookieGateConfig;
  bearerMiddleware?: BearerMiddlewareConfig;
  onPostLogin?: PostLoginHook;
}): void {
  if (app.hasDecorator('__office_claw_auth_registered')) {
    throw new Error('Auth system can only be registered once');
  }
  app.decorate('__office_claw_auth_registered', true);
  
  if (opts.cookieGate) registerGlobalAuthHook(app, opts.cookieGate);
  if (opts.bearerMiddleware) registerAuthMiddleware(app, opts.bearerMiddleware);
  // ...
}
```

## 8. 验证清单

实施完毕后**逐项**跑通才能开 PR：

### 8.1 dev 模式（关键）

```bash
# 删掉 SKIP_AUTH=1
export OFFICE_CLAW_SKIP_AUTH=
export OFFICE_CLAW_AUTH_PROVIDER=no-auth   # 或 huawei-iam
pnpm dev
```

- [ ] 浏览器打开 `http://localhost:3003`，DevTools Network 看到 `/api/islogin` 200 响应带 `Set-Cookie: oc_sid=...; HttpOnly; SameSite=Strict; Path=/`
- [ ] 后续 `/api/threads` 请求 Cookie 头自动带上 `oc_sid`，返回 200 而非 401
- [ ] 改 `OFFICE_CLAW_AUTH_PROVIDER=huawei-iam`，登录表单正常渲染，提交错误密码报错，提交正确密码进入主页
- [ ] 改 `OFFICE_CLAW_AUTH_PROVIDER=huawei-cas`，访问首页直接外跳到 `auth.huaweicloud.com`，登录后回到 `/login/callback?ticket=...`，自动 POST 到 `/api/login/callback`，成功后进主页
- [ ] huawei-cas 邀请码错误时跳到 `/login/invitation`，仅显示邀请码字段

### 8.2 进程重启行为对等 main

- [ ] no-auth: 重启后浏览器 cookie 仍存在 → `/api/islogin` 检测 sessionStore 没了 → 重新创建 + 重写 cookie
- [ ] huawei-iam: 重启后 secure-config 无持久化 → 用户重登
- [ ] huawei-cas: 重启后 secure-config 数据还在但 `serverStartId` 不匹配 → `restoreSession` 返回 null → 用户重登

### 8.3 prod 模拟（可选，但推荐）

用本地 cloudflare tunnel 起两个域 (`app.localhost.example.com` + `api.localhost.example.com`)：

- [ ] cookie 跨子域可读
- [ ] `credentials: 'include'` 自动启用（命中 `PROD_API_HOST` 判定）

### 8.4 测试

- [ ] `pnpm test` 全绿（包括 D7 列出的所有新增/修改测试）
- [ ] `pnpm lint` 全绿
- [ ] `pnpm check` 全绿

## 9. 风险与回滚

### 9.1 风险

1. ~~dev rewrites 生效后，前端调试工具中的请求 URL 会变成 `/api/...`~~ — D1-R 恢复跨域直连后此风险不再存在，DevTools 中显示完整的 `http://localhost:{apiPort}/api/...`
2. **secure-config schema 沿用 main**——如果 main schema 在未来变化，huawei-cas restoreSession 反序列化会跟着变。建议加 schema version 字段防御
3. **多 provider 切换运行时**——切换 `OFFICE_CLAW_AUTH_PROVIDER` env 变量需要重启进程，已有 secure-config 数据可能与新 provider 不兼容

### 9.2 回滚

每个文件改动相互独立，可分步回滚：

| 回滚单元 | 后果 |
|---|---|
| 仅回滚 `next.config.js` | dev 重新无法跑（必须 SKIP_AUTH=1）|
| 回滚 `auth.ts` cookie 注入 | 全环境 401 死循环 |
| 回滚 `huawei-cas.ts` 不影响其他 provider | huawei-cas 模式不可用，huawei-iam / no-auth 仍然 work |

## 10. 接力交接

**当前球权**: 设计文档已完成，等待实现者认领 + 完成 [实施 Checkpoint] 签名。

**实现者建议**: 同时熟悉 main 上 `auth.ts` 819 行版本 + 本分支 174 行版本的人。如果不熟悉 main 行为，先跑一份 main 的 dev 看华为 CAS 流程的实际样子。

**预估工作量**: 2-3 个工作日（含测试 + 验证）。

**Review 建议**: 至少一只**跨家族**猫 review。如果实现者是缅因猫家族，请布偶猫家族出 reviewer，反之亦然。
