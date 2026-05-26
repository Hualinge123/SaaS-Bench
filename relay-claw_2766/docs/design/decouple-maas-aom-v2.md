---
feature_ids: []
topics: [decat, huawei-maas, aom, decoupling, credential, protocol, metrics, plugin-api]
doc_kind: design
created: 2026-05-14
supersedes: docs/design/decouple-maas-aom.md
reviewed_by: 缅因猫/砚砚(GPT-5.5)
review_status: P1 fixed, pending re-review
---

# 解耦方案 V2：对齐 Provider Plugin 协议

## 背景

V1 方案（`decouple-maas-aom.md`）通过鸭子类型 + 自建 registry 实现了 `packages/api` 对 `green-package` 的构建时解耦。功能等价，运行正确，但绕过了代码仓已有的 provider plugin 协议。

代码仓已有五个 provider 领域（Auth / Evidence / Scheduler / Storage / Catalog），全部遵循统一模式：

```
plugin-api 定义 interface → Registry（Map + 鸭子类型收集）→ Module factory → Env 驱动选择
```

V1 的 `protocol-credential-registry.ts` 和 `aom-initializer-registry.ts` 没有走这条路，而是寄生在 auth 的模块加载通道上，用自建的轻量 registry + 纯 key-name 约定替代 interface。

**V2 目标：对齐现有协议，补齐 plugin-api 的契约定义。**

## 领域分析

V1 要解耦的两个集成点，领域归属不同：

| 集成点 | 领域归属 | V2 方案 |
|--------|---------|---------|
| MaaS 协议凭证解析 | Auth 的延伸（依赖 auth session，和 auth provider 1:1 绑定） | **扩展 AuthProvider interface** |
| AOM 指标初始化 | 独立的可观测性领域（可替换后端：AOM / Prometheus / noop） | **新建 MetricsProvider** |

### 为什么 Protocol Credential 不做独立 provider

1. **和 auth provider 1:1 绑定**：只有 `huawei-cas` auth provider 才有 `huawei_maas` 凭证，`no-auth` 没有
2. **依赖 auth session state**：凭证从 `session.providerState` 派生，这是 auth 的内部状态
3. **不存在多实现替换场景**：不会出现"用 huawei-cas 登录但用另一个 provider 解析凭证"
4. 做成独立 provider 会引入不必要的 env 变量 + registry + module factory，增加配置负担

### 为什么 Metrics 做独立 provider

1. **可替换**：可以是 AOM（华为云）、可以是自建 Prometheus、可以是 noop（不上报）
2. **独立生命周期**：和 auth 无关，只需要 `providerState` 作为输入（不需要 session store）
3. **和现有 provider 模式完全匹配**：id + bootstrap + shutdown + 业务方法

---

## 方向 A：AuthProvider 扩展 — Protocol Credential

### 1. plugin-api 接口变更

```typescript
// packages/plugin/api/src/auth.ts — 新增类型 + 扩展 interface

export interface ProtocolCredentialResult {
  baseUrl: string;
  apiKey: string;
  defaultHeaders: Record<string, string>;
}

export interface AuthProvider {
  // ... 现有方法不变 ...

  /**
   * Resolve LLM-call credentials for a named protocol.
   * Only implemented by auth providers whose cloud sessions carry model-call
   * credentials (e.g., huawei-cas provides huawei_maas credentials).
   *
   * Design: follows the same pattern as postLoginInit / refresh / logout —
   * the PLATFORM owns sessions, PROVIDER only interprets providerState.
   * Platform looks up the session and passes AuthSessionInfo to the provider.
   *
   * @param protocol - Protocol identifier from provider-profile config (e.g., 'huawei_maas')
   * @param session  - Platform-managed session info (provider reads its own providerState)
   * @returns Credential bundle for LLM API calls, or null if this provider
   *          does not support the requested protocol or session state is insufficient.
   */
  resolveProtocolCredential?(
    protocol: string,
    session: AuthSessionInfo,
  ): ProtocolCredentialResult | null;
}
```

> **设计约束对齐**：auth.ts 开头声明 "Provider only converts credentials → identity.
> No session, no middleware, no business logic." 以及 "providerState is opaque to
> the platform — only the provider interprets it."
>
> 因此签名接收 `AuthSessionInfo`（平台查 session 后传入），而非 `userId`（那意味着
> provider 需要自己 lookup session，违反约束）。这和 `postLoginInit(session)`、
> `refresh(session)`、`logout(session)` 保持一致。

### 2. plugin-api 导出变更

```typescript
// packages/plugin/api/src/index.ts — 追加导出
export type {
  // ... 现有 auth types ...
  ProtocolCredentialResult,  // NEW
} from './auth.js';
```

### 3. plugin-api package.json — 无需变更

`ProtocolCredentialResult` 从 `./auth` subpath 导出（已有），不需要新增 exports 条目。

### 4. green-package 实现

```typescript
// green-package: createHuaweiCasAuthProvider() 返回的对象中追加
// 注意：provider 从 session.providerState 读取自己写入的 modelInfo，
// 不访问 platform 的 session store

resolveProtocolCredential(protocol: string, session: AuthSessionInfo) {
  if (protocol !== 'huawei_maas') return null;

  const providerState = isRecord(session.providerState) ? session.providerState : {};
  const modelInfo = isRecord(providerState.modelInfo)
    ? (providerState.modelInfo as HuaweiMaaSSessionModelInfo)
    : null;
  if (!modelInfo) return null;

  const rawBaseUrl = modelInfo.model_api_url_base?.trim();
  if (!rawBaseUrl) return null;

  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    apiKey: 'huawei-maas-session',
    defaultHeaders: {
      Authorization: buildHuaweiMaaSAuthorization(modelInfo),
    },
  };
},
```

> **字段对齐**：复用现有 `resolveHuaweiMaaSRuntimeConfig` 的逻辑。
> header 是 `Authorization: Basic(appKey:appSecret)`（来自 `buildHuaweiMaaSAuthorization`），
> 不是 `X-Auth-Token`。`apiKey` 字段填占位值 `'huawei-maas-session'`，因为 MaaS
> 网关的认证走 header 而非 API key。

### 4b. huawei-iam 和 huawei-cas 都需要实现 resolveProtocolCredential

> **P1 fix**：green-package 同时导出 `huawei-iam` 和 `huawei-cas` 两个 auth provider，
> 且**两者都将 `modelInfo` 写入 `providerState`**：
> - `huawei-iam.ts:212`: `modelInfo: subResult.modelInfo ?? {}`
> - `huawei-cas.ts:313-325`: `modelInfo` normalized from `model_info`
>
> V1 的 resolver 只看 `session.providerState.modelInfo`，不区分哪个 provider 写的，
> 所以 IAM 路径也能解析 MaaS 凭证。**V2 两个 provider 都必须实现，否则 IAM 登录后 MaaS 功能回退。**

**方案**：直接复用现有 `resolveHuaweiMaaSRuntimeConfig`，不新建 helper 文件。

`resolveHuaweiMaaSRuntimeConfig(userId, getSession)` 接受一个 `SessionLookup` 回调，
我们构造一个只返回 `providerState` 的 fake getter 即可桥接：

```typescript
// createHuaweiCasAuthProvider() 和 createHuaweiIamAuthProvider() 中均追加：
import { resolveHuaweiMaaSRuntimeConfig } from '../integrations/huawei-maas.js';

resolveProtocolCredential(protocol: string, session: AuthSessionInfo) {
  if (protocol !== 'huawei_maas') return null;
  try {
    return resolveHuaweiMaaSRuntimeConfig(
      session.userId,
      () => ({ providerState: session.providerState }),
    );
  } catch {
    // modelInfo 缺失 / baseUrl 缺失时 resolveHuaweiMaaSRuntimeConfig 会 throw
    // 转为 null 表示"凭证不可用"
    return null;
  }
},
```

> **为什么不新建 `resolve-maas-credential.ts` 共享 helper**：
> `normalizeBaseUrl`、`isRecord`、`HuaweiMaaSSessionModelInfo` 都是 `huawei-maas.ts`
> 的内部未导出符号。与其强行导出它们，不如直接调用已导出的
> `resolveHuaweiMaaSRuntimeConfig`（它已经封装了全部解析逻辑），把 throw 转 null。
> 零新文件，零新导出。

### 5. api 消费方改造 — 具体注入路径

**问题**：三个消费者是深层 helper 函数，当前只接收 `userId`，没有 `authModule` 访问权。
具体约束：
- `builtin-credential-resolvers.ts` — 模块级纯函数，通过 `CredentialResolutionContext` 拿到 `userId`
- `agent-teams-bundle.ts` — 纯函数，参数只有 `binding`/`defaultModel`/`userId`
- `maas-models.ts` — Fastify route plugin，有 `app` 实例

`CredentialResolutionContext` 定义在 `@openjiuwen/relay-core`（共享包），不宜直接加 `authModule` 依赖。

**方案**：模块级 adapter + 启动时初始化。

adapter 是 V1 registry 的正式替代品——同样是模块级单例，但从 duck-typed Map
变为 typed adapter，内部委托给 `AuthProvider.resolveProtocolCredential`。

```typescript
// packages/api/src/integrations/protocol-credential-adapter.ts — 新文件

import type { ProtocolCredentialResult, AuthSessionInfo } from '@openjiuwen/relay-api-server-contracts/auth';
import type { AuthModule } from '../auth/module.js';
import { authSessionStore } from '../auth/session-store.js';

export type ProtocolCredentialLookup = (
  protocol: string,
  userId: string,
) => ProtocolCredentialResult | null;

let lookup: ProtocolCredentialLookup | undefined;

/**
 * Called once at startup after createAuthModule() completes.
 * Creates a closure that bridges: userId → platform session lookup → provider call.
 */
export function initProtocolCredentialAdapter(authModule: AuthModule): void {
  lookup = (protocol, userId) => {
    const record = authSessionStore.getByUserId(userId);
    if (!record) return null;
    const session: AuthSessionInfo = {
      sessionId: record.sessionId,
      userId: record.userId,
      providerId: record.providerId,
      providerState: record.providerState,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
    };
    return authModule.getActiveProvider().resolveProtocolCredential?.(protocol, session) ?? null;
  };
}

/**
 * Consumers call this — same signature as V1 getProtocolResolver().
 * Returns null if adapter not initialized or provider doesn't support the protocol.
 */
export function resolveProtocolCredential(
  protocol: string,
  userId: string,
): ProtocolCredentialResult | null {
  if (!lookup) return null;
  return lookup(protocol, userId);
}
```

**启动接线**：

```typescript
// index.ts — 在 createAuthModule() 之后、server.listen() 之前
import { initProtocolCredentialAdapter } from './integrations/protocol-credential-adapter.js';

const authModule = await createAuthModule();
initProtocolCredentialAdapter(authModule);   // ← 一行初始化
```

**三个消费者的改动**：

| 消费者 | 改动 | 调用方式 |
|--------|------|---------|
| `builtin-credential-resolvers.ts` | import 来源换为 adapter | `resolveProtocolCredential('huawei_maas', ctx.userId)` |
| `agent-teams-bundle.ts` | 同上 | `resolveProtocolCredential('huawei_maas', userId)` |
| `maas-models.ts` | 同上 | `resolveProtocolCredential('huawei_maas', userId)` |

**兜底行为**：

| 场景 | `resolveProtocolCredential` 返回值 | 消费者行为 |
|------|-----------------------------------|-----------
| adapter 未初始化（不应发生） | `null` | 同"provider 不支持" |
| auth provider 无 `resolveProtocolCredential` 方法 | `null` | 消费者 1/2: throw Error (fail-closed)；消费者 3: 返回空列表 |
| auth provider 返回 `null`（session 过期/modelInfo 缺失） | `null` | 同上 |
| 正常 | `{ baseUrl, apiKey, defaultHeaders }` | 使用凭证调用 MaaS |

> **为什么用模块级 adapter 而非 Fastify decorator 或 CredentialResolutionContext 扩展**：
> - `builtin-credential-resolvers.ts` 是模块级纯函数，没有 `app` 实例可用
> - `CredentialResolutionContext` 在 `@openjiuwen/relay-core` 中定义，加字段会扩大变更范围
> - 模块级 adapter 和 V1 的 `getProtocolResolver()` 对消费者完全同构，迁移成本最低
> - adapter 内部委托给 typed AuthProvider 方法，不再是 duck-typed registry

### 6. 删除的文件

| 文件 | 原因 |
|------|------|
| `api/src/integrations/protocol-credential-registry.ts` | 被 adapter 替代 |
| `api/src/integrations/huawei-maas.ts` | 已在 V1 删除 |

### 7. `integration-module.ts` 的处理

V1 中 `integration-module.ts` 承担两项鸭子检测：protocol + AOM。V2 中 protocol 走
AuthProvider + adapter，AOM 走独立 MetricsProvider。两者都有各自的初始化路径。
**`integration-module.ts` 整个删除。**

`auth/module.ts` 中 V1 新增的 `loadedModuleNamespaces` 字段同步移除，恢复原状。

---

## 方向 B：MetricsProvider — 独立 Provider

### 1. plugin-api 接口定义

```typescript
// packages/plugin/api/src/metrics.ts — 新文件

/**
 * Metrics Provider Plugin API — contract for metrics reporter config resolution.
 *
 * Scope: the provider resolves cloud-platform credentials into a reporter config
 * (endpoint + token + projectId). The platform core owns the reporter lifecycle
 * (creation, concurrency guard, periodic flush, shutdown).
 *
 * This is intentionally a "config provider", not a "reporter factory":
 *   - Core controls reporter implementation (AomMetricsReporter, Prometheus remote-write)
 *   - Provider only handles the cloud-specific credential exchange
 *   - Future: if we need pluggable reporter backends, promote to createReporter()
 *
 * Design:
 *   - `resolveReporterConfig` receives opaque `providerState` from the auth session.
 *     The provider interprets it internally (e.g., extract CAS credentials for AOM).
 *   - Returning null means "conditions not met, skip metrics" — not an error.
 *   - Core only calls this after a successful login, never at startup.
 */

export interface MetricsReporterConfig {
  endpoint: string;
  token: string;
  projectId: string;
}

export interface MetricsProviderInput {
  /** Opaque auth state from login session. Provider interprets internally. */
  providerState: unknown;
  /** Platform base URL (e.g., region endpoint). */
  baseUrl: string;
  /** Instance identifier for metrics tagging. */
  instanceId?: string;
  /** Logger for diagnostic output. Compatible with Fastify/pino logger shape. */
  log?: {
    info(msg: string): void;
    info(obj: unknown, msg: string): void;
    warn(msg: string): void;
    warn(obj: unknown, msg: string): void;
    error(msg: string): void;
    error(obj: unknown, msg: string): void;
  };
}

export interface MetricsProvider {
  readonly id: string;
  readonly displayName?: string;

  bootstrap?(): Promise<void>;
  shutdown?(): Promise<void>;

  /**
   * Resolve metrics reporter configuration from auth session state.
   * Return null if conditions are not met (missing credentials, unsupported region, etc.).
   */
  resolveReporterConfig(input: MetricsProviderInput): Promise<MetricsReporterConfig | null>;
}
```

### 2. plugin-api 导出 + package exports

```typescript
// packages/plugin/api/src/index.ts — 追加
export type {
  MetricsProvider,
  MetricsProviderInput,
  MetricsReporterConfig,
} from './metrics.js';
```

```jsonc
// packages/plugin/api/package.json — exports 追加：
"./metrics": {
  "import": "./dist/metrics.js",
  "types": "./dist/metrics.d.ts"
}
```

### 2b. green-package package.json — exports 追加

```jsonc
// packages/green-package/api/package.json — exports 追加：
"./metrics-plugin": {
  "import": "./dist/metrics-plugin.js",
  "types": "./dist/metrics-plugin.d.ts"
}
```

> **P1 fix**：没有这两条 exports，`import('@openjiuwen/relay-api-server-contracts/metrics')` 和
> `import('@office-claw/green-package/metrics-plugin')` 会直接报 ERR_PACKAGE_PATH_NOT_EXPORTED。

### 3. api 侧标准三件套

**3a. Registry**

```typescript
// packages/api/src/metrics/provider-registry.ts

import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';

function isRecord(value: unknown): value is Record<string, unknown> { ... }

function isMetricsProvider(value: unknown): value is MetricsProvider {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.resolveReporterConfig === 'function';
}

function collectModuleProviders(namespace: unknown): MetricsProvider[] {
  if (!isRecord(namespace)) return [];
  const providers: MetricsProvider[] = [];
  const push = (p: MetricsProvider) => {
    if (!providers.some(x => x.id === p.id)) providers.push(p);
  };
  if (isMetricsProvider(namespace.default)) push(namespace.default);
  if (isMetricsProvider(namespace.metricsProvider)) push(namespace.metricsProvider);
  if (Array.isArray(namespace.metricsProviders)) {
    for (const c of namespace.metricsProviders) {
      if (isMetricsProvider(c)) push(c);
    }
  }
  return providers;
}

export class MetricsProviderRegistry {
  private readonly providers = new Map<string, MetricsProvider>();

  register(provider: MetricsProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Metrics provider '${provider.id}' already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): MetricsProvider { ... }
  listIds(): string[] { ... }

  async registerModule(
    specifier: string,
    moduleLoader: (specifier: string) => Promise<unknown>,
  ): Promise<void> {
    const namespace = await moduleLoader(specifier);
    const providers = collectModuleProviders(namespace);
    if (providers.length === 0) {
      throw new Error(`Metrics provider module '${specifier}' exported no metrics providers`);
    }
    for (const provider of providers) {
      this.register(provider);
    }
  }
}
```

**3b. Module factory**

```typescript
// packages/api/src/metrics/module.ts

import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';
import { createNoopMetricsProvider } from './providers/noop.js';
import { MetricsProviderRegistry } from './provider-registry.js';

export interface MetricsModule {
  activeProviderId: string;
  providerRegistry: MetricsProviderRegistry;
  getActiveProvider(): MetricsProvider;
}

export interface CreateMetricsModuleOptions {
  env?: NodeJS.ProcessEnv;
  moduleLoader?: (specifier: string) => Promise<unknown>;
  providers?: MetricsProvider[];
}

function parseModuleSpecifiers(env: NodeJS.ProcessEnv): string[] {
  const raw = env.OFFICE_CLAW_METRICS_PROVIDER_MODULES?.trim();
  if (!raw) return [];
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

export function resolveConfiguredMetricsProviderId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OFFICE_CLAW_METRICS_PROVIDER?.trim() || 'noop';
}

export async function createMetricsModule(
  options: CreateMetricsModuleOptions = {},
): Promise<MetricsModule> {
  const env = options.env ?? process.env;
  const moduleLoader = options.moduleLoader ?? ((s: string) => import(s));
  const providerRegistry = new MetricsProviderRegistry();

  providerRegistry.register(createNoopMetricsProvider());
  for (const provider of options.providers ?? []) {
    providerRegistry.register(provider);
  }
  for (const spec of parseModuleSpecifiers(env)) {
    await providerRegistry.registerModule(spec, moduleLoader);
  }

  const activeProviderId = resolveConfiguredMetricsProviderId(env);
  const activeProvider = providerRegistry.get(activeProviderId);
  await activeProvider.bootstrap?.();

  return {
    activeProviderId,
    providerRegistry,
    getActiveProvider() { return activeProvider; },
  };
}
```

**3c. Noop provider**

```typescript
// packages/api/src/metrics/providers/noop.ts

import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';

export function createNoopMetricsProvider(): MetricsProvider {
  return {
    id: 'noop',
    displayName: 'No-op Metrics (disabled)',
    async resolveReporterConfig() {
      return null;
    },
  };
}
```

### 4. green-package 实现

```typescript
// packages/green-package/api/src/metrics-plugin.ts — 新文件

import type { MetricsProvider } from '@openjiuwen/relay-api-server-contracts/metrics';
import {
  extractRegion,
  buildAomEndpoint,
  ensurePrometheusInstance,
  fetchAomAccessCode,
  type CasCredential,
} from './metrics/aom-access-code-client.js';

export const metricsProviders: MetricsProvider[] = [createAomMetricsProvider()];

function createAomMetricsProvider(): MetricsProvider {
  return {
    id: 'aom',
    displayName: 'Huawei Cloud AOM',

    async resolveReporterConfig(input) {
      const log = input.log;
      const ps = input.providerState as Record<string, unknown> | null;
      if (!ps) return null;

      const credential: CasCredential = {
        access: String(ps.access ?? ''),
        secret: String(ps.secret ?? ''),
        sts_token: String(ps.sts_token ?? ''),
        project_id: String(ps.project_id ?? ''),
      };

      if (!credential.access || !credential.secret
        || !credential.sts_token || !credential.project_id) {
        log?.warn('[AomMetricsProvider] Missing CAS credential fields, skipping');
        return null;
      }

      const region = extractRegion(input.baseUrl);
      const instances = await ensurePrometheusInstance(credential, region, log);
      if (!instances) {
        log?.warn('[AomMetricsProvider] No Prometheus instance available');
        return null;
      }

      const result = await fetchAomAccessCode(credential, region, log);
      if (!result) {
        log?.warn('[AomMetricsProvider] Failed to fetch AOM access code');
        return null;
      }

      log?.info('[AomMetricsProvider] AOM credentials resolved successfully');
      return {
        endpoint: buildAomEndpoint(region, credential.project_id),
        token: result.accessCode,
        projectId: credential.project_id,
      };
    },
  };
}
```

### 5. api `index.ts` 接线

```typescript
// 启动阶段：
const metricsModule = await createMetricsModule({ env: process.env });
app.log.info(`[api] Metrics provider: ${metricsModule.activeProviderId}`);

// onPostLogin hook：
if (session.providerState) {
  const metricsProvider = metricsModule.getActiveProvider();
  const baseUrl = process.env.HUAWEI_CLAW_URL || process.env.CAS_SERVICE_BASE_URL || '';
  const instanceId = process.env.AOM_INSTANCE_ID || 'officeclaw-instance';

  const config = await metricsProvider.resolveReporterConfig({
    providerState: session.providerState,
    baseUrl,
    instanceId,
    log: request.log,
  });

  if (config) {
    const { initMetricsFromConfig, startTokenUsageReporter, reportMetric }
      = await import('./services/metrics/index.js');
    // initMetricsFromConfig 内部已经调用 readClawVersion()，不需要外部传入
    const wasFirst = await initMetricsFromConfig(
      async () => ({ ...config, instanceId }),
      request.log,
    );
    if (wasFirst) {
      startTokenUsageReporter(60_000);
      await reportMetric('agentarts_claw_user_login', 1, undefined, request.log);
    }
  }
}
```

### 6. 删除的文件

| 文件 | 原因 |
|------|------|
| `api/src/integrations/aom-initializer-registry.ts` | 被 MetricsProvider 替代 |
| `api/src/integrations/integration-module.ts` | 两项鸭子检测均已归位，整个文件无用 |
| `api/src/services/metrics/aom-access-code-client.ts` | 已在 V1 移至 green-package |

---

## Edge Case 兜底矩阵

### Protocol Credential（AuthProvider 扩展）

| 场景 | 条件 | 行为 | 原因 |
|------|------|------|------|
| 开源部署，无 green-package | auth provider = `no-auth`，无 `resolveProtocolCredential` 方法 | 返回 `undefined` | `no-auth` 不实现该可选方法 |
| 开源部署，配了 huawei_maas 协议 | profile 写了 `protocol: huawei_maas` 但 provider 无该方法 | **throw Error**：`"huawei_maas protocol configured but active auth provider does not support protocol credential resolution"` | 配置矛盾，fail-closed |
| 华为云部署，正常登录 | auth provider = `huawei-cas`，有 `resolveProtocolCredential` | 正常返回凭证 | Happy path |
| 华为云部署，session 过期 | `resolveProtocolCredential` 内部查 session 失败 | 返回 `null` | provider 内部处理，消费方做空值判断 |
| 华为云部署，MaaS 模型列表 | resolver 可用但返回 null（session 问题） | 返回空模型列表 + warn | 降级合理 |
| 新增云厂商（如 aliyun） | 新 auth provider 可选实现 `resolveProtocolCredential` | 自动支持 | 接口可选方法，按需实现 |

### Metrics Provider

| 场景 | 条件 | 行为 | 原因 |
|------|------|------|------|
| 未配置 `OFFICE_CLAW_METRICS_PROVIDER` | 默认值 `noop` | `resolveReporterConfig` 返回 null，不初始化 reporter | 功能关闭，静默 |
| 配了 `OFFICE_CLAW_METRICS_PROVIDER=aom` 但无模块 | registry 里没有 id=aom 的 provider | **throw Error** at `createMetricsModule`：`"Metrics provider 'aom' not found"` | 配置矛盾，fail-closed |
| 配了 `aom` + 模块，但 CAS 凭证缺失 | `resolveReporterConfig` 检测到缺字段 | 返回 null + warn 日志 | 条件不满足，不报错 |
| 配了 `aom` + 模块，Prometheus 实例创建失败 | 网络/权限问题 | 返回 null + warn 日志 | 暂时性失败，不崩溃 |
| 配了 `aom` + 模块，正常登录 | 一切就绪 | 返回 config → 初始化 reporter → 定时上报 | Happy path |
| 并发登录 | 多个用户同时触发 `onPostLogin` | `initMetricsFromConfig` 的 `initPromise` 并发守卫保证只初始化一次 | 现有逻辑保留 |
| 未登录（`no-auth` 模式） | `session.providerState` 为空 | `if (session.providerState)` 跳过整个 metrics 块 | 无凭证无法上报 |

### 启动顺序约束

```
createAuthModule()          ← 必须先完成（auth provider 需要先 bootstrap）
createMetricsModule()       ← 独立于 auth，可并行或顺序
createEvidenceModule()      ← 独立
createSchedulerModule()     ← 独立
createStorageModule()       ← 独立
server.listen()             ← 所有 module 就绪后
onPostLogin hook 触发       ← 运行时，调用 authProvider.resolveProtocolCredential
                              + metricsProvider.resolveReporterConfig
```

`createMetricsModule()` 不依赖 `createAuthModule()` 的结果（不需要 auth session），只是注册和选择 provider。实际的 `resolveReporterConfig` 调用发生在 `onPostLogin` 时，此时 auth 已完成。

---

## `.env.example` 变更

### 新增

```env
# ── Metrics Provider 指标上报（可选）────────────────────────────
# Provider selection for metrics/observability backend.
# Default: noop (no metrics reporting).
# 默认 noop（不上报指标）。配置 aom 需同时配置 MODULES 指向实现包。
#
# OFFICE_CLAW_METRICS_PROVIDER=aom
# OFFICE_CLAW_METRICS_PROVIDER_MODULES=@office-claw/green-package/metrics-plugin
```

### 无变更

以下已有配置不需要改动：

```env
# Auth provider — 不变
OFFICE_CLAW_AUTH_PROVIDER=huawei-cas
OFFICE_CLAW_AUTH_PROVIDER_MODULES=@office-claw/green-package/providers-plugin

# Evidence / Scheduler — 不变
OFFICE_CLAW_EVIDENCE_PROVIDER=sqlite
OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/evidence
OFFICE_CLAW_SCHEDULER_PROVIDER=sqlite
OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/scheduler
```

### 用户 `.env` 迁移

**无 green-package 用户（开源）**：零变更。`METRICS_PROVIDER` 默认 `noop`，`resolveProtocolCredential` 不实现。

**有 green-package 用户（华为云）**：需要新增两行：

```env
OFFICE_CLAW_METRICS_PROVIDER=aom
OFFICE_CLAW_METRICS_PROVIDER_MODULES=@office-claw/green-package/metrics-plugin
```

如果不加，AOM 上报静默关闭（noop），不报错。

---

## 文件变更总览

### 新增

| 文件 | 用途 |
|------|------|
| `plugin-api/src/metrics.ts` | MetricsProvider interface 定义 |
| `api/src/metrics/provider-registry.ts` | MetricsProviderRegistry |
| `api/src/metrics/module.ts` | createMetricsModule() |
| `api/src/metrics/providers/noop.ts` | Noop metrics provider |
| `api/src/integrations/protocol-credential-adapter.ts` | platform session → provider 桥接 adapter |
| `green-package/api/src/metrics-plugin.ts` | AOM metrics provider 实现 |

### 修改

| 文件 | 变更 |
|------|------|
| `plugin-api/src/auth.ts` | 加 `resolveProtocolCredential?(protocol, session)` 可选方法 + `ProtocolCredentialResult` 类型 |
| `plugin-api/src/index.ts` | 导出新类型 |
| `plugin-api/package.json` | exports 加 `./metrics` 子路径 |
| `api/src/index.ts` | `createMetricsModule()` + `initProtocolCredentialAdapter()` + onPostLogin 改用 metricsProvider |
| `api/src/config/plugins/builtin-credential-resolvers.ts` | 改用 adapter 的 `resolveProtocolCredential()` |
| `api/src/routes/maas-models.ts` | 同上 |
| `api/src/utils/agent-teams-bundle.ts` | 同上 |
| `api/package.json` | 移除 green-package 依赖（同 V1） |
| `green-package/api/src/auth/huawei-cas.ts` | 加 `resolveProtocolCredential` 实现（复用 `resolveHuaweiMaaSRuntimeConfig`） |
| `green-package/api/src/auth/huawei-iam.ts` | 同上 |
| `green-package/api/package.json` | exports 加 `./metrics-plugin` 子路径 |
| `.env.example` | 新增 METRICS_PROVIDER 注释段 |

### 删除

| 文件 | 原因 |
|------|------|
| `api/src/integrations/protocol-credential-registry.ts` | 被 AuthProvider 方法替代 |
| `api/src/integrations/aom-initializer-registry.ts` | 被 MetricsProvider 替代 |
| `api/src/integrations/integration-module.ts` | 无用，两项检测均已归位 |
| `api/src/integrations/huawei-maas.ts` | 同 V1 |
| `api/src/services/metrics/aom-access-code-client.ts` | 同 V1 |

### 净变化

- **新增 6 个文件**（plugin-api 1 + api 4 + green-package 1）
- **删除 5 个文件**（V1 的 3 个自建 registry + 2 个原有 shim）
- **修改 11 个文件**（含 2 个 package.json exports）
- **新增 env 变量 2 个**（`OFFICE_CLAW_METRICS_PROVIDER` + `OFFICE_CLAW_METRICS_PROVIDER_MODULES`）

---

## 与 V1 的对比

| 维度 | V1（鸭子方案） | V2（对齐协议） |
|------|--------------|--------------|
| 编译期契约 | 无 | plugin-api 有 interface |
| 模块加载 | 寄生 auth 通道 | 各自独立 env + module factory |
| Registry | 手建 Map / 单槽变量 | 标准 XxxProviderRegistry 类 |
| 默认行为 | `undefined` 检查跳过 | noop provider 显式返回 null |
| 新增 env | 0 | 2（METRICS_PROVIDER + MODULES） |
| 代码量 | 少 | 多（但全是模板代码，和 evidence/scheduler 一致） |
| 可维护性 | 需要记住 key 名约定 | IDE 可 navigate 到 interface 定义 |
| 扩展性 | 加新能力需要改 integration-module.ts | 加新 provider 只需标准三件套 |

---

## 验收标准

1. **无 green-package 编译通过**：`packages/api` 单独 `tsc --noEmit` 成功
2. **无 green-package 测试通过**：`pnpm --filter @openjiuwen/relay-api-server run test:public` 全绿
3. **Metrics noop 默认**：不配置 `METRICS_PROVIDER` 时 metrics 静默关闭，日志输出 `Metrics provider: noop`
4. **Metrics AOM 正常**：配置 `aom` + 模块后，CAS 登录触发 AOM 上报
5. **CAS Protocol credential 正常**：CAS 登录后 DARE/RelayClaw agent 能获取 huawei_maas 凭证
6. **IAM Protocol credential 正常**：IAM 登录后 DARE/RelayClaw agent 能获取 huawei_maas 凭证
7. **fail-closed 验证**：配置 `huawei_maas` 协议但 auth provider 不支持时，抛明确错误
8. **fail-closed 验证**：配置 `METRICS_PROVIDER=aom` 但无模块时，启动报错
9. **并发安全**：多用户同时登录，`initMetricsFromConfig` 只调用一次
