---
feature_ids: [F144]
related_features: [F089, F120, F143]
topics: [preview, gateway, browser, deprecation, security, uploads]
doc_kind: spec
created: 2026-04-24
---

# F144: Preview Gateway 下线方案

> **Status**: proposed | **Owner**: Maine Coon（Codex） | **Priority**: P1
> **Trigger**: OfficeClaw 当前主产品流中已找不到 preview gateway 的真实前端入口，但 API 进程仍会默认启动 gateway、注册整组 `/api/preview/*` 路由，并保留 terminal/worktree 级端口发现耦合

## Why

当前工程已经从早期 Cat Cafe / Hub Embedded Browser 形态演进到 OfficeClaw，但 preview gateway 相关能力仍以“后端默认启动 + 路由仍注册 + 端口发现仍运行 + worktree 广播仍存在”的形式残留在系统里。

基于当前仓库代码现状，存在三个明显问题：

1. **真实使用不足**：`packages/web/src` 非测试代码中，唯一仍调用 `/api/preview/*` 的地方是 [packages/web/src/components/hub-cat-editor.client.ts](D:/ai/officeclaw/relay-claw/packages/web/src/components/hub-cat-editor.client.ts)，而且它调用的是 `/api/preview/screenshot` 来做头像图片上传；未发现任何主代码在调用 `/api/preview/open`、`/api/preview/close`、`/api/preview/navigate`、`/api/preview/auto-open`、`/api/preview/discovered` 或消费 `gatewayUrl`、`preview:auto-open`、`preview:port-discovered`。
2. **产品债务**：API 仍会在启动时初始化 `PreviewGateway`、`PreviewLeaseStore`、`PortDiscoveryService`，默认监听 `4100` 端口并注册整组 preview 路由；但对应前端 embedded browser / browser panel 主链路已不在 OfficeClaw 当前产品路径中，形成“基础设施还活着，产品入口已经消失”的半存活状态。
3. **边界混乱**：`/api/preview/screenshot` 这个仍被真实使用的接口，本质是“data URL 图片落盘到 uploads 并返回 `/uploads/...`”的上传能力，不应继续和 preview gateway / browser preview 混放在同一个命名空间和生命周期里。

因此，本 feature 的目标不是“继续修 F120”，而是**在 OfficeClaw 语境下正式下线 preview gateway / browser preview 主链路**，同时把仍有业务价值的图片落盘能力迁移到更准确的 uploads 专用链路。

## Decision

### 结论

选择 **Sunset Preview Gateway / Browser Preview 主链路**，同时 **Retain + Migrate Screenshot Upload**。

### 原因

1. 当前仓库内可见的 OfficeClaw 主路径里，看不到对 preview gateway 的真实端到端消费。
2. `html_widget` 富块仍有业务价值，但其实现是前端 `iframe srcDoc`，不依赖 preview gateway，不应作为保留 gateway 的理由。
3. terminal 侧端口发现仍保留 `worktreeId` 语义，但 terminal 会话创建本身已在 F143 后被禁用，继续保留 port discovery / preview lease / auto-open 只会加重死代码和概念噪音。
4. `/api/preview/screenshot` 的现有使用场景可以迁移到 uploads 体系，无需为了这个单点上传接口保留整套 preview 基础设施。

### 退出原则

1. **先迁移真实使用，再删除整组 preview 基础设施**：`/api/preview/screenshot` 不能与 gateway 一起直接删除。
2. **不保留“后端仍默认启动，但前端没人用”的中间态**：下线后，API 不应继续默认监听 preview gateway 端口。
3. **明确区分 browser preview 与图片上传**：data URL 图片落盘是 uploads/asset 能力，不是 browser preview 能力。
4. **不误伤 `html_widget`**：内联 HTML widget 保持可用，它不应被视为 preview gateway 的依赖方。

## Scope

### In scope

- 下线 `PreviewGateway`、`PreviewLeaseStore`、`PortDiscoveryService`
- 停止 API 进程默认启动 preview gateway，并移除相关环境变量依赖
- 删除 `/api/preview/status`、`/api/preview/validate-port`、`/api/preview/discovered`、`/api/preview/open`、`/api/preview/close`、`/api/preview/navigate`、`/api/preview/auto-open`
- 删除 terminal → port discovery → `preview:global` / `worktree:*` 广播链路
- 迁移 `/api/preview/screenshot` 到 uploads 体系下的新接口
- 清理仍直接暴露或消费 preview gateway 的运行中外围面：env registry、Hub 环境变量面板、dev/macOS 启动脚本、preview gateway 端口状态文件
- 清理前后端测试、文档、注释中对 preview gateway/browser panel 的残留假设

### Out of scope

- 不在本 feature 内重新设计新的 embedded browser 能力
- 不在本 feature 内删除 `html_widget` rich block
- 不在本 feature 内重做截图导出、页面截图、Puppeteer 导出等与 preview gateway 无关的能力
- 不在本 feature 内删除 `preview` 一词在所有历史文档、UI 文案中的命名痕迹；若仅是历史叙述 naming debt，可后续再收敛
- 不在本 feature 内重构线程 `projectPath`、`workspaceDelete*` 或 F143 已保留的线程目录生命周期能力

## Boundary Clarification

本 feature 要下线的是：

- 独立监听端口的 preview gateway（默认 `4100`）
- preview lease / token / session 机制
- 端口自动发现 + `preview:port-discovered` 广播
- `preview:auto-open` socket 事件链
- 面向 browser preview / dev server 预览的整组 `/api/preview/*` API

本 feature 明确保留的是：

- `html_widget` 富块的前端 `iframe srcDoc` 渲染能力
- 图片上传后落盘到 `uploads/` 并返回 `/uploads/...` URL 的能力
- 非 preview gateway 的一般上传/附件链路

换言之，**本 feature 下线的是 browser preview 基础设施，不是内联 HTML 可视化，也不是 uploads 图片落盘能力**。

## Current Footprint

### 1. 后端启动层

当前 API 进程仍在启动时创建并尝试启动：

- `packages/api/src/domains/preview/preview-gateway.ts`
- `packages/api/src/domains/preview/preview-lease-store.ts`
- `packages/api/src/domains/preview/port-discovery.ts`

注册位置：

- `packages/api/src/index.ts`

默认行为：

- `PREVIEW_GATEWAY_ENABLED !== '0'` 时自动启动
- 默认端口 `PREVIEW_GATEWAY_PORT ?? '4100'`
- preview routes 内部还读取 `PREVIEW_LEASE_TTL_MS`

这意味着，即使当前前端没人消费，API 仍会默认持有一条独立监听端口。

### 2. 预览路由层

当前仍注册：

- `packages/api/src/routes/preview.ts`

主要端点包括：

- `GET /api/preview/status`
- `POST /api/preview/validate-port`
- `GET /api/preview/discovered`
- `POST /api/preview/open`
- `POST /api/preview/close`
- `POST /api/preview/navigate`
- `POST /api/preview/auto-open`
- `POST /api/preview/screenshot`

其中，前七个端点服务于 browser preview / gateway 主链路；最后一个 `screenshot` 实际承担的是图片落盘。

### 3. Terminal / worktree 耦合层

当前 terminal 路由仍会把 pane stdout 喂给 `PortDiscoveryService`：

- `packages/api/src/routes/terminal.ts`

当前残留耦合包括：

- `PortDiscoveryService.feedStdout(worktreeId, paneId, line)`
- `GET /api/terminal/agent-panes/:paneId/ws` 的只读 attach 路径仍会把 agent pane 输出投喂给 `feedStdout()`
- 发现端口后广播到 `worktree:${worktreeId}` 或 `preview:global`
- `/api/preview/discovered?worktreeId=...`
- `/api/preview/auto-open` 仍接受 `worktreeId`

但与此同时，terminal 会话创建本身已在 F143 后被显式关闭；当前剩余的 preview 端口发现耦合主要来自 agent pane 观测链路，而不是用户可见的 terminal 创建主流程。这进一步说明该能力已从产品主路径退化为残余基础设施。

### 4. 前端实际消费层

当前 `packages/web/src` 非测试代码中，唯一真实 preview API 调用是：

- `packages/web/src/components/hub-cat-editor.client.ts`
  - `POST /api/preview/screenshot`

未发现任何主代码调用：

- `/api/preview/open`
- `/api/preview/close`
- `/api/preview/navigate`
- `/api/preview/auto-open`
- `/api/preview/discovered`
- `/api/preview/status`

也未发现任何主代码消费：

- `gatewayUrl`
- `preview:auto-open`
- `preview:port-discovered`
- `__preview_port`
- `__preview_session`
- `__preview_token`

### 4.1 运行中外围残留

除了 preview 主链路本身，当前仓库还有几类“活着的外围面”仍把 preview gateway 当成有效能力：

- `packages/api/src/config/env-registry.ts`
  - 仍把 `PREVIEW_GATEWAY_PORT` 作为可见 env var 暴露给 `/api/config/env-summary`
- `packages/web/src/components/HubEnvFilesTab.tsx`
  - 默认不会把 `PREVIEW_GATEWAY_PORT` 渲染成可编辑输入，但仍保留其 restart hint 语义；若 whitelist 放开，Hub 仍会把它当作可写 env 项处理
- `scripts/start-dev.sh`
  - 仍恢复/透传 `PREVIEW_GATEWAY_PORT`，并在启动前尝试回收 preview gateway 端口
- `macos/scripts/start-bundle.sh`
  - 仍为 bundle 启动分配 `PREVIEW_GATEWAY_PORT`，并写出 `preview-gateway-port` 状态文件

这些不只是历史命名痕迹，而是**当前运行、启动、运维路径仍在消费 preview gateway 概念**；若 F144 不一起清理，会形成代码删除但控制面仍暴露该能力的半下线状态。

### 5. `html_widget` 真实边界

`html_widget` 富块当前通过前端直接渲染：

- `packages/web/src/components/rich/HtmlWidgetBlock.tsx`

实现方式是：

- `<iframe srcDoc={block.html} sandbox="allow-scripts" />`

因此它**不依赖**：

- preview gateway
- preview lease
- `/api/preview/open`
- `/api/preview/auto-open`

这点必须在实施中明确保护，不能误删。

## Target State

下线完成后，系统应满足以下终态：

1. API 进程不再创建或启动 `PreviewGateway`
2. 系统中不存在独立监听 preview gateway 端口的默认行为
3. `/api/preview/status`、`validate-port`、`discovered`、`open`、`close`、`navigate`、`auto-open` 不再注册
4. terminal 不再向 `PortDiscoveryService` 喂 stdout，也不再广播 `preview:port-discovered`
5. `preview:global` / `worktree:*` 上与 preview auto-open 相关的 socket 事件链被移除
6. `html_widget` 富块继续可用，行为不变
7. 头像编辑器等仍需 data URL 图片上传的功能改为走 uploads 专用接口，而不是 `/api/preview/screenshot`
8. 文档层明确说明：OfficeClaw 中 browser preview / preview gateway 已 sunset；`html_widget` 保留；截图上传已迁移到 uploads 能力

## Implementation Plan

整个下线工作分为 **Phase 0 真实使用迁移** 和 **Phase 1-4 基础设施拆除**。

### Phase 0: 迁移仍在使用的截图上传接口

目标：先把唯一仍在使用的 `/api/preview/screenshot` 从 preview 域搬走，避免后续删除 previewRoutes 时误伤真实业务。

#### 0.1 新增 uploads 专用 data URL 图片上传接口

建议位置：

- 优先复用 `packages/api/src/routes/image-upload.ts` 的保存逻辑
- 新增一个更准确的接口，例如：
  - `POST /api/uploads/images/from-data-url`

建议原因：

- 现有逻辑本质是“data URL -> Buffer -> 上传目录 -> `/uploads/...` URL”
- 这与 preview gateway/browser preview 无关
- 放在 uploads 命名空间下更符合当前工程语义
- 应复用现有 uploads 约束，而不是新开一个更宽松的上传特例

建议约束：

- 继续只接受 image data URL（至少保持与现状一致的 `png/jpeg/webp`）
- 复用 `packages/api/src/routes/image-upload.ts` 中现有上传治理边界
  - MIME allowlist
  - 文件大小治理策略与 uploads 主链路保持一致
  - 统一的文件命名 / 落盘逻辑
- 不必在 F144 中承诺新的“精确数值上限”；但实现必须明确：
  - 若继续走 JSON `dataUrl`，有效可上传原图大小会受 API route body limit + base64 膨胀共同约束，未必等同于 multipart 上传的名义上限
  - 若希望与 uploads 主链路在实际上保持同等文件大小能力，则需要单独调整该接口的 transport 方式或 body limit，而不是只复用落盘 helper
- 返回结构保持兼容：`{ url: '/uploads/...' }`
- 为新接口补独立测试，覆盖合法图片、非法 data URL、超限文件三个基本分支

#### 0.2 前端调用点切换

修改：

- `packages/web/src/components/hub-cat-editor.client.ts`

动作：

- 从 `/api/preview/screenshot` 切换到新的 uploads 接口
- 保持返回结构兼容：仍返回 `{ url: '/uploads/...' }`

#### 0.3 可选兼容期

短期可选策略：

- 在一个短暂版本窗口里让 `/api/preview/screenshot` 返回 `410 Gone` 或 `301/308` 风格提示性错误
- 或直接删除旧端点，前提是仓库内唯一调用点已同步完成

本 feature 推荐：

- **同版切换前端并删除旧端点，不保留兼容层**

原因：

- 当前仓库内唯一主代码调用点是可控的
- 保留旧端点只会继续延长 preview 命名污染

### Phase 1: 下线 preview gateway 启动与注册

#### 1.1 停止 API 启动 preview gateway

修改：

- `packages/api/src/index.ts`

动作：

- 删除 `PreviewGateway`、`PreviewLeaseStore`、`PortDiscoveryService` 的初始化
- 删除 `previewGateway.start()` / `previewGateway.stop()`
- 删除 `PREVIEW_GATEWAY_ENABLED` / `PREVIEW_GATEWAY_PORT` 的启动时读取
- 删除 `PREVIEW_LEASE_TTL_MS` 的残留配置语义

#### 1.2 停止注册 preview routes

修改：

- `packages/api/src/index.ts`

动作：

- 不再注册 `previewRoutes`

说明：

- 这是最直接的 fail-closed
- 不应保留“后端继续注册，但返回 unavailable”的伪下线模式

### Phase 2: 删除 preview route 实现

文件：

- `packages/api/src/routes/preview.ts`

动作：

- 删除整个 route 文件
- 删除 preview route 相关类型依赖

前提：

- Phase 0 的截图上传迁移已完成

### Phase 3: 删除端口发现 / terminal 耦合

文件：

- `packages/api/src/domains/preview/port-discovery.ts`
- `packages/api/src/routes/terminal.ts`
- `packages/api/src/index.ts`
- `packages/api/src/infrastructure/websocket/SocketManager.ts`（如仍需收紧 room whitelist）
- `packages/api/src/domains/terminal/tmux-agent-spawner.ts`（仅需确认 agent pane 注册逻辑仍被保留，但不再服务 preview 发现链）

动作：

- 删除 `PortDiscoveryService`
- 删除 terminal / agent-pane stdout → `feedStdout()` 逻辑
- 删除 `preview:port-discovered` 广播
- 删除 `preview:auto-open` 相关 socket 广播
- 如 room whitelist 中 `preview:global` 只为这条链路服务，则一并清理

### Phase 4: 删除 gateway / lease 实现与文档残留

文件：

- `packages/api/src/domains/preview/preview-gateway.ts`
- `packages/api/src/domains/preview/preview-lease-store.ts`
- `packages/api/src/domains/preview/types.ts`
- `packages/api/src/domains/preview/bridge-script.ts`
- `packages/api/src/domains/preview/ws-patch-script.ts`
- `packages/api/src/domains/preview/preview-origin.ts`
- `packages/api/src/domains/preview/port-validator.ts`

动作：

- 删除仅服务 browser preview/gateway 的实现
- 若 `validatePort()` 中存在对其他路由的复用，再决定是否抽成独立 util；否则整体删除
- 清理 `AuditEventTypes.BROWSER_PREVIEW_OPEN/CLOSE/NAVIGATE`
- 将 screenshot 上传迁移后的审计语义改到更准确的 uploads/asset 事件，或直接删除该审计点；不能继续复用 browser preview 事件名

### Phase 5: 文档与测试清理

目标：避免仓库继续给出“preview gateway 仍是有效主能力”的错误信号。

文档层：

- 更新 `docs/features/F120-hub-embedded-browser.md`
- 更新 `docs/features/F143-workspace-sunset.md`
- 归档或标记 `docs/architecture/preview-gateway-loopback-ssrf-fix.md`
- 更新与打包/运行态有关的说明，避免继续暗示 preview gateway 是 bundle/runtime contract 的组成部分

测试层：

- 删除或改写 preview gateway / preview routes / port discovery / auto-open 相关测试
- 为新的 uploads data URL 接口补测试
- 保留 `html_widget` 相关测试，不应回归

## Cleanup Inventory

### 后端删除 / 修改

| 类型 | 文件 | 动作 |
|------|------|------|
| 启动逻辑 | `packages/api/src/index.ts` | 删除 preview gateway 初始化、启动、停止、route registration |
| 路由 | `packages/api/src/routes/preview.ts` | 删除；截图上传迁移后整体移除 |
| 域逻辑 | `packages/api/src/domains/preview/preview-gateway.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/preview-lease-store.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/port-discovery.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/bridge-script.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/ws-patch-script.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/types.ts` | 删除或拆空 |
| 域逻辑 | `packages/api/src/domains/preview/preview-origin.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/preview/port-validator.ts` | 若无复用则删除 |
| terminal 耦合 | `packages/api/src/routes/terminal.ts` | 删除 preview port discovery 投喂 |
| websocket | `packages/api/src/infrastructure/websocket/SocketManager.ts` | 若 `preview:global` 仅为此链路服务则删除 |
| env registry | `packages/api/src/config/env-registry.ts` | 删除 `PREVIEW_GATEWAY_PORT` 等 preview gateway 相关可见 env 定义 |
| 上传迁移 | `packages/api/src/routes/image-upload.ts` | 新增 data URL 图片落盘 helper 或复用保存逻辑 |
| 新上传路由 | `packages/api/src/routes/...` | 新增 uploads 专用 data URL 上传接口 |
| config UI | `packages/web/src/components/HubEnvFilesTab.tsx` | 删除 preview gateway 的 restart hint / 命名残留；不再暗示该能力可配置 |
| dev 启动脚本 | `scripts/start-dev.sh` | 删除 preview gateway 端口恢复、占口回收、启动摘要残留 |
| macOS bundle | `macos/scripts/start-bundle.sh` | 删除 preview gateway 端口分配与 `preview-gateway-port` 状态文件 |
| 审计常量 | `packages/api/src/domains/cats/services/orchestration/EventAuditLog.ts` | 删除或迁移 browser preview 事件类型 |

### 前端删除 / 修改

| 类型 | 文件 | 动作 |
|------|-------------|------|
| 唯一真实调用点 | `packages/web/src/components/hub-cat-editor.client.ts` | 改为调用 uploads 专用接口 |
| `html_widget` | `packages/web/src/components/rich/HtmlWidgetBlock.tsx` | 保留，不改逻辑 |
| 历史测试 | `packages/web/src/components/__tests__/browser-panel-strict-mode-tab.test.ts` | 删除或归档 |
| 其他 preview 相关测试 | `packages/web/src/components/__tests__/preview-*.test.ts` | 仅保留仍有价值的纯工具测试；gateway 专属测试删除 |
| Hub env UI 测试 | `packages/web/src/components/__tests__/hub-env-files-tab.test.tsx` | 移除对 `PREVIEW_GATEWAY_PORT` 的断言 |

## Feature Truth Updates

### F120 的真值需要收敛

当前 `F120-hub-embedded-browser.md` 仍把 preview gateway、`preview:auto-open`、browser preview 视为保留能力边界。  
若 F144 实施，应把 F120 的真值更新为：

1. browser preview / preview gateway 在 OfficeClaw 中 sunset
2. `html_widget` 保留，但不再和 browser preview 共用一套能力叙述
3. 若未来仍需 browser preview，应作为新 feature 重新立项，而不是继续保留当前残余基础设施

### F143 中对 F120 的保留判断需要细化

`F143-workspace-sunset.md` 目前的表述是：

- F120 保留 feature，移除 workspace 依赖

若 F144 实施，应更新为：

- F120 中与 preview gateway / browser panel 相关的子能力 sunset
- `html_widget` 或其他内联可视化能力若仍保留，应单独明确归属

## Risks

1. **仓库外隐式调用风险**：虽然当前仓库内未发现 preview gateway 的前端真实入口，但不能 100% 排除仓库外部客户端或手工脚本仍在调用 `/api/preview/*`。
2. **截图上传接口切换风险**：`/api/preview/screenshot` 迁移时，如果前端调用点遗漏，会导致头像上传失败。
3. **大小语义漂移风险**：如果新接口继续使用 JSON `dataUrl` 但文档口径仍沿用 uploads multipart 的名义大小上限，实际可上传文件大小会比预期更小，形成隐性回归。
4. **控制面残留风险**：如果代码层删除了 preview gateway，但 env registry、Hub UI、启动脚本仍暴露 `PREVIEW_GATEWAY_PORT` 或 preview gateway 状态文件，团队会误以为该能力仍可配置/仍受支持。
5. **文档真值漂移风险**：如果只删代码、不同步 F120/F143 文档和运行态说明，团队会继续误以为 preview gateway 仍是有效产品能力。
6. **测试面收尾风险**：preview 相关测试当前覆盖了 routes、gateway、port discovery、bridge、env UI、启动脚本等多层，删除时需要接受成片移除，而不是逐个保留旧断言。
7. **审计命名残留风险**：如果 screenshot 上传迁出 preview 域，但仍继续写入 `browser_preview_*` 事件，会让审计数据继续传递错误产品语义。

## Open Questions

1. 新的 data URL 图片上传接口是否只服务当前头像编辑器，还是需要直接抽象成 uploads 公共 asset API，并提前定义调用方约束？
2. `preview:global` room 在 websocket whitelist 中是否还有其他用途？若没有，应在 F144 中一起删除。
3. `docs/architecture/preview-gateway-loopback-ssrf-fix.md` 是作为已废弃架构记录保留，还是迁到 archive/retrospective 目录？

## Acceptance Criteria

- [ ] AC-1: API 进程不再启动 preview gateway，也不再默认监听 `4100` 端口
- [ ] AC-2: `PreviewGateway`、`PreviewLeaseStore`、`PortDiscoveryService` 从主代码中删除
- [ ] AC-3: `/api/preview/status`、`validate-port`、`discovered`、`open`、`close`、`navigate`、`auto-open` 不再注册
- [ ] AC-4: `packages/web/src` 中不存在对 `/api/preview/open|close|navigate|auto-open|discovered|status` 的真实调用
- [ ] AC-5: `html_widget` 继续可用，不依赖 preview gateway
- [ ] AC-6: `hub-cat-editor.client.ts` 的图片上传改为走 uploads 专用接口
- [ ] AC-7: `/api/preview/screenshot` 从 preview 域移除；若保留兼容层，必须有明确 sunset 期限
- [ ] AC-8: terminal 不再向 preview port discovery 投喂 stdout，也不再广播 `preview:port-discovered`
- [ ] AC-9: preview 相关测试被删除或迁移，测试集不再假设 preview gateway/browser panel 仍存在
- [ ] AC-10: F120 / F143 / 架构文档同步更新，明确 browser preview 已 sunset
- [ ] AC-11: `PREVIEW_GATEWAY_PORT` / `PREVIEW_GATEWAY_ENABLED` / `PREVIEW_LEASE_TTL_MS` 不再作为 OfficeClaw 当前运行态支持能力暴露在主代码路径中
- [ ] AC-12: Hub 环境变量面板、env summary、dev/macOS 启动脚本不再暴露或消费 preview gateway 端口语义
- [ ] AC-13: 新的 uploads data URL 接口复用现有 MIME / 文件大小治理边界，并补齐对应测试
- [ ] AC-14: 主代码与审计常量中不再保留 `browser_preview_*` 事件语义；若截图上传保留审计，需迁移到更准确的 uploads/asset 命名

## Follow-ups

1. 若未来确实需要在 OfficeClaw 中恢复 browser preview，应基于当前产品路径重新设计，而不是直接复活现有 preview gateway 代码。
2. 可考虑把 `html_widget` 的 feature truth 从 F120 中拆出，归入更准确的 rich block / visualization feature 家族。
3. data URL 图片上传若后续复用场景增加，可进一步标准化为 uploads/asset 公共能力，而不是由单个前端页面私有调用。
