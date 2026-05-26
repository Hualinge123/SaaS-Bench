---
feature_ids: [F147]
related_features: [F008, F146]
topics: [telemetry, opentelemetry, observability, metrics, traces, plugin]
doc_kind: spec
created: 2026-05-22
status: impl
---

# F147 — Telemetry Provider Plugin System

> **Status**: impl | **Owner**: Hualinge

## Why

OfficeClaw 当前缺乏统一的可观测性基础设施：

- 无法追踪 HTTP 请求的完整调用链路
- 无法收集 Agent 调用的耗时和成功率指标
- 无法对接下游 jiuwenclaw 的 telemetry 系统
- 不同部署环境（华为云 AOM、自建 OTLP、本地调试）需要不同的 telemetry 配置
- 现有方案缺乏插件化扩展能力

对运维和用户而言，可观测性应当回答的问题：

- 每个 HTTP 请求的响应时间、成功率、错误类型
- Agent 调用的耗时分布、失败率、token 消耗
- 跨服务的 trace 链路（从 HTTP → Agent → downstream jiuwenclaw）
- 按租户/用户维度聚合的指标（如 x-userid label）

因此，需要引入插件化的 telemetry 系统：

- 支持 OpenTelemetry 标准（traces + metrics）
- 支持动态 MetricLabelProvider 扩展（从 HTTP request 解析 labels）
- 支持环境变量配置（opt-in，默认关闭）
- 支持多种 exporter（OTLP grpc/http、Console）

## What

本方案引入 Telemetry Provider Plugin System：

### 核心组件

1. **TelemetryProvider 接口** — 配置 OpenTelemetry SDK
   - `createTraceExporter()` — 创建 trace exporter
   - `createMetricReader()` — 创建 metric reader
   - `createResource()` — 创建 resource attributes
   - `getInstrumentations()` — 返回 auto-instrumentation 列表

2. **MetricLabelProvider 接口** — 动态指标标签解析
   - `resolveLabels(request)` — 从 HTTP request 解析 labels（如 x-userid）
   - 支持插件化扩展（通过 `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` 环境变量加载）

3. **TelemetryProviderRegistry** — Provider 注册表
   - 支持模块加载（`registerModule()`）
   - 支持 default/named exports

4. **HTTP Span Hook** — Fastify 请求追踪
   - `onRequest` — 创建 SERVER span
   - `preHandler` — 设置 active context
   - `onResponse` — 结束 span + 记录 metrics
   - `onError` — 记录 exception

5. **Agent Span Helpers** — Agent 调用追踪
   - `startAgentInvokeSpan()` — 创建 CLIENT span
   - `runWithActiveSpan()` — 绑定 trace context
   - `recordAgentInvokeMetrics()` — 记录 agent.invoke 指标

### 指标定义

| 指标名 | 类型 | 单位 | 说明 |
|--------|------|------|------|
| `jiuwenclaw.request.count` | Counter | `{request}` | HTTP 请求计数 |
| `jiuwenclaw.request.duration` | Histogram | `s` | HTTP 请求耗时 |
| `officeclaw.request.error.count` | Counter | `{request}` | HTTP 错误计数 |
| `jiuwenclaw.agent.invoke.count` | Counter | `{invoke}` | Agent 调用计数 |
| `jiuwenclaw.agent.invoke.duration` | Histogram | `s` | Agent 调用耗时 |
| `officeclaw.agent.invoke.error.count` | Counter | `{invoke}` | Agent 调用错误计数 |
| `gen_ai.client.operation.duration` | Histogram | `s` | LLM 调用耗时 |
| `gen_ai.client.token.usage` | Counter | `{token}` | LLM token 使用量 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OTEL_ENABLED` | `false` | 是否启用 telemetry |
| `OTEL_EXPORTER_TYPE` | `none` | 全局 exporter 类型（otlp/console/none） |
| `OTEL_TRACES_EXPORTER` | `none` | traces exporter 类型 |
| `OTEL_METRICS_EXPORTER` | `none` | metrics exporter 类型 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP endpoint |
| `OTEL_SERVICE_NAME` | `officeclaw-api` | service name |
| `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` | - | MetricLabelProvider 模块路径 |

### 范围

本方案覆盖：

- 插件接口定义（`packages/plugin/api/`）
- Telemetry SDK 初始化（`packages/api/src/infrastructure/telemetry/`）
- HTTP 请求追踪（`fastify-hook.ts`）
- Agent 调用追踪（`agent-span.ts`）
- 指标定义（`metrics.ts`）
- Resource 属性注入（`resource-attributes-processor.ts`）
- 环境变量配置（`config.ts`）
- Builtin Provider（`builtin-telemetry.ts`）
- 相关测试

## Current State

### 新增文件

| 文件 | 功能 |
|------|------|
| `packages/plugin/api/src/telemetry-provider.ts` | TelemetryProvider 接口 |
| `packages/plugin/api/src/metric-label-provider.ts` | MetricLabelProvider 接口 |
| `packages/api/src/infrastructure/telemetry/init.ts` | SDK 初始化 |
| `packages/api/src/infrastructure/telemetry/fastify-hook.ts` | HTTP Span Hook |
| `packages/api/src/infrastructure/telemetry/metrics.ts` | 指标定义 |
| `packages/api/src/infrastructure/telemetry/attributes.ts` | 属性常量 |
| `packages/api/src/infrastructure/telemetry/provider-registry.ts` | Provider 注册表 |
| `packages/api/src/infrastructure/telemetry/provider.ts` | Tracer/Meter 工具 |
| `packages/api/src/infrastructure/telemetry/config.ts` | 配置解析 |
| `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts` | Resource 属性注入 |
| `packages/api/src/infrastructure/telemetry/providers/builtin-telemetry.ts` | Builtin Provider |
| `packages/api/src/domains/agents/services/agents/telemetry/agent-span.ts` | Agent Span Helpers |

### 改动文件

| 文件 | 改动 |
|------|------|
| `packages/api/src/index.ts` | 初始化 telemetry + 注册 HTTP hook |
| `packages/api/src/routes/messages.ts` | 创建 execution span + 绑定 context |
| `packages/api/package.json` | 新增 OpenTelemetry 依赖 |

### 测试文件

| 文件 | 测试内容 |
|------|---------|
| `telemetry-provider-registry.test.js` | Provider 注册表 |
| `telemetry-provider-e2e.test.js` | E2E 集成 |
| `x-userid-metric-label.test.ts` | x-userid provider |
| `resource-attributes-processor.test.js` | Resource 属性处理 |
| `resource-attributes-metrics.test.js` | Resource 属性注入指标 |
| `relayclaw-sidecar-telemetry.test.js` | sidecar telemetry |

## Design

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     HTTP Request                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              fastify-hook.ts (onRequest)                    │
│  - 创建 HTTP SERVER Span                                     │
│  - 调用 MetricLabelProvider.resolveLabels()                 │
│  - 合并 labels → 记录 request.count/duration                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   messages.ts                                │
│  - 创建 execution Span (继承 HTTP Span context)             │
│  - background 任务绑定到 Span context                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   agent-span.ts                              │
│  - startAgentInvokeSpan() 创建 CLIENT Span                  │
│  - runWithActiveSpan() 绑定 context                          │
│  - recordAgentInvokeMetrics() 记录指标                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   downstream jiuwenclaw                     │
│  - traceparent 传播                                          │
└─────────────────────────────────────────────────────────────┘
```

### MetricLabelProvider 扩展机制

1. 设置环境变量 `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=/path/to/provider.mjs`
2. Provider 模块导出 `MetricLabelProvider` 对象
3. HTTP hook 在 `onResponse` 时调用 `resolveLabels(request)`
4. 返回的 labels 合并到 metric attributes

示例 Provider：

```javascript
// x-userid-provider.mjs
export const metricLabelProvider = {
  id: 'x-userid',
  displayName: 'X-User-ID Label Provider',
  resolveLabels(request) {
    const userId = request.headers['x-hw-agentarts-user-id'];
    return userId ? { 'user.id': userId } : null;
  }
};
```

### Resource 属性注入

通过 `ResourceAttributesProcessor` 将 Resource attributes（如 `service.name`、`claw.id`）注入到所有 metric attributes：

```typescript
// init.ts
_sdk = new NodeSDK({
  resource,
  views: [
    {
      instrumentName: '*',
      instrumentType: InstrumentType.COUNTER,
      attributesProcessors: [new ResourceAttributesProcessor(resource)],
    },
    // ...
  ],
});
```

## Implementation

### 启用方式

```bash
# 1. 启用 telemetry
export OTEL_ENABLED=true

# 2. 配置 exporter
export OTEL_TRACES_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-otlp-collector:4317

# 3. 配置 MetricLabelProvider（可选）
export OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE=/path/to/provider.mjs

# 4. 启动服务
pnpm start
```

### 默认行为

- `OTEL_ENABLED` 未设置或非 `true` → telemetry 关闭
- `OTEL_TRACES_EXPORTER=none` → 不导出 traces
- `OTEL_METRICS_EXPORTER=none` → 不导出 metrics
- `OFFICE_CLAW_METRIC_LABEL_PROVIDER_MODULE` 未设置 → 使用 noop provider（无额外 labels）

### Console Exporter（调试模式）

```bash
export OTEL_ENABLED=true
export OTEL_TRACES_EXPORTER=console
export OTEL_METRICS_EXPORTER=console
```

traces 和 metrics 将输出到 console，便于本地调试。

## Testing

### 单元测试

- `telemetry-provider-registry.test.js` — Provider 注册和加载
- `resource-attributes-processor.test.js` — Resource 属性处理
- `x-userid-metric-label.test.ts` — x-userid provider 功能

### E2E 测试

- `telemetry-provider-e2e.test.js` — 完整 SDK 初始化流程
- `relayclaw-sidecar-telemetry.test.js` — Agent 调用 telemetry

### 验证命令

```bash
# 运行 telemetry 相关测试
pnpm --filter @openjiuwen/relay-api-server run test telemetry-*.test.js
```

## Migration

### 向后兼容

- telemetry 默认关闭，不影响现有部署
- 新增字段 `extra.stream.completedAt` 向后兼容（旧消息 fallback）
- MetricLabelProvider 为可选扩展，不设置时使用 noop

### 升级步骤

1. 确认 OpenTelemetry collector 可访问
2. 设置 `OTEL_ENABLED=true`
3. 配置 exporter 类型
4. 启动服务，验证指标/traces 导出

## References

- [metric-label-provider-design.md](../superpowers/specs/2026-05-21-metric-label-provider-design.md)
- [resource-attributes-to-labels-design.md](../superpowers/specs/2026-05-21-resource-attributes-to-labels-design.md)
- [x-userid-metric-label-design.md](../superpowers/specs/2026-05-21-x-userid-metric-label-design.md)
- [F-telemetry-metrics-analysis.md](../feature/F-telemetry-metrics-analysis.md)
- [F-telemetry-gateway-observability.md](../feature/F-telemetry-gateway-observability.md)
- OpenTelemetry Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/