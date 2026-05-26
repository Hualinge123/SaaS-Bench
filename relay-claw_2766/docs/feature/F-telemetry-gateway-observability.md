# Gateway OpenTelemetry 可观测性

OfficeClaw Gateway (packages/api) 内置了基于 OpenTelemetry 协议的可观测性能力，遵循 OpenTelemetry GenAI 语义规范，支持上报 HTTP 和 Agent 调用链 Trace 和运行指标 Metric。

## 1. 功能概述

通过 OpenTelemetry 集成，可以观测以下调用链路：

| 类型 | 含义 | 记录内容 |
|------|------|----------|
| HTTP | HTTP 请求 | 请求方法、URL、路由、状态码、响应时延 |
| AGENT | Agent 调用 | Agent ID、Session ID、Request ID、Thread ID |

同时记录以下运行指标：
- HTTP 请求总数、错误数、处理时延
- Agent 调用总数、失败数、调用时延
- 当前活跃 invocation 数（ObservableGauge）

## 2. 快速启用

### 2.1 通过环境变量启用

```bash
# 启用 telemetry，使用 console 输出（开发调试）
OTEL_ENABLED=true OTEL_EXPORTER_TYPE=console pnpm dev

# 启用 telemetry，使用 OTLP 导出到 Jaeger/Tempo 等后端（注意本地使用端口4317启动Jaeger/Tempo）
OTEL_ENABLED=true OTEL_EXPORTER_TYPE=otlp OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 pnpm dev
```

### 2.2 Trace 和 Metrics 独立上报

```bash
# 只导出 trace，不导出 metrics
OTEL_ENABLED=true OTEL_TRACES_EXPORTER=otlp OTEL_METRICS_EXPORTER=none pnpm dev

# trace 和 metrics 分别上报到不同后端
OTEL_ENABLED=true \
OTEL_TRACES_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://trace.example.com \
OTEL_METRICS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://metrics.example.com \
pnpm dev
```

## 3. 配置参数

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `OTEL_ENABLED` | `false` | 总开关 |
| `OTEL_EXPORTER_TYPE` | `none` | 公共 exporter fallback：otlp / console / none |
| `OTEL_TRACES_EXPORTER` | `none` | trace 导出方式：otlp / console / none |
| `OTEL_METRICS_EXPORTER` | `none` | metrics 导出方式：otlp / console / none |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP 后端地址 |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | OTLP 协议：grpc / http |
| `OTEL_SERVICE_NAME` | `officeclaw-api` | 服务名称 |
| `OTEL_CLAW_ID` | `None` | Claw 实例标识，用于区分同一服务下的不同实例 |

优先级：
1. Signal 专属环境变量（如 `OTEL_TRACES_EXPORTER`）
2. 公共环境变量（`OTEL_EXPORTER_TYPE`）
3. 默认值

## 4. Trace 调用链结构

Gateway 作为入口层，Trace 结构如下：

```
[HTTP]    {method} {route}                        (SERVER span, Fastify HTTP 请求)
  └── [AGENT] officeclaw.agent.invoke             (CLIENT span, 调用下游 jiuwenclaw)
        ├── channel_context.traceparent           ← W3C TraceContext 传播
        └── [下游 jiuwenclaw] ...                  ← 继承 Gateway 的 trace context
```

### Span Attributes

**HTTP span** (`SpanKind.SERVER`):
- `http.method` — HTTP 方法
- `http.url` — 完整 URL
- `http.route` — Fastify 路由路径
- `http.status_code` — 响应状态码
- `officeclaw.thread.id` — Thread ID（从请求 body 提取，可选）

**AGENT span** (`SpanKind.CLIENT`):
- `gen_ai.agent.name` — Agent ID
- `gen_ai.conversation.id` — Thread ID
- `officeclaw.session.id` — Session ID
- `officeclaw.request_id` — Request ID
- `officeclaw.agent.id` — Agent ID

### TraceContext 传播

Gateway 通过 W3C TraceContext 协议将 traceparent 注入到 WebSocket 消息的 `channel_context` 中：

```typescript
// relayclaw-connection.ts
Object.assign(enhancedPayload.channel_context, buildTraceContextForE2A());
```

这确保下游 jiuwenclaw 继承 Gateway 的 trace context，形成完整的跨进程调用链。

## 5. Metric 指标

### 5.1 指标总览

| 指标名 | 类型 | 单位 | 触发时机 | Labels |
|--------|------|------|----------|--------|
| `jiuwenclaw.request.count` | Counter | `{request}` | 每次 HTTP 请求结束时累加 | `http.method`, `http.route` |
| `jiuwenclaw.request.duration` | Histogram | `s` | 每次 HTTP 请求结束时记录 | `http.method`, `http.route` |
| `officeclaw.request.error.count` | Counter | `{request}` | HTTP 响应状态码 ≥500 时累加 | `http.method`, `http.route` |
| `jiuwenclaw.agent.invoke.count` | Counter | `{invoke}` | 每次 Agent 调用结束时累加 | `officeclaw.agent.id` |
| `jiuwenclaw.agent.invoke.duration` | Histogram | `s` | 每次 Agent 调用结束时记录 | `officeclaw.agent.id` |
| `officeclaw.agent.invoke.error.count` | Counter | `{invoke}` | Agent 调用失败时累加 | `officeclaw.agent.id` |
| `officeclaw.invocation.active` | ObservableGauge | `{invocation}` | 导出时实时采样 | 无 |

### 5.2 GenAI 指标（已定义但 Gateway 侧未上报）

以下指标遵循 OpenTelemetry GenAI 语义规范定义，但实际数据由下游 jiuwenclaw 上报：

| 指标名 | 类型 | 单位 | 说明 |
|--------|------|------|------|
| `gen_ai.client.operation.duration` | Histogram | `s` | LLM 调用时延 |
| `gen_ai.client.operation.count` | Counter | `{call}` | LLM 调用次数 |
| `gen_ai.client.token.usage` | Counter | `{token}` | Token 消耗（按 input/output/cache 类型） |

Gateway 仅定义了这些指标的 factory 函数，未实际调用上报。

### 5.3 Labels 说明

| Label | 所属指标 | 取值说明 |
|--------|----------|----------|
| `http.method` | request 系列 | HTTP 方法，如 GET、POST |
| `http.route` | request 系列 | Fastify 路由路径，如 `/api/messages` |
| `officeclaw.agent.id` | agent 系列 | Agent ID |

### 5.4 资源属性

所有 telemetry 数据附带以下资源属性：

| 属性 | 值来源 | 说明 |
|--------|--------|------|
| `service.name` | `OTEL_SERVICE_NAME`，默认 `officeclaw-api` | 服务标识 |
| `officeclaw.claw.id` | `OTEL_CLAW_ID` | Claw 实例标识（可选） |

## 6. 对接 Jaeger 示例

```bash
# 启动 Jaeger（支持 OTLP gRPC）
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4317:4317 \
  jaegertracing/all-in-one:latest

# 启动 Gateway
OTEL_ENABLED=true OTEL_EXPORTER_TYPE=otlp pnpm dev
```

打开 http://localhost:16686 即可在 Jaeger UI 中查看调用链。

## 7. 架构与代码结构

| 文件 | 作用 |
|------|------|
| `infrastructure/telemetry/config.ts` | 配置加载（环境变量解析） |
| `infrastructure/telemetry/init.ts` | OpenTelemetry SDK 初始化 |
| `infrastructure/telemetry/provider.ts` | Tracer/Meter 访问入口 |
| `infrastructure/telemetry/metrics.ts` | 指标定义和 lazy 初始化 |
| `infrastructure/telemetry/fastify-hook.ts` | Fastify HTTP 埋点钩子 |
| `infrastructure/telemetry/propagation.ts` | W3C TraceContext 传播工具 |
| `infrastructure/telemetry/attributes.ts` | 语义属性常量定义 |
| `domains/agents/services/agents/telemetry/agent-span.ts` | Agent 调用 span 工具 |

### 初始化流程

```
index.ts
  → initTelemetry()                // 启动 OpenTelemetry SDK
  → registerTelemetryHook(app)     // 注册 Fastify HTTP 钩子
```

### Agent 调用埋点流程

```
RelayClawAgentService.invoke()
  → startAgentInvokeSpan()         // 创建 CLIENT span
  → context.with(activeSpan, ...)  // 设置 active context
  → buildTraceContextForE2A()      // 注入 traceparent 到 WS 消息
  → consumeFrames()                // 消费响应流
  → endAgentInvokeSpan()           // 结束 span
  → recordAgentInvokeMetrics()     // 记录指标
```

## 8. 注意事项

- 当 `OTEL_ENABLED` 为 `false` 时，telemetry 模块完全不加载，对性能零影响
- Gateway 侧仅上报 HTTP 和 Agent 级指标，LLM/Tool 指标由下游 jiuwenclaw 上报
- HttpInstrumentation 自动埋点会为所有 HTTP 请求创建 span，与 Fastify hook 可能产生重复；当前优先使用 Fastify hook 以获取更精确的路由信息
- TraceContext 通过 WebSocket `channel_context` 字段传播，确保 Gateway → jiuwenclaw 跨进程调用链完整

## 9. 已知限制

1. **GenAI 指标 Gateway 侧未上报**
   - `gen_ai.client.operation.duration` / `gen_ai.client.token.usage` / `gen_ai.client.operation.count` 已定义但未调用
   - 实际数据由下游 jiuwenclaw 上报，Gateway 仅作为调用入口

2. **Tool 相关指标未实现**
   - 当前 Gateway 未定义或上报任何 tool 相关指标
   - Tool 执行指标由下游 jiuwenclaw 负责

3. **HttpInstrumentation 与 Fastify hook 潜在重复**
   - NodeSDK 启用了 HttpInstrumentation 自动埋点
   - 同时 Fastify hook 也创建 SERVER span
   - 当前实际生效的是 Fastify hook span（提供更精确路由）