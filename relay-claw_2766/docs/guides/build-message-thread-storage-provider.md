---
feature_ids: []
topics: [storage-provider, plugin-api, message-store, thread-store, integration]
doc_kind: guide
created: 2026-05-11
---

# Build a Message/Thread Storage Provider

这份文档面向要提供 Message / Thread 持久化的小伙伴：先基于源码实现和验证，后续打成 npm 包时，主要差异只是依赖从 workspace 包变成已发布包，以及安装包名进入运行环境。

运行时支持 **partial provider**：只导出 `createMessageStore()` 和 `createThreadStore()` 的对象也能注册，未实现的 13 个 store 自动 fallback 到内置 memory provider。启动日志会打印 fallback 详情。

## 1. 运行时接入模型

storage provider 的公开契约在 `packages/plugin-api/src/storage/`：

```ts
import type {
  CreateMessageStoreOptions,
  CreateThreadStoreOptions,
  IMessageStore,
  IThreadStore,
  OfficeClawStorageProvider,
} from '@openjiuwen/relay-api-server-contracts/storage';
```

运行时通过两个 env 选择和加载 provider：

```bash
OFFICE_CLAW_STORAGE_PROVIDER=partner-db
OFFICE_CLAW_STORAGE_PROVIDER_MODULES=@partner/office-claw-storage
```

加载规则：

1. `OFFICE_CLAW_STORAGE_PROVIDER_MODULES` 是逗号分隔的 ESM module specifier。
2. 每个模块可以导出 `default`、`storageProvider` 或 `storageProviders[]`。
3. registry 检查 provider：如果具备全部 15 个 `createXxxStore()` 方法，直接注册；如果只实现了部分（至少 1 个），自动用内置 memory provider 补齐缺失的 factory（partial provider）。
4. `OFFICE_CLAW_STORAGE_PROVIDER` 必须匹配某个 provider 的 `id`，找不到就 fast-fail。
5. provider 的 `bootstrap()` 可选；适合在启动时做 DB ping、schema check 或 migration guard。
6. partial provider 启动时会打印日志：`[storage] Provider 'xxx': 2/15 stores implemented, 13 falling back to 'memory'`。

## 2. 源码开发包结构

推荐先按独立包开发，即使还没有发布 npm：

```text
packages/storage-partner/
  package.json
  tsconfig.json
  src/
    index.ts
    PartnerMessageStore.ts
    PartnerThreadStore.ts
```

`package.json` 最小形态：

```json
{
  "name": "@partner/office-claw-storage",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit"
  },
  "peerDependencies": {
    "@openjiuwen/relay-api-server-contracts": ">=0.1.0",
    "@openjiuwen/relay-shared": ">=0.1.0"
  },
  "devDependencies": {
    "@openjiuwen/relay-api-server-contracts": "workspace:*",
    "@openjiuwen/relay-shared": "workspace:*",
    "typescript": "^5.3.3"
  }
}
```

发布成 npm 包后，把 `workspace:*` 换成发布版本即可；运行时 env 的模块名和 provider 导出形式不变。

## 3. Provider 导出

`src/index.ts` 只需导出你实现了的 store factory。运行时会自动把缺失的 factory 用内置 memory provider 补齐：

```ts
import type { CreateMessageStoreOptions, CreateThreadStoreOptions } from '@openjiuwen/relay-api-server-contracts/storage';
import { PartnerMessageStore } from './PartnerMessageStore.js';
import { PartnerThreadStore } from './PartnerThreadStore.js';

export const storageProvider = {
  id: 'partner-db',
  displayName: 'Partner DB Storage',

  async bootstrap() {
    // 建议做 DB ping、schema version check、migration lock check。
  },

  createMessageStore(options?: CreateMessageStoreOptions) {
    return new PartnerMessageStore({
      onAppend: options?.onAppend,
      ttlSeconds: options?.ttlSeconds,
    });
  },

  createThreadStore(options?: CreateThreadStoreOptions) {
    return new PartnerThreadStore({
      ttlSeconds: options?.ttlSeconds,
    });
  },
};

export default storageProvider;
```

启动后，日志会提示哪些 store 在用 fallback：

```text
[storage] Provider 'partner-db': 2/14 stores implemented, 12 falling back to 'memory' (createTaskStore, createBacklogStore, ...)
```

如果后续需要持久化更多 store，只需在 provider 对象里加对应的 factory 方法，fallback 列表会自动缩短。

完整 provider 的 14 个 factory 方法供参考：

```text
createMessageStore      createThreadStore        createTaskStore
createBacklogStore      createMemoryStore        createDraftStore
createSessionChainStore  createInvocationRecordStore  createPendingRequestStore
createAuthorizationRuleStore  createAuthorizationAuditStore  createPushSubscriptionStore
createReadStateStore    createWorkflowSopStore
```

## 4. Message Store 接口

实现类需要满足 `IMessageStore`。方法可以同步返回，也可以返回 `Promise`。

```ts
import type {
  AppendMessageInput,
  CreateMessageStoreOptions,
  IMessageStore,
  StoredMessage,
} from '@openjiuwen/relay-api-server-contracts/storage';
import { DEFAULT_THREAD_ID } from '@openjiuwen/relay-api-server-contracts/storage';

export class PartnerMessageStore implements IMessageStore {
  readonly onAppend?: CreateMessageStoreOptions['onAppend'];

  constructor(options: CreateMessageStoreOptions = {}) {
    this.onAppend = options.onAppend;
  }

  async append(input: AppendMessageInput): Promise<StoredMessage> {
    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    // 1. 如果 input.idempotencyKey 存在，按 userId + threadId + key 去重。
    // 2. 生成唯一 message id；分页游标必须有稳定顺序。
    // 3. 写入后 best-effort 调用 this.onAppend?.({ id, threadId, timestamp, content })。
    throw new Error('implement me');
  }
}
```

### StoredMessage 字段

| 字段 | 说明 |
| --- | --- |
| `id` | provider 生成的唯一 message id。cursor 查询依赖它，必须稳定。 |
| `threadId` | 所属 thread；缺省写入 `DEFAULT_THREAD_ID`。 |
| `userId` | 触发/归属用户。agent 消息也会带触发用户。 |
| `agentId` | 发言猫；用户消息为 `null`。 |
| `content` | 纯文本正文。 |
| `contentBlocks` | 结构化富消息块，来自 `@openjiuwen/relay-shared`。 |
| `toolEvents` | 工具调用/结果事件。 |
| `metadata` | provider、model、token usage 等模型元数据。 |
| `extra` | rich block 状态、stream invocation、cross-post、task run 等扩展字段。 |
| `mentions` | 被 @ 的猫列表。 |
| `mentionsUser` | 是否提及用户。 |
| `timestamp` | 消息时间戳，毫秒。 |
| `visibility` / `whisperTo` / `revealedAt` | whisper 可见性。 |
| `source` | IM connector / scheduler 等来源。 |
| `deliveryStatus` / `deliveredAt` | queued / delivered / canceled 状态。 |
| `replyTo` | 父消息 id。 |
| `deletedAt` / `deletedBy` / `_tombstone` | 软删除、硬删除 tombstone。 |

### IMessageStore 方法

| 方法 | 语义 |
| --- | --- |
| `append(input)` | 写入消息并返回完整 `StoredMessage`。支持 `idempotencyKey` 去重；成功后 best-effort 触发 `onAppend`。 |
| `getById(id)` | 按 id 查询，找不到返回 `null`。 |
| `getRecent(limit?, userId?)` | 返回最近 N 条，按时间升序返回；传 `userId` 时按 `userId` 精确过滤。 |
| `getMentionsFor(agentId, limit?, userId?, threadId?, afterMessageId?)` | 返回提及某猫的最早 N 条，支持 user/thread/cursor 过滤。 |
| `getRecentMentionsFor(agentId, limit?, userId?, threadId?)` | 返回最近 N 条 mention，结果仍按旧到新排序。 |
| `getBefore(timestamp, limit?, userId?, beforeId?)` | 时间游标分页，返回 cursor 前的消息，旧到新排序。 |
| `getByThread(threadId, limit?, userId?)` | 返回 thread 最近 N 条，旧到新排序。 |
| `getByThreadAfter(threadId, afterId?, limit?, userId?)` | 返回某 message id 之后的 thread 消息，旧到新排序。`afterId` 缺省表示从 thread 开头；这个 cursor path 需要包含已删除 tombstone。 |
| `getByThreadBefore(threadId, timestamp, limit?, beforeId?, userId?)` | thread 内 cursor 前分页，旧到新排序。 |
| `deleteByThread(threadId)` | 物理删除 thread 下所有消息，返回删除数量。 |
| `softDelete(id, deletedBy)` | 标记删除，保留内容，找不到返回 `null`。 |
| `hardDelete(id, deletedBy)` | 清空内容和扩展字段，留下 tombstone；不可恢复。 |
| `restore(id)` | 恢复软删除；硬删除 tombstone 必须返回 `null`。 |
| `revealWhispers(threadId, userId)` | 将该用户在 thread 内未 reveal 的 whisper 标为 revealed，返回数量。 |
| `updateExtra(id, extra)` | 覆盖 `extra`，用于 rich block / task run 状态持久化。 |
| `markDelivered(id, deliveredAt)` | queued -> delivered；非 queued 消息应保持原样返回。 |
| `markCanceled(id)` | 标记为 canceled。 |

查询过滤要对齐现有 `MessageStore` / `RedisMessageStore`：大多数 timeline 查询排除 `deletedAt`，但 `getByThreadAfter()` 必须保留已删除 tombstone，供 cursor 增量同步看到删除状态。mention、`getBefore()` 和 thread history 查询需要排除 `deliveryStatus === 'queued'` 和 `deliveryStatus === 'canceled'` 的消息。thread history 的 `userId` 过滤不能简单等值过滤 agent 消息：agent 消息属于 thread，不属于某个触发用户；参考 `packages/api/src/domains/agents/services/stores/visibility.ts` 的 `matchesThreadHistoryUserScope()`。

## 5. Thread Store 接口

实现类需要满足 `IThreadStore`。Thread 是会话索引、参与者、routing policy、thread memory、bootcamp state 等线程级状态的真相源。

```ts
import type { AgentId } from '@openjiuwen/relay-shared';
import type { IThreadStore, Thread } from '@openjiuwen/relay-api-server-contracts/storage';
import { DEFAULT_THREAD_ID } from '@openjiuwen/relay-api-server-contracts/storage';

export class PartnerThreadStore implements IThreadStore {
  async create(userId: string, title?: string, projectPath?: string): Promise<Thread> {
    // 生成 thread id，保存 projectPath/title/createdBy/createdAt/lastActiveAt。
    throw new Error('implement me');
  }

  async get(threadId: string): Promise<Thread | null> {
    // DEFAULT_THREAD_ID 建议兼容内置实现：首次读取可返回/创建默认 thread。
    if (threadId === DEFAULT_THREAD_ID) {
      // ...
    }
    throw new Error('implement me');
  }

  async addParticipants(threadId: string, agentIds: AgentId[]): Promise<void> {
    // 去重添加参与猫；不要在这里增加 activity 计数。
  }
}
```

### Thread 字段

| 字段 | 说明 |
| --- | --- |
| `id` | thread id；`DEFAULT_THREAD_ID` 是默认线程常量。 |
| `projectPath` | thread 绑定的本地项目路径。 |
| `title` | 标题，可为 `null`。 |
| `createdBy` | 创建用户。 |
| `participants` | 参与猫列表，必须去重。 |
| `lastActiveAt` / `createdAt` | 活跃和创建时间。 |
| `pinned` / `favorited` | 前端列表状态。 |
| `thinkingMode` | `debug` 或 `play`。 |
| `mentionActionabilityMode` | mention 判定模式；`strict` 是默认语义。 |
| `preferredCats` | 当前 thread 偏好的猫，写入时去重。 |
| `phase` / `backlogItemId` | workflow / backlog 关联。 |
| `routingPolicy` | review / architecture 等 scope 的路由偏好。 |
| `threadMemory` | thread 摘要记忆。 |
| `votingState` | 投票状态。 |
| `voiceMode` | 是否语音模式。 |
| `bootcampState` | 新手引导状态。 |
| `connectorHubState` | 外部 IM hub 绑定状态。 |
| `deletedAt` | 软删除时间；`null` 表示已恢复。 |

### IThreadStore 方法

| 方法 | 语义 |
| --- | --- |
| `create(userId, title?, projectPath?)` | 创建 thread。需写入 `createdBy`、`createdAt`、`lastActiveAt`。 |
| `get(threadId)` | 按 id 查询；找不到返回 `null`。建议兼容 `DEFAULT_THREAD_ID`。 |
| `list(userId)` | 返回用户可见且未删除的 thread，按 `lastActiveAt` 倒序。 |
| `listByProject(userId, projectPath)` | 在 `list(userId)` 基础上按 projectPath 过滤。 |
| `addParticipants(threadId, agentIds)` | 去重添加参与猫；不更新 activity。 |
| `getParticipants(threadId)` | 返回参与猫列表；找不到返回空数组。 |
| `getParticipantsWithActivity(threadId)` | 返回参与猫 activity，按 `lastMessageAt` 倒序。 |
| `updateParticipantActivity(threadId, agentId)` | 成功追加消息后调用；确保参与猫存在，并累加 messageCount。 |
| `updateTitle(threadId, title)` | 更新标题。 |
| `updatePin(threadId, pinned)` | 更新 pinned 和 `pinnedAt`。 |
| `updateFavorite(threadId, favorited)` | 更新 favorited 和 `favoritedAt`。 |
| `updateThinkingMode(threadId, mode)` | 更新 thinking mode。 |
| `updateMentionActionabilityMode(threadId, mode)` | `strict` 应回到默认语义；`relaxed` 写显式字段。 |
| `updatePreferredCats(threadId, agentIds)` | 去重写入；空数组清除偏好。 |
| `updatePhase(threadId, phase)` | 更新 thread phase。 |
| `linkBacklogItem(threadId, backlogItemId)` | 关联 backlog item。 |
| `setMentionRoutingFeedback(threadId, agentId, feedback)` | 写入一次性 mention routing feedback。 |
| `consumeMentionRoutingFeedback(threadId, agentId)` | 读取并删除 feedback；没有则返回 `null`。 |
| `updateRoutingPolicy(threadId, policy)` | `null` 或空 scopes 清除 policy；仅接受 `v: 1`。 |
| `getThreadMemory(threadId)` | 返回 thread memory 或 `null`。 |
| `updateThreadMemory(threadId, memory)` | 写入 thread memory。 |
| `getVotingState(threadId)` | 返回 voting state 或 `null`。 |
| `updateVotingState(threadId, state)` | `null` 清除，否则写入。 |
| `updateVoiceMode(threadId, voiceMode)` | `false` 清除显式 voice mode。 |
| `updateBootcampState(threadId, state)` | `null` 清除，否则写入。 |
| `updateConnectorHubState(threadId, state)` | `null` 清除，否则写入。 |
| `updateLastActive(threadId)` | 更新 `lastActiveAt`，用于列表排序。 |
| `delete(threadId)` | 物理删除；`DEFAULT_THREAD_ID` 不应被删除。 |
| `softDelete(threadId)` | 标记删除，返回是否成功。 |
| `restore(threadId)` | 恢复软删除，返回是否成功。 |
| `listDeleted(userId)` | 返回用户已软删除的 thread，按删除时间倒序。 |

## 6. TTL 和回调

平台会把 env 解析后的 TTL 传给 provider factory：

| Factory | Option |
| --- | --- |
| `createMessageStore(options)` | `options.ttlSeconds`、`options.onAppend` |
| `createThreadStore(options)` | `options.ttlSeconds` |

`ttlSeconds === 0` 的语义是永久保留，不是立即过期。不要用 truthy 判断 TTL；应使用 `ttlSeconds !== undefined`。

`onAppend` 是 MessageStore 写入成功后的 best-effort callback，用于 thread index / realtime 辅助逻辑。provider 不应让 callback 失败回滚已经成功的消息写入。

## 7. 配置和本地验证

先只验证 Message/Thread store 本身，不经过 registry 和完整 provider：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PartnerMessageStore } from '../src/PartnerMessageStore.js';
import { PartnerThreadStore } from '../src/PartnerThreadStore.js';

test('message/thread store contract smoke', async () => {
  const messages = new PartnerMessageStore();
  const threads = new PartnerThreadStore();

  const thread = await threads.create('dev-user', 'storage smoke', process.cwd());
  const msg = await messages.append({
    threadId: thread.id,
    userId: 'dev-user',
    agentId: null,
    content: 'hello storage provider',
    mentions: [],
    timestamp: Date.now(),
  });

  assert.equal((await messages.getById(msg.id))?.content, 'hello storage provider');
  assert.equal((await messages.getByThread(thread.id, 10))[0]?.id, msg.id);
  assert.equal((await threads.get(thread.id))?.id, thread.id);
});
```

这个 targeted test 不需要完整 provider，适合快速验证核心读写语义。构建 provider 和 API：

```bash
pnpm --dir packages/plugin-api build
pnpm --dir packages/api build
pnpm --filter @partner/office-claw-storage build
```

用源码 smoke test 验证模块能被 storage module 注册（partial provider 会自动补齐）：

```bash
OFFICE_CLAW_STORAGE_PROVIDER=partner-db \
OFFICE_CLAW_STORAGE_PROVIDER_MODULES=@partner/office-claw-storage \
node --input-type=module <<'EOF'
const { createStorageModule } = await import('./packages/api/dist/storage/module.js');

const module = await createStorageModule({
  env: {
    OFFICE_CLAW_STORAGE_PROVIDER: process.env.OFFICE_CLAW_STORAGE_PROVIDER,
    OFFICE_CLAW_STORAGE_PROVIDER_MODULES: process.env.OFFICE_CLAW_STORAGE_PROVIDER_MODULES,
  },
});

const provider = module.getActiveProvider();
const messages = await provider.createMessageStore();
const threads = await provider.createThreadStore();

const thread = await threads.create('dev-user', 'storage smoke', process.cwd());
const msg = await messages.append({
  threadId: thread.id,
  userId: 'dev-user',
  agentId: null,
  content: 'hello storage provider',
  mentions: [],
  timestamp: Date.now(),
});

const loaded = await messages.getById(msg.id);
if (!loaded) throw new Error('message was not persisted');
console.log(`storage provider ok: ${provider.id}`);
EOF
```

完整 API 启动验证时，不要修改共享 `.env`。在当前 shell 或 `.env.local` 里覆盖：

```bash
OFFICE_CLAW_STORAGE_PROVIDER=partner-db
OFFICE_CLAW_STORAGE_PROVIDER_MODULES=@partner/office-claw-storage
```

如果本机已有运行中的实例，端口也要用 `.env.local` 覆盖，避免撞到保留端口。

## 8. 必测场景

MessageStore 至少覆盖：

1. `append()` 生成 id、默认 thread、触发 `onAppend`。
2. `idempotencyKey` 重复写入返回同一条消息。
3. `getRecent()`、`getBefore()`、`getByThread*()` 的排序和 cursor 边界。
4. mention 查询的 agentId / userId / threadId / afterMessageId 过滤。
5. queued / canceled 消息不进入 history 和 mention 结果。
6. soft delete 不出现在查询结果，restore 后恢复。
7. `getByThreadAfter()` 能返回已删除 tombstone，普通 history 查询不返回 deleted 消息。
8. hard delete 清空内容和扩展字段，并且不可 restore。
9. whisper `revealWhispers()` 只 reveal 指定用户在指定 thread 的消息。
10. `markDelivered()` 只允许 queued -> delivered。

ThreadStore 至少覆盖：

1. `create()`、`get()`、`list()`、`listByProject()` 的基础读写和排序。
2. `DEFAULT_THREAD_ID` 行为。
3. participant 去重；`addParticipants()` 不增加 activity，`updateParticipantActivity()` 才增加。
4. pin / favorite / thinking mode / mention actionability / preferred cats 更新。
5. routing policy 的清除语义：`null` 或空 scopes 清除。
6. mention routing feedback 必须 consume 后删除。
7. thread memory、voting state、voice mode、bootcamp state、connector hub state 的 null 清除语义。
8. soft delete / restore / listDeleted；默认 thread 不能删除。

已有参考实现：

1. `packages/api/src/domains/agents/services/stores/ports/MessageStore.ts`
2. `packages/api/src/domains/agents/services/stores/ports/ThreadStore.ts`
3. `packages/api/src/domains/agents/services/stores/redis/RedisMessageStore.ts`
4. `packages/api/src/domains/agents/services/stores/redis/RedisThreadStore.ts`
5. `packages/api/test/message-store.test.js`
6. `packages/api/test/storage-module.test.js`

## 9. 发布 npm 后的差异

源码开发时：

```json
"@openjiuwen/relay-api-server-contracts": "workspace:*"
```

发布后：

```json
"@openjiuwen/relay-api-server-contracts": "^0.1.0"
```

应用侧只需要安装包并保留同样的 env：

```bash
pnpm add @partner/office-claw-storage

OFFICE_CLAW_STORAGE_PROVIDER=partner-db
OFFICE_CLAW_STORAGE_PROVIDER_MODULES=@partner/office-claw-storage
```

不要从外部 npm 包 import `@openjiuwen/relay-api-server/src/...` 或 `dist/storage/providers/...`。这些是源码验证便利，不是公开 contract。公开稳定边界只有 `@openjiuwen/relay-api-server-contracts/storage` 和 `@openjiuwen/relay-shared`。

partial provider 发布为 npm 包后同样有效：运行时自动补齐缺失的 factory，不需要在包里 stub 剩余 13 个 store。
