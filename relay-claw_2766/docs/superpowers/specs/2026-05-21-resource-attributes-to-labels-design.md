# Resource Attributes to Metric Labels 设计方案

**日期**: 2026-05-21
**状态**: 已批准
**作者**: Claude

---

## 1. 背景

当前遥测系统中，Resource attributes (`service.name`, `officeclaw.claw.id`) 在初始化时设置，但这些属性不会自动成为metric labels。用户期望Resource attributes能够自动转换为所有metric的labels，以便在Prometheus/Grafana中作为查询维度使用。

### 1.1 问题陈述

- Resource attributes存储在MetricData的resource字段中
- Resource attributes不会自动出现在metric attributes（labels）字段中
- 在Prometheus/Grafana查询中无法使用service.name或claw.id作为过滤条件

### 1.2 目标

- 将Resource attributes自动注入到所有metric labels
- 保持现有metric labels不变（优先级正确）
- 支持所有metric类型（Counter、Histogram）
- 符合OpenTelemetry标准做法

---

## 2. 当前实现分析

### 2.1 Resource Attributes来源

**文件**: `packages/api/src/infrastructure/telemetry/providers/builtin-telemetry.ts`

```typescript
createResource() {
  return new Resource({
    [SEMRESATTRS_SERVICE_NAME]: cfg.serviceName,           // service.name
    ...(cfg.clawId ? { 'officeclaw.claw.id': cfg.clawId } : {}), // officeclaw.claw.id
  });
}
```

### 2.2 现有Metric Labels

**HTTP请求指标** (`fastify-hook.ts`):
- `http.method` - HTTP方法（GET、POST等）
- `http.route` - 路由路径（/api/messages）

**Agent调用指标** (`agent-span.ts`):
- `officeclaw.agent.id` - Agent标识符

### 2.3 重叠分析

**结论**: Resource attributes与现有metric labels完全不同，无重叠风险。

| 来源 | 属性级别 | 示例 |
|------|---------|------|
| Resource attributes | 服务实例级别 | `service.name=officeclaw-api` |
| Metric labels | 请求/调用级别 | `http.method=POST` |

---

## 3. 解决方案设计

### 3.1 核心思路

使用OpenTelemetry View API + 自定义AttributesProcessor，在metrics采集时自动将Resource attributes注入到metric attributes。

### 3.2 架构变化

```
当前流程:
Resource → SDK → MetricData {
  resource: {service.name, claw.id},
  attributes: {http.method, http.route}
}

目标流程:
Resource → SDK + AttributesProcessor → MetricData {
  resource: {...},
  attributes: {http.method, http.route, service.name, claw.id}
}
```

---

## 4. 文件修改清单

### 4.1 新建文件

| 文件路径 | 说明 | 预估代码量 |
|---------|------|-----------|
| `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts` | Resource attributes处理器 | ~40行 |

### 4.2 修改文件

| 文件路径 | 修改内容 | 预估修改量 |
|---------|---------|-----------|
| `packages/api/src/infrastructure/telemetry/init.ts` | SDK初始化时添加View配置 | ~15行 |

### 4.3 无需修改文件

- `metrics.ts` - 指标定义保持不变
- `fastify-hook.ts` - 指标记录代码保持不变
- `agent-span.ts` - Agent调用指标记录保持不变
- `attributes.ts` - 属性定义保持不变

---

## 5. 详细设计

### 5.1 ResourceAttributesProcessor

**文件**: `packages/api/src/infrastructure/telemetry/resource-attributes-processor.ts`

```typescript
import type { Attributes } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';

/**
 * AttributesProcessor that injects resource attributes into metric attributes.
 * Resource attributes are added as base labels for all metrics.
 */
export class ResourceAttributesProcessor {
  private resourceAttributes: Record<string, string | number | boolean>;

  constructor(resource: Resource) {
    this.resourceAttributes = resource.attributes;
  }

  /**
   * Process attributes by merging resource attributes.
   * Existing attributes take precedence (no overwrite).
   */
  process(attributes: Attributes): Attributes {
    return {
      ...this.resourceAttributes,  // Resource attributes as base
      ...attributes,                // Existing attributes override (priority)
    };
  }
}
```

### 5.2 SDK初始化修改

**文件**: `packages/api/src/infrastructure/telemetry/init.ts`

```typescript
import { View, InstrumentType } from '@opentelemetry/sdk-metrics';
import { ResourceAttributesProcessor } from './resource-attributes-processor.js';

// 在SDK创建时添加View配置
_sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations,
  views: [
    // Apply to all Counter metrics
    new View({
      instrumentName: '*',
      instrumentType: InstrumentType.COUNTER,
      attributesProcessor: new ResourceAttributesProcessor(resource),
    }),
    // Apply to all Histogram metrics
    new View({
      instrumentName: '*',
      instrumentType: InstrumentType.HISTOGRAM,
      attributesProcessor: new ResourceAttributesProcessor(resource),
    }),
  ],
});
```

---

## 6. 数据流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用启动                                   │
│  packages/api/src/index.ts                                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    initTelemetry()                               │
│  packages/api/src/infrastructure/telemetry/init.ts              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 1. createTelemetryModule()                                │  │
│  │ 2. activeProvider.createResource()                        │  │
│  │    → Resource {                                           │  │
│  │         service.name: 'officeclaw-api',                   │  │
│  │         officeclaw.claw.id: 'instance-001'                │  │
│  │       }                                                   │  │
│  │ 3. new NodeSDK({                                          │  │
│  │      resource,                                            │  │
│  │      views: [                                             │  │
│  │        new View({                                         │  │
│  │          instrumentName: '*',                             │  │
│  │          attributeProcessor:                              │  │
│  │            new ResourceAttributesProcessor(resource)      │  │
│  │        })                                                 │  │
│  │      ]                                                    │  │
│  │    })                                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HTTP请求进入                                    │
│  packages/api/src/routes/messages.ts                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   fastify-hook.ts                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ onRequest → startSpan                                     │  │
│  │ onResponse → record metrics                               │  │
│  │                                                           │  │
│  │ getRequestCount().add(1, {                                │  │
│  │   http.method: 'POST',                                    │  │
│  │   http.route: '/api/messages'                             │  │
│  │ })                                                        │  │
│  │                                                           │  │
│  │ ↓ AttributesProcessor.process()                           │  │
│  │                                                           │  │
│  │ 最终attributes:                                            │  │
│  │ {                                                         │  │
│  │   service.name: 'officeclaw-api',    ← from resource      │  │
│  │   officeclaw.claw.id: 'instance-001', ← from resource      │  │
│  │   http.method: 'POST',               ← from metric        │  │
│  │   http.route: '/api/messages'        ← from metric        │  │
│  │ }                                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MetricReader                                   │
│  PeriodicExportingMetricReader                                   │
│  每30秒导出到OTLP Collector                                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OTLP Collector                                 │
│  Prometheus/Grafana                                              │
│  可使用 service.name、claw.id 作为查询维度                         │  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 测试策略

### 7.1 单元测试

| 测试文件 | 测试内容 |
|---------|---------|
| `tests/telemetry/resource-attributes-processor.test.ts` | Processor逻辑测试 |
| `tests/telemetry/init.test.ts` | SDK初始化包含View配置测试 |

**测试用例**:

```typescript
describe('ResourceAttributesProcessor', () => {
  it('should inject resource attributes into metric attributes', () => {
    const resource = new Resource({ 'service.name': 'test-service' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    expect(result).toEqual({
      'service.name': 'test-service',
      'http.method': 'GET',
    });
  });

  it('should not override existing attributes', () => {
    const resource = new Resource({ 'http.method': 'POST' });
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    expect(result['http.method']).toBe('GET');  // Existing takes priority
  });

  it('should handle empty resource', () => {
    const resource = new Resource({});
    const processor = new ResourceAttributesProcessor(resource);

    const result = processor.process({ 'http.method': 'GET' });

    expect(result).toEqual({ 'http.method': 'GET' });
  });
});
```

### 7.2 集成测试

| 测试文件 | 测试内容 |
|---------|---------|
| `tests/telemetry/metrics-integration.test.ts` | 完整流程验证 |
| `tests/telemetry/fastify-hook.test.ts` | HTTP请求指标验证 |

**验证点**:

1. Resource attributes正确注入到metric attributes
2. 现有attributes不被覆盖（优先级正确）
3. 所有指标类型都注入resource labels
4. 无resource时不影响现有metrics

---

## 8. 错误处理

### 8.1 错误场景

| 场景 | 处理策略 |
|------|---------|
| Resource为null/undefined | AttributesProcessor跳过注入，返回原有attributes |
| Resource attributes为空 | 同上 |
| AttributesProcessor异常 | 记录警告日志，继续原有attributes |
| View配置失败 | SDK初始化失败，记录错误日志，应用继续运行 |

### 8.2 Graceful Degradation

遵循现有telemetry初始化原则：
- 所有telemetry错误不影响应用启动
- 错误记录到日志后继续运行

---

## 9. 实施计划

### 9.1 实施步骤

1. 创建 `resource-attributes-processor.ts`
2. 修改 `init.ts` 添加View配置
3. 编写单元测试
4. 编写集成测试
5. 手动验证（ConsoleMetricExporter观察输出）
6. 文档更新（更新F-telemetry-metrics-analysis.md）

### 9.2 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| OpenTelemetry API变化 | View API可能在不同版本有差异 | 使用当前版本支持的API |
| Metrics数量增加 | Resource labels增加可能影响metrics存储 | Resource attributes数量少（2个），影响有限 |
| 性能影响 | AttributesProcessor每次调用都合并 | 合并操作简单，性能影响可忽略 |

---

## 10. 总结

本设计方案通过OpenTelemetry View API + 自定义AttributesProcessor，实现Resource attributes自动注入到所有metric labels。方案修改范围小（2个文件），符合OpenTelemetry标准，保持graceful degradation原则。

**关键收益**:
- Resource attributes成为metric labels
- 在Prometheus/Grafana可按service.name、claw.id查询
- 现有代码无需修改（metrics定义、记录逻辑不变）

**下一步**: 使用writing-plans skill创建详细实施计划。