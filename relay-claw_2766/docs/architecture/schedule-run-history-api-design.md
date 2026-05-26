# 查询与删除定时任务执行记录接口设计方案

## 背景

当前定时任务管理的核心路由在 `packages/api/src/routes/schedule.ts`，调度执行由 `TaskRunnerV2` 驱动，执行记录写入 SQLite 表 `task_run_ledger`。

现有接口已经支持查询单个任务的执行记录：

```http
GET /api/schedule/tasks/:id/runs
```

但前端如果要做“执行记录总表 / 审计日志 / 最近执行记录”页面，需要跨任务查询所有执行记录；如果要在全局执行记录页支持清理误触发、测试或不再需要展示的单条历史记录，还需要按记录 `id` 删除指定执行记录。

同时，任务未来支持编辑，任务名称、分类、描述、触发规则、投递线程等元数据可能在执行后发生变化。执行记录页面展示历史记录时，应展示“任务执行当时的任务状态”，而不是查询时的当前任务状态。因此建议在执行记录写入时同步保存任务元数据快照，并新增全局执行记录查询与单条删除接口。

## 目标

新增接口：

```http
GET /api/schedule/runs
DELETE /api/schedule/runs/:id
```

`GET /api/schedule/runs` 用于查询所有定时任务执行记录，支持分页和常用过滤条件。

`DELETE /api/schedule/runs/:id` 用于删除指定 `id` 的单条任务执行记录。该接口是全局接口，只按执行记录 `id` 删除，不做“只能删除自己线程相关执行记录”的限制。

查询接口只负责读取历史记录，不触发任务、不修改任务状态、不改变调度行为。删除接口只删除历史执行记录，不删除任务定义、不停止任务、不修改调度状态。

## 非目标

本次设计不做以下事情：

- 不修改定时任务调度逻辑。
- 不新增新的任务执行结果写入入口，只在现有 ledger 写入时附带任务快照。
- 不批量删除或自动清理历史记录。
- 不补录历史数据。
- 不把 `started_at` 改造成计划触发时间。
- 不新增 `scheduled_at` / `fire_at` 数据库字段。

如果未来产品需要展示“原计划执行时间”，建议另起设计，在 ledger 表中新增独立字段，而不是复用 `started_at`。

## 现有数据模型

### 表：`task_run_ledger`

建表位置：`packages/api/src/domains/memory/schema.ts`

当前字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER | 自增主键，当前 SQL 已存在，但 `RunLedgerRow` 类型未暴露 |
| `task_id` | TEXT | 所属任务 ID |
| `subject_key` | TEXT | 本次执行主体，例如 `thread-xxx`、`thread:xxx` 或任务自身 ID |
| `outcome` | TEXT | 执行结果 |
| `signal_summary` | TEXT | gate 阶段信号摘要 |
| `duration_ms` | INTEGER | 本条记录对应动作耗时 |
| `started_at` | TEXT | 本条记录对应动作开始时间，ISO 8601 字符串 |
| `assigned_cat_id` | TEXT | 被分配执行的 cat / agent ID |
| `error_summary` | TEXT | 失败摘要 |
| `task_snapshot_json` | TEXT | 任务执行当时的元数据快照，JSON 字符串；新记录写入，旧记录可能为 `null` |

现有索引：

| 索引 | 字段 |
|---|---|
| `idx_run_ledger_task` | `task_id` |
| `idx_run_ledger_subject` | `subject_key` |

### 任务元数据快照

新增字段：

```sql
task_snapshot_json TEXT
```

`task_snapshot_json` 存储任务执行当时的展示与配置快照。API 不直接暴露该 JSON 字段，而是解析后映射到响应体中的 `run.task`。

建议快照结构：

```json
{
  "version": 1,
  "id": "dyn-1777109400000-a1b2c3",
  "source": "dynamic",
  "templateId": "reminder",
  "label": "提醒",
  "category": "thread",
  "description": "定时提醒",
  "enabled": true,
  "effectiveEnabled": true,
  "trigger": {
    "type": "cron",
    "expression": "0 9 * * *",
    "timezone": "Asia/Shanghai"
  },
  "deliveryThreadId": "thread-abc123",
  "threadTitle": "项目讨论"
}
```

写入原则：

- 每次 `RunLedger.record(...)` 写入执行记录时，同时写入当时的任务快照。
- `task_snapshot_json` 是执行记录的一部分，记录写入后不随任务后续编辑而变化。
- 查询接口的 `task` 字段只来自 `task_snapshot_json`。
- 如果历史记录没有 `task_snapshot_json`，或 JSON 解析失败，`task` 返回 `null`。
- 不从 `taskRunner.getTaskSummaries()`、`dynamicTaskStore.getAll()`、`threadStore.get(...)` 回退补全 `task`。

这样可以保证执行记录页面展示的是“当时执行时的任务状态”，避免任务后续编辑污染历史记录。

### `started_at` 语义

`started_at` 表示“这条执行记录对应动作开始发生的时间”。它不是统一意义上的计划触发时间。

不同 outcome 下语义如下：

| outcome | `started_at` 含义 |
|---|---|
| `RUN_DELIVERED` | 某个 work item 实际开始执行的时间 |
| `RUN_FAILED` | 某个 work item 实际开始执行的时间 |
| `SKIP_NO_SIGNAL` | 调度器开始检查本次 tick，随后 gate 判定无信号的时间 |
| `SKIP_GLOBAL_PAUSE` | 调度器开始检查本次 tick，随后发现全局暂停的时间 |
| `SKIP_TASK_OVERRIDE` | 调度器开始检查本次 tick，随后发现该任务被覆盖禁用的时间 |
| `SKIP_OVERLAP` | 调度器开始检查本次 tick，随后发现上一次仍在执行、决定跳过的时间 |
| `SKIP_SELF_ECHO` | work item 检查阶段发现自回声并跳过的时间 |
| `SKIP_MISSED_WINDOW` | 服务启动 hydrate 时发现一次性任务已经错过窗口，并写入审计记录的时间 |

产品展示上可以统一叫“执行时间”或“记录时间”。如果要更准确，建议叫“开始时间”。

## 认证设计

认证方式与现有 schedule 接口保持一致，继续使用 `resolveScheduleCaller(...)`。

新增查询与删除接口建议与现有单任务执行记录接口保持一致，只允许浏览器用户访问：

```ts
const { error } = resolveScheduleCaller(request, {
  allowedKinds: ['browser'],
  registry,
  browserUserVerifier,
});
```

原因：

- `GET /api/schedule/tasks/:id/runs` 当前也是 browser-only。
- 全局执行记录属于管理 / 审计视图，主要供前端页面使用。
- 单条删除执行记录属于全局管理动作，只按执行记录 `id` 操作，不做线程归属限制。
- callback 调用方通常用于 agent 在执行过程中创建、暂停、删除任务，不需要批量读取或删除历史记录。

### callback 的含义

`callback` 指 agent 执行过程中通过 callback 机制回调 API 的服务端调用，不是浏览器用户直接访问。

例如用户在会话里说“明天 9 点提醒我”，agent 在执行过程中需要调用 schedule API 创建定时任务，此时调用方就是 callback。

创建任务接口允许 callback 是合理的；但查询所有执行记录和删除执行记录不需要开放 callback。

## 接口定义

### `GET /api/schedule/runs`

查询所有定时任务执行记录，按 `id DESC` 返回最新记录。

#### Query 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `limit` | number | 否 | `50` | 返回条数，最大 `200` |
| `cursor` | number | 否 | 无 | 分页游标，传上一页最后一条记录的 `id`，查询 `id < cursor` 的更早记录 |
| `taskId` | string | 否 | 无 | 按任务 ID 过滤 |
| `threadId` | string | 否 | 无 | 按会话线程过滤，同时兼容 `thread-${threadId}` 和 `thread:${threadId}` |
| `outcome` | string | 否 | 无 | 按执行结果过滤 |
| `since` | string | 否 | 无 | ISO 时间字符串，筛选 `started_at >= since` |
| `until` | string | 否 | 无 | ISO 时间字符串，筛选 `started_at <= until` |

#### 响应体

```json
{
  "runs": [
    {
      "id": 128,
      "taskId": "dyn-1777109400000-a1b2c3",
      "subjectKey": "thread-thread-abc123",
      "threadId": "thread-abc123",
      "outcome": "RUN_DELIVERED",
      "signalSummary": "{\"message\":\"提醒内容\"}",
      "durationMs": 1532,
      "startedAt": "2026-04-27T10:12:33.000Z",
      "assignedCatId": "assistant",
      "errorSummary": null,
      "task": {
        "id": "dyn-1777109400000-a1b2c3",
        "source": "dynamic",
        "templateId": "reminder",
        "label": "提醒",
        "category": "thread",
        "description": "定时提醒",
        "enabled": true,
        "effectiveEnabled": true,
        "trigger": {
          "type": "cron",
          "expression": "0 9 * * *",
          "timezone": "Asia/Shanghai"
        },
        "deliveryThreadId": "thread-abc123",
        "threadTitle": "项目讨论"
      }
    }
  ],
  "nextCursor": 102,
  "hasMore": true
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `runs` | array | 执行记录列表 |
| `nextCursor` | number \| null | 下一页游标；没有更多数据时为 `null` |
| `hasMore` | boolean | 是否还有更多记录 |

`runs[]` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | ledger 自增 ID，用于稳定分页 |
| `taskId` | string | 任务 ID，对应数据库 `task_id` |
| `subjectKey` | string | 执行主体，对应数据库 `subject_key` |
| `threadId` | string \| null | 从 `subjectKey` 中解析出的线程 ID |
| `outcome` | string | 执行结果 |
| `signalSummary` | string \| null | 信号摘要 |
| `durationMs` | number | 耗时，毫秒 |
| `startedAt` | string | 本条记录对应动作开始时间 |
| `assignedCatId` | string \| null | 被分配执行的 cat / agent ID |
| `errorSummary` | string \| null | 失败摘要 |
| `task` | object \| null | 任务执行当时的元数据快照；仅来自 `task_snapshot_json`，旧记录无快照时为 `null` |

`task` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 任务 ID |
| `source` | `'builtin' \| 'dynamic'` | 任务执行当时的来源 |
| `templateId` | string \| null | 动态任务模板 ID；内置任务可为 null |
| `label` | string \| null | 任务执行当时的显示名称 |
| `category` | string \| null | 任务执行当时的分类 |
| `description` | string \| null | 任务执行当时的描述 |
| `enabled` | boolean \| null | 任务执行当时的自身启用状态 |
| `effectiveEnabled` | boolean \| null | 任务执行当时综合治理后的实际启用状态 |
| `trigger` | TriggerSpec \| null | 任务执行当时的触发规则 |
| `deliveryThreadId` | string \| null | 任务执行当时的投递线程 |
| `threadTitle` | string \| null | 任务执行当时的投递线程标题 |


### `DELETE /api/schedule/runs/:id`

删除指定 `id` 的单条定时任务执行记录。

该接口是全局执行记录管理接口：只校验调用方具备访问 schedule 管理接口的权限，不按 `subjectKey` / `threadId` 做“只能删除自己线程相关执行记录”的限制。

#### Path 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | number | 是 | `task_run_ledger.id`，必须是正整数 |

#### 成功响应

```json
{
  "success": true
}
```

#### 错误响应

`id` 非法：

```json
{
  "error": "Invalid id: expected positive integer"
}
```

记录不存在：

```json
{
  "error": "Schedule run not found"
}
```

#### 语义说明

- 删除的是 `task_run_ledger` 中的一条历史记录。
- 不删除动态任务定义。
- 不注销运行中的任务。
- 不停止正在执行的任务。
- 不删除已投递到线程中的消息。
- 删除后该记录不再出现在 `GET /api/schedule/runs` 返回结果中。
- 删除后基于 `task_run_ledger` 聚合出来的任务执行统计会自然减少对应记录。

### 历史记录无快照处理

旧版本写入的执行记录没有 `task_snapshot_json`。这类记录查询时仍然返回 run 本身，但 `task` 返回 `null`：

```json
{
  "id": 12,
  "taskId": "dyn-old-task",
  "subjectKey": "thread-thread-abc123",
  "threadId": "thread-abc123",
  "outcome": "RUN_DELIVERED",
  "signalSummary": null,
  "durationMs": 1532,
  "startedAt": "2026-04-27T10:12:33.000Z",
  "assignedCatId": "assistant",
  "errorSummary": null,
  "task": null
}
```

接口不得根据当前任务定义回退补全 `task`。原因是当前任务元数据可能已经被编辑，不能代表历史执行当时状态。

## 后端实现方案

### 1. 扩展类型定义

文件：`packages/api/src/infrastructure/scheduler/types.ts`

新增带 `id` 和快照字段的查询结果类型：

```ts
export interface TaskRunSnapshot {
  version: 1;
  id: string;
  source: TaskSource;
  templateId: string | null;
  label: string | null;
  category: DisplayCategory | null;
  description: string | null;
  enabled: boolean;
  effectiveEnabled: boolean;
  trigger: TriggerSpec;
  deliveryThreadId: string | null;
  threadTitle: string | null;
}

export interface RunLedgerRecord extends RunLedgerRow {
  id: number;
  task_snapshot_json: string | null;
}

export interface RunLedgerQuery {
  taskId?: string;
  threadId?: string;
  outcome?: RunOutcome;
  since?: string;
  until?: string;
  limit: number;
  cursor?: number;
}
```

需要扩展 `RunLedgerRow` 写入参数，允许写入任务快照：

```ts
export interface RunLedgerRow {
  task_id: string;
  subject_key: string;
  outcome: RunOutcome;
  signal_summary: string | null;
  duration_ms: number;
  started_at: string;
  assigned_cat_id: string | null;
  error_summary: string | null;
  task_snapshot_json?: string | null;
}
```


### 2. 扩展 `RunLedger`

文件：`packages/api/src/infrastructure/scheduler/RunLedger.ts`

新增方法：

```ts
queryAll(query: RunLedgerQuery): RunLedgerRecord[]
getById(id: number): RunLedgerRecord | null
deleteById(id: number): boolean
```

查询规则：

- 默认 `ORDER BY id DESC`。
- `cursor` 存在时追加 `id < ?`。
- `taskId` 存在时追加 `task_id = ?`。
- `threadId` 存在时追加 `(subject_key = ? OR subject_key = ?)`，分别匹配 `thread-${threadId}` 和 `thread:${threadId}`。
- `outcome` 存在时追加 `outcome = ?`。
- `since` 存在时追加 `started_at >= ?`。
- `until` 存在时追加 `started_at <= ?`。
- 查询 `limit + 1` 条，用于判断 `hasMore`。

SQL 返回字段应包含 `id`：

```sql
SELECT id, task_id, subject_key, outcome, signal_summary, duration_ms,
       started_at, assigned_cat_id, error_summary, task_snapshot_json
FROM task_run_ledger
WHERE ...
ORDER BY id DESC
LIMIT ?
```

`getById(id)` 用于删除前确认记录存在，并保留日志所需的 `task_id` 等信息：

```sql
SELECT id, task_id, subject_key, outcome, signal_summary, duration_ms,
       started_at, assigned_cat_id, error_summary, task_snapshot_json
FROM task_run_ledger
WHERE id = ?
```

`deleteById(id)` 只按主键删除单条记录：

```sql
DELETE FROM task_run_ledger
WHERE id = ?
```

实现上根据 SQLite `changes` 判断是否删除成功。

### 3. 新增路由

文件：`packages/api/src/routes/schedule-runs.ts`

新增查询接口：

```ts
app.get('/api/schedule/runs', async (request, reply) => {
  const { error } = resolveScheduleCaller(request, {
    allowedKinds: ['browser'],
    registry,
    browserUserVerifier,
  });
  if (error) return authError(reply, error);

  // parse query
  // ledger.queryAll(...)
  // parse task_snapshot_json into run.task, invalid/missing snapshot => null
  // return { runs, nextCursor, hasMore }
});
```

新增删除接口：

```ts
app.delete('/api/schedule/runs/:id', async (request, reply) => {
  const { error } = resolveScheduleCaller(request, {
    allowedKinds: ['browser'],
    registry,
    browserUserVerifier,
  });
  if (error) return authError(reply, error);

  // parse positive integer id
  // ledger.getById(id)
  // ledger.deleteById(id)
  // return { success: true }
});
```

`DELETE /api/schedule/runs/:id` 是全局接口，不检查记录对应的 `threadId` 是否属于当前浏览器用户。只要通过 schedule 管理接口认证，就可以删除任意一条执行记录。

建议查询和删除接口都放在 `schedule-runs.ts` 中维护，避免继续扩大 `schedule.ts` 文件体积。

### 4. 参数校验

建议规则：

- `limit`：`Number(limit) || 50`，最小 1，最大 200。
- `cursor`：如果存在，必须是正整数，否则 400。
- 删除接口的 path `id`：必须是正整数，否则 400。
- `outcome`：必须属于 `RunOutcome` 枚举，否则 400。
- `since` / `until`：如果存在，必须能被 `Date.parse(...)` 解析，否则 400。
- `taskId` / `threadId`：空字符串按未传处理。

### 5. 任务快照写入与读取

写入执行记录时，调度器需要基于当前 `TaskSpec` 和动态任务定义构造 `TaskRunSnapshot`，序列化后写入 `task_run_ledger.task_snapshot_json`。

快照构造建议：

- `id`：任务 ID。
- `source`：`builtin` / `dynamic`。
- `templateId`：动态任务来自 `DynamicTaskDef.templateId`；内置任务为 `null`。
- `label` / `category` / `description`：来自执行当时的 `task.display`。
- `enabled`：执行当时 `task.enabled()` 的结果。
- `effectiveEnabled`：执行当时综合全局开关、任务覆盖后的实际状态。
- `trigger`：执行当时的 `task.trigger`。
- `deliveryThreadId`：动态任务定义里的投递线程；内置任务没有则为 `null`。
- `threadTitle`：执行当时根据 `deliveryThreadId` 查到的线程标题；查不到则为 `null`。

读取执行记录时：

- 只解析 `task_snapshot_json` 生成响应里的 `task`。
- `task_snapshot_json` 为 `null`、空字符串或 JSON 解析失败时，响应 `task: null`。
- 不读取当前任务定义做 fallback。
- 不根据 `taskRunner.getTaskSummaries()` / `dynamicTaskStore.getAll()` 补全历史记录。

### 6. `threadId` 解析

复用现有函数：

```ts
extractThreadId(subjectKey: string): string | null
```

该函数已兼容：

- `thread-xxx`
- `thread:xxx`

### 7. 分页设计

使用 `task_run_ledger.id` 作为 cursor。

原因：

- `id` 是自增主键，顺序稳定。
- `started_at` 不是唯一值，同一次 tick 可能写入多条记录。
- 用 `started_at` 做 cursor 容易出现重复或漏数据。

分页流程：

1. 前端首次请求不传 `cursor`。
2. 后端查询 `limit + 1` 条。
3. 如果返回条数大于 `limit`：
   - `hasMore = true`
   - 截断到 `limit` 条
   - `nextCursor = 最后一条返回记录的 id`
4. 如果返回条数不大于 `limit`：
   - `hasMore = false`
   - `nextCursor = null`

## 是否需要数据库迁移

需要数据库迁移。

新增字段：

```sql
ALTER TABLE task_run_ledger ADD COLUMN task_snapshot_json TEXT;
```

迁移要求：

- 已有历史记录的 `task_snapshot_json` 默认为 `null`。
- 不回填旧数据，避免用当前任务状态伪造历史执行时状态。
- 查询接口遇到旧记录时返回 `task: null`。

可选优化：如果未来数据量明显增大，可以增加组合索引：

```sql
CREATE INDEX IF NOT EXISTS idx_run_ledger_started ON task_run_ledger(started_at);
CREATE INDEX IF NOT EXISTS idx_run_ledger_task_id_desc ON task_run_ledger(task_id, id DESC);
```

但第一版不建议提前加索引，除非压测或真实数据证明需要。

## 与现有接口关系

现有接口保留：

```http
GET /api/schedule/tasks/:id/runs
```

用途：任务详情页查询单个任务历史。

新增接口：

```http
GET /api/schedule/runs
DELETE /api/schedule/runs/:id
```

用途：全局执行记录页、审计日志页、最近执行记录列表，以及按记录 `id` 删除单条执行历史。

删除接口是全局管理接口，不继承 `threadId` 归属限制。

后续可以选择让旧接口内部复用 `RunLedger.queryAll({ taskId })`，但不是必须。第一版可以只新增方法和路由，降低改动范围。

## 错误码

| 状态码 | 场景 |
|---|---|
| 400 | query 参数非法，例如 cursor 非正整数、时间格式非法、outcome 不在枚举内；或删除接口 path `id` 不是正整数 |
| 401 / 403 | 认证失败或当前用户无权访问，沿用 `resolveScheduleCaller` 的返回 |
| 404 | 删除指定执行记录时，记录不存在 |
| 500 | SQLite 查询 / 删除或快照解析出现未预期错误 |

## 测试建议

### 单元测试 / 集成测试覆盖

建议至少覆盖：

1. 不传参数时返回最新执行记录。
2. `limit` 默认 50，最大 200。
3. `cursor` 能正确翻页，无重复记录。
4. `taskId` 过滤有效。
5. `threadId` 同时匹配 `thread-${id}` 和 `thread:${id}`。
6. `outcome` 过滤有效。
7. `since` / `until` 过滤有效。
8. 旧记录没有 `task_snapshot_json` 时仍能返回 run，且 `task = null`。
9. 非法参数返回 400。
10. 未认证请求返回现有认证错误。
11. 删除存在的执行记录返回 `{ success: true }`。
12. 删除后 `GET /api/schedule/runs` 不再返回该记录。
13. 删除不存在的执行记录返回 404。
14. 删除接口的非法 `id` 返回 400。
15. 新执行记录写入 `task_snapshot_json`，查询时 `task` 等于快照内容。
16. 任务编辑后，旧执行记录返回的 `task` 仍保持执行时快照，不被当前任务状态影响。
17. `task_snapshot_json` 为空或解析失败时，查询接口返回 `task: null`。
18. 删除某条记录不影响同一任务的其他执行记录。
19. 删除接口只校验 schedule 管理接口认证，不做线程归属限制。

### 手工验证

1. 创建一个 once 动态任务并等待执行。
2. 创建一个 cron / interval 动态任务并手动触发。
3. 查询：

```http
GET /api/schedule/runs?limit=20
```

4. 删除动态任务后再次查询，确认历史记录仍存在，且 `task` 仍来自执行时快照。
5. 使用 `threadId` 查询，确认两种 subject key 格式都能查到。
6. 编辑任务名称或触发规则后再次查询旧记录，确认旧记录的 `task` 没有变化。
7. 调用 `DELETE /api/schedule/runs/:id` 删除其中一条记录。
8. 再次查询，确认被删除记录不再出现，其他记录仍存在。
9. 使用另一个线程相关记录验证：只要具备 schedule 管理接口认证，即可按 `id` 删除，不受线程归属限制。

## 前端展示建议

列表列建议：

| 列 | 来源 |
|---|---|
| 时间 | `startedAt` |
| 任务 | `task?.label || taskId` |
| 分类 | `task?.category` |
| 结果 | `outcome` |
| 会话 | `task?.threadTitle || threadId` |
| 执行者 | `assignedCatId` |
| 耗时 | `durationMs` |
| 错误 | `errorSummary` |

`startedAt` 展示文案建议：

- 列名使用“开始时间”或“执行时间”。
- 详情 tooltip 说明：对于跳过记录，该时间表示调度器发现并记录跳过的时间。

## 最小实现清单

1. 在 schema 迁移中给 `task_run_ledger` 增加 `task_snapshot_json TEXT`。
2. 在 `types.ts` 增加 `TaskRunSnapshot`、`RunLedgerRecord` 和 `RunLedgerQuery`。
3. 扩展 `RunLedgerRow` / `RunLedger.record(...)`，写入 `task_snapshot_json`。
4. 在调度执行路径构造执行时任务快照，并随每条 ledger 记录写入。
5. 在 `RunLedger.ts` 增加 `queryAll(...)`、`getById(...)`、`deleteById(...)`。
6. 在 `schedule-runs.ts` 增加 `GET /api/schedule/runs`。
7. 在 `schedule-runs.ts` 增加 `DELETE /api/schedule/runs/:id`，作为全局删除接口，不做线程归属限制。
8. 复用 `extractThreadId(...)` 解析线程 ID。
9. 查询响应中 `task` 只由 `task_snapshot_json` 解析生成；无快照或解析失败时返回 `null`。
10. 加参数校验、分页返回和删除结果处理。
11. 补测试或至少手工验证分页、过滤、快照写入、编辑后历史快照不变、无快照返回 `task: null`、单条删除、删除后不可见、无线程归属限制场景。
