# TS Gateway 用户可观测日志测试报告

**测试日期**: 2026-05-20
**测试环境**: macOS，本地开发环境
**仓库路径**: `/Users/lucheng/Projects/relay-claw-new`
**启动命令**: `pnpm --dir packages/green-package dev`
**前端地址**: `http://127.0.0.1:3003`
**后端地址**: `http://127.0.0.1:3004`
**日志文件**: `data/logs/api/api.2026-05-20.1.log`

## 1. 测试目标

验证 TS Gateway 用户可观测日志能力是否满足以下标准：

1. 关键用户操作输出 `[USER]` / `user_visible=critical`。
2. 执行进度输出 `[USER_PROGRESS]` / `user_visible=progress`。
3. 普通技术日志不携带用户可见 Tag。
4. Web 页面真实点击发送任务后，完整执行链路可观测。
5. 之前出现的 Huawei MaaS credential 报错不再复现。
6. 后端构建和日志单测通过。

## 2. 测试输入

来源：`/Users/lucheng/Downloads/转发：TS版Gateway日志模式与方案/user_view_tag_logs_WebTestCases.md`

```text
请帮我完成以下任务：

1. 创建一个备忘录，标题是"项目会议记录"，内容是"讨论了产品迭代计划，决定了下周开始开发新功能"

2. 查询一下备忘录中是否有"会议"相关的记录

3. 学习一条经验：当用户要求创建备忘录时，需要先确认标题和内容是否完整

4. 使用协程功能，同时查询两组信息：
   - 第一组：查询备忘录中"项目"
   - 第二组：查询备忘录中"开发"
   然后汇总结果告诉我

5. 设置一个提醒闹钟，标题是"下周会议提醒"，时间是下周一上午10点

（注意：如果某些操作需要授权，请帮我审批通过）
```

## 3. 测试步骤

1. 使用 `pnpm --dir packages/green-package dev` 启动绿色包开发环境。
2. 用 Chrome 打开 `http://127.0.0.1:3003`。
3. 通过鼠标点击输入框。
4. 粘贴测试输入。
5. 点击发送按钮。
6. 等待 Agent 执行完成。
7. 检查页面执行状态、审批状态和日志文件。
8. 停止开发服务。
9. 执行后端 build 和日志单测。

## 4. 执行结果

### 4.1 Web 真实点击链路

| 项目 | 结果 |
| --- | --- |
| 页面打开 | 通过 |
| 输入框点击 | 通过 |
| 测试用例粘贴 | 通过 |
| 发送按钮点击 | 通过 |
| 任务进入执行 | 通过 |
| Agent 最终完成 | 通过 |
| 权限待审批项 | 无待审批 |
| 队列状态 | 执行后队列为空 |

执行时间：

| 节点 | 时间 |
| --- | --- |
| 用户消息收到 | `2026-05-20T06:48:10.105Z` |
| 调用创建 | `2026-05-20T06:48:10.366Z` |
| Jiuwen 请求完成 | `2026-05-20T06:51:59.330Z` |
| Invocation 完成 | `2026-05-20T06:51:59.334Z` |
| Agent 路由完成 | `2026-05-20T06:51:59.343Z` |

### 4.2 关键日志抽样

日志文件：`data/logs/api/api.2026-05-20.1.log`

| 行号 | 类型 | 日志 |
| --- | --- | --- |
| 1666 | `[USER]` | `[Messages] User message received` |
| 1667 | `[USER]` | `[Messages] User message accepted for processing` |
| 1669 | `[USER_PROGRESS]` | `[Messages] Agent routing started` |
| 1678 | `[USER_PROGRESS]` | `Created invocation` |
| 6600 | `[USER]` | `Invocation completed` |
| 6601 | `[USER]` | WebSocket `messageType=done` 分发 |
| 6606 | `[USER]` | `[Messages] Agent routing completed` |

关键字段示例：

```json
{
  "module": "routes/messages",
  "component": "gateway",
  "threadId": "thread_mpdpa2spi9zxj88d",
  "user_visible": "critical",
  "user_tag": "[USER]",
  "msg": "[Messages] User message received"
}
```

```json
{
  "module": "ws",
  "component": "gateway",
  "threadId": "thread_mpdpa2spi9zxj88d",
  "messageType": "text",
  "user_visible": "progress",
  "user_tag": "[USER_PROGRESS]",
  "msg": "[SocketManager] agent message dispatched"
}
```

### 4.3 Tag 数量

从 `2026-05-20T06:48` 本轮请求开始统计：

| 指标 | 结果 |
| --- | --- |
| `[USER]` + `[USER_PROGRESS]` 总数 | 1964 条 |
| 关键完成日志 | 已出现 |
| 过程进度日志 | 已出现 |
| 普通技术日志无 Tag | 已确认 |

说明：流式文本、系统信息、工具调用事件会产生大量 `[USER_PROGRESS]`，符合“过程日志”预期。

### 4.4 MaaS 问题回归验证

本轮请求时间段：`2026-05-20T06:48` 至 `2026-05-20T06:51`。

检查关键字：

- `MaaS`
- `maas`
- `credential not available`
- `auth info is missing`
- `model_app_key`
- `model_app_secret`

结果：本轮请求时间段内未发现 Huawei MaaS credential 相关错误。

历史日志中仍保留早先失败记录，例如 `2026-05-20T03:40`、`03:43`、`03:45`、`03:48` 的 `huawei_maas protocol configured but credential not available`，这些不属于本轮启动和测试。

## 5. 自动化验证

### 5.1 后端构建

命令：

```bash
pnpm --filter @openjiuwen/relay-api-server run build
```

结果：通过。

### 5.2 日志单测

命令：

```bash
OFFICE_CLAW_LOG_DISABLE_FILE=1 node --test packages/api/test/observable-logger.test.js
```

结果：

```text
tests 5
pass 5
fail 0
duration_ms 87.397375
```

覆盖点：

1. OfficeClaw 与 JiuwenClaw 兼容环境变量解析。
2. `critical` 日志归一化和 `[USER]` Tag。
3. `progress` 日志归一化和 `[USER_PROGRESS]` Tag 开关。
4. 无效 `user_visible` 不输出。
5. 主要 TS Gateway 模块组件推断。

## 6. 遗留与风险

| 项目 | 说明 | 影响 |
| --- | --- | --- |
| 截图留证 | `screencapture` 因系统权限未生成图片 | 不影响日志和功能验收 |
| Python/JiuwenClaw 工具内部日志 | 本次 TS Gateway 未修改 note/alarm/memory/multi-session 工具内部日志 | 这些细粒度工具日志仍需由 JiuwenClaw 侧方案覆盖 |
| `context.usage` unknown event warning | 执行中出现 `jiuwen unknown event type — possible protocol drift` | 非本次日志 Tag 功能阻断项 |
| HTTP 429 重试 | 页面执行中出现一次模型限流重试并恢复 | 最终完成，不阻断验收 |

## 7. 验收结论

本次 TS Gateway 用户可观测日志开发通过验收：

1. Web 鼠标点击真实链路完成。
2. `[USER]` 关键日志可查询。
3. `[USER_PROGRESS]` 过程日志可查询。
4. 普通技术日志未被错误标记。
5. 本轮未复现 MaaS credential 错误。
6. 后端 build 和日志单测均通过。
