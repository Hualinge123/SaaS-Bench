# API 遥测指标分析

## 一、实际采集的指标（6 个）

| 指标名称 | 类型 | 单位 | Labels | 采集位置 |
|----------|------|------|--------|----------|
| `jiuwenclaw.request.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional), **动态 labels** | `fastify-hook.ts:84` |
| `jiuclaw.request.error.count` | Counter | `{request}` | `http.method`, `http.route`, `officeclaw.user.id` (optional), **动态 labels** | `fastify-hook.ts:99` |
| `jiuwenclaw.request.duration` | Histogram | `s` | `http.method`, `http.route`, `officeclaw.user.id` (optional), **动态 labels** | `fastify-hook.ts:89` |
| `jiuwenclaw.agent.invoke.count` | Counter | `{invoke}` | `officeclaw.agent.id` | `agent-span.ts:76` |
| `jiuwenclaw.agent.invoke.error.count` | Counter | `{invoke}` | `officeclaw.agent.id` | `agent-span.ts:79` |
| `jiuwenclaw.agent.invoke.duration` | Histogram | `s` | `officeclaw.agent.id` | `agent-span.ts:75` |
| Resource Labels | - | - | `service.name`, `officeclaw.claw.id` | `resource-attributes-processor.ts` |

**Note:**
- `officeclaw.user.id` label is optional — only present when `x-userid` header exists in HTTP request.
- **动态 labels** 通过 MetricLabelProvider 插件提供，详见十一节。

---

## 二、调用链分析

### 2.1 HTTP 请求指标采集链

```
应用启动
└── packages/api/src/index.ts:17
    └── initTelemetry()                          # 遥测初始化
│
│   packages/api/src/index.ts:460
└── registerTelemetryHook(app)                   # 注册 Fastify 钩子
│
│   packages/api/src/infrastructure/telemetry/fastify-hook.ts
│
├── onRequest 钩子
│   └── tracer.startSpan('POST /api/messages')   # 创建 HTTP Span
│
└── onResponse 钩子
    ├── getRequestCount().add(1, {http.method, http.route})
    ├── getRequestDuration().record(duration, {http.method, http.route})
    └── if (statusCode >= 500):
        └── getRequestErrorCount().add(1, {http.method, http.route})
    └── span.end()
```

### 2.2 Agent 调用指标采集链

```
HTTP 请求进入
└── packages/api/src/routes/messages.ts
│
└── RelayClawAgentService.sendMessage()
│   │
│   │ packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts:260
│   ├── startAgentInvokeSpan(agentId, sessionId, requestId, threadId)
│   │   │
│   │   │ packages/api/src/domains/agents/services/agents/telemetry/agent-span.ts:40
│   │   └── tracer.startSpan('officeclaw.agent.invoke')
│   │       └── attributes: {
│   │             gen_ai.agent.name: agentId,
│   │             gen_ai.conversation.id: threadId,
│   │             officeclaw.session.id: sessionId,
│   │             officeclaw.request_id: requestId,
│   │             officeclaw.agent.id: agentId
│   │           }
│   │
│   ├── context.with(trace.setSpan(context.active(), span), () => {
│   │       runtime.connection.send(request)      # 在 Span 上下文中发送请求
│   │       └── buildTraceContextForE2A()         # 注入 traceparent 到 channel_context
│   │     })
│   │
│   ├── yield* runGeneratorWithActiveSpan(span, consumeFrames())
│   │       # Generator 在 Span 上下文中执行
│   │
│   └── endAgentInvokeSpan(span, success)         # 结束 Span
│   └── recordAgentInvokeMetrics(agentId, duration, success)
│       │
│       │ packages/api/src/domains/agents/services/agents/telemetry/agent-span.ts:75
│       ├── getAgentInvokeDuration().record(duration, {officeclaw.agent.id})
│       ├── getAgentInvokeCount().add(1, {officeclaw.agent.id})
│       └── if (!success):
│           └── getAgentInvokeErrorCount().add(1, {officeclaw.agent.id})
```

---

## 三、Trace Context 传播链

```
HTTP Span (fastify-hook.ts)
│
├── Span 创建: tracer.startSpan('POST /api/messages')
│   └── request.telemetrySpan = span
│   └── request.telemetryContext = trace.setSpan(context.active(), span)
│
└── Agent Span 继承 HTTP Span
    └── startAgentInvokeSpan() 使用 context.active() 作为 parent
    └── context.with(trace.setSpan(context.active(), span), ...)
│
└── 传播到 Sidecar
    └── buildTraceContextForE2A() 提取当前 Span 的 traceparent
    └── 注入到 channel_context.traceparent
    └── Sidecar 收到后可继续链路追踪
```

---

## 四、未实现的指标（4 个）

| 指标名称 | 类型 | 状态 |
|----------|------|------|
| `gen_ai.client.operation.duration` | Histogram | 定义未使用 |
| `gen_ai.client.token.usage` | Counter | 定义未使用 |
| `gen_ai.client.operation.count` | Counter | 定义未使用 |
| `officeclaw.invocation.active` | ObservableGauge | 定义未使用 |

---

## 五、架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Request                              │
│  POST /api/messages                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    fastify-hook.ts                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ onRequest:                                                │  │
│  │   span = tracer.startSpan('POST /api/messages')          │  │
│  │   attributes: http.method, http.url, http.route           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ onResponse:                                               │  │
│  │   getRequestCount().add(1, {http.method, http.route})     │  │
│  │   getRequestDuration().record(duration, {...})            │  │
│  │   if (status >= 500):                                     │  │
│  │     getRequestErrorCount().add(1, {...})                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 RelayClawAgentService.ts                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ span = startAgentInvokeSpan(agentId, sessionId, ...)      │  │
│  │   └── tracer.startSpan('officeclaw.agent.invoke')         │  │
│  │   └── inherits HTTP span as parent                        │  │
│  │   └── attributes:                                         │  │
│  │       gen_ai.agent.name, gen_ai.conversation.id,          │  │
│  │       officeclaw.session.id, officeclaw.request_id        │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Trace Propagation:                                        │  │
│  │   context.with(trace.setSpan(context.active(), span))     │  │
│  │   buildTraceContextForE2A() → channel_context.traceparent │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Metrics Recording:                                        │  │
│  │   recordAgentInvokeMetrics(agentId, duration, success)    │  │
│  │     getAgentInvokeDuration().record(duration, {agent.id}) │  │
│  │     getAgentInvokeCount().add(1, {agent.id})              │  │
│  │     if (!success):                                        │  │
│  │       getAgentInvokeErrorCount().add(1, {agent.id})       │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Sidecar (Python)                            │
│  收到 channel_context.traceparent                                │
│  继续链路追踪                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、关键文件路径

| 文件 | 说明 |
|------|------|
| `packages/api/src/infrastructure/telemetry/metrics.ts` | 指标定义 |
| `packages/api/src/infrastructure/telemetry/attributes.ts` | 属性常量定义 |
| `packages/api/src/infrastructure/telemetry/fastify-hook.ts` | HTTP 请求追踪钩子 |
| `packages/api/src/infrastructure/telemetry/init.ts` | 遥测 SDK 初始化 |
| `packages/api/src/infrastructure/telemetry/propagation.ts` | Trace Context 传播 |
| `packages/api/src/domains/agents/services/agents/telemetry/agent-span.ts` | Agent Span 工具函数 |
| `packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts` | Agent 服务（实际调用遥测） |
| `packages/api/src/index.ts` | 应用入口（初始化和注册钩子） |

---

## 七、指标命名约定

| 前缀 | 说明 |
|------|------|
| `jiuwenclaw.*` | 与 Python 侧 `jiuwenclaw/telemetry/metrics.py` 保持一致 |
| `jiuclaw.*` | 简化前缀（用于错误计数） |
| `gen_ai.*` | OpenTelemetry GenAI 语义约定标准 |

---

## 八、环境变量配置

通过环境变量配置导出到 OTLP Collector：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4317
OTEL_SERVICE_NAME=officeclaw-api
OTEL_RESOURCE_ATTRIBUTES=service.version=1.0.0
```

---

## 九、总结

当前 API 侧遥测系统已实现：

- **HTTP 请求追踪**：自动采集请求计数、延迟、错误
- **Agent 调用追踪**：记录 Agent 调用次数、延迟、错误
- **分布式链路追踪**：通过 W3C TraceContext 传播到 Sidecar
- **Provider 扩展机制**：支持自定义遥测 Provider

待实现：

- **LLM 指标**：Token 使用量、LLM 调用次数和延迟
- **活跃调用数**：实时观测当前活跃的 Agent 调用

---

## 十、Resource Attributes 作为 Metric Labels

所有指标自动包含 Resource attributes 作为 labels：

| Label | 来源 | 说明 |
|-------|------|------|
| `service.name` | Resource | 服务实例名称 |
| `officeclaw.claw.id` | Resource | 实例标识符 |

**实现方式：**
- `ResourceAttributesProcessor` 在 metrics 采集时注入 resource attributes
- View 配置应用到所有 Counter 和 Histogram metrics
- 现有 metric labels 优先（不会被 resource attributes 覆盖）

**查询示例（Prometheus）：**
```promql
# 按服务实例查询请求计数
jiuwenclaw_request_count{service.name="officeclaw-api"}

# 按实例ID查询特定路由的请求延迟
jiuwenclaw_request_duration{officeclaw_claw_id="instance-001", http.route="/api/messages"}
```

---

## 十一、动态 Metric Labels (MetricLabelProvider)

HTTP 请求指标支持通过 MetricLabelProvider 插件添加动态 labels。

### 插件机制

| Label | 来源 | 说明 |
|-------|------|------|
| 动态 labels | MetricLabelProvider | 插件根据 HTTP request 返回 key-value pairs |

**实现方式：**
- MetricLabelProvider 接口定义在 `packages/plugin/api/src/metric-label-provider.ts`
- Provider 通过 `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` 环境变量加载
- Labels 在 `fastify-hook.ts` 的 onResponse 钩子中合并到 metric attributes
- Provider 执行失败时 fallback 到 noop，不影响 metrics 记录

**内置 Provider：**

| Provider ID | 说明 | Labels |
|-------------|------|--------|
| `noop` | 默认 provider | 无（返回 null） |
| `x-userid` | 提取 x-userid header | `officeclaw.user.id` |

### 配置示例

```bash
# 使用 x-userid provider
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=./dist/infrastructure/telemetry/metric-label-providers/x-userid.js

# 使用第三方 provider
OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=@my-company/my-metric-label-provider

# 不使用动态 labels（默认 noop）
# （不设置 OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE）
```

### 自定义 Provider

第三方可以创建自定义 MetricLabelProvider：

```typescript
import type { MetricLabelProvider } from '@openjiuwen/relay-api-server-contracts';

export const metricLabelProvider: MetricLabelProvider = {
  id: 'my-custom-labels',
  displayName: 'My Custom Labels Provider',
  resolveLabels: async (request) => {
    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) return null;
    return { 'officeclaw.tenant.id': tenantId };
  },
};
```

### 查询示例（Prometheus）

```promql
# 查询特定用户的请求计数（使用 x-userid provider）
jiuwenclaw_request_count{officeclaw_user_id="alice"}

# 查询特定租户的请求延迟（使用自定义 provider）
jiuwenclaw_request_duration{officeclaw_tenant_id="tenant-001"}
```