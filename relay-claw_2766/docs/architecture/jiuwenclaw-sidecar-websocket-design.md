# OfficeClaw AI 拉起 JiuwenClaw 与 Sidecar/WebSocket 调用设计文档

## 1. 文档目标

本文回答三个核心问题：

1. `OfficeClaw` 是如何把一个配置为 `relayclaw` 的智能体，实例化成可调用的 JiuwenClaw 运行时的。
2. `OfficeClaw` 是如何拉起 JiuwenClaw sidecar 进程，并在多次请求之间复用它的。
3. `OfficeClaw` 是如何通过 WebSocket 把请求发送给 JiuwenClaw，再把流式结果映射回 OfficeClaw 内部消息流的。

本文只基于当前仓库代码说明真实实现，不描述理想状态或历史方案。

## 2. 一句话总览

在当前实现中，`OfficeClaw` 对 JiuwenClaw 的调用链路是：

`配置(provider=relayclaw)`  
`-> packages/api/src/index.ts` 创建 `RelayClawAgentService`  
`-> RelayClawAgentService` 计算 scope，必要时拉起 sidecar  
`-> sidecar 启动 vendor/jiuwenclaw/jiuwenclaw/app.py`  
`-> JiuwenClaw 进程内部启动 AgentWebSocketServer + WebChannel`  
`-> OfficeClaw 连接 AgentWebSocketServer(ws://127.0.0.1:AGENT_PORT)`  
`-> 发送 chat.send / history.get 等请求帧`  
`-> 接收 chat.delta / chat.tool_call / chat.final 等流式事件`  
`-> 映射为 OfficeClaw 的 `AgentMessage` 继续进入线程、消息、UI 和回调链路`

最关键的一点：

- OfficeClaw 真正用于“调用 JiuwenClaw”的 WebSocket 端口，是 `AGENT_PORT` 对应的 `AgentWebSocketServer`。
- `WEB_PORT` 对应的 `WebChannel` 主要服务 JiuwenClaw 自己的 Web/桌面前端，不是 OfficeClaw 发起模型请求的主通道。
- sidecar 在这里不是一个独立中间件名字，而是“由 OfficeClaw 管理、随请求自动拉起/复用的 JiuwenClaw 本地子进程”。

## 3. 代码入口总图

### 3.1 OfficeClaw 侧入口

- `packages/api/src/index.ts`
  - 根据智能体配置里的 `provider` 创建对应 `AgentService`
  - 当 `provider === 'relayclaw'` 时，实例化 `RelayClawAgentService`
- `packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts`
  - 对外暴露统一的 `invoke()` 异步流接口
  - 负责 scope、sidecar、连接、请求发送、事件消费
- `packages/api/src/domains/agents/services/agents/providers/relayclaw-sidecar.ts`
  - 真正负责 spawn JiuwenClaw 进程
  - 负责探活、日志缓存、重启与复用
- `packages/api/src/domains/agents/services/agents/providers/relayclaw-connection.ts`
  - 负责 Node 侧 WebSocket 长连接
  - 负责 `connection.ack` 握手和按 `request_id` 分发流式帧
- `packages/api/src/domains/agents/services/agents/providers/relayclaw-event-transform.ts`
  - 将 JiuwenClaw 事件帧转换为 OfficeClaw 内部 `AgentMessage`
- `packages/api/src/domains/agents/services/agents/invocation/invoke-single-agent.ts`
  - 负责把账号信息、模型上下文窗口、工作目录、系统提示词、MCP 回调环境等注入到 `AgentServiceOptions`

### 3.2 JiuwenClaw 侧入口

- `vendor/jiuwenclaw/jiuwenclaw/app.py`
  - JiuwenClaw 主进程入口
  - 启动 `AgentWebSocketServer`
  - 启动内部 `WebSocketAgentServerClient`
  - 创建 `MessageHandler`、`ChannelManager`、`WebChannel`
- `vendor/jiuwenclaw/jiuwenclaw/agentserver/agent_ws_server.py`
  - OfficeClaw 实际连接的 Agent Server WebSocket 服务端
- `vendor/jiuwenclaw/jiuwenclaw/channel/web_channel.py`
  - JiuwenClaw 自己的 Web UI/Web 前端通道
- `vendor/jiuwenclaw/jiuwenclaw/agentserver/interface.py`
  - `JiuWenClaw` 核心实现
  - 处理 `project_dir`、`office_claw_mcp`、系统提示词、工具注册、流式输出等逻辑

## 4. 从 智能体 配置到 RelayClawAgentService

### 4.1 配置层

仓库模板中，`assistant`、`office`、`agentteams` 等角色都可以配置为：

```json
{
  "provider": "relayclaw",
  "defaultModel": "glm-5",
  "cli": {
    "command": "jiuwenclaw-app",
    "outputFormat": "json"
  }
}
```

这说明“这只智能体的底层执行引擎不是 Claude/Codex/Gemini CLI，而是 JiuwenClaw”。

### 4.2 服务实例化

`packages/api/src/index.ts` 在注册 agent service 时做了以下判断：

- 如果环境变量 `CAT_<AGENT_ID>_WS_URL` 存在，则视为外部已运行 JiuwenClaw，`autoStart=false`
- 否则，默认 `autoStart=true`，由 OfficeClaw 自己拉起本地 sidecar

实例化时还会注入：

- `appDir`
- `executablePath`
- `pythonBin`
- `homeDir`
- `modelName`

因此，`RelayClawAgentService` 是 JiuwenClaw 在 OfficeClaw 内部的适配层，不是一个单纯的“WebSocket 客户端”。

## 5. Sidecar 的定义与职责

### 5.1 什么是 sidecar

在这个项目里，sidecar 指：

- 由 `OfficeClaw` 主进程按需拉起的 JiuwenClaw 子进程
- 默认在本机 `127.0.0.1` 上监听端口
- 生命周期由 `RelayClawAgentService` 控制
- 按 scope 复用，而不是每个请求都新开一个进程

它的职责包括：

- 隔离不同 provider profile / API key / model 的 JiuwenClaw 运行环境
- 给 JiuwenClaw 注入 OfficeClaw 当前请求的上下文，例如 API base、API key、工作目录、MCP 回调能力
- 通过本地 WebSocket 暴露统一调用接口

### 5.2 为什么要做 sidecar

这么设计主要有五个原因：

1. JiuwenClaw 本身是一个完整 agent runtime，不适合每次请求冷启动后立刻退出。
2. JiuwenClaw 有自己的会话、工具、技能、内存、MCP、工作目录等运行态，复用进程能减少初始化成本。
3. OfficeClaw 需要把同一只智能体在多轮对话中的请求，稳定打到同一个 runtime 上。
4. 不同绑定的 provider profile 可能对应不同 API base / key / model，必须做隔离。
5. 本地 WebSocket 是比较稳定的宿主边界，OfficeClaw 不需要直接耦合 JiuwenClaw 内部 Python 对象。

## 6. Sidecar 启动链路

### 6.1 调用开始：`invoke()`

当用户在 OfficeClaw 中 @ 一个 `relayclaw` 智能体时，最终会进入：

- `RelayClawAgentService.invoke(prompt, options)`

这个方法先做三件事：

1. 根据 `channelId`、会话信息和线程上下文生成 `sessionId`
2. 计算当前请求属于哪个 runtime scope
3. 找到或创建这个 scope 对应的运行时对象：
   - `connection`
   - `sidecar`
   - `requestQueues`

### 6.2 Scope 为什么重要

如果 `autoStart=true`，`RelayClawAgentService` 不会把所有请求都打到同一个 JiuwenClaw 进程，而是按下面这些字段算哈希：

- `API_BASE`
- `API_KEY`
- `modelName`

然后把 scope 写成类似：

- `auto:<scopeHash>`

同时为该 scope 分配独立目录：

- `.office-claw/relayclaw/<Id>/scope-<scopeHash>`

这表示：

- 相同模型配置的请求会复用同一个 JiuwenClaw sidecar
- 换了 API key / API base / model 后，会触发新的 sidecar scope

### 6.3 `ensureStarted()` 的启动策略

`DefaultRelayClawSidecarController.ensureStarted()` 的启动顺序如下：

1. 先根据当前请求构造完整 runtime 描述
2. 根据 runtime signature 计算哈希
3. 如果已有 child process，且哈希没变化，并且端口探活成功，则直接复用
4. 如果已有 child process 但 signature 变化，则先停掉旧进程
5. 如果当前已有启动中的 `bootPromise`，则等待同一个启动流程完成
6. 否则真正调用 `start()`

这段逻辑解决了两个典型问题：

- 避免并发请求把同一个 sidecar 启动两次
- 避免 API 配置变化后继续误复用旧进程

## 7. Sidecar 启动时注入了哪些运行环境

### 7.1 基础环境变量

OfficeClaw 拉起 JiuwenClaw 时会构造一组非常关键的环境变量：

- `HOME=<scopeHomeDir>`
- `PYTHONUNBUFFERED=1`
- `WEB_HOST=127.0.0.1`
- `AGENT_PORT=<allocatedAgentPort>`
- `WEB_PORT=<allocatedWebPort>`
- `API_KEY`
- `API_BASE`
- `MODEL_NAME`
- `MODEL_PROVIDER`
- `MODEL_CONTEXT_WINDOW`

这些变量决定了：

- JiuwenClaw 用哪个模型服务
- Agent WebSocket 服务监听在哪个端口
- WebChannel 监听在哪个端口
- 运行期的家目录和 agent 数据落在哪个 scope 下

### 7.2 OfficeClaw 集成相关变量

此外还会注入：

- `JIUWENCLAW_AGENT_ROOT=<homeDir>/agent`
- `JIUWENCLAW_RUNTIME_SKILLS_DIR=<projectRoot>/.office-claw/relayclaw-skill-cache/<id>`
- `JIUWENCLAW_PROJECT_DIR=<workingDirectory>`，如果当前请求带有工作目录
- `JIUWENCLAW_SHARED_SKILLS_DIRS`
- `JIUWENCLAW_DISABLED_SKILLS`

以及 Cat Cafe MCP 相关变量：

- `OFFECE_CLAW_MCP_SERVER_PATH`
- `OFFECE_CLAW_MCP_COMMAND`
- `OFFECE_CLAW_MCP_ARGS_JSON`
- `OFFECE_CLAW_MCP_CWD`
- 还有回调能力相关的 `OFFECE_CLAW_API_URL`、`OFFECE_CLAW_INVOCATION_ID`、`OFFECE_CLAW_CALLBACK_TOKEN` 等

这意味着 sidecar 并不是“裸 JiuwenClaw”，而是一个被 OfficeClaw request context 定制过的 JiuwenClaw runtime。

## 8. 实际拉起了什么进程

### 8.1 启动命令选择

`buildRelayClawLaunchCommand()` 有两种模式：

1. 如果存在打包好的可执行文件
   - 运行 `vendor/jiuwenclaw.exe --desktop-run-app`
2. 否则
   - 运行 `<pythonBin> -m jiuwenclaw.app`

也就是说，开发态通常是 Python 模块启动，安装包/便携版更偏向 exe 启动。

### 8.2 进程 cwd

- exe 模式：`cwd = dirname(executablePath)`
- Python 模式：`cwd = appDir`

这很重要，因为 JiuwenClaw 里很多资源查找、包内文件加载、日志路径、静态资源路径都和当前工作目录/安装形态有关。

## 9. JiuwenClaw 进程内部启动了什么

当 `jiuwenclaw.app` 启动后，`app.py` 里的 `_run()` 会做以下事情：

1. 读取环境变量中的 `AGENT_PORT`、`WEB_HOST`、`WEB_PORT`、`WEB_PATH`
2. 创建 `JiuWenClaw()` 实例
3. 启动 `AgentWebSocketServer(host=127.0.0.1, port=AGENT_PORT)`
4. 在同一进程里再创建一个 `WebSocketAgentServerClient`
5. 让这个内部 client 反向连接刚刚启动的 `AgentWebSocketServer`
6. 基于这个 client 构造 `MessageHandler`
7. 再启动 `WebChannel(host=WEB_HOST, port=WEB_PORT, path=WEB_PATH)`
8. 启动 `ChannelManager`、心跳、cron、各种 channel 动态管理逻辑

这里第一次看代码时很容易困惑，因为 JiuwenClaw 进程内部同时扮演了三种角色：

- `AgentWebSocketServer`
  - 面向 OfficeClaw，是真正的 agent 调用入口
- `WebSocketAgentServerClient`
  - JiuwenClaw 自己进程内的 gateway client，用于把 WebChannel 的请求转进 agent server
- `WebChannel`
  - 面向 JiuwenClaw 自己的浏览器/桌面前端

## 10. 为什么 sidecar 启动探活要看两个端口

OfficeClaw sidecar controller 的 ready 判定分三层：

1. `AGENT_PORT` TCP 通了
2. 日志里出现应用 ready 标记，例如：
   - `[JiuWenClaw] 初始化完成`
   - `WebChannel 已启动`
3. 如果没有明确日志 ready，但 `WEB_PORT` 也通了，也视为 ready

所以当前实现不是只看 `AGENT_PORT`，而是把“JiuwenClaw Agent 可调用”与“JiuwenClaw App 基本完成初始化”一起考虑。

这样做的原因是：

- 单纯 TCP 监听只能说明 socket 打开了，不代表内部工具、配置、web channel、初始化流程都完成了
- Web port ready 通常意味着 app 主循环已经稳定运行

## 11. OfficeClaw 到 JiuwenClaw 的 WebSocket 协议

### 11.1 OfficeClaw 连接哪一个 WebSocket

OfficeClaw 连接的是：

- `ws://127.0.0.1:<AGENT_PORT>`

对应服务端是：

- `vendor/jiuwenclaw/jiuwenclaw/agentserver/agent_ws_server.py`

不是：

- `ws://127.0.0.1:<WEB_PORT>/ws`

后者是给 JiuwenClaw Web UI 用的。

### 11.2 握手

`RelayClawConnectionManager.ensureConnected()` 建立 WebSocket 连接后，会等待第一条关键事件：

```json
{
  "type": "event",
  "event": "connection.ack",
  "payload": {
    "status": "ready"
  }
}
```

只有收到这条 `connection.ack`，OfficeClaw 才会把连接标记为 `serverReady=true`。

这一步非常关键，因为它代表的不是 TCP ready，而是协议级 ready。

### 11.3 OfficeClaw 发出的请求帧

OfficeClaw 给 JiuwenClaw 发的请求，来自 `RelayClawAgentService.buildRequest()`，典型格式如下：

```json
{
  "request_id": "uuid",
  "channel_id": "officeclaw",
  "session_id": "channel_digest_or_cli_session",
  "req_method": "chat.send",
  "params": {
    "query": "用户问题",
    "system_prompt": "OfficeClaw 拼好的请求级系统提示",
    "mode": "agent",
    "project_dir": "/absolute/project/path",
    "files": {
      "uploaded": [
        {
          "type": "image",
          "name": "demo.png",
          "path": "/absolute/upload/path/demo.png"
        }
      ]
    },
    "office_claw_mcp": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "cwd": "/repo/root",
      "env": {
        "OFFECE_CLAW_API_URL": "...",
        "OFFECE_CLAW_CALLBACK_TOKEN": "..."
      }
    }
  },
  "is_stream": true,
  "timestamp": 1710000000.0
}
```

重点字段说明：

- `request_id`
  - 用于把返回帧路由回对应请求队列
- `session_id`
  - 用于 JiuwenClaw 侧会话复用与 session 元数据绑定
- `req_method`
  - 常见是 `chat.send`，也可以是 `history.get`、`chat.interrupt` 等
- `mode`
  - OfficeClaw 这里固定按 agent 模式调用
- `project_dir`
  - 告诉 JiuwenClaw 本轮任务应该在哪个工程目录下工作
- `office_claw_mcp`
  - 把 OfficeClaw MCP server 的请求级连接信息带给 JiuwenClaw

## 12. JiuwenClaw 如何消费这些请求

### 12.1 AgentWebSocketServer 做什么

`AgentWebSocketServer` 收到请求后会：

1. 把 JSON 解析成 `AgentRequest`
2. 根据 `req_method` 做分流
3. 如果是流式请求，调用 `JiuWenClaw.process_message_stream()`
4. 把每个 `AgentResponseChunk` 再序列化回 JSON 发给 OfficeClaw

### 12.2 `project_dir` 的处理规则

`JiuWenClaw._effective_project_dir_for_session()` 的规则是：

1. 某个 `session_id` 第一次收到非空 `project_dir` 时，绑定这个路径
2. 后续请求如果 `project_dir` 为空，则继续复用第一次绑定的目录
3. 如果后续请求给了另一个不同的 `project_dir`，JiuwenClaw 会记录 warning，并保留第一次绑定

这相当于：

- `session_id` 绑定工作目录
- 一个会话不允许在中途 silently 切换项目根目录

这是为了防止多轮会话里 agent 的工作上下文漂移。

### 12.3 `office_claw_mcp` 的处理规则

`JiuWenClaw._register_runtime_tools()` 在每次请求前会调用：

- `ToolManager.register_request_scoped_office_claw_mcp(office_claw_mcp)`

这一步会：

1. 移除旧的 `office-claw*` MCP server
2. 用当前请求里的 command/args/env 重新注册一个请求级 MCP server

这样设计的原因是：

- OfficeClaw callback token、invocationId、userId 等是请求级的，不应在 sidecar 启动时永久固化
- 如果沿用旧 MCP 配置，JiuwenClaw 调回 OfficeClaw 时可能使用过期 token 或错误请求上下文

## 13. JiuwenClaw 返回的流式事件

### 13.1 常见流式事件

JiuwenClaw 返回的是 `AgentResponseChunk` JSON，常见 `payload.event_type` 有：

- `chat.delta`
- `chat.final`
- `chat.tool_call`
- `chat.tool_result`
- `chat.error`
- `chat.processing_status`
- `chat.ask_user_question`
- `todo.updated`
- `context.compressed`

### 13.2 OfficeClaw 如何映射

`relayclaw-event-transform.ts` 中的转换规则大致是：

- `chat.delta` -> `AgentMessage.type = text`
- `chat.tool_call` -> `tool_use`
- `chat.tool_result` -> `tool_result`
- `chat.error` -> `error`
- `chat.processing_status` -> `system_info`
- `chat.ask_user_question` -> `system_info`
- `chat.final` -> 默认不直接发出，作为最终补全文本/完成标记处理

其中 `chat.delta` 如果 `source_chunk_type === 'llm_reasoning'`，会被转成 thinking 类型的系统信息，而不是普通正文文本。

## 14. OfficeClaw 侧如何按请求分发 WebSocket 帧

### 14.1 为什么需要 `requestQueues`

sidecar 是长连接复用的，一个 JiuwenClaw 进程可以连续处理很多请求，所以不能简单用“当前 socket 收到什么就归给当前请求”。

OfficeClaw 通过：

- `Map<requestId, FrameQueue>`

做按请求的帧分发。

流程如下：

1. 每发起一个请求，生成 `requestId`
2. 创建一条 `FrameQueue`
3. 把 `requestId -> queue` 放进 `requestQueues`
4. WebSocket 收到帧后，按 `frame.request_id` 找到对应 queue
5. 当前请求的 `consumeFrames()` 只消费自己的 queue

这样才能支持：

- 长连接复用
- 请求完成与连接寿命解耦
- 延迟帧/串流帧正确路由

### 14.2 请求结束判定

OfficeClaw 侧认为一个请求结束，通常满足以下任一条件：

- `frame.is_complete === true`
- `frame.payload.is_complete === true`
- 连接关闭并注入 transport error

结束后会：

- 生成 `done` 类型消息
- 附带 usage 信息
- 从 `requestQueues` 删除该 requestId

## 15. 这里其实有两层 WebSocket，不要混淆

这是最容易混淆的点。

### 15.1 第一层：OfficeClaw <-> JiuwenClaw AgentServer

用途：

- 真正的 agent 调用通道

监听端口：

- `AGENT_PORT`

服务端：

- `AgentWebSocketServer`

客户端：

- OfficeClaw 的 `RelayClawConnectionManager`

### 15.2 第二层：JiuwenClaw Web 前端 <-> JiuwenClaw WebChannel

用途：

- 给 JiuwenClaw 自己的 Web UI/桌面前端用

监听端口：

- `WEB_PORT`

服务端：

- `WebChannel`

客户端：

- JiuwenClaw 前端页面、桌面容器

### 15.3 它们之间的关系

`WebChannel` 收到前端请求后，会把 `chat.send` 等方法转给 JiuwenClaw 进程内部的 `MessageHandler`，再通过内部 `WebSocketAgentServerClient` 打到同进程里的 `AgentWebSocketServer`。

所以内部实际上是：

`Jiuwen 前端 -> WebChannel -> MessageHandler -> 内部 WebSocketAgentServerClient -> AgentWebSocketServer -> JiuWenClaw`

而 OfficeClaw 走的是更短的一条：

`OfficeClaw -> AgentWebSocketServer -> JiuWenClaw`

## 16. `invoke-single-agent.ts` 在这条链路里做了什么

很多人第一次看 sidecar 代码时会漏掉一个事实：

- sidecar 只负责“怎么启动 JiuwenClaw”
- 真正把“当前用户/线程/工作区/账号配置”转成调用参数的，是 `invoke-single-agent.ts`

它会在调用前注入：

- `callbackEnv.OPENAI_API_KEY`
- `callbackEnv.OPENAI_BASE_URL`
- `callbackEnv.default_headers`
- `callbackEnv.MODEL_CONTEXT_WINDOW`
- `workingDirectory`
- `systemPrompt`
- `uploadDir/contentBlocks`

对于 `relayclaw`，它还专门做了两个处理：

1. `MODEL_CONTEXT_WINDOW` 通过环境变量传给 sidecar
2. 系统提示词不直接拼进用户 query，而是放到 `options.systemPrompt`，再由 `RelayClawAgentService.buildRequest()` 填入 `params.system_prompt`

这样做的好处是：

- JiuwenClaw 还能维持自己的 system/user 通道结构
- 不会把 OfficeClaw 的系统提示词污染成“用户输入”

## 17. Sidecar 复用与重启规则

### 17.1 会复用的情况

以下条件都满足时，会复用已有 sidecar：

- 子进程还活着
- runtime signature 没变
- `resolvedUrl` 存在
- `AGENT_PORT` 探活成功

### 17.2 会触发重启的情况

以下任一变化都会触发重启：

- `executablePath` 变化
  - 来源：`config.executablePath`、`OFFICE_CLAW_RELAYCLAW_EXE` 或默认 `vendor/jiuwenclaw.exe`
  - 影响：切换 JiuwenClaw 可执行文件路径会改变签名
- `useExecutable` 变化
  - 来源：`existsSync(executablePath)`
  - 影响：同一个 `executablePath` 从不存在变成存在，或从存在变成不存在，会改变签名
- `pythonBin` 变化
  - 来源：`config.pythonBin`、`OFFICE_CLAW_RELAYCLAW_PYTHON`，或从 `appDir/.venv` / bundled Python / legacy path 推导
  - 影响：切换 Python 解释器路径会改变签名
- `appDir` 变化
  - 来源：`config.appDir`、`OFFICE_CLAW_RELAYCLAW_APP_DIR`、vendored JiuwenClaw 目录或 legacy 目录
  - 影响：切换 JiuwenClaw app 根目录会改变签名
- `homeDir` 变化
  - 来源：`config.homeDir`，默认是 `<monorepo>/.office-claw/relayclaw/<agentId>`
  - 影响：切换 sidecar 的 `HOME` / agent 数据根目录会改变签名
- `officeClawDataDir` 变化
  - 来源：`OFFICE_CLAW_DATA_DIR`，默认是 `~/.office-claw`
  - 影响：切换 OfficeClaw 数据根目录会改变签名
- `appSignature` 变化
  - 来源：`appDir/jiuwenclaw` 下 `.py` 文件的相对路径、文件大小、mtime，以及 `appDir/jiuwenclaw` 根路径
  - 影响：JiuwenClaw Python 代码文件新增、删除、大小变化、mtime 变化，或 app 根路径变化，都会改变签名
- `apiBase` 变化
  - 来源：`callbackEnv.API_BASE`、`callbackEnv.OPENAI_BASE_URL`、`callbackEnv.OPENAI_API_BASE`
  - 影响：切换 OpenAI-compatible API base 会改变签名
- `defaultHeaders` 变化
  - 来源：`callbackEnv.default_headers`、`callbackEnv.OPENAI_DEFAULT_HEADERS`
  - 影响：默认请求头变化会改变签名
- `modelName` 变化
  - 来源：`config.modelName`，默认 `gpt-5.4`
  - 影响：切换模型名会改变签名
- `provider` 变化
  - 来源：由 `apiBase` 推导，包含 `openrouter.ai` 时是 `OpenRouter`，否则是 `OpenAI`
  - 影响：API base 导致 provider 推导结果变化时会改变签名
- `modelContextWindow` 变化
  - 来源：`callbackEnv.MODEL_CONTEXT_WINDOW`，仅正整数生效；无效或缺省记为 `0`
  - 影响：上下文窗口配置变化会改变签名
- `officeClawMcpPath` 变化
  - 来源：`resolveOfficeClawMcpServer(options.workingDirectory)` 解析出的 `serverPath`
  - 影响：OfficeClaw MCP server 入口在 `packages/mcp-server/dist/index.js` 与 `packages/mcp-server/src/index.ts` 之间切换、路径变化，或从不存在变成存在，都会改变签名
- `keyHash` 变化
  - 来源：`callbackEnv.API_KEY`、`callbackEnv.OPENAI_API_KEY`、`callbackEnv.OPENROUTER_API_KEY` 的 SHA-256
  - 影响：API key 变化会改变签名，但日志里只记录哈希，不记录明文 key

当前签名不包含 `workingDirectory`、`JIUWENCLAW_PROJECT_DIR`、共享 skills 内容签名、disabled skills、request 级 callback token、`OFFICE_CLAW_MCP_*` 回调环境变量、`AGENT_PORT`、`WEB_PORT`。这些字段变化本身不会因为 runtime signature 改变而触发 sidecar 重启。

换句话说，当前实现把 sidecar 看成“带配置和工具快照的缓存进程”，不是一个完全静态的 daemon。

### 17.3 前端错误参考号如何反查 sidecar 重启/崩溃原因

当前实现里，sidecar 相关诊断分成两层：

- sidecar 自己的生命周期日志仍然按原样输出，例如：
  - `relayclaw sidecar runtime signature changed — restarting`
  - `relayclaw sidecar exited`
- 如果本次 invocation 最终因为 relayclaw transport 断连而失败，例如前端看到：
  - `jiuwen WebSocket connection closed unexpectedly`

那么 `RelayClawAgentService` 会把最近一次 sidecar 诊断摘要挂到该 error message 的 `metadata.relayclawSidecarDiag`，并由上层 `route-serial.ts` / `route-parallel.ts` 在生成错误参考号时一并写入 `errorAuditLogger.error(...)`。

因此可以通过前端错误参考号，在 `error.log` 中直接反查这些字段：

- `lastStopReason`
- `lastSignatureDiff`
- `lastStartSummary`
- `lastExitSummary`
- `recentLogTail`

这覆盖了两类最常见场景：

- 不是前端自己触发的问题，而是 sidecar 因 runtime signature 变化被主动重启
- 不是签名变化，而是 sidecar 自身异常退出，最终只在前端表现成 WebSocket close

## 18. 最容易踩的坑

### 18.1 误以为 OfficeClaw 连接的是 `WEB_PORT`

不是。OfficeClaw 调 JiuwenClaw 用的是 `AGENT_PORT`。

### 18.2 误以为 `project_dir` 每次都能改

不是。JiuwenClaw 会把第一次非空 `project_dir` 绑定到 `session_id`，后面传不同目录会被忽略。

### 18.3 误以为 sidecar 只有一个全局实例

不是。sidecar 是按 `API_BASE + API_KEY + modelName` scope 复用的。

### 18.4 误以为 request 级 MCP 能在 sidecar 启动时一次性注入

不行。`office_claw_mcp` 带有 request 级回调 token，必须每次请求前重注册。

### 18.5 误以为 `connection.ack` 可有可无

不行。OfficeClaw 只有收到 `connection.ack` 才认为 WebSocket server 已经 ready。

### 18.6 误以为 `chat.final` 一定就是最终展示文本

不完全是。OfficeClaw 会结合已经流出的 `chat.delta` 做去重和补全，避免最终文本重复输出。

## 19. 推荐的排障顺序

如果要排 “OfficeClaw 调不通 JiuwenClaw”，建议按这个顺序看：

1. 看 `packages/api/src/index.ts` 是否真的把该智能体创建成了 `RelayClawAgentService`
2. 看 `invoke-single-agent.ts` 是否给出了正确的 `callbackEnv`、`workingDirectory`、`systemPrompt`
3. 看 `relayclaw-sidecar.ts` 是否真的 spawn 了 JiuwenClaw
4. 看 sidecar 最近日志里是否出现：
   - `relayclaw sidecar spawned`
   - `jiuwen sidecar tcp_ready`
   - `jiuwen sidecar app_ready`
   - `jiuwen sidecar fully ready`
5. 看 JiuwenClaw 日志里 `AgentWebSocketServer` 是否启动并发出 `connection.ack`
6. 看请求帧里是否有正确的：
   - `request_id`
   - `session_id`
   - `req_method`
   - `project_dir`
   - `office_claw_mcp`
7. 看返回流里是否出现 `chat.error`
8. 最后再看 `relayclaw-event-transform.ts` 是否把某种事件错误地过滤掉了

## 20. 结论

当前集成方案的本质可以概括为一句话：

`OfficeClaw` 把 JiuwenClaw 当成一个可按 scope 复用的本地 agent runtime，通过 sidecar 方式托管其进程生命周期，并通过 `AGENT_PORT` 上的 Agent WebSocket 协议实现请求、流式事件、工具调用与回调能力的双向联通。

因此，理解这套方案时要把它拆成四层：

1. 配置与 service 实例化层
2. sidecar 进程管理层
3. Agent WebSocket 协议层
4. JiuwenClaw 内部工具/会话/工作目录执行层

只要这四层分清楚，就不会再把 `WebChannel`、`AgentWebSocketServer`、`request-scoped MCP`、`project_dir session 绑定` 这些关键概念混在一起。
