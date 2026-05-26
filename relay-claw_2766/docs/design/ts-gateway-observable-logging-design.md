# TS Gateway 用户可观测日志设计方案

**文档状态**: 已实现并通过验证
**编写日期**: 2026-05-20
**适用范围**: OfficeClaw TS Gateway (`packages/api`)
**参考资料**: `/Users/lucheng/Downloads/转发：TS版Gateway日志模式与方案/logs-new.md`

## 1. 背景

原始 JiuwenClaw 日志方案定义了用户可观测日志能力，核心目标是把日志分成三类：

| 类型 | 标记 | 含义 |
| --- | --- | --- |
| 关键用户日志 | `[USER]` / `user_visible=critical` | 用户请求进入、被接受、执行完成、执行失败、权限决策等用户关心的关键状态 |
| 过程用户日志 | `[USER_PROGRESS]` / `user_visible=progress` | 队列、路由、流式消息、工具事件等用户可感知的执行进度 |
| 技术内部日志 | 无标记 | HTTP 请求、调试、usage、sidecar 状态等内部工程日志 |

TS Gateway 没有直接照搬 Python 方案中的文件分流和 formatter 体系，而是在现有 `pino` 日志基础上增加结构化字段和兼容配置，保持现有日志链路稳定。

## 2. 设计目标

1. 在 TS Gateway 关键链路中输出用户可观测日志。
2. 同时支持机器可解析字段和文本 Tag。
3. 保持普通技术日志不被污染，不输出 `user_visible: null` 这类噪声字段。
4. 与 OfficeClaw 命名兼容，并保留 JiuwenClaw 环境变量兼容入口。
5. 不修改运行时配置文件，默认行为向后兼容。

## 3. 实现概览

### 3.1 日志字段

新增字段：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `user_visible` | `critical` / `progress` | 用户可见等级 |
| `user_tag` | `[USER]` / `[USER_PROGRESS]` | 便于文本 grep 的 Tag |
| `component` | `gateway` / `agent_server` / `channel` / `permissions` | 组件分类 |
| `module` | `routes/messages` | 已有模块名，继续保留 |

示例：

```json
{
  "module": "routes/messages",
  "component": "gateway",
  "threadId": "thread_xxx",
  "user_visible": "critical",
  "user_tag": "[USER]",
  "msg": "[Messages] User message received"
}
```

普通技术日志不携带 `user_visible` 和 `user_tag`。

### 3.2 配置项

实现位置：[packages/api/src/infrastructure/logger.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/infrastructure/logger.ts)

| OfficeClaw 环境变量 | JiuwenClaw 兼容变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OFFICE_CLAW_LOG_FORMAT` | `JIUWENCLAW_LOG_FORMAT` | `json` | 支持 `text` / `json` / `dual`，当前 TS 侧保留解析能力 |
| `OFFICE_CLAW_LOG_CONSOLE_ENABLED` | `JIUWENCLAW_LOG_CONSOLE_ENABLED` | `true` | 是否输出 stdout |
| `OFFICE_CLAW_LOG_FILE_ENABLED` | `JIUWENCLAW_LOG_FILE_ENABLED` | `true` | 是否输出文件日志 |
| `OFFICE_CLAW_LOG_USER_VISIBLE` | `JIUWENCLAW_LOG_USER_VISIBLE` | `true` | 是否输出 `[USER]` |
| `OFFICE_CLAW_LOG_USER_PROGRESS_VISIBLE` | `JIUWENCLAW_LOG_USER_PROGRESS_VISIBLE` | `true` | 是否输出 `[USER_PROGRESS]` |
| `OFFICE_CLAW_LOG_INCLUDE_COMPONENT` | `JIUWENCLAW_LOG_INCLUDE_COMPONENT` | `true` | 是否补充 `component` |

既有 `OFFICE_CLAW_LOG_DISABLE_FILE=1` 仍然有效，并优先关闭文件日志。

### 3.3 归一化逻辑

`normalizeObservableLogObject()` 负责：

1. 只接受 `critical` / `progress` 两个有效值。
2. 把 `userVisible` 兼容字段归一为 `user_visible`。
3. 根据配置生成 `user_tag`。
4. 无效或空值直接删除，避免 null-like 噪音。
5. 根据 `module` 推断 `component`。

调用方式：

```ts
log.info(
  userVisibleFields('critical', {
    threadId,
    targetAgents,
  }),
  '[Messages] User message received',
);
```

## 4. 埋点范围

### 4.1 网关消息入口

文件：[packages/api/src/routes/messages.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/routes/messages.ts)

| 场景 | 类型 | 消息 |
| --- | --- | --- |
| 收到用户消息 | critical | `[Messages] User message received` |
| 消息进入待执行队列 | progress | `[Messages] User message queued` |
| 队列已满 | critical | `[Messages] Invocation queue full` |
| 用户消息被接受处理 | critical | `[Messages] User message accepted for processing` |
| Agent 路由开始 | progress | `[Messages] Agent routing started` |
| Agent 路由完成 | critical | `[Messages] Agent routing completed` |
| Agent 路由失败 | critical | `[Messages] Agent routing failed` |

### 4.2 调用队列和执行器

文件：

- [InvocationQueue.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/domains/agents/services/agents/invocation/InvocationQueue.ts)
- [QueueProcessor.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/domains/agents/services/agents/invocation/QueueProcessor.ts)
- [invoke-single-agent.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts)

| 场景 | 类型 |
| --- | --- |
| invocation 入队 | progress |
| 队列满 | critical |
| 队列执行开始 | progress |
| invocation 创建 | progress |
| invocation 完成 | critical |
| invocation 失败 | critical |

### 4.3 权限、渠道和 WebSocket

文件：

- [authorization.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/routes/authorization.ts)
- [ConnectorRouter.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/infrastructure/connectors/ConnectorRouter.ts)
- [SocketManager.ts](/Users/lucheng/Projects/relay-claw-new/packages/api/src/infrastructure/websocket/SocketManager.ts)

| 场景 | 类型 |
| --- | --- |
| 用户审批权限 | critical |
| Connector 消息路由 | critical |
| WebSocket 进度/文本/工具事件分发 | progress |
| WebSocket done/error 分发 | critical |

## 5. 组件分类规则

`inferLogComponent()` 根据模块名推断：

| 条件 | component |
| --- | --- |
| `routes/*`、`ws`、`queue` | `gateway` |
| `connector`、`adapter`、`streaming-outbound` | `channel` |
| `authorization`、`permission` | `permissions` |
| `agent`、`route-`、`invocation` | `agent_server` |
| 其他 | `gateway` |

## 6. 与原始方案的差异

| 原始 JiuwenClaw 方案 | TS Gateway 本次实现 |
| --- | --- |
| Python logging Filter / Formatter | Pino `formatters.log` / `formatters.bindings` |
| `gateway.log` / `channel.log` / `agent_server.log` 分文件输出 | 沿用现有 TS 日志文件轮转，不新增文件分流 |
| 工具层 note/alarm/memory/multi-session 内部日志 | 不在 TS Gateway 改动范围，本次主要覆盖 Gateway 到 Agent 调用边界 |
| YAML 配置优先 | 不修改运行时配置文件，使用环境变量控制 |

## 7. 验收标准

1. 用户发起 Web 消息后，日志中有 `[USER]` 关键节点。
2. 执行过程和流式返回中有 `[USER_PROGRESS]` 进度节点。
3. 普通 HTTP、usage、sidecar、debug 日志没有用户 Tag。
4. 无效 `user_visible` 不输出。
5. 后端 build 和单测通过。
6. 鼠标点击 Web 端真实链路测试通过。
