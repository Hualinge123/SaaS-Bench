# 编辑定时任务接口设计方案

## 背景

当前定时任务管理核心路由在 `packages/api/src/routes/schedule.ts`，调度执行由 `TaskRunnerV2` 驱动，动态任务定义持久化在 SQLite 表 `dynamic_task_defs`。

现有接口已经支持：

```http
GET    /api/schedule/tasks
POST   /api/schedule/tasks
DELETE /api/schedule/tasks/:id
PATCH  /api/schedule/tasks/:id
```

但当前 `PATCH /api/schedule/tasks/:id` 只支持启用 / 禁用动态任务，即请求体只能传：

```json
{
  "enabled": false
}
```

它不能修改任务的触发规则、模板参数、展示信息或投递线程。因此如果用户想把“每天 9 点提醒我”改成“每天 10 点提醒我”，目前只能删除旧任务再创建新任务。

## 目标

将现有接口扩展为完整的动态任务编辑接口：

```http
PATCH /api/schedule/tasks/:id
```

支持编辑：

- `enabled`：启用 / 禁用状态。
- `trigger`：触发规则，包括 `interval`、`cron`、`once`。
- `params`：模板参数。
- `display`：任务展示信息。
- `deliveryThreadId`：任务执行结果投递线程。

同时保持现有启停调用兼容：只传 `{ "enabled": false }` 仍然表示暂停任务。

## 非目标

本次设计不做以下事情：

- 不支持编辑内置任务，只支持 `source = dynamic` 的用户创建任务。
- 不支持修改 `templateId`。
- 不新增 SQLite 表或字段。
- 不重写 `TaskRunnerV2` 的调度模型。
- 不改变 run ledger 历史记录语义。
- 不支持批量编辑。
- 不在本接口中删除任务或清理执行记录。

`templateId` 不允许修改的原因是：模板决定了 `params` 语义和 `template.createSpec()` 的运行逻辑。如果要更换模板，应删除旧任务后重新创建。

## 现有实现判断

### 路由层

当前 `PATCH /api/schedule/tasks/:id` 位于 `packages/api/src/routes/schedule.ts`，只读取 `enabled` 字段：

```ts
const body = (request.body ?? {}) as { enabled?: boolean };

if (typeof body.enabled !== 'boolean') {
  reply.status(400);
  return { error: 'Missing enabled field' };
}
```

然后调用：

```ts
dynamicTaskStore.setEnabled(id, body.enabled);
taskRunner.setDynamicEnabled(id, body.enabled);
```

该流程只修改启停状态，无法让新的 `trigger`、`params`、`display` 或 `deliveryThreadId` 生效。

### 存储层

`DynamicTaskStore` 目前只有：

- `insert(def)`
- `getAll()`
- `getById(id)`
- `remove(id)`
- `setEnabled(id, enabled)`
- `removeByThreadId(threadId)`

没有通用更新方法。

### 运行时层

`TaskRunnerV2` 当前支持：

- `register(task)`：注册内置任务。
- `registerDynamic(task, dynamicDefId, enabled)`：注册动态任务。
- `setDynamicEnabled(taskId, enabled)`：切换动态任务启停。
- `unregister(taskId)`：注销任务并清理 timer。
- `hydrateDynamic(store, templateGetter)`：从 SQLite 恢复动态任务。

其中 `setDynamicEnabled()` 只控制 timer 和 runtime enabled map，不会替换已有 `TaskSpec_P1`，所以不能用于完整编辑任务。

## 接口定义

### `PATCH /api/schedule/tasks/:id`

编辑动态任务。

#### 路径参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 动态任务 ID |

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `enabled` | `boolean` | 否 | `true` 启用，`false` 禁用；不传则保持原状态 |
| `trigger` | `TriggerSpec` | 否 | 新触发规则；支持 `interval` / `cron` / `once` |
| `params` | `object` | 否 | 新模板参数，必须是 plain object |
| `display` | `object` | 否 | 新展示信息，可传 `{ label, category, description, subjectKind }` 中的任意字段 |
| `deliveryThreadId` | `string \| null` | 否 | 新投递线程；`null` 表示清空投递线程 |

#### 字段更新语义

- 未传字段保持原值。
- `params` 采用整体替换语义，不做深度 merge。
- `display` 采用浅合并语义，只传 `label` 时保留旧 `category`、`description`、`subjectKind`。
- `trigger` 采用整体替换语义。
- `deliveryThreadId` 传 `null` 表示清空；不传表示保持原值。
- `enabled` 不传表示保持原状态。

#### 请求示例

```json
{
  "enabled": true,
  "trigger": {
    "type": "cron",
    "expression": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai"
  },
  "params": {
    "message": "每天 9 点提醒我看项目日报"
  },
  "display": {
    "label": "工作日日报提醒",
    "description": "每个工作日上午提醒查看日报"
  },
  "deliveryThreadId": "thread-abc123"
}
```

#### 响应体

```json
{
  "success": true,
  "task": {
    "id": "dyn-1777109400000-a1b2c3",
    "templateId": "reminder",
    "trigger": {
      "type": "cron",
      "expression": "0 9 * * 1-5",
      "timezone": "Asia/Shanghai"
    },
    "params": {
      "message": "每天 9 点提醒我看项目日报"
    },
    "display": {
      "label": "工作日日报提醒",
      "category": "thread",
      "description": "每个工作日上午提醒查看日报"
    },
    "deliveryThreadId": "thread-abc123",
    "enabled": true
  }
}
```

## 校验规则

### 请求体校验

- 请求体至少包含一个可编辑字段。
- `enabled` 如果传入，必须是 boolean。
- `trigger` 如果传入，必须通过现有 `normalizeTriggerSpec()` 校验。
- `params` 如果传入，必须是 plain object，不能是 `null`、数组或 primitive。
- `display` 如果传入，必须是 plain object。
- `display.label` 如果传入，必须是非空字符串。
- `display.category` 如果传入，必须是合法 `DisplayCategory`。
- `display.subjectKind` 如果传入，必须是合法 `SubjectKind`。
- `deliveryThreadId` 如果传入，只能是 string 或 `null`。

### TriggerSpec 校验

复用创建任务接口已有逻辑：

- `interval.ms` 必须是有限数字，且 `>= 10000`。
- `cron.expression` 必须是非空字符串。
- `cron.timezone` 可选，传入时 trim 后保存。
- `once` 支持 `delayMs` 或 `fireAt`。
- `once.delayMs` 必须是有限数字，且 `>= 1000`。
- `once.fireAt` 必须是未来 epoch ms。
- `once.delayMs` 会被后端归一化为绝对 `fireAt`。

## 权限规则

继续复用 `resolveScheduleCaller()`。

### Browser 调用方

Browser 调用方必须满足：

1. 能访问当前任务的旧 `deliveryThreadId`。
2. 如果请求传入新的 `deliveryThreadId`，也必须能访问新线程。

如果任务当前没有 `deliveryThreadId`，browser 调用方可以编辑；如果绑定新线程，则必须拥有新线程访问权。

### Callback 调用方

Callback 调用方只能编辑与当前 invocation 线程一致的任务：

- 如果旧任务有 `deliveryThreadId`，必须等于 `caller.record.threadId`。
- 如果请求传入新的 `deliveryThreadId`，必须等于 `caller.record.threadId`。
- 不允许 callback 调用方把任务改到其他线程。

## 存储层设计

在 `DynamicTaskStore` 中新增更新方法：

```ts
update(
  id: string,
  def: Pick<DynamicTaskDef, 'trigger' | 'params' | 'display' | 'deliveryThreadId' | 'enabled'>,
): boolean
```

使用现有 `dynamic_task_defs` 表字段即可，不需要新增 migration：

```sql
UPDATE dynamic_task_defs
SET trigger_json = ?,
    params_json = ?,
    display_json = ?,
    delivery_thread_id = ?,
    enabled = ?
WHERE id = ?
```

返回值表示是否更新到记录：

- `true`：更新成功。
- `false`：任务不存在。

## TaskRunnerV2 运行时设计

编辑任务不能只调用 `TaskRunnerV2.setDynamicEnabled()`。

原因是 `setDynamicEnabled()` 只改变运行时启停状态，不替换已有 `TaskSpec_P1`。如果任务的 `trigger`、`params`、`display` 或 `deliveryThreadId` 已变化，旧 `TaskSpec_P1` 仍然持有旧配置，timer 也仍按旧 trigger 调度。

因此应在 `TaskRunnerV2` 增加动态任务替换能力：

```ts
replaceDynamic(task: TaskSpec_P1<unknown>, dynamicDefId: string, enabled: boolean): void {
  this.unregister(task.id);
  this.registerDynamic(task, dynamicDefId, enabled);
}
```

该方法复用现有能力：

- `unregister()` 负责清理旧 task、旧 timer、running 状态、tickCount、lastRunAt、dynamic map。
- `registerDynamic()` 负责包装 enabled 逻辑、登记 dynamicDefId、写入 runtime enabled map，并在 runner 已启动时重新 schedule。

### 与 `setDynamicEnabled()` 的关系

- 只修改 `enabled` 时，可以继续走 `setDynamicEnabled()` 快路径。
- 修改了 `trigger`、`params`、`display` 或 `deliveryThreadId` 时，必须走 `replaceDynamic()`。
- 为了保持逻辑简单，也可以所有 PATCH 都统一走 `replaceDynamic()`；但只启停任务时没有必要重建 `TaskSpec_P1`。

推荐实现：

- enabled-only 请求继续使用现有流程，降低行为变化。
- 非 enabled-only 请求使用完整 replace 流程。

## Route 层处理流程

1. 鉴权，允许 `browser` 和 `callback`。
2. 检查 `dynamicTaskStore` 和 `templateRegistry` 是否存在，不存在返回 `501`。
3. 读取旧定义：`dynamicTaskStore.getById(id)`。
4. 旧定义不存在返回 `404`。
5. 校验调用方是否有权编辑旧任务线程。
6. 解析并校验请求体。
7. 如果请求体为空，返回 `400`。
8. 如果传入新 `deliveryThreadId`，校验调用方是否有权绑定新线程。
9. 将 patch 与旧定义合并成 `updatedDef`。
10. 通过旧 `templateId` 获取模板；模板不存在返回 `500`。
11. 通过模板构造新 spec：

```ts
const spec = template.createSpec(updatedDef.id, {
  trigger: updatedDef.trigger,
  params: updatedDef.params,
  deliveryThreadId: updatedDef.deliveryThreadId,
});
spec.display = updatedDef.display;
```

12. 更新 SQLite：`dynamicTaskStore.update(id, updatedDef)`。
13. 如果只是 enabled-only，调用 `taskRunner.setDynamicEnabled(id, updatedDef.enabled)`。
14. 否则调用 `taskRunner.replaceDynamic(spec, id, updatedDef.enabled)`。
15. 返回更新后的任务定义。

## 一致性与回滚策略

推荐采用“先构造 spec，再更新 DB，再替换 runtime”的顺序：

1. 先在内存中 merge 并构造新 spec，提前暴露 trigger 或模板参数错误。
2. DB 更新失败时，不修改 runtime。
3. DB 更新成功后，替换 runtime。
4. runtime 替换失败时，应回滚 DB 到旧定义，并尝试恢复旧 runtime spec。

伪流程：

```ts
const oldDef = dynamicTaskStore.getById(id);
const updatedDef = mergeDynamicTaskDef(oldDef, patch);
const oldSpec = createSpec(oldDef);
const newSpec = createSpec(updatedDef);

const dbUpdated = dynamicTaskStore.update(id, updatedDef);
if (!dbUpdated) return notFound();

try {
  taskRunner.replaceDynamic(newSpec, id, updatedDef.enabled);
} catch (err) {
  dynamicTaskStore.update(id, oldDef);
  try {
    taskRunner.replaceDynamic(oldSpec, id, oldDef.enabled);
  } catch (restoreErr) {
    app.log.error({ err: restoreErr }, '[scheduler] failed to restore old dynamic task after edit failure');
  }
  throw err;
}
```

如果选择 enabled-only 快路径，则：

1. 先 `dynamicTaskStore.setEnabled(id, enabled)`。
2. 再 `taskRunner.setDynamicEnabled(id, enabled)`。
3. 如果 runtime 缺失，可复用当前代码里的 fallback：从 store 读 def，`template.createSpec()` 后 `registerDynamic()`。

## once 任务编辑语义

一次性任务编辑需要特别明确：

- 如果 once 任务尚未执行且仍存在于 `dynamic_task_defs`，可以编辑。
- 如果 once 任务已经执行完成，`TaskRunnerV2.retireOnceTask()` 会删除持久化定义，此时编辑返回 `404`。
- 修改 once trigger 时，新的 `delayMs` 或 `fireAt` 从编辑请求发生时重新计算。
- 如果服务重启后 hydrate 发现 once 任务已错过窗口，任务会被记录为 `SKIP_MISSED_WINDOW` 并删除，此后编辑也返回 `404`。

## 错误码

| 状态码 | 说明 |
|---|---|
| `400` | 请求体为空 / 字段类型错误 / trigger 校验失败 / params 不是 plain object / display 字段非法 / spec 构造失败 |
| `403` | 浏览器用户不拥有当前或新的目标线程 / callback 调用者试图编辑其他线程任务 |
| `404` | 动态任务不存在，或 once 任务已退休 |
| `500` | 模板缺失 / 数据库更新失败 / 运行时替换失败且回滚已处理 |
| `501` | 动态任务系统未配置 |

## MCP 工具同步设计

新增 MCP 工具：

```ts
office_claw_update_scheduled_task
```

用于 agent callback 编辑动态任务。

参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | `string` | 是 | 动态任务 ID |
| `enabled` | `boolean` | 否 | 是否启用 |
| `trigger` | `string` | 否 | JSON 字符串形式的 TriggerSpec |
| `params` | `string` | 否 | JSON 字符串形式的模板参数对象 |
| `deliveryThreadId` | `string` | 否 | 新投递线程 |
| `label` | `string` | 否 | 新展示名称 |
| `category` | `string` | 否 | 新展示分类 |
| `description` | `string` | 否 | 新描述 |

实现要求：

- 复用现有 `validateTriggerConfig()` 校验 trigger JSON。
- `params` 必须解析为 plain object。
- 将 `label`、`category`、`description` 组装为 `display` patch。
- 通过 `PATCH /api/schedule/tasks/:id` 调用后端。
- 现有 `office_claw_set_scheduled_task_enabled` 可以保留，作为 pause/resume 的语义化快捷工具。

## 测试建议

API 层测试：

- enabled-only 请求保持兼容。
- 修改 `interval` trigger 后 runtime 使用新间隔。
- 修改 `cron` trigger 后能重新注册。
- 修改 `once.delayMs` 后保存为新的 `fireAt`。
- 修改 `params` 后旧参数被整体替换。
- 修改 `display.label` 时其他 display 字段保留。
- 修改 `deliveryThreadId` 时校验旧线程和新线程权限。
- callback 不能编辑其他线程任务。
- 内置任务不可编辑。
- 任务不存在返回 `404`。
- 模板不存在时返回 `500`。

存储层测试：

- `DynamicTaskStore.update()` 正确写入 JSON 字段。
- 更新不存在的任务返回 `false`。

运行时测试：

- `TaskRunnerV2.replaceDynamic()` 会清理旧 timer 并注册新 timer。
- disabled 任务 replace 后仍保持 disabled，不应立即 schedule。
- runner 已启动时 replace 后能自动 schedule 新任务。
- once 任务 replace 后使用新的 `fireAt`。

## 实施步骤

1. 在 `DynamicTaskStore` 增加 `update()`。
2. 在 `TaskRunnerV2` 增加 `replaceDynamic()`。
3. 在 `schedule.ts` 中扩展 `PATCH /api/schedule/tasks/:id`。
4. 抽出 route 层辅助函数：
   - `normalizeScheduleTaskPatch()`
   - `mergeDynamicTaskDef()`
   - `createDynamicSpecFromDef()`
   - `callerCanEditDynamicTask()`
5. 新增 MCP 工具 `office_claw_update_scheduled_task`。
6. 补 API、store、runtime、MCP 测试。
7. 实现后更新 `docs/schedule-api.md`，把 `PATCH /api/schedule/tasks/:id` 从“启停接口”正式改为“编辑动态任务接口”。
