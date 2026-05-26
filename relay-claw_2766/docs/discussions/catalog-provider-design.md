# Catalog Provider 设计：多用户成员配置抽象方案

> **状态**: 方案（待 CVO 审批）
> **作者**: 布偶猫/宪宪 (Opus-4.6)
> **修订**: 缅因猫/砚砚 (GPT-5.5)
> **日期**: 2026-05-13

## 1. 背景与目标

当前成员配置（catalog）系统通过本地 JSON 文件（`.office-claw/office-claw-catalog.json`）进行读写。为适配云端多用户部署场景，需要：

1. 将 catalog 读写抽象为 plugin-api 接口，默认实现与当前文件读写一致，云端版本自定义实现
2. 接口引入 `identity` 字段区分用户，本地文件实现忽略该字段
3. 每个**成员**增加 `extend` 字段，字段位于 **variant/member 粒度**，是自由 JSON 结构体，平台不做业务校验
4. 消息发送链路中 identity 全程透传；云端 provider 在自己的实现中解析 `extend`，完成账号和用户相关处理

**交付模型**：我们通过 npm 包 `@openjiuwen/relay-api-server-contracts` 提供接口定义。默认 `FileCatalogProvider` 行为与当前本地文件实现保持一致。云端同事安装此 npm 包后，自行实现 `CatalogProvider`，在他们的 provider 内部基于 `identity` 和 `extend` 完成用户隔离、账号选择和外部平台集成。

## 2. 当前工程的真实结构

在当前工程中，真正参与路由和调用的“成员”，不是 breed，而是 **variant 展平后的 member**：

- 配置源结构：`AgentBreed -> AgentVariant[]`
- 运行时路由结构：`toAllAgentConfigs(config) -> Record<agentId, OfficeClawConfigEntry>`
- `agentId` 是最终路由和调用的主键

因此本方案中的“成员”指的是：

- `packages/shared/src/types/agent-breed.ts` 中的 `AgentVariant`
- 或经过 `toAllAgentConfigs()` 投影后的 `OfficeClawConfigEntry`

不再使用旧文档里的 `CatBreed` / `CatConfig` / `catRegistry` 命名。

## 3. 架构总览

```text
┌────────────────────────────────────────────────────────────┐
│ HTTP / Queue / Callback / Connector Trigger               │
│                                                            │
│  入口层解析 trusted userId                                 │
│  └─ 组装 GatewayIdentity { userId }                        │
│                                                            │
│  AgentRouter / routeExecution                              │
│  └─ CatalogProvider.listRoutableMembers(identity)          │
│     用于 mention 解析和可路由成员判断                        │
│                                                            │
│  invokeSingleCat                                           │
│  └─ CatalogProvider.getMember(identity, agentId)           │
│     读取成员配置 + extend                                  │
│                                                            │
│  AgentServiceOptions                                       │
│  └─ { gatewayIdentity, memberExtend, providerProfile?... } │
│                                                            │
│  各 AgentService 实现                                       │
│  └─ Claude / Codex / Gemini / ACP / RelayClaw / A2A ...   │
│                                                            │
│  云端自定义 Provider                                        │
│  └─ 基于 identity + extend 解析账号和用户                  │
└────────────────────────────────────────────────────────────┘
```

## 4. 接口定义

### 4.1 身份类型：GatewayIdentity

Catalog 使用已有的 `GatewayIdentity` 作为统一身份标识：

```typescript
// packages/plugin/api/src/identity.ts
export interface GatewayIdentity {
  userId: string;
}
```

使用方式：

```typescript
import type { GatewayIdentity } from '@openjiuwen/relay-api-server-contracts/identity';
```

### 4.2 CatalogProvider

```typescript
// packages/plugin/api/src/catalog.ts

import type { GatewayIdentity } from './identity.js';
import type { OfficeClawConfig, OfficeClawConfigEntry } from '@openjiuwen/relay-shared';

export interface CatalogProvider {
  readonly id: string;
  readonly displayName?: string;

  /**
   * 读取指定用户的完整 catalog 配置。
   * 文件实现：忽略 identity，直接读本地文件。
   * 云端实现：按 identity.userId 查询。
   */
  readCatalog(identity: GatewayIdentity): Promise<CatalogSnapshot>;

  /**
   * 写入/更新 catalog 配置。
   * 当前场景不涉及不同用户同时写同一个本地文件，
   * 因此接口不引入 expectedVersion / 乐观并发控制。
   */
  writeCatalog(identity: GatewayIdentity, catalog: OfficeClawConfig): Promise<void>;

  /**
   * 按 identity + agentId 查询单个成员。
   * 用于消息发送流程中的快速查询。
   * 未实现时可降级为 readCatalog() + toAllAgentConfigs()。
   */
  getMember?(identity: GatewayIdentity, agentId: string): Promise<CatalogMemberEntry | null>;

  /**
   * 列出指定用户可路由的成员。
   * 用于替代全局 officeClawRegistry.getAllConfigs() 做 mention 解析。
   * 文件实现：返回所有成员（忽略 identity）。
   * 云端实现：返回该用户可见的成员子集。
   */
  listRoutableMembers?(identity: GatewayIdentity): Promise<CatalogMemberEntry[]>;

  bootstrap?(): Promise<void>;
  shutdown?(): Promise<void>;
}
```

### 4.3 辅助类型

```typescript
// packages/plugin/api/src/catalog.ts

import type { OfficeClawConfig, OfficeClawConfigEntry } from '@openjiuwen/relay-shared';

export interface CatalogMemberEntry {
  agentId: string;
  config: OfficeClawConfigEntry;
  extend?: Record<string, unknown>;
}

export interface CatalogSnapshot {
  catalog: OfficeClawConfig;
}
```

### 4.4 包导出

```jsonc
// packages/plugin/api/package.json
{
  "./catalog": {
    "import": "./dist/catalog.js",
    "types": "./dist/catalog.d.ts"
  }
}
```

使用方式：

```typescript
import type {
  CatalogProvider,
  CatalogSnapshot,
  CatalogMemberEntry,
} from '@openjiuwen/relay-api-server-contracts/catalog';
import type { GatewayIdentity } from '@openjiuwen/relay-api-server-contracts/identity';
```

## 5. 类型变更

### 5.1 `extend` 放到 `AgentVariant`

当前工程中成员粒度在 variant，因此 `extend` 必须定义在 `AgentVariant` 上，而不是 `AgentBreed` 上。

```typescript
// packages/shared/src/types/agent-breed.ts
export interface AgentVariant {
  readonly id: string;
  readonly agentId?: string;
  readonly displayName?: string;
  readonly mentionPatterns?: readonly string[];
  readonly accountRef?: string;
  readonly provider: AgentProvider;
  readonly defaultModel: string;
  readonly mcpSupport: boolean;
  readonly cli: CliConfig;

  /** 云端 provider 自定义扩展信息。平台不做业务校验。 */
  readonly extend?: Readonly<Record<string, unknown>>;
}
```

### 5.2 Zod Schema 变更

```typescript
// packages/api/src/config/office-claw-config-loader.ts
const agentVariantSchema = z.object({
  // ...现有字段...
  extend: z.record(z.string(), z.unknown()).optional(),
});
```

只校验“如果存在则必须是 object”，不做业务字段约束。

### 5.3 运行时投影补全

当前运行时路由使用 `toAllAgentConfigs()` 生成 `OfficeClawConfigEntry`。  
因此需要把 variant 上的 `extend` 一并投影进去。

```typescript
// packages/shared/src/types/agent.ts
export interface OfficeClawConfigEntry {
  readonly id: AgentId;
  readonly name: string;
  readonly displayName: string;
  // ...现有字段...
  readonly extend?: Readonly<Record<string, unknown>>;
}
```

```typescript
// packages/api/src/config/office-claw-config-loader.ts
result[agentId] = {
  id: createAgentId(agentId),
  name: variant.displayName ?? breed.name,
  displayName: variant.displayName ?? breed.displayName,
  // ...现有映射...
  ...(variant.extend != null ? { extend: variant.extend } : {}),
};
```

### 5.4 `extend` 的职责边界

`extend` 是**成员配置字段**，不是仅在运行时临时拼装的附加信息。

因此它在系统中的职责分工必须明确为：

1. `agent` 管理 API 负责接收、修改、返回 `extend`
2. `CatalogProvider` 负责持久化并读取 `extend`
3. `invokeSingleCat` 负责读取并透传 `extend`
4. 云端自定义 provider 负责解释和使用 `extend`

特别说明：

- `invokeSingleCat` **不负责解释** `extend` 的业务含义
- `invokeSingleCat` 的职责仅为：
  - 通过 `CatalogProvider.getMember(identity, agentId)` 读取成员
  - 取得 `member.extend`
  - 将其写入 `AgentServiceOptions.memberExtend`
  - 再传递给 `service.invoke(prompt, options)`

### 5.5 AgentServiceOptions 扩展

当前工程内调用栈使用的是 `packages/api/src/domains/agents/services/types.ts` 中的 `AgentServiceOptions`。  
文档中的修改目标也应以该文件为准。

```typescript
// packages/api/src/domains/agents/services/types.ts
export interface AgentServiceOptions {
  // ...现有字段...

  /** 请求发起者身份认证信息，供云端 provider 使用。 */
  gatewayIdentity?: GatewayIdentity;

  /** 当前成员的 extend 扩展字段，来自 CatalogProvider.getMember()。 */
  memberExtend?: Record<string, unknown>;
}
```

## 6. 身份解析

### 6.1 新增 `resolveGatewayIdentity()`

```typescript
// packages/api/src/utils/request-identity.ts

import type { FastifyRequest } from 'fastify';
import type { GatewayIdentity } from '@openjiuwen/relay-api-server-contracts/identity';

export function resolveGatewayIdentity(request: FastifyRequest): GatewayIdentity | null {
  const userId = resolveTrustedUserId(request);
  if (!userId) return null;
  return { userId };
}
```

### 6.2 信任链路

Catalog 身份必须只来自可信来源：

1. `request.authenticatedUserId`
2. `request.auth?.userId`
3. 无身份则返回 `null`

**不接受**：

- `query.userId`
- `default-user` 回退

原因是 catalog 是用户隔离边界，不能使用兼容性 hint。

## 7. 结合当前代码确认：哪些链路已经传了 identity

### 7.1 结论

**当前代码还没有在 A2A callback、multi-mention callback、QueueProcessor、ConnectorInvokeTrigger 等链路中传递独立的 `GatewayIdentity` 对象。**

它们目前传递的是 `userId: string`，并调用：

```typescript
router.routeExecution(userId, ...)
```

而不是：

```typescript
router.routeExecution(identity, ...)
```

### 7.2 已核实的调用点

以下链路当前都只传 `userId`：

- `packages/api/src/routes/callback-a2a-trigger.ts`
- `packages/api/src/routes/callback-multi-mention-routes.ts`
- `packages/api/src/domains/agents/services/agents/invocation/QueueProcessor.ts`
- `packages/api/src/infrastructure/email/ConnectorInvokeTrigger.ts`
- `packages/api/src/routes/messages.ts`

### 7.3 对实施方案的影响

因此 Phase 3 不能只改 `POST /api/messages` 主入口，必须一并改造：

- `AgentRouter.resolveTargetsAndIntent()`
- `AgentRouter.routeExecution()`
- `invokeSingleCat()`
- 所有 callback / queue / connector 触发入口

否则会出现：

- HTTP 主链路按 identity 作用域取 catalog
- callback / queue 链路仍按旧的 `userId + 全局 registry` 逻辑运行

这会造成行为不一致。

## 8. 消息发送链路变更

### 8.1 当前流程

当前主链路大致为：

```text
POST /api/messages
  -> resolveTrustedUserId(request) -> userId
  -> router.resolveTargetsAndIntent(content, threadId)
  -> router.routeExecution(userId, ...)
  -> invokeSingleCat(...)
  -> service.invoke(prompt, options)
```

内部 callback / queue / connector 链路也是调用 `routeExecution(userId, ...)`。

### 8.2 改造后目标流程

```text
入口（HTTP / Queue / Callback / Connector）
  -> 解析 / 组装 GatewayIdentity
  -> router.resolveTargetsAndIntent(..., identity)
  -> router.routeExecution(identity, ...)
  -> invokeSingleCat(..., gatewayIdentity: identity)
  -> catalogProvider.getMember(identity, agentId)
  -> service.invoke(prompt, {
       gatewayIdentity: identity,
       memberExtend: member.extend,
       providerProfile: resolvedByPlatformOrCloudProvider,
     })
```

### 8.3 路由约束原则

**所有候选成员的产生、过滤、fallback，都必须按 identity 的可见成员集合来约束。**

这条规则覆盖的不只是显式 `@mention`，还包括：

- 无 mention 时的隐式回退
- thread participant 回退
- preferredCats 候选集
- routingPolicy 过滤后的候选集
- `@all` / `@thread` / `@全体某组` 等群体展开
- 最终 default/fallback 成员选择

实现上应遵循以下原则：

1. 先通过 `catalogProvider.listRoutableMembers(identity)` 得到当前 identity 的可见成员集合
2. `AgentRouter` 中任何地方产生的候选成员，都必须与该集合求交
3. 如果求交后为空，才允许进入基于该 identity 的 fallback 逻辑
4. 不允许在 identity 作用域之外直接从全局 `officeClawRegistry` 选出最终目标成员

也就是说，`officeClawRegistry` 只可作为：

- 本地默认 provider 的种子基线
- 无请求上下文时的内部系统兜底

不能再作为有 identity 请求下的最终路由权威。

### 8.4 关键变更点

| 组件 | 当前 | 改造后 |
|------|------|--------|
| 身份来源 | `userId: string` | `GatewayIdentity` |
| Mention 解析 | `officeClawRegistry.getAllConfigs()` | `catalogProvider.listRoutableMembers(identity)` |
| 单成员查询 | `officeClawRegistry.tryGet(agentId)` | `catalogProvider.getMember(identity, agentId)` |
| Provider 调用 | 无 identity / extend | `gatewayIdentity + memberExtend` |
| callback / queue 链路 | 仅传 `userId` | 统一传 `GatewayIdentity` |

## 9. Provider 注册与加载

### 9.1 环境变量

```bash
OFFICE_CLAW_CATALOG_PROVIDER=file
OFFICE_CLAW_CATALOG_PROVIDER_MODULES=@my-org/cloud-catalog-provider
```

### 9.2 注册表

```typescript
// packages/api/src/config/catalog-provider-registry.ts

export class CatalogProviderRegistry {
  register(provider: CatalogProvider): void;
  get(id: string): CatalogProvider;
  getActive(): CatalogProvider;
  listIds(): string[];
}
```

注册模式沿用当前 `StorageProviderRegistry`。

### 9.3 默认文件 Provider

```typescript
class FileCatalogProvider implements CatalogProvider {
  readonly id = 'file';
  readonly displayName = '本地文件';

  async readCatalog(_identity: GatewayIdentity): Promise<CatalogSnapshot> {
    const catalog = readRuntimeAgentCatalog(this.projectRoot);
    return { catalog };
  }

  async writeCatalog(
    _identity: GatewayIdentity,
    catalog: OfficeClawConfig,
  ): Promise<void> {
    writeAndValidateCatalog(this.projectRoot, catalog);
  }

  async getMember(
    _identity: GatewayIdentity,
    agentId: string,
  ): Promise<CatalogMemberEntry | null> {
    const snapshot = await this.readCatalog(_identity);
    const configs = toAllAgentConfigs(snapshot.catalog);
    const config = configs[agentId];
    if (!config) return null;
    return { agentId, config, extend: config.extend };
  }

  async listRoutableMembers(
    _identity: GatewayIdentity,
  ): Promise<CatalogMemberEntry[]> {
    const snapshot = await this.readCatalog(_identity);
    const configs = toAllAgentConfigs(snapshot.catalog);
    return Object.entries(configs).map(([agentId, config]) => ({
      agentId,
      config,
      extend: config.extend,
    }));
  }
}
```

本地文件 provider 继续忽略 identity，行为与当前实现保持一致。

### 9.4 文件写入边界

为避免 `FileCatalogProvider` 依赖私有 helper，本方案明确要求：

- 将 `packages/api/src/config/runtime-office-claw-catalog.ts` 中的 `writeAndValidateCatalog()` **直接导出**
- `catalog-file-provider.ts` 通过该导出函数完成本地写入

目标是避免以下不确定实现：

- 重新复制一份文件写入逻辑
- 把 provider 塞回 runtime helper 内部
- 为了 provider 再新造一层重复 store

因此本次实现的推荐方式是：

```typescript
// packages/api/src/config/runtime-office-claw-catalog.ts
export function writeAndValidateCatalog(projectRoot: string, catalog: unknown): OfficeClawConfig
```

然后由：

```typescript
// packages/api/src/config/catalog-file-provider.ts
import { readRuntimeAgentCatalog, writeAndValidateCatalog } from './runtime-office-claw-catalog.js';
```

统一复用现有本地文件写入与校验逻辑。

## 10. 成员管理 API 变更

当前成员管理路由真实文件为：

- `packages/api/src/routes/agents.ts`

不是旧文档中的 `routes/cats.ts`。

### 10.1 改造前

当前主要通过这些 helper 直接读写本地 runtime catalog：

- `createRuntimeCat(projectRoot, input)`
- `updateRuntimeCat(projectRoot, agentId, patch)`
- `deleteRuntimeCat(projectRoot, agentId)`

对应文件：

- `packages/api/src/config/runtime-office-claw-catalog.ts`

### 10.1.1 `extend` 在 agent 管理 API 中的要求

这里的“成员管理 API”即当前工程中的 `agent` 管理 API：

- `GET /api/agents`
- `POST /api/agents`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`

由于 `extend` 是成员配置字段，因此本方案明确要求：

1. `POST /api/agents` 支持传入可选 `extend`
2. `PATCH /api/agents/:id` 支持更新可选 `extend`
3. `GET /api/agents` 返回当前保存的 `extend`

也就是说，`extend` 必须在“创建 / 修改 / 查询”三条链路上都可见，而不是只在运行时调用时才存在。

### 10.2 改造后目标

成员管理路由读取和写入 catalog 时，改为通过 `CatalogProvider`：

```typescript
const identity = resolveGatewayIdentity(request);
if (!identity) return reply.status(401).send({ error: '需要身份认证' });

const { catalog } = await catalogProvider.readCatalog(identity);
// ... 修改 catalog ...
await catalogProvider.writeCatalog(identity, catalog);
```

### 10.3 说明

当前场景不涉及不同用户同时写同一个本地文件，因此：

- 不引入 `version`
- 不引入 `expectedVersion`
- 不引入乐观并发控制

如果未来云端场景发生变化，再单独设计并发控制即可。

### 10.4 明确迁移路径

当前 `routes/agents.ts` 直接调用：

- `createRuntimeCat(projectRoot, input)`
- `updateRuntimeCat(projectRoot, agentId, patch)`
- `deleteRuntimeCat(projectRoot, agentId)`

而这些 helper 内部又直接读写本地文件。

为了避免路由层、helper 层、provider 层三处同时操作 catalog，本方案明确采用以下迁移路径：

1. **保留** `runtime-office-claw-catalog.ts` 作为“catalog 结构编辑 helper”所在位置
2. 将其中“直接读文件 / 直接写文件”的部分抽离或改造成基于 `CatalogProvider` 的实现
3. `routes/agents.ts` 继续调用这些 helper，但 helper 的底层数据源改为 `CatalogProvider`

换句话说，本次不推荐把完整 CRUD 逻辑全部上移到路由层；推荐做法是：

- 路由层继续负责参数校验、鉴权、HTTP 响应
- `runtime-office-claw-catalog.ts` 继续负责 catalog 结构修改
- `CatalogProvider` 负责最终读写来源

这样可以减少 `routes/agents.ts` 的改动面，并保持现有结构稳定。

### 10.5 `extend` 在 agent 管理链路中的落点

为了保证 `extend` 能真正进入和离开系统，本次实现还应同步补齐以下位置：

1. `packages/api/src/routes/agents.ts`
   - `createAgentSchema` 增加 `extend`
   - `updateAgentSchema` 增加 `extend`
   - `toAgentResponse()` 返回 `extend`

2. `packages/api/src/config/runtime-office-claw-catalog.ts`
   - `RuntimeAgentInput` 增加 `extend`
   - `RuntimeAgentUpdate` 增加 `extend`
   - `createBreedFromInput()` 将 `extend` 写入 variant
   - `updateRuntimeCat()` 支持更新 variant 上的 `extend`

这样才能保证：

- create 能写入
- update 能修改
- get 能回显
- invoke 时能读取并透传

## 11. 云端 Provider 的职责边界

当前明确约定：

1. 平台负责：
   - 统一传递 `GatewayIdentity`
   - 统一传递成员级 `extend`
   - 提供默认文件 provider
   - 负责本地 catalog 的读取、投影和运行时路由

2. 云端自定义 provider 负责：
   - 使用 `identity.userId` 区分用户
   - 解析 `extend`
   - 在 provider 实现内部完成账号和用户相关处理
   - 按需接入外部账号、租户、平台凭据或用户绑定逻辑

也就是说，云端场景下“账号和用户处理”的核心逻辑，放在新的 provider 中，而不是继续堆在平台默认实现里。

## 12. 约束条件与假设

| 约束 | 说明 |
|------|------|
| 成员粒度是 variant/member | `extend` 放在 `AgentVariant` 上，经 `toAllAgentConfigs()` 投影到 `OfficeClawConfigEntry` |
| 同一 `agentId` 的 AgentService 类型对所有用户一致 | 用户间差异由 `identity` 和 `extend` 体现，不通过切换 `AgentService` 类别实现 |
| 种子成员全局一致 | 基线种子 catalog 对所有用户一致；按用户定制由 provider 控制 |
| 平台不校验 `extend` 业务结构 | `extend` 被视为透明 JSON 对象 |
| 默认文件 provider 忽略 identity | 本地行为保持不变 |
| 当前不做乐观并发控制 | 因场景不涉及不同用户写同一文件 |

## 13. 公共契约分层结论

### 13.1 结论

本次开放的 `CatalogProvider` 是**平台公共契约**，因此与外部 provider 插件交互时依赖的公共调用选项，不能只停留在 `packages/api` 内部类型中。

结合当前代码结构，结论如下：

1. `CatalogProvider` 放在 `@openjiuwen/relay-api-server-contracts`
2. `AgentServiceOptions` 的**公共字段**应放在 `@openjiuwen/relay-core`
3. `packages/api/src/domains/agents/services/types.ts` 可以继续保留 API 内部扩展字段，但必须与 `@openjiuwen/relay-core` 的公共字段保持兼容
4. `@openjiuwen/relay-core` **直接依赖** `@openjiuwen/relay-api-server-contracts`

### 13.2 为什么不是只改 API 内部那套

当前外部 provider 包已经从 `@openjiuwen/relay-core` 引入 `AgentServiceOptions`，例如：

- `packages/provider-a2a`
- `packages/provider-echo`

这说明对插件/外部 provider 来说，真正可见的公共契约层是 `@openjiuwen/relay-core`，不是 `packages/api` 内部类型。

如果仅在 `packages/api/src/domains/agents/services/types.ts` 上增加：

- `gatewayIdentity`
- `memberExtend`

那么会出现：

- API 内部调用方能看到这些字段
- 外部 provider 通过 `@openjiuwen/relay-core` 却看不到这些字段

这会破坏“平台公共契约”的一致性。

### 13.3 因此本次文档明确要求

本次需要同步修改三层：

1. `packages/core/package.json`
   - 增加对 `@openjiuwen/relay-api-server-contracts` 的直接依赖

2. `packages/core/src/agent/types.ts`
   - 增加公共字段：
     - `gatewayIdentity?: GatewayIdentity`
     - `memberExtend?: Record<string, unknown>`
   - 其中 `gatewayIdentity` 的类型直接使用：
     - `@openjiuwen/relay-api-server-contracts/identity` 中的 `GatewayIdentity`

3. `packages/api/src/domains/agents/services/types.ts`
   - 保持与 `@openjiuwen/relay-core` 的公共字段对齐
   - API 内部特有字段继续保留，例如：
     - `callbackEnvOverrides`
     - `interactiveAsk`

### 13.4 推荐分层方式

建议按以下方式组织：

- `@openjiuwen/relay-api-server-contracts`
  - 放 `CatalogProvider`
  - 放 `GatewayIdentity`

- `@openjiuwen/relay-core`
  - 放插件/provider 可见的 `AgentServiceOptions` 公共字段
  - 直接依赖 `@openjiuwen/relay-api-server-contracts`
  - `AgentServiceOptions.gatewayIdentity` 直接引用 `@openjiuwen/relay-api-server-contracts/identity` 中的 `GatewayIdentity`

- `packages/api`
  - 在公共字段之上增加 API 内部扩展字段

### 13.5 本次文档采用的明确写法

因此，文档中提到的 `AgentServiceOptions` 扩展，**以 `@openjiuwen/relay-core` 为公共契约基线**，并要求 API 内部类型同步兼容。

## 14. 实施阶段

### Phase 1：接口定义 + 类型变更

- 新增 `@openjiuwen/relay-api-server-contracts/catalog`
- `packages/shared/src/types/agent-breed.ts`：`AgentVariant` 增加 `extend`
- `packages/shared/src/types/agent.ts`：`OfficeClawConfigEntry` 增加 `extend`
- `packages/api/src/config/office-claw-config-loader.ts`：Zod schema + `toAllAgentConfigs()` 投影补全
- `packages/api/src/routes/agents.ts`：create / update / get 支持 `extend`
- `packages/api/src/config/runtime-office-claw-catalog.ts`：`RuntimeAgentInput` / `RuntimeAgentUpdate` / helper 支持 `extend`
- `packages/core/package.json`：增加对 `@openjiuwen/relay-api-server-contracts` 的依赖
- `packages/core/src/agent/types.ts`：公共 `AgentServiceOptions` 增加 `gatewayIdentity` + `memberExtend`

### Phase 2：FileCatalogProvider + 注册表

- 新增 `packages/api/src/config/catalog-provider-registry.ts`
- 新增 `packages/api/src/config/catalog-file-provider.ts`
- `packages/api/src/config/runtime-office-claw-catalog.ts`：导出 `writeAndValidateCatalog()`
- 环境变量加载：`OFFICE_CLAW_CATALOG_PROVIDER`、`OFFICE_CLAW_CATALOG_PROVIDER_MODULES`

### Phase 3：消息链路 identity 透传

- `packages/api/src/utils/request-identity.ts`：新增 `resolveGatewayIdentity()`
- `packages/api/src/domains/agents/services/types.ts`：与 `@openjiuwen/relay-core` 公共字段对齐，并保留 API 内部扩展字段
- `packages/api/src/domains/agents/services/agents/routing/AgentRouter.ts`：
  - `resolveTargetsAndIntent()` 接收 identity
  - `routeExecution()` 接收 identity
  - 所有 candidate 生成、过滤、fallback 都受 identity 可见成员集合约束
- `packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts`：
  - 使用 `CatalogProvider.getMember(identity, agentId)`
  - 将 `gatewayIdentity` / `memberExtend` 传给 `service.invoke()`

### Phase 4：补齐所有入口

- `packages/api/src/routes/messages.ts`
- `packages/api/src/routes/callback-a2a-trigger.ts`
- `packages/api/src/routes/callback-multi-mention-routes.ts`
- `packages/api/src/domains/agents/services/agents/invocation/QueueProcessor.ts`
- `packages/api/src/infrastructure/email/ConnectorInvokeTrigger.ts`

统一把 `userId` 升级为 `GatewayIdentity` 透传。

### Phase 5：成员管理 API 适配

- `packages/api/src/routes/agents.ts`
- `packages/api/src/config/runtime-office-claw-catalog.ts`

将直接文件读写替换为 `CatalogProvider`。

## 15. 文件影响清单

| 文件 | 变更类型 |
|------|----------|
| `packages/plugin/api/src/catalog.ts` | 新增 |
| `packages/plugin/api/package.json` | 增加 `./catalog` 导出 |
| `packages/plugin/api/src/index.ts` | 重导出 catalog 类型 |
| `packages/shared/src/types/agent-breed.ts` | `AgentVariant` 增加 `extend` |
| `packages/shared/src/types/agent.ts` | `OfficeClawConfigEntry` 增加 `extend` |
| `packages/api/src/routes/agents.ts` | create / update / get 支持 `extend` |
| `packages/api/src/config/runtime-office-claw-catalog.ts` | 导出 `writeAndValidateCatalog()`，并让 `RuntimeAgentInput` / `RuntimeAgentUpdate` / helper 支持 `extend` |
| `packages/core/package.json` | 增加 `@openjiuwen/relay-api-server-contracts` 依赖 |
| `packages/core/src/agent/types.ts` | 公共 `AgentServiceOptions` 增加 `gatewayIdentity`、`memberExtend` |
| `packages/api/src/config/office-claw-config-loader.ts` | variant schema + 投影补全 |
| `packages/api/src/config/catalog-provider-registry.ts` | 新增 |
| `packages/api/src/config/catalog-file-provider.ts` | 新增 |
| `packages/api/src/utils/request-identity.ts` | 新增 `resolveGatewayIdentity()` |
| `packages/api/src/domains/agents/services/types.ts` | 与 core 公共字段对齐，保留 API 内部扩展字段 |
| `packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts` | identity 作用域成员查询 |
| `packages/api/src/domains/agents/services/agents/routing/AgentRouter.ts` | 接受 identity，且所有候选成员都受 identity 可见集合约束 |
| `packages/api/src/routes/agents.ts` | 切换到 CatalogProvider |
| `packages/api/src/routes/messages.ts` | 传递 `GatewayIdentity` |
| `packages/api/src/routes/callback-a2a-trigger.ts` | 传递 `GatewayIdentity` |
| `packages/api/src/routes/callback-multi-mention-routes.ts` | 传递 `GatewayIdentity` |
| `packages/api/src/domains/agents/services/agents/invocation/QueueProcessor.ts` | 传递 `GatewayIdentity` |
| `packages/api/src/infrastructure/email/ConnectorInvokeTrigger.ts` | 传递 `GatewayIdentity` |

## 16. 命名校对说明

本次文档已按当前工程现状统一以下命名：

- `cat` → `agent` / `member`
- `CatBreed` → `AgentBreed`
- `CatConfig` → `OfficeClawConfigEntry`
- `CatCafeConfig` → `OfficeClawConfig`
- `catRegistry` → `officeClawRegistry`
- `cat-config-loader.ts` → `office-claw-config-loader.ts`
- `runtime-cat-catalog.ts` → `runtime-office-claw-catalog.ts`
- `routes/cats.ts` → `routes/agents.ts`
- `domains/cats/services/...` → `domains/agents/services/...`

> **注意**：
> 1. `GatewayIdentity` 当前已存在于 `packages/plugin/api/src/identity.ts`
> 2. callback / queue / connector 等链路目前尚未真正传递独立 `GatewayIdentity`，这部分需要在实现阶段补齐
> 3. 因为 `CatalogProvider` 是平台公共契约，所以 `AgentServiceOptions` 的公共字段必须同步进入 `@openjiuwen/relay-core`
> 4. `@openjiuwen/relay-core` 直接依赖 `@openjiuwen/relay-api-server-contracts`，且 `AgentServiceOptions.gatewayIdentity` 直接使用 `@openjiuwen/relay-api-server-contracts/identity` 中的 `GatewayIdentity`
