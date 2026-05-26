---
feature_ids: [F146]
related_features: [F008, F024, F051]
topics: [token, usage, session, observability, stats]
doc_kind: spec
created: 2026-05-19
status: spec
---

# F146 — Session Total Usage Accumulation

> **Status**: spec | **Owner**: Codex

## Why

当前工程里的 session 用量统计以 `lastUsage` 为基础。`lastUsage` 的语义是“最近一次 usage 快照”，不是“该 session 的累计 usage”。

这会在长链路任务里造成明显误导，尤其是大 PPT、长报告、复杂代码生成等场景：

- 一个 session 内往往会发生多次模型调用
- 前面的大调用会产生成千上万的 `inputTokens` / `outputTokens`
- 最后常常还有一次很小的收尾调用，例如“完成提示”“写 marker”“小范围修订”
- 当前实现会用最后一次小调用覆盖之前的大调用
- 最终用户在“用量统计”里看到的是一个很小的数字，而不是整个 session 的累计消耗

对用户而言，“用量统计”应当回答的问题是：

- 这个 session 一共消耗了多少 Input Tokens
- 这个 session 一共消耗了多少 Output Tokens
- 近 1 天 / 3 天 / 7 天 / 30 天各自消耗了多少

因此，session 层需要从“最新账单”升级为“累计账本”。

## What

本方案引入 session 级累计 usage 结构，并将用户可见统计从 `lastUsage` 切换到 `totalUsage` / `usageByDay`：

- 保留 `lastUsage`
  用于调试、兼容和“最近一次调用”的运维语义
- 新增 `totalUsage`
  表示该 session 生命周期内累计的 token 消耗
- 新增 `usageByDay`
  表示该 session 按天累计的 token 消耗，用于支撑“今日 / 近 3 日 / 近 7 日 / 近 30 日”这类范围统计

### 范围

本方案覆盖：

- session 共享类型
- SessionChainStore 内存实现
- RedisSessionChainStore 持久化实现
- `invoke-single-agent` 的 session usage 写入逻辑
- `GET /api/threads/:threadId/sessions`
- `GET /api/threads/:threadId/usage`
- 前端“用量统计”弹窗的数据构建逻辑
- 相关测试

当前实际启用的 provider 都按 `jiuwenclaw` 的 usage 口径处理：

- 只认 `done.metadata.usage` 作为该 attempt 的最终 usage
- 当前不为其他 provider 设计单独的 usage 适配分支
- 后续若重新启用其他 provider，再按各自事件语义补适配

## Current State

### 当前数据结构

共享类型定义位于：

- [packages/shared/src/types/session.ts](D:/ai/officeclaw/relay-claw/packages/shared/src/types/session.ts:21)

当前 `SessionRecord` 与 usage 相关的字段只有：

- `lastUsage?: SessionUsageSnapshot`
- `updatedAt: number`

当前 `SessionUsageSnapshot` 字段包括：

- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `costUsd`

### 当前写入逻辑

session usage 的持久化逻辑位于：

- [packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts:1219)

当前行为：

- 从当前 invocation 的 `msg.metadata.usage` 取出 `inputTokens` / `outputTokens` / `cacheReadTokens` / `costUsd`
- 直接覆盖写入 `SessionRecord.lastUsage`

这意味着：

- 同一 session 内前一次 usage 不会保留
- 后一次 usage 会把前一次 usage 覆盖掉
- usage 持久化当前仍然挂在 `contextHealth` 可计算分支里
- 若某次调用只有 `outputTokens` / `costUsd` 等 usage，但算不出 `windowSize` 或 `usedTokens`，该次真实消耗可能完全不入账

### 当前前端统计逻辑

“用量统计”弹窗数据构建位于：

- [packages/web/src/services/usageStats.ts](D:/ai/officeclaw/relay-claw/packages/web/src/services/usageStats.ts:138)
- [packages/web/src/services/usageStats.ts](D:/ai/officeclaw/relay-claw/packages/web/src/services/usageStats.ts:179)

当前行为：

- 读取 `/api/threads/:threadId/sessions`
- 在时间范围内筛选 session
- 对每个 session 读取 `lastUsage.inputTokens`
- 对每个 session 读取 `lastUsage.outputTokens`
- 将 session 级值相加，得到线程级显示值

### 当前 thread usage 路由逻辑

位于：

- [packages/api/src/routes/session-chain.ts](D:/ai/officeclaw/relay-claw/packages/api/src/routes/session-chain.ts:42)

当前行为：

- 聚合每个 session 的 `lastUsage`
- 输出 thread 级 `inputTokens` / `outputTokens` / `cacheReadTokens` / `costUsd`

## Design Goals

### G1. 用户可见统计必须反映累计 usage

`Input Tokens消耗` 和 `Output Tokens消耗` 应表示累计值，而非最后一笔。

### G2. 保留 `lastUsage` 的调试语义

一些调试/运维面板仍然可能需要“最近一次调用用了多少 token”，因此不删除 `lastUsage`。

### G3. 不破坏范围统计

“今日 / 近 3 日 / 近 7 日 / 近 30 日”必须继续成立，不能因为引入 `totalUsage` 而把一个跨多天的 session 总量全部算进今天。

### G4. 对历史数据兼容

历史 session 只有 `lastUsage`。新方案上线后不能让旧 session 在 UI 上全部变成空值。

### G5. 降低重复累计风险

同一次 attempt 的 usage 只能累计一次，不能因流式事件或重复 done 造成双记。

## Non-Goals

以下不在本方案范围内：

- 统一所有 provider 的 usage 采集来源
- 修复 Codex provider 可能优先保留 `turn.completed` 而非 session total 的问题
- 改造 invocation 级 `usageByCat`
- 改造 AOM reporter 的聚合模型

说明：

- 本方案不会重写各 provider 如何采集 usage
- Phase 1 统一按当前实际启用 provider 的 `done.metadata.usage` 口径累计；未来再按具体 provider 补适配

## Data Model Changes

### 1. `SessionRecord`

修改：

- [packages/shared/src/types/session.ts](D:/ai/officeclaw/relay-claw/packages/shared/src/types/session.ts:21)

新增字段：

```ts
export interface SessionRecord {
  readonly id: string;
  cliSessionId: string;
  readonly threadId: string;
  readonly agentId: AgentId;
  readonly userId: string;
  readonly seq: number;
  status: SessionStatus;
  contextHealth?: ContextHealth;
  lastUsage?: SessionUsageSnapshot;
  lastUsageAt?: number;
  totalUsage?: SessionUsageSnapshot;
  usageByDay?: Record<string, SessionUsageSnapshot>;
  messageCount: number;
  sealReason?: 'threshold' | 'manual' | 'error' | (string & {});
  compressionCount?: number;
  consecutiveRestoreFailures?: number;
  readonly createdAt: number;
  updatedAt: number;
  sealedAt?: number;
}
```

### 2. 字段语义

- `lastUsage`
  最近一次 usage 快照。仅代表最近一笔，不代表累计值。
- `lastUsageAt`
  最近一次最终落账 usage 的时间戳。仅在 session usage 真正入账时更新，不复用 `updatedAt`。
- `totalUsage`
  该 session 生命周期内累计 usage。
- `usageByDay`
  该 session 按天累计的 usage，key 为 `YYYY-MM-DD`。
`usageByDay` 的 key 统一按共享时区常量 `Asia/Shanghai` 解释。

补充约束：

- `updatedAt` 继续保留为通用记录更新时间，可被 seal、bind、compression 等非 usage 事件更新
- 因此 `updatedAt` 不再承担 usage 发生时间或 usage 展示时间语义

### 3. `SessionUsageSnapshot`

保持现有结构不变：

```ts
export interface SessionUsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
}
```

不在 session 级快照中引入：

- `totalTokens`
- `durationMs`
- `numTurns`
- `contextWindowSize`

理由：

- 这些字段在现有 session UI 统计里不是主口径
- 可累计性和语义不完全统一
- 本方案优先做最小而明确的累计口径落地

## API Contract Changes

### 1. SessionChainStore patch contract

修改：

- `@openjiuwen/relay-api-server-contracts/storage` 中的 `SessionRecordPatch` canonical contract
- API 侧 re-export 入口 [packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts:20)

为 `SessionRecordPatch` 增加：

- `lastUsageAt`
- `totalUsage`
- `usageByDay`

目标形态：

```ts
export type SessionRecordPatch = Partial<
  Pick<
    SessionRecord,
    | 'cliSessionId'
    | 'status'
    | 'contextHealth'
    | 'lastUsage'
    | 'lastUsageAt'
    | 'totalUsage'
    | 'usageByDay'
    | 'messageCount'
    | 'sealReason'
    | 'sealedAt'
    | 'updatedAt'
    | 'compressionCount'
    | 'consecutiveRestoreFailures'
  >
>;
```

### 2. `/api/threads/:threadId/sessions`

响应结构保持向后兼容，但 session 项中新增：

- `lastUsageAt`
- `totalUsage`
- `usageByDay`

前端新逻辑可直接使用；旧前端仍可继续读取 `lastUsage`。

### 3. `/api/threads/:threadId/usage`

路由语义从“按 session.lastUsage 聚合”调整为：

- 优先使用 `session.totalUsage`
- fallback 到历史数据 `session.lastUsage`

### 4. 当前 provider usage 语义

当前实际启用的 provider 都按 `jiuwenclaw` 口径处理：provider 层将“本次 attempt 最后收敛到的 usage 快照”挂到 `done.metadata.usage`。

Phase 1 只需要遵守这一条规则：

- 只在 `msg.type === 'done' && msg.metadata?.usage` 时累计 session usage
- 中途 frame 的 `metadata.usage` 仅用于 provider 内部收敛，不直接写 session 累计账
- 不引入 `delta` / `session_total` 的通用语义分支

## Write Path Design

### 0. 顺序与并发假设

- session usage 的累计写入发生在现有的单 active invocation / attempt 串行路径中
- 同一个 `(threadId, agentId)` 不支持多个并发写入者同时更新同一个 active session
- `didPersistSessionUsageForThisAttempt` 只解决同一 attempt 的重复 `done` 落账，不负责跨 attempt 并发互斥
- Phase 1 不新增 CAS 或 Lua 自增协议；如果出现真正的并发写入，那是上层串行化失效，需要单独修复
- usage 持久化与 `contextHealth` 持久化必须解耦；两者最多共享一次 `getActive()`，不能共享同一个 gating 条件

### 1. 新增 usage merge helper

建议新增：

- `packages/api/src/domains/agents/services/session/session-usage.ts`

提供三个 API 侧纯函数：

```ts
export function toSessionUsageSnapshot(usage: TokenUsage): SessionUsageSnapshot;
export function mergeSessionUsage(
  base: SessionUsageSnapshot | undefined,
  delta: SessionUsageSnapshot | undefined,
): SessionUsageSnapshot | undefined;
export function mergeUsageByDay(
  base: Record<string, SessionUsageSnapshot> | undefined,
  day: string,
  delta: SessionUsageSnapshot | undefined,
): Record<string, SessionUsageSnapshot> | undefined;
```

说明：

- `SESSION_USAGE_TIMEZONE`
- `toDateBucketAtTimezone()`

不放在 API helper 内部实现，统一由 `packages/shared` 导出，作为前后端唯一来源。

### 2. `toSessionUsageSnapshot` 规则

输入：

- provider 归一化后的 `TokenUsage`

输出：

- 仅保留以下字段：
  - `inputTokens`
  - `outputTokens`
  - `cacheReadTokens`
  - `costUsd`

忽略：

- `totalTokens`
- `cacheCreationTokens`
- `durationMs`
- `durationApiMs`
- `numTurns`
- `contextWindowSize`
- `lastTurnInputTokens`
- `contextUsedTokens`
- `contextResetsAtMs`

### 3. `mergeSessionUsage` 规则

字段级别加法累加：

- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `costUsd`

处理规则：

- `undefined` 按 0 处理
- 如果 base 和 delta 都为空，返回 `undefined`
- `costUsd` 允许保留浮点，最终输出统一 round 到 6 位小数

示例：

```ts
mergeSessionUsage(
  { inputTokens: 1000, outputTokens: 200 },
  { inputTokens: 300, outputTokens: 50 },
)
// => { inputTokens: 1300, outputTokens: 250 }
```

### 4. 当前写入口径

写路径不做差分，不做累计值归一化，只做一次最终落账：

- `done.metadata.usage` 作为 provider 层最终收敛出的 usage 快照
- 该快照写入 `lastUsage`
- 该快照按一次 attempt 直接 merge 到 `totalUsage`
- 该快照按 `done.timestamp` 落入 `usageByDay`

### 5. `mergeUsageByDay` 规则

`day` 使用共享统计时区常量 `Asia/Shanghai` 对应的本地日期桶，格式为 `YYYY-MM-DD`。

日桶归属时间戳规则必须固定为：

- Phase 1 按“本次 attempt 的最终 usage 结算时刻”归属日桶
- 该时间戳应来自 `done.timestamp`；若事件本身没有时间戳，则 fallback 到 `Date.now()`
- Phase 1 不尝试把一次 attempt 的 usage 再拆分到多个自然日
- 因此，跨午夜长任务会整体记到“最终 usage 结算发生的那个本地日”

说明：

- 这是 Phase 1 在无逐段 usage 明细前提下的最小、可复现口径
- 该口径优先保证“前后端可一致复算”，不承诺精确还原长任务在午夜前后的真实分布

这里必须明确：

- `usageByDay` 的 key 一律使用共享时区常量 `Asia/Shanghai` 日桶
- 前端范围统计必须使用同一共享时区常量复算 bucket
- Phase 1 不允许把“服务端进程本地时区”当成统计分桶口径

原因：

- 若只存日桶而不存更细粒度事件，就必须把用于分桶的时区一起固定
- 使用共享时区常量后，前后端可以稳定复现同一“本地日”口径

说明：

- 这里约束的是“统计分桶时区”，不是“所有用户可见时间都必须显示为上海时区”
- 前端展示时间可以继续使用用户本地时区；只要不要把展示时间直接当成 range bucket 边界即可

行为：

- 若 `base` 不存在，则创建新 map
- 若 `base[day]` 不存在，则直接写入本次 attempt 的 usage snapshot
- 若 `base[day]` 已存在，则对 `base[day]` 与本次 attempt 的 usage snapshot 做 `mergeSessionUsage`

### 6. attempt 内单次累计保护

在：

- [packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts:1219)

引入 attempt 级布尔保护：

- `didPersistSessionUsageForThisAttempt`

规则：

- 初始值为 `false`
- 只有在本次 attempt 的 `done` 消息上，才允许执行 usage 落账并置位
- 对当前实际启用的 provider，`done.metadata.usage` 就是该 attempt 唯一允许入账的最终 usage 快照
- 中途 usage 相关事件可以继续用于 provider 内部调试或收敛，但不能写入 `totalUsage` / `usageByDay`
- 落账完成后置为 `true`
- 同一 attempt 后续重复 `done` 或重复 usage 事件，`lastUsage` / `lastUsageAt` / `totalUsage` / `usageByDay` 都不得再次写入
- 若外层 invocation 发生 retry，则新的 attempt 必须重新创建自己的布尔位，不能沿用前一次 attempt 的状态
- `lastUsage` 仍直接取自 `done.metadata.usage`，但与累计字段共用同一幂等保护

实现约束：

- 对当前实际启用的 provider，terminal usage event 就是 `done`
- 不需要在 attempt 中途提前落账
- 不需要缓存多次 usage 再比较谁更完整

这样可以避免：

- 流式生命周期重复触发
- 同一个 attempt 内同一 usage 被双记
- 同一个 attempt 的重复 `done` 把“最近一次最终落账”时间再次覆盖
- 同一个 attempt 先收到部分 usage、后收到完整 usage 时被部分值截断

### 7. retry / failed attempt 记账规则

必须显式规定：

- session total usage 统计的是“真实资源消耗”，不是“最终成功结果的 usage”
- 只要某个 attempt 收到了 `done.metadata.usage`，该 attempt 就应计入 `totalUsage`
- retry 产生的新 attempt 若也收到了 `done.metadata.usage`，应继续追加累计
- failed attempt 若没有 `done.metadata.usage`，则该 attempt 计 0

换句话说：

- success + retry success：两次 attempt 的 usage 都算
- failed + retry success：只有 failed attempt 也产出了 `done.metadata.usage` 时才两次都算；否则只算 retry success
- 单纯因为业务结果失败，不应抹掉已经发生的 token 消耗

### 8. 写入流程

当前写入逻辑：

- 更新 `contextHealth`
- 覆盖写入 `lastUsage`

调整后：

1. provider 层将最终 usage 收敛到 `done.metadata.usage`
2. 查询 `activeRecord`
3. 独立判断是否可计算 `contextHealth`
4. 仅在 `done` 且带 `metadata.usage` 时累计
5. 使用 `done.timestamp` 计算日桶
6. 构造 patch

```ts
const incomingUsage = done.metadata?.usage ? toSessionUsageSnapshot(done.metadata.usage) : undefined;
const patch: SessionRecordPatch = { updatedAt: Date.now() };

if (incomingUsage) {
  const bucketTimestamp = done.timestamp ?? Date.now();
  const day = toDateBucketAtTimezone(bucketTimestamp, SESSION_USAGE_TIMEZONE);
  const seededLegacyUsage = activeRecord.totalUsage ?? activeRecord.lastUsage;
  const legacySeedTimestamp = activeRecord.lastUsageAt ?? activeRecord.updatedAt;
  const seededLegacyByDay =
    activeRecord.usageByDay ??
    (seededLegacyUsage && legacySeedTimestamp != null
      ? { [toDateBucketAtTimezone(legacySeedTimestamp, SESSION_USAGE_TIMEZONE)]: seededLegacyUsage }
      : undefined);

  patch.lastUsage = incomingUsage;
  patch.lastUsageAt = bucketTimestamp;
  patch.totalUsage = mergeSessionUsage(seededLegacyUsage, incomingUsage);
  patch.usageByDay = mergeUsageByDay(seededLegacyByDay, day, incomingUsage);
}

if (health) {
  patch.contextHealth = health;
}

await deps.sessionChainStore.update(activeRecord.id, patch);
```

约束：

- 只要某个 attempt 在 `done` 上拿到了 `incomingUsage`，usage 持久化就必须尝试执行；不能要求 `contextHealth` 先可计算
- `contextHealth` 是否存在，不影响 `lastUsage` / `totalUsage` / `usageByDay` 的写入资格
- `lastUsage` 记录最近一次最终落账的 provider usage 快照
- `lastUsageAt` 记录最近一次最终落账 usage 的时间戳；不能复用 `updatedAt`
- `totalUsage` 和 `usageByDay` 只能基于 `done.metadata.usage` 累加
- 若 `incomingUsage` 为空，则允许只更新 `contextHealth`，不更新累计字段
- `totalUsage` 与 `usageByDay` 的 legacy seed 必须来自同一份 `seededLegacyUsage`，不能只 seed 前者不 seed 后者
- 若历史 session 缺失 `lastUsageAt`，允许仅为 legacy seed 使用 `updatedAt` 推导一个近似日桶；该近似时间只用于兼容历史范围统计，不得回写到 `lastUsageAt`
- `usageByDay` 的归属时间戳固定使用 `done.timestamp`，不能混用 `updatedAt` 或服务端本地当前时间

### 7. 为什么保留 `lastUsage`

保留原因：

- 调试时需要知道“最近一次调用”的 usage
- 旧 UI / 旧测试可继续兼容
- 某些 context health 逻辑仍天然依赖“最近一次”语义

## Read Path Design

### 0. 共享统计时区常量与 helper 的唯一来源

为避免前后端各自硬编码 `Asia/Shanghai`，统计分桶必须提供单一来源：

- 在 `packages/shared` 中新增 `SESSION_USAGE_TIMEZONE = 'Asia/Shanghai'`
- 在 `packages/shared` 中新增或导出 `toDateBucketAtTimezone()`

目标不是抽象出复杂时间框架，而是避免：

- 服务端分桶用 `Asia/Shanghai`
- 前端范围统计也用 `Asia/Shanghai`
- 但前端按浏览器默认时区去重算 range，导致 bucket 错位

Phase 1 的强约束：

- `usageByDay` 分桶
- range 统计

必须全部基于同一个 `SESSION_USAGE_TIMEZONE`。

前端显示时间规则：

- `occurredAt` 不要求强制使用 `SESSION_USAGE_TIMEZONE`
- `occurredAt` 可以继续按用户本地时区格式化
- 但 `occurredAt` 的来源应优先使用 `lastUsageAt`，而不是 `updatedAt`

### 1. Thread usage route

修改：

- [packages/api/src/routes/session-chain.ts](D:/ai/officeclaw/relay-claw/packages/api/src/routes/session-chain.ts:42)

当前：

- 聚合 `session.lastUsage`

调整后：

- 优先聚合 `session.totalUsage`
- fallback 聚合 `session.lastUsage`

聚合逻辑建议改为：

```ts
const usage = s.totalUsage ?? s.lastUsage;
if (!usage) continue;
```

其余汇总逻辑保持不变：

- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `costUsd`
- `sessions`

### 2. Frontend usage stats dataset

当前前端类型位于：

- [packages/web/src/services/usageStats.ts](D:/ai/officeclaw/relay-claw/packages/web/src/services/usageStats.ts:15)

需要将 `SessionSummary.lastUsage` 扩展为：

- `lastUsage`
- `totalUsage`
- `usageByDay`

建议结构：

```ts
interface SessionSummary {
  id: string;
  updatedAt?: number;
  lastUsage?: UsageSnapshot;
  lastUsageAt?: number;
  totalUsage?: UsageSnapshot;
  usageByDay?: Record<string, UsageSnapshot>;
}
```

### 3. Frontend range 统计规则

现有 `buildUsageStatsPageFromDataset()` 按 session 的 `updatedAt` 过滤后，再从 `lastUsage` 取值。

新规则：

- 如果 `session.usageByDay` 存在，则按 range 累加 bucket
- 如果 `session.usageByDay` 不存在，则走 legacy fallback
- 每个 thread 还需要计算 `latestUsageTimestampInRange`
  - 用于列表排序
  - 用于 `occurredAt` 展示
  - 不再使用 `session.updatedAt` 作为 usage 排序依据

#### today

- 读取当前 `Asia/Shanghai` 日桶 `usageByDay[toDateBucketAtTimezone(now, SESSION_USAGE_TIMEZONE)]`

#### 3d / 7d / 30d

- 遍历最近 N 个 `Asia/Shanghai` 日期 key
- 将命中的 bucket 累加

### 4. Legacy fallback

对历史 session：

- 若无 `usageByDay`
- 但有 `totalUsage` 或 `lastUsage`
  则必须构造一个“近似单日桶”

近似单日桶规则：

- 选择 `legacyUsage = totalUsage ?? lastUsage`
- 优先选择 `legacyUsageAt = lastUsageAt`
- 若 `lastUsageAt` 缺失，则选择 `legacyUsageAt = updatedAt` 作为历史兼容近似时间
- 选择 `legacyDay = toDateBucketAtTimezone(legacyUsageAt, SESSION_USAGE_TIMEZONE)`
- 将该 usage 视为全部发生在 `legacyDay`
- 然后再按新口径参与 range 统计

这条规则只用于历史兼容，不代表真实历史分布。

推荐 fallback 顺序：

1. `usageByDay`
2. `synthetic usageByDay from totalUsage ?? lastUsage`

说明：

- `usageByDay` 是新口径真值
- synthetic bucket 是历史兼容近似值
- 不允许在 bounded range 中直接把 `totalUsage` 整体计入而不落到某个明确的日桶
- 一旦 session 在后续真实写入中完成了 legacy seed，前端仍然只读取 `usageByDay` 即可；不需要把 `usageByDay` 与 `totalUsage` 再重复相加

### 5. 时间范围与 session.updatedAt / session.lastUsageAt

在新口径下，range 不应再用 `session.updatedAt` 决定是否计入整条 session。

正确做法：

- 由 `usageByDay` 决定当前 range 是否有贡献
- `latestUsageTimestampInRange` 才是 usage 列表排序和展示时间的唯一来源
- `session.updatedAt` 仅保留给通用记录更新时间，不参与 usage 排序

唯一例外：

- legacy fallback 在缺失 `lastUsageAt` 时，可以近似使用 `session.updatedAt`
- 但这只用于把旧数据投影到某一个明确的本地日桶
- 不允许把“updatedAt 在窗口内”直接等价为“整条 totalUsage 都在窗口内”

换句话说：

- “会不会被计入统计”看 `usageByDay`
- “usage 展示时间显示哪个时间”看 `latestUsageTimestampInRange`
- “列表排序用哪个时间”也看 `latestUsageTimestampInRange`

### 6. Frontend 显示时间规则

`UsageStatsItem.occurredAt` 的语义需要明确为：

- 显示该线程在当前 range 内命中的最新 usage 时间，即 `latestUsageTimestampInRange`
- 若该命中来自 legacy fallback，则允许该时间等于 `lastUsageAt ?? updatedAt`
- 仅用于列表展示，不参与 range bucket 判定
- 默认按用户本地时区格式化即可

因此，前端可以继续使用本地时区格式化，例如：

```ts
new Date(timestamp).toLocaleString()
```

## Storage Changes

### 1. In-memory store

修改：

- [packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts:120)

需要支持：

- `record.lastUsageAt = patch.lastUsageAt`
- `record.totalUsage = patch.totalUsage`
- `record.usageByDay = patch.usageByDay`

### 2. Redis store write path

修改：

- [packages/api/src/domains/agents/services/stores/redis/RedisSessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/redis/RedisSessionChainStore.ts:180)

新增字段：

- `lastUsageAt`
- `totalUsage`
- `usageByDay`

`update()` 中新增：

```ts
if (patch.lastUsageAt !== undefined) {
  pairs.push('lastUsageAt', String(patch.lastUsageAt));
}
if (patch.totalUsage !== undefined) {
  pairs.push('totalUsage', JSON.stringify(patch.totalUsage));
}
if (patch.usageByDay !== undefined) {
  pairs.push('usageByDay', JSON.stringify(patch.usageByDay));
}
```

### 3. Redis store read path

同文件 hydrate 阶段新增：

```ts
const lastUsageAt = data.lastUsageAt ? parseInt(data.lastUsageAt, 10) : undefined;
const totalUsage = safeParseJson<SessionUsageSnapshot>(data.totalUsage);
const usageByDay = safeParseJson<Record<string, SessionUsageSnapshot>>(data.usageByDay);
```

返回对象新增：

```ts
...(lastUsageAt !== undefined ? { lastUsageAt } : {}),
...(totalUsage ? { totalUsage } : {}),
...(usageByDay ? { usageByDay } : {}),
```

## Migration Strategy

### 1. 原则

不做离线全量回填脚本，采用懒迁移。

原因：

- 历史 session 只有 `lastUsage`
- 无法准确从 `lastUsage` 反推历史累计 usage
- 无法准确重建按天 usage 分布

因此迁移目标不是“恢复历史真相”，而是：

- 不让旧数据在新 UI 下变空
- 从上线后开始，逐步积累准确的 `totalUsage` 和 `usageByDay`

### 2. 懒迁移规则

在 session 被再次读取或更新时：

- 若 `totalUsage` 缺失且 `lastUsage` 存在
  - 视为 `seededLegacyUsage = lastUsage`
- 若 `lastUsageAt` 缺失
  - 不为新数据写路径臆造 `lastUsageAt`
- 若 `usageByDay` 缺失且 `totalUsage` 存在
  - 视为 `usageByDay[toDateBucketAtTimezone(lastUsageAt ?? updatedAt, SESSION_USAGE_TIMEZONE)] = totalUsage`
- 若 `usageByDay` 缺失且 `totalUsage` 不存在但 `lastUsage` 存在
  - 视为 `usageByDay[toDateBucketAtTimezone(lastUsageAt ?? updatedAt, SESSION_USAGE_TIMEZONE)] = lastUsage`

对纯历史数据的读路径 fallback：

- 若 `lastUsageAt` 也缺失，前端可在 dataset 构建阶段用 `updatedAt` 生成 synthetic bucket
- 该 fallback 仅用于历史兼容展示，不回写为新的 usage 时间真值

注意：

- 这是近似迁移
- 会把旧 `lastUsage` 当作累计起点
- 不保证历史范围统计绝对准确
- 但必须保证旧值不会因为一次新 usage 写入而从 bounded range 统计中“消失”

### 3. 是否回写懒迁移结果

建议分阶段：

- Phase 1
  只在内存逻辑中 seed，不主动回写 Redis
- Phase 2
  当该 session 下一次真实更新发生时，将 `totalUsage` / `usageByDay` 一并持久化

这样可以减少一次性大规模数据写放大。

## Detailed Implementation Plan

### Step 1. 共享类型与契约

修改：

- [packages/shared/src/types/session.ts](D:/ai/officeclaw/relay-claw/packages/shared/src/types/session.ts:21)
- `@openjiuwen/relay-api-server-contracts/storage` 中的 `SessionRecordPatch` canonical contract
- [packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts:20)

完成内容：

- `SessionRecord` 新增 `totalUsage`
- `SessionRecord` 新增 `usageByDay`
- `SessionRecord` 新增 `lastUsageAt`
- `SessionRecordPatch` 在 canonical contract 中新增对应 patch 字段，并由 API 侧 re-export 暴露

### Step 2. 新增 usage merge helper

新增：

- `packages/api/src/domains/agents/services/session/session-usage.ts`

完成内容：

- 在 `packages/shared` 导出 `SESSION_USAGE_TIMEZONE`
- 在 `packages/shared` 导出 `toDateBucketAtTimezone`
- 在 API 侧新增 `toSessionUsageSnapshot`
- 在 API 侧新增 `mergeSessionUsage`
- 在 API 侧新增 `mergeUsageByDay`

### Step 3. store 实现

修改：

- [packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/ports/SessionChainStore.ts:120)
- [packages/api/src/domains/agents/services/stores/redis/RedisSessionChainStore.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/stores/redis/RedisSessionChainStore.ts:180)

完成内容：

- 支持读写 `lastUsageAt`
- 支持读写 `totalUsage`
- 支持读写 `usageByDay`

### Step 4. invocation 写路径

修改：

- [packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts](D:/ai/officeclaw/relay-claw/packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts:1219)

完成内容：

- 引入 `didPersistSessionUsageForThisAttempt`
- 将 usage 写路径从 `contextHealth` gate 中解耦
- 只在 `done` 上累计写入
- 中途 usage 不得提前落累计账
- `lastUsage` / `lastUsageAt` / `totalUsage` / `usageByDay` 受同一 attempt 幂等保护
- `lastUsage` 写 `done.metadata.usage`
- `lastUsageAt` 写最近一次最终落账 usage 时间
- `totalUsage` 基于 legacy seed 做 merge
- `usageByDay` 基于同一份 legacy seed 做按天 merge
- 日桶归属使用 `done.timestamp`

### Step 5. thread usage route

修改：

- [packages/api/src/routes/session-chain.ts](D:/ai/officeclaw/relay-claw/packages/api/src/routes/session-chain.ts:42)

完成内容：

- 使用 `totalUsage ?? lastUsage`

### Step 6. frontend usage stats

修改：

- [packages/web/src/services/usageStats.ts](D:/ai/officeclaw/relay-claw/packages/web/src/services/usageStats.ts:15)

完成内容：

- 扩展 session summary 类型
- 新增 range bucket 求和逻辑
- 从 shared 复用 `SESSION_USAGE_TIMEZONE` 与日期 helper
- 将统计口径切换到 `usageByDay`
- 按 `latestUsageTimestampInRange` 排序
- `occurredAt` 显示 `latestUsageTimestampInRange`
- fallback 到 `totalUsage` / `lastUsage`

### Step 7. tests

新增和修改测试，见下节。

## Acceptance Criteria

- [ ] AC-A1: 同一 session 连续多次 invocation 后，`totalUsage.inputTokens` 为累计值
- [ ] AC-A2: 同一 session 连续多次 invocation 后，`totalUsage.outputTokens` 为累计值
- [ ] AC-A3: `lastUsage` 仍然表示最近一次 usage 快照
- [ ] AC-A3b: `lastUsageAt` 仍然表示最近一次最终落账 usage 时间
- [ ] AC-A4: “用量统计”弹窗中的 `Input Tokens消耗` 显示 session 累计值，而不是最后一笔
- [ ] AC-A5: “用量统计”弹窗中的 `Output Tokens消耗` 显示 session 累计值，而不是最后一笔
- [ ] AC-A6: `today / 3d / 7d / 30d` 统计基于 `usageByDay`，不会把跨天 session 的全部 total 都错误算入当天
- [ ] AC-A7: 旧 session 只有 `lastUsage` 时页面仍能展示值
- [ ] AC-A8: Redis 与内存 store 均可读写 `totalUsage` 和 `usageByDay`
- [ ] AC-A9: 同一 attempt 的终态 `done` 若被重复处理，usage 不会被双记
- [ ] AC-A10: usage 持久化不依赖 `contextHealth` 是否可计算；只有 `outputTokens` / `costUsd` 的调用也能入账
- [ ] AC-A11: `today / 3d / 7d / 30d` 使用同一共享统计时区常量复算 bucket
- [ ] AC-A12: 同一 attempt 若中途出现多个 usage 相关 frame，session 层仍只以 `done.metadata.usage` 结算，不直接消费中途 frame
- [ ] AC-A13: `usageByDay` 的归属日固定按 `done.timestamp` 计算，跨午夜长任务口径可复现
- [ ] AC-A14: 历史 session 缺失 `lastUsageAt` 时，旧 usage 不会因为一次新写入而从 bounded range 统计中消失
- [ ] AC-A15: usage 列表排序与 `occurredAt` 都基于当前 range 内最后一个命中的 usage 时间，而不是 `updatedAt`

## Test Plan

### 单元测试

新增：

- `session-usage.test.ts`

覆盖：

- `mergeSessionUsage(undefined, undefined)`
- `mergeSessionUsage(base, delta)`
- `mergeUsageByDay`
- `toDateBucketAtTimezone`
- `costUsd` 精度 round
- terminal timestamp 跨午夜时的日桶归属
- `lastUsageAt` 不受非 usage `updatedAt` 更新污染
- legacy seed 在缺失 `lastUsageAt` 时使用 `updatedAt` 形成近似日桶

### invoke-single-agent 测试

修改或新增：

- [packages/api/test/invoke-single-agent.test.js](D:/ai/officeclaw/relay-claw/packages/api/test/invoke-single-agent.test.js:943)

覆盖：

- 一次 invocation 写入 `lastUsage` + `totalUsage`
- 一次 invocation 写入 `lastUsageAt`
- 同一 session 两次 invocation 后 `totalUsage = 第一次 + 第二次`
- `lastUsage = 第二次`
- 中途 frame 即使带 usage，也不会直接写 `totalUsage` / `usageByDay`
- session 层只在 `done.metadata.usage` 上累计一次
- 同一 attempt 的终态 `done` 若被重复处理，`lastUsage` / `lastUsageAt` / `totalUsage` / `usageByDay` 都不会重复写
- 只有 `outputTokens` / `costUsd` 且无 `contextHealth` 时也会写 usage
- 历史 session 缺失 `lastUsageAt` 时，第一次新写入仍会把 legacy usage seed 到 `usageByDay`

### RelayClawAgentService provider 测试

修改或新增：

- `RelayClawAgentService` 相关测试

覆盖：

- 中途出现多个 usage-bearing frame 时，最终 `done.metadata.usage` 为 provider 收敛后的最终值
- session 层不负责比较“部分 usage”与“最终 usage”的完整度；该职责由 provider 层承担

### SessionChainStore 测试

修改：

- `session-chain-store.test.js`
- `redis-session-chain-store.test.js`

覆盖：

- `update()` 支持 `totalUsage`
- `update()` 支持 `usageByDay`
- `update()` 支持 `lastUsageAt`
- `get()` / `hydrate()` 正确返回新字段

### session-chain route 测试

修改：

- [packages/api/test/session-chain-route.test.js](D:/ai/officeclaw/relay-claw/packages/api/test/session-chain-route.test.js:392)

覆盖：

- `GET /api/threads/:threadId/usage` 优先使用 `totalUsage`
- 老 session 没有 `totalUsage` 时 fallback `lastUsage`
- `byCat` 和 `total` 聚合正确

### frontend usageStats 测试

修改：

- [packages/web/src/services/__tests__/usageStats.test.ts](D:/ai/officeclaw/relay-claw/packages/web/src/services/__tests__/usageStats.test.ts:31)

覆盖：

- `usageByDay` 下 `today`
- `usageByDay` 下 `3d`
- `usageByDay` 下 `7d`
- `usageByDay` 下 `30d`
- `occurredAt` 使用 `latestUsageTimestampInRange`
- `occurredAt` 可继续依赖浏览器默认时区显示
- fallback 到 `totalUsage`
- fallback 到 `lastUsage`
- fallback 到缺失 `lastUsageAt` 时的 `updatedAt` 近似值
- 排序不再依赖 `updatedAt`

### modal 集成测试

修改：

- [packages/web/src/components/__tests__/usage-stats-modal.test.tsx](D:/ai/officeclaw/relay-claw/packages/web/src/components/__tests__/usage-stats-modal.test.tsx:54)

覆盖：

- 大 session 后续小调用不会把累计值冲掉
- `Input Tokens消耗` / `Output Tokens消耗` / `总Tokens消耗` 显示累计值

## Risks

| 风险 | 说明 | 缓解 |
|------|------|------|
| provider usage 口径仍可能偏小 | 当前 Phase 1 只信任 provider 最终挂到 `done.metadata.usage` 的收敛快照；若 provider 本身给得偏小，session total 仍会偏小 | 后续按 provider 单独补适配 |
| 历史数据无法精确恢复 | 旧数据只有 `lastUsage`，无法还原真实累计和跨天分布 | 采用懒迁移 + 兼容 fallback |
| range 统计实现复杂度上升 | `usageByDay` 需要额外 bucket 逻辑 | 通过纯函数和测试保障 |
| Redis 数据体积增长 | session 记录新增 `totalUsage` 和 `usageByDay` | `usageByDay` 只存 slim usage snapshot，保持字段克制 |

## Rollout Plan

### Phase 1

- 完成类型与 store 改造
- 完成后端累计写入
- 完成路由 fallback 兼容
- 完成 usage 写路径与 `contextHealth` 的解耦
- 完成前端基于 `Asia/Shanghai` 的 `usageByDay` range 统计
- 将 `Asia/Shanghai` 作为共享常量用于 helper 和前端 range 统计
- 当前所有实际启用 provider 都按 `done.metadata.usage` 口径运行

### Phase 2

- 观察线上 session usage 是否与用户主观体验一致
- 如仍存在“大任务 output 明显偏小”问题，按具体 provider 继续补适配

### Phase 3

- 评估是否将 `lastUsage` 从用户可见统计中彻底移出，仅保留调试语义

## Open Questions

- 是否需要将 `totalTokens` 也持久化到 session snapshot
  当前不建议，避免重复字段；前端可用 `inputTokens + outputTokens`
- 是否要为老 session 做一次性离线回填
  当前不建议，历史信息不足，收益有限
- 是否在未来引入“用户本地时区日桶”版本
  Phase 1 直接采用 `Asia/Shanghai` 日桶，并通过共享常量保证口径可复现

## Key Decisions

- 保留 `lastUsage`，新增 `totalUsage`，而不是重命名字段
- 新增 `lastUsageAt`，避免让 `updatedAt` 承担 usage 时间语义
- 范围统计必须引入 `usageByDay`，不能只靠 `totalUsage`
- 历史兼容采用懒迁移，不做离线精确回放
- 用户可见“用量统计”主口径从 `lastUsage` 切换到 `totalUsage` / `usageByDay`
- usage 持久化与 `contextHealth` 持久化解耦，前者不能依赖后者是否可计算
- Phase 1 统一按最终 `done.metadata.usage` 口径累计；未来再按具体 provider 补适配
- bounded range 对历史数据只能通过 synthetic local day bucket 近似兼容，不能直接按 `updatedAt` 吞整条 total
- retry / failed attempt 的真实 token 消耗应计入 `totalUsage`
- Phase 1 只统一统计分桶时区，不强制统一所有用户可见显示时区

## Dependencies

- **Related**: F008（token observability 口径）
- **Related**: F024（session chain / context monitoring）
- **Related**: F051（real quota dashboard / usage presentation）
