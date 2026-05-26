---
feature_ids: []
related_features: [F004, F088, F136]
topics: [gateway, api, config, env, process-env, minimal-design]
doc_kind: design
created: 2026-05-11
---

# API as Gateway: Minimal Config Source Design

> Status: draft | Owner: TBD

## Background

### Original direction

团队最初的目标不是继续扩展现有 [`@openjiuwen/relay-api-server`](/D:/ai/officeclaw/relay-claw/packages/api/package.json:1)，而是抽取一个更轻、更可复用的 Office Gateway 形态，用于同时支持两类场景：

1. **本地版**
   当前 OfficeClaw 工程，保留多 agent 协作、本地 runtime、connector、session 等完整能力。
2. **云端版**
   面向多用户或外部系统接入，只保留 gateway 所需的身份提取、配置读写、消息转发与基础存储抽象。

在这个方向下，理想状态是把消息、线程、配置、connector、agent gateway 通信等能力拆成清晰的 contracts 和 adapters，使消费方可以像插件一样替换存储与下游实现。

### Current constraint

但当前代码现实并不是一个天然可抽取的轻量 gateway：

- `api` 已经承担了大量本地运行时职责
- 消息、配置、connector、session、memory、agent provider 等链路彼此有较强耦合
- 配置读取并不统一，存在 `process.env`、`.env`、JSON 文件、本地 secret store 等多种来源
- 很多运行逻辑默认假设配置已经存在于当前 Node 进程的 `process.env`

如果在这个阶段直接推进完整 gateway 抽取，改动将同时横跨：

- 路由边界
- 消息编排
- thread / message store
- provider profiles / model config profiles
- connector runtime
- secret persistence

这会让首次落地成本偏高，也会增加回归风险。

### Relationship to the full gateway plan

这份文档与完整 gateway 设计之间的关系如下：

| 设计层次 | 目标 | 当前文档是否覆盖 |
|----------|------|------------------|
| 完整 gateway 设计 | 抽取轻量 Office Gateway，分离 message/thread/config/store/agent adapter | 否 |
| 最小过渡方案 | 保留 `api`，先抽象全局运行时配置来源 | 是 |
| 本地兼容性 | 不破坏当前 `api` 和 Hub 使用方式 | 是 |
| 云端接入前置条件 | 让云端不必依赖本地 `.env` 文件 | 是 |

因此，本设计应被理解为：

- 一份**独立成立**的最小实施设计
- 一份为后续完整 gateway 演进铺路的过渡方案
- 一份刻意限制范围、优先降低改造风险的工程决策

## Why

这份文档聚焦一个比完整 gateway 更小、但可以独立落地的目标：

1. 保留现有 `api` 作为实际 gateway
2. 不改消息层、agent 层、thread 层
3. 仅把 `.env` 背后的读取与持久化机制替换成接口
4. 保持现有业务代码继续统一读取 `process.env`

这样可以先支持：

- 本地模式: 配置继续落盘到 `.env`
- 云端模式: 配置从其他配置源加载，并同步到 `process.env`

## Problem Statement

当前运行时配置存在以下现实：

1. 大量业务代码直接读取 `process.env`
2. `PATCH /api/config/env` 既修改 `process.env`，又把变更写回 `.env`
3. connector 敏感配置不总是明文写 `.env`，部分通过本地 secret store 持久化
4. 不是所有配置都在 `.env`

其中第 4 点尤其重要。当前工程至少存在以下几类配置存储：

| 配置类别 | 当前存储 | 说明 |
|----------|----------|------|
| 全局运行时 env | `.env` + `process.env` | 当前 Hub 可编辑的 env 配置 |
| connector secret | `.env` ref + local secret store | 敏感值通过 ref 间接存储 |
| model config profiles | `.office-claw/model.json` | 非 `.env` 配置链路 |
| provider profiles | `provider-profiles.json` 等 | 非 `.env` 配置链路 |

因此，本设计不是 "统一所有配置存储"，而是仅解决第一类问题：**全局运行时 env 配置来源可替换**。

## Goals

- 继续使用现有 `api` 作为 gateway
- 抽象全局运行时 env 配置的读写来源
- 保持现有代码读取 `process.env` 的方式不变
- 本地实现继续使用 `.env`
- 云端实现可以从远端配置中心读写
- 为 connector secret 留出独立接口，不把敏感值和普通 env 混在一起

## Non-Goals

- 不抽取独立 `@office-claw/gateway` npm 包
- 不实现 `IMessageStore` / `IThreadStore` / `IUserConfigStore`
- 不改消息发送、thread 管理、agent 编排
- 不把 `model-config-profiles`、`provider-profiles` 并入本次抽象
- 不解决多租户、按用户配置、按 tenant 配置
- 不解决多实例间的配置广播或自动一致性

## Design Summary

本设计只引入一个最小接口：`RuntimeEnvStore`。

设计原则只有一句：

**业务代码继续直接读 `process.env`，`RuntimeEnvStore` 只负责为 `process.env` 提供来源和持久化出口。**

**契约归属：`RuntimeEnvStore` 应定义在 `packages/plugin/api` 中，作为纯契约包导出；运行时由宿主自动发现外部实现，未发现时回退到本地 `LocalDotenvStore`。**

## Architecture

```text
                 startup
Config Source -----------------> RuntimeEnvBootstrap -----------------> process.env
   |                                                               |
   |                                                               v
   |                                                      Existing api code
   |
   |                 update
   +<---------------- /api/config/env <-------------------- Hub / caller
                         |
                         v
                  RuntimeEnvStore.save()
```

## Interface

### Contract Placement

`RuntimeEnvStore` 的**契约**必须放在 [`packages/plugin/api`](/D:/ai/officeclaw/relay-claw/packages/plugin/api/package.json:1) 中，作为纯接口包的一部分。

`packages/plugin/api` 在本设计中的职责仅限于：

- 导出 TypeScript interface / type
- 为本地 `api` 和云端二次开发提供统一 contract

`packages/plugin/api` 明确**不负责**：

- 提供本地 `.env`、远端 HTTP、数据库或文件系统实现
- 承担自动发现逻辑本身
- 自动注册、扫描、discover provider

因此，`packages/plugin/api` 仍然只是 contract 包；真正的自动发现逻辑放在 `packages/api` 宿主侧，而不是放在 contract 包里。

之所以不先把这份契约放在 `packages/api` 内部，是因为本设计虽然是“最小过渡方案”，但它的直接消费方从一开始就有两个：

1. 当前仓库里的 `api`
2. 云端二次开发服务

把契约放进 `plugin-api` 的目的，不是提前做运行时插件系统，而是让本地和云端在开发期共享同一份稳定 TypeScript contract，避免后续再做一次从 `api` 内部抽契约的迁移。

### Contract Definition

`RuntimeEnvStore` 负责全局 env 键值的读取与持久化。

```ts
export interface RuntimeEnvStore {
  load(): Promise<Record<string, string>>;
  save(updates: Record<string, string | null>): Promise<void>;
}
```

语义约定：

- `load()`
  - 返回当前配置源中的完整 env 键值集合
  - 仅返回字符串值
  - 不返回 `null`
- `save(updates)`
  - `string` 表示设置或覆盖
  - `null` 表示删除该键
  - 只负责把变更持久化到当前实现的配置源
  - 不负责鉴权、白名单校验、审计、reconcile、restart 或其他业务副作用
  - 不负责直接修改业务模块状态；调用方若需要同步 `process.env`，仍由宿主编排

### Implementation Split

在这个边界下，契约与实现的拆分如下：

| 层次 | 放置位置 | 职责 |
|------|----------|------|
| 契约层 | `packages/plugin/api` | 定义 `RuntimeEnvStore` interface |
| 本地实现层 | `packages/api` | 提供 `LocalDotenvStore`，兼容当前 `.env` 语义 |
| 云端实现层 | 云端项目 | 按接口实现 `RemoteEnvStore` 或其他 store |
| 宿主装配层 | `packages/api` | 自动发现外部实现，未发现时回退到本地实现 |

本地与云端都依赖同一个 contract，但具体实现可以独立演进；宿主负责在运行时解析最终使用哪个实现。

### Runtime Discovery

当前实现采用“自动发现优先，本地兜底”的运行时解析策略：

1. 如果宿主显式传入 `runtimeEnvStore`，优先使用该实例
2. 否则扫描 `node_modules` 与 monorepo `packages/` 下的外部实现包
3. 如果扫描到外部实现，则直接使用该实现
4. 如果未扫描到任何外部实现，则回退到本地 `LocalDotenvStore`

自动发现的最小约定如下：

- `package.json` 需要声明 `clowder.kind === "runtime-env-store"`
- 包需要能从主入口导出一个可用的 `RuntimeEnvStore`
- 支持两种导出形式：
  - 默认导出一个 `{ load, save }` 对象
  - 导出 `createRuntimeEnvStore()` 工厂函数，由宿主在启动时调用

这意味着云端接入时，只需要新增一个符合约定并已构建完成的实现包；API 重启后即可自动优先使用该实现，而不需要再修改 API 启动代码。

### Boundary With Existing Runtime Layers

本设计不是要替换现有所有配置机制，而是只补上一层“外部 env 来源抽象”。

和当前仓库已有机制的边界应明确为：

1. `RuntimeEnvStore`
   - 负责启动期把外部配置源加载进 `process.env`
   - 负责把 env 变更持久化回其配置源
2. `ConfigStore`
   - 继续作为少量已声明 key 的运行时 overlay / hot-update 层
   - 不接管全局 env 来源，不替代 `RuntimeEnvStore`
3. `connector-secret-updater`
   - 继续承担 connector 变更路径上的本地编排职责
   - 其底层文件/ref/secret 处理可逐步收敛为本地 `RuntimeEnvStore` 实现细节

优先级关系是：

- 启动时先 `RuntimeEnvStore.load() -> process.env`
  - 普通运行时 env 键：允许由 store 注入或覆盖
  - bootstrap-only 键（如 `REDIS_URL`、`API_SERVER_PORT`、`CAT_TEMPLATE_PATH`）：如果当前进程已显式提供值，则保留显式值，不再由 store 反向覆盖
- 运行时如命中 `ConfigStore` 管辖键，则 `ConfigStore` overlay 可以覆盖对应值
- connector 特殊变更仍由路由层和本地实现共同完成编排

因此，这不是两套并行配置系统，而是“来源层 + overlay 层 + 路由编排层”的分层关系。

## Implementations

### LocalDotenvStore

本地默认实现为 `LocalDotenvStore`，实现放在 `packages/api` 内部：

- `load()`: 读取项目根 `.env`
- `save()`: 按现有规则更新 `.env`
- 继续兼容当前 `PATCH /api/config/env` 的行为

该实现复用当前已有的 `.env` 更新语义：

- 删除键时从文件移除
- 增加或修改键时保持现有格式化逻辑
- connector 相关 key 如需走本地 ref / secret backend，仍由 `LocalDotenvStore` 在内部处理
- 对上层来说，`load()` 返回的仍然是最终写入 `process.env` 的明文键值

### RemoteEnvStore

云端实现不放在本仓库内，而是由云端服务基于 `@openjiuwen/relay-api-server-contracts` 自行实现。实现形式可以是：

- HTTP 配置中心
- 数据库
- 特定文件，如 `config.json`
- 其他内部配置来源

无论底层来源是什么，只需要满足两个约束：

1. 能返回字符串键值对
2. 允许启动时一次性加载到 `process.env`

若希望被当前 API 自动发现，还需额外满足运行时约定：

1. 包已出现在 `node_modules` 或 monorepo `packages/` 搜索路径中
2. `package.json` 声明 `clowder.kind === "runtime-env-store"`
3. 主入口默认导出 `RuntimeEnvStore`，或导出 `createRuntimeEnvStore()`

对于敏感值，本设计不要求单独抽接口。远端实现可以自行决定：

- 在存储层使用 KMS / Vault / secret manager
- 在 `load()` 时解出明文并返回
- 在 `save()` 时按自身安全模型重新加密或落库

对 `api` 运行时来说，最终仍只关心注入到 `process.env` 的明文值。

### Explicit Runtime Limitation

本设计默认只支持：

- 启动期一次性加载外部配置到 `process.env`
- 由明确 API 路由触发的少量显式更新

本设计**不提供**广义上的“云端配置中心自动生效”语义。具体来说，它不承诺：

- 远端配置变更后自动推送到所有运行实例
- 所有读取 `process.env` 的模块都能无感热更新
- 配置源与 `process.env` 的持续双向同步

如果后续需要 watch、broadcast、自动 reload、多实例一致性等能力，需要额外设计单独机制；那不属于本设计范围。

## Runtime Behavior

### Startup Flow

服务启动时，增加一个极早执行的 bootstrap 步骤：

1. 解析 `RuntimeEnvStore`
   - 优先使用显式传入实例
   - 否则自动发现外部实现
   - 否则回退到本地 `LocalDotenvStore`
2. 调用 `load()`
3. 按键类型把返回结果写入 `process.env`
   - 普通运行时键：逐项写入
   - bootstrap-only 键：仅在当前进程未显式设置时写入
4. 再继续现有 `api` 初始化流程

```text
resolve RuntimeEnvStore
        -> explicit instance ? use it
        -> else discovered external store ? use it
        -> else LocalDotenvStore
          ->
RuntimeEnvStore.load()
          ->
for each (k, v):
  bootstrap-only && process.env[k] already set ? keep existing : write process.env[k] = v
        ->
start existing api initialization
```

这样做的原因是：

- 现有代码大量直接读 `process.env`
- 如果不在启动早期完成注入，后续模块会在错误或空配置下初始化

### Update Flow

保留现有 `PATCH /api/config/env` 路由，但调整内部职责：

1. 路由层先做鉴权、请求体校验、白名单检查和审计上下文准备
2. 路由层更新 `process.env`
3. 路由层调用 `RuntimeEnvStore.save()`
4. 路由层继续执行现有 connector reconcile 流程

如果某些键在本地模式下仍需使用 ref / local secret store，这属于 `LocalDotenvStore.save()` 的内部实现细节；但白名单、审计和 reconcile 仍保留在 API 路由编排层，而不是下沉进 `RuntimeEnvStore`。

## Current Code Mapping

本设计第一阶段只改以下链路：

| 模块 | 当前职责 | 最小改法 |
|------|----------|----------|
| [`routes/config.ts`](/D:/ai/officeclaw/relay-claw/packages/api/src/routes/config.ts:344) | 校验 env patch + 直接写 `.env` + 写 `process.env` | 把文件写入替换为 `RuntimeEnvStore.save()` |
| [`config/connector-secret-updater.ts`](/D:/ai/officeclaw/relay-claw/packages/api/src/config/connector-secret-updater.ts:82) | connector secret 更新 + 直接写 `.env` | 收敛到 `RuntimeEnvStore` 内部实现细节 |
| 启动入口 | 直接依赖启动前 env 已准备好 | 增加 `RuntimeEnvBootstrap` |
| [`config/ConfigStore.ts`](/D:/ai/officeclaw/relay-claw/packages/api/src/config/ConfigStore.ts:70) | overlay + `process.env` | 保持不变 |

## Scope Boundary

第一阶段仅覆盖适合 env 化的全局配置，例如：

- 服务监听 host / port
- Redis URL
- feature flags
- connector 非敏感配置
- 外部服务基础 URL
- CLI / runtime 策略参数

第一阶段不覆盖：

- `model-config-profiles`
- `provider-profiles`
- 用户级 model / MCP / skill 配置
- thread / message / session 数据

## Risks

### 1. Direct `process.env` coupling remains

本方案有意保留现有 `process.env` 读取模式，因此不会自动获得更强的解耦性。

影响：

- 某些模块仍然是进程级全局配置
- 未来做用户级配置时不能直接复用这套方案

### 2. Multi-instance consistency is out of scope

如果部署多个 `api` 实例：

- 每个实例都需要在启动时各自执行 `load()`
- 一个实例通过 API 改了远端配置，其他实例不会自动刷新

这不是本设计要解决的问题，后续如有需要，需引入事件广播或定时 reload。

### 3. Some configs are startup-only

即使运行时更新了 `process.env`，也不代表配置一定生效。

原因：

- 某些模块只在启动时读取一次配置
- 某些模块需要显式 reconcile 或 restart

因此本设计只保证：

- 配置源可更新
- `process.env` 被同步

不保证所有下游模块都天然热更新。

另外，对于 startup-only / bootstrap-only 键，还需要额外遵守一条启动优先级规则：

- `RuntimeEnvStore.load()` 可以提供默认值
- 但如果宿主进程在启动时已经显式注入该键，则该显式值优先

这条规则的目的，是避免本地 `.env` 或远端配置源反向覆盖部署层、启动脚本、wrapper 或外部运行环境已明确指定的关键启动参数。

### 4. Secret persistence remains implementation-specific

本设计不再单独抽 `SecretStore`，但不代表 secret 问题消失了。

需要明确：

- 本地实现仍可能继续使用 `*_REF` + local secret backend
- 远端实现也可能在存储层使用加密或 secret manager
- 这些都属于 `RuntimeEnvStore` 的实现细节

因此，本设计统一的是**运行时读取面**，不是**secret 持久化方式**。

## Implementation Plan

### Phase 1: Define interfaces

- 在 `packages/plugin/api` 中新增 `RuntimeEnvStore` 契约
- 新增本地实现 `LocalDotenvStore`

### Phase 2: Bootstrap env loading

- 在 `api` 启动早期增加 `RuntimeEnvBootstrap`
- 启动时执行 `load() -> process.env`

### Phase 3: Replace direct `.env` writes

- 改造 [`routes/config.ts`](/D:/ai/officeclaw/relay-claw/packages/api/src/routes/config.ts:344)
- 改造 [`connector-secret-updater.ts`](/D:/ai/officeclaw/relay-claw/packages/api/src/config/connector-secret-updater.ts:82)
- 保持 API 路由和返回结构不变

### Phase 4: Add remote implementation

- 增加 `RemoteEnvStore`
- 云端实现通过 `@openjiuwen/relay-api-server-contracts` 的契约对接，并满足 `clowder.kind === "runtime-env-store"` 的自动发现约定
- 运行时优先使用自动发现到的外部实现；未发现时回退到本地实现

## Acceptance Criteria

- [ ] AC-1: `api` 启动时可从 `RuntimeEnvStore.load()` 完成 `process.env` 初始化
- [ ] AC-2: 本地模式下行为与当前 `.env` 方案保持兼容
- [ ] AC-3: `PATCH /api/config/env` 不再直接依赖 `.env` 文件写入逻辑
- [ ] AC-4: 本地模式下 connector 相关 secret 行为与现状保持兼容
- [ ] AC-5: 现有读取 `process.env` 的业务代码无需大规模改造
- [ ] AC-6: 远端实现可以在不修改主要业务层的前提下接入

## Open Questions

1. `RuntimeEnvStore.load()` 是否允许只返回白名单 key，还是返回完整配置集？
2. 云端 remote store 的更新是否需要版本号或 CAS 以避免并发覆盖？
3. 是否需要在后续 Phase 为多实例添加配置变更广播？
4. `model-config-profiles` 和 `provider-profiles` 是否要进入下一阶段抽象范围？

## Decision

本阶段采用以下最小方案：

- 保留现有 `api` 作为 gateway
- 保留 `process.env` 作为运行时配置读取面
- 抽象 `.env` 背后的配置来源为 `RuntimeEnvStore`
- 本地继续用 `.env`，必要时在 `RuntimeEnvStore` 实现内部兼容 local secret store
- 云端通过远端实现注入配置到 `process.env`

这是一个**过渡性、低侵入、可落地**的设计，不等同于最终的完整 gateway 解耦方案。
