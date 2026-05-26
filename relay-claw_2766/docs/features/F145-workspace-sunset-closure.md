---
feature_ids: [F145]
related_features: [F063, F082, F089, F120, F131, F143]
topics: [workspace, closure, migration, ppt, artifact, tests]
doc_kind: spec
created: 2026-04-29
---

# F145: Workspace Sunset 收口实施方案

> **Status**: proposed | **Owner**: Maine Coon（Codex） | **Priority**: P1
> **Trigger**: F143 已完成 workspace API 下线，但基于审计文档确认系统仍存在运行时残留、PPT live protocol 残留、前端状态残留以及测试/契约层残留，继续阻碍整体收口

## Why

F143 的目标是下线 workspace 文件服务能力，但当前系统实际处于“主链已迁移、残留仍活跃”的中间态。

基于审计文档 [docs/discussions/f143-workspace-impact-audit.md](../discussions/f143-workspace-impact-audit.md)，至少还存在以下五类问题：

1. **运行时断点未收口**：例如 `PptSessionCard` 仍调用 `/api/workspace/local-file-meta`，导致右侧 PPT 成品卡片状态校验不可靠。
2. **legacy workspace 协议仍在持续产出**：后端仍会继续生成新的 `/api/workspace/download?...` rich block 和正文“文件位置”披露。
3. **PPT live protocol 仍传播旧语义**：虽然安全边界已迁到 `projectRoot`，但 `worktreeId` 仍在请求、响应、session snapshot、message context 和 prompt 语义中活跃流动。
4. **测试 / 契约仍在强化旧行为**：部分测试已经与当前运行时冲突，另一些测试则把当前的 legacy 行为固化成正确预期，持续阻碍后续修复。
5. **替代链路的边界语义还未完全显式化**：当前 `projects` 本地文件接口已经承担了 workspace sunset 后的主要打开 / 校验职责，但其 `projectPath` / project-boundary 约束还没有在本轮收口目标里被明确要求。

这意味着 F143 解决了“直接暴露 workspace API”这件事，但没有完成“把运行时、协议、状态和测试层全部收束到新链路”这件事。

因此，F145 的目标不是重新讨论是否保留 workspace，而是**对 F143 后的过渡态进行工程收口**，把系统从“半迁移状态”推进到“边界明确、协议统一、测试对齐”的稳定状态。

## Decision

### 结论

选择 **Closure（收口）**，而不是继续保持现有兼容壳长期存在。

### 原因

1. 当前残留已经不再只是命名债务，而是会影响用户页面体验、工程理解和测试演进。
2. 如果不在这一阶段明确目标状态，后续功能会继续围绕 `worktreeId`、legacy rich block 和旧测试预期扩散。
3. 审计文档已经足够说明问题面，当前缺少的是面向实施的目标状态、分阶段步骤和测试迁移策略。

### 收口原则

1. **先修真实用户可见断点，再收协议和测试**：优先处理仍受影响的页面行为。
2. **先停止继续产出 legacy 数据，再清理消费端兼容壳**：避免边修边继续制造旧协议数据。
3. **区分“兼容历史消息”和“继续生成新 legacy 数据”**：历史降级可以保留，新生成必须停止。
4. **测试必须跟随正式契约，而不是反向定义契约**：凡是旧 workspace 行为不再是目标状态，就不能继续由测试固化为正确预期。
5. **PPT 体系单独处理**：PPT 不再被视为“只是个 store 兼容字段问题”，而是单独的一组 live protocol 收口任务。

## Scope

### In scope

- 修复 `PptSessionCard` 对已下线 `/api/workspace/local-file-meta` 的残留调用
- 停止后端继续生成新的 `/api/workspace/download?...` file rich block
- 停止正文“文件位置”继续输出 legacy workspace URL
- 收敛 PPT preview/session/export/message context/prompt 中的 `worktreeId` live protocol 语义
- 将 PPT store / type 层中仍活跃传播 `worktreeId` 的状态模型一起收口，避免仅改 request/response 但前端状态继续携带旧语义
- 梳理并调整前端 `workspace` 状态残留，至少消除继续强化旧模式的入口
- 收紧 `projects` 本地文件接口的边界语义，使其与 thread/projectPath 的目标边界一致，而不是仅作为“能打开绝对路径”的替代壳
- 清理或改写仍强化旧 workspace 契约的测试
- 明确哪些历史兼容逻辑继续保留，哪些不再允许新产出

### Out of scope

- 不在本 feature 内恢复 Workspace Explorer / WorkspacePanel
- 不在本 feature 内重新设计新的通用本地文件浏览器
- 不在本 feature 内修改线程默认工作目录机制（`projectPath` / 默认目录创建 / 删除线程时目录处理）
- 不在本 feature 内重做整个 PPT Studio 产品交互，仅收口 workspace 残留语义
- 不在本 feature 内清扫所有命名上的 `workspace` 历史痕迹；只处理会影响运行时、协议、状态或测试契约的活跃残留

## Target State

F145 完成后，系统应满足以下终态：

1. **PPT 成品文件卡片全部走 `projects` 链路**
   `PptSessionCard` 不再调用任何 `/api/workspace/*` 路由；其元信息读取、打开文件、打开文件夹与普通本地生成文件卡片保持一致。

2. **`projects` 本地文件链路具备明确的 project-boundary 语义**
   `local-file-meta` / `open-local` / `open-local-folder` 不再只是“接收绝对路径”，而是具备明确请求体契约、root 推导顺序、相对路径解析规则和越界错误语义，并与 thread/projectPath 或明确允许的 project root 边界保持一致，避免 F145 只是把问题从 workspace 路由平移到另一个宽接口。

3. **系统不再生成新的 workspace 文件 rich block**
   新消息中不再出现由运行时新生成的 `/api/workspace/download?...` file rich block。历史消息仍允许按 legacy 方式降级展示。

4. **正文文件位置不再披露 workspace URL**
   `appendGeneratedFileLocationDisclosure(...)` 不再把 `/api/workspace/download?...` 当作正式输出位置。若需要披露位置，应使用相对路径、项目内路径或新的专用 artifact 位置表示。

5. **PPT live protocol 不再把 `worktreeId` 作为活跃正式语义传播**
   `projectRoot` 成为 PPT preview/session/export/message context 的正式边界语义。`worktreeId` 若保留，只能作为过渡兼容字段，且不能继续影响主协议设计；前端 session store / type model 也不再把它当作活跃字段持续回写。

6. **前端 workspace 状态不再被继续强化**
   至少应移除或冻结那些仍会主动把 UI 切换到 `rightPanelMode='workspace'` 的入口，避免页面上已不存在的模式继续被活跃写入。

7. **测试与正式契约对齐**
   所有仍把旧 workspace 行为当作正确结果的测试，要么改写为新契约，要么删除；不允许继续用测试固化 legacy 目标状态。

8. **历史兼容边界明确**
   继续保留的仅限于：历史消息中的 legacy workspace file/image/link 的只读降级展示；不再保留“新数据继续生成 legacy workspace 协议”的能力。

## Non-Goals by Area

### Message / Artifact

F145 不要求设计一个全新的 artifact 子系统，但要求停止继续使用 workspace URL 作为新 artifact 的正式输出协议。

### Projects Local File APIs

F145 不重做整个 `projects` 路由体系，但要求把本轮实际依赖到的 `local-file-meta` / `open-local` / `open-local-folder` 明确收紧到与 projectPath / project root 一致的边界语义，并把请求体 / root 推导 / 越界返回语义写成稳定契约，避免直接破坏已恢复链路。

### PPT

F145 不重做 PPT Studio 的交互，不要求一次性删光所有 `worktreeId` 字段，但要求它不再作为 live protocol 的核心部分继续流动。

### Frontend Store

F145 不要求一次性删除所有 `workspace*` 命名字段，但要求停止继续把这些状态作为活跃页面入口强化。

## Implementation Plan

整个收口分为 **Phase 1 用户可见断点修复**、**Phase 2 协议产出收口**、**Phase 3 PPT live protocol 收口**、**Phase 4 状态与测试收口**。

### Phase 1: 修复用户可见断点

目标：先解决仍会直接影响页面行为的运行时问题。

#### 1.1 `PptSessionCard` 元信息链路迁移

修改：

- `packages/web/src/components/cli-output/CliOutputBlock.tsx`
- `packages/web/src/components/ppt-studio/PptSessionCard.tsx`
- `packages/api/src/routes/projects.ts`

动作：

- 将 `/api/workspace/local-file-meta` 替换为 `/api/projects/local-file-meta`
- 对齐 `CliOutputBlock` 的元信息读取逻辑
- 保持 `local-file-meta` / `open-local` / `open-local-folder` 的请求体外形稳定为 `{ path: string; projectPath?: string }`，避免直接打断已恢复调用方
- 明确 `projects` 本地文件接口的正式契约：
  - `path` 允许继续沿用当前主链的绝对路径输入，以兼容已恢复卡片链路
  - 若 `path` 为相对路径，必须在服务端先解析出 effective project root，再按该 root 解析；不允许相对路径脱离 project root 独立求值
  - `projectPath` 若显式提供且不为 `default`，优先作为 effective project root
  - F145 的主链要求调用方显式传入 effective project root：当 thread `projectPath === default` 时，客户端必须先用 `/api/projects/cwd` 解析出 `defaultProjectPath`，再把该绝对路径作为 `projectPath` 传入；不能依赖“服务端知道当前 thread”
  - 当前 `trusted project identity` 仅能证明用户 / 客户端身份，不能唯一定位 thread；因此在不扩展请求体为 `threadId` 之前，F145 不把“服务端按当前 thread 推导 root”写成正式主链契约
  - 若 `projectPath` 缺失或为 `default`，服务端只能走受限兼容分支：
    - 仅处理可规范化为绝对路径的请求
    - 仅当目标路径位于 configured allowed roots 内时才允许继续
    - 若无法安全确定 root 或目标不在 allowed roots 内，返回 `409` 或 `403`，而不是退回全局 cwd 宽放行
  - 服务端完成 root 推导或兼容判定后，绝对路径与相对路径都必须收敛为同一个 canonical absolute target
  - 对带 `projectPath` 的主链请求，必须先验证 effective project root 自身位于 configured allowed roots 内，再验证 target 位于 effective project root 内；`allowed roots` 不能被实现成“target 落在任意 allowed root 即放行”
  - 只有没有 thread/project root 语义的兼容分支，才允许直接按 configured allowed roots 判断 target，且必须有单独测试覆盖
  - `local-file-meta` / `open-local` 继续保留扩展名白名单，但白名单校验只能发生在 boundary 校验之后的目标文件上，不能替代 boundary
- 明确错误语义：
  - `400`：`path` 缺失、格式非法、扩展名不支持、目标类型不匹配
  - `403`：目标路径解析成功，但越过 effective project root；或兼容分支下越过 configured allowed roots
  - `404`：目标文件或文件夹不存在
  - `409`：请求本身合法，但调用方未提供可用 `projectPath`，且服务端也无法安全进入兼容分支完成 boundary 判定
- 明确测试矩阵至少覆盖：
  - 显式 `projectPath` + root 内绝对路径
  - `projectPath === default` 时，客户端先解析 `defaultProjectPath` 再请求
  - root 内相对路径解析
  - root 外绝对路径
  - 缺失 `projectPath` 时的 allowed-roots 兼容分支
  - 无法安全确定 root 的请求返回 `409`
  - 不支持扩展名 / 类型不匹配
- 保持 `open-local` / `open-local-folder` 现有新链路不变

验收：

- PPT Studio 右侧成品卡片可以正确显示生成时间
- 生成中轮询状态与真实文件状态一致
- 不再出现对 `/api/workspace/local-file-meta` 的运行时请求
- 普通生成文件卡片与 PPT 成品卡片在 `projectPath === default`、显式 `projectPath`、相对路径 / 绝对路径三类场景下都不发生新增 403
- `projects` 本地文件接口与 F145 目标边界一致，不会只是把旧风险平移到新的宽接口

### Phase 2: 停止继续产出 legacy workspace 文件协议

目标：先堵住“新消息继续生成旧协议”的源头。

#### 2.1 停止新建 workspace file rich block

修改：

- `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`

动作：

- 删除或停用 `buildWorkspaceFileRichBlocks(...)` 在新消息链路中的产出
- 保留 `ppt_studio_page` 这类仍有业务价值的 signal，但不再附带 workspace file block
- 明确 provider `file_change` 的正式文件展示策略，不能只“删旧 block 不补决策”：
  - 默认正式来源是 `send_file_to_user` 与已存在的非 workspace 专用 signal
  - 若某类用户可见产物当前只会通过 provider `file_change` 暴露，则必须在移除 legacy workspace file block 之前，把它转换为新的非 workspace artifact / file signal，或明确写入本 feature 的行为变更与验收

验收：

- 新生成 `.ppt/.pptx` 文件时，消息中不再出现 `/api/workspace/download?...` file rich block
- 不会因为停掉 legacy workspace file block 而让原本仍需展示的 provider 产物直接从聊天区消失；若某类文件明确改为“不展示卡片”，该行为必须在方案与测试中被显式记录

#### 2.2 停止正文披露 workspace URL

修改：

- `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts`
- 接入点：
  - `packages/api/src/domains/cats/services/agents/routing/route-serial.ts`
  - `packages/api/src/domains/cats/services/agents/routing/route-parallel.ts`
  - `packages/api/src/routes/callbacks.ts`

设计选择：

优先采用以下策略之一：

1. **相对路径披露**：例如 `output/report.docx`
2. **项目内路径披露**：例如 `Pages directory` / `Output path`
3. **新专用 artifact 位置描述**：如未来已有统一 artifact 协议，可改为该协议

明确不再允许：

- 正文中继续输出 `/api/workspace/download?...`
- `resolveArtifactLocation()` 与 `contentHasArtifactDisclosure()` 使用不同 canonical location 语义，导致同一文件重复追加披露

验收：

- 新消息正文中的“文件位置”不再包含 workspace URL
- 当正文已包含新的 canonical location 表达时，不会重复追加同一文件的“文件位置”披露

### Phase 3: PPT live protocol 收口

目标：把 PPT 从“主链已经迁走，但 live protocol 仍在跑旧语义”的状态推进到“正式以 `projectRoot` 为边界”。

#### 3.1 收敛 preview/session live request

修改：

- `packages/web/src/components/ppt-studio/PptStudioPanel.tsx`
- `packages/web/src/components/ppt-studio/PptSlideStrip.tsx`
- `packages/web/src/components/ppt-studio/PptCanvasFrame.tsx`
- `packages/web/src/components/ppt-studio/ppt-preview-canvas.ts`
- `packages/web/src/stores/ppt-preview-store-helpers.ts`
- `packages/web/src/components/ppt-studio/ppt-studio-types.ts`
- `packages/api/src/routes/ppt-studio.ts`
- `packages/api/src/domains/ppt/ppt-studio-service.ts`

动作：

- 前端轮询 `/api/ppt-studio/session` 时不再继续携带 `worktreeId`
- slide URL 不再继续拼接 `worktreeId`
- `PptSlideStrip` / `PptCanvasFrame` 等 UI 组件 prop 不再接受或转发 `worktreeId`，避免类型层和组件层把旧字段重新拉回主链
- 前端 session store / type model 不再继续把 `payload.worktreeId` 作为活跃字段回写和传播
- 后端 session snapshot / slide meta 不再把 `worktreeId` 作为正式返回字段继续回写；如短期保留，须明确为兼容字段且不继续驱动前端逻辑

验收：

- 新的 PPT preview/session 协议请求与响应中，主链不再依赖 `worktreeId`
- 前端 PPT session 状态模型不再继续把 `worktreeId` 当作活跃协议字段保存和扩散
- PPT 预览 UI 组件层不再通过 props 继续传播 `worktreeId`

#### 3.1b 收敛 export request / result

修改：

- `packages/web/src/components/ppt-studio/PptStudioPanel.tsx`
- `packages/api/src/routes/ppt-studio.ts`
- `packages/api/src/domains/ppt/ppt-studio-service.ts`

动作：

- `POST /api/ppt-studio/export` 不再把 `worktreeId` 作为正式输入参数要求
- export 调用前端不再主动发送 `worktreeId`
- export result 不再把 `worktreeId` 作为正式返回字段；如短期保留，仅能作为兼容字段存在，且前端不得依赖

验收：

- export 主链请求、响应和调用方都不再以 `worktreeId` 作为正式协议字段

#### 3.2 收敛消息契约与 prompt 语义

修改：

- `packages/api/src/routes/messages.schema.ts`
- `packages/api/src/domains/ppt/ppt-context.ts`
- `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx`
- `packages/web/src/components/cli-output/use-cli-output-ppt-preview.ts`

动作：

- `pptContext` 的正式输入语义收敛到 `projectRoot + pagesDir`
- system prompt 不再把 `Worktree ID` 作为正式 deck context 提示
- 前端构建 `PptMessageContext` 时停止把 `worktreeId` 当作正式上下文字段传播

兼容策略：

- 如历史数据中仍存在 `worktreeId`，可在解析层容忍，但不再继续作为新消息的首选输出和主语义

验收：

- PPT 消息上下文和系统提示中不再依赖 `worktreeId` 作为主要定位语义

### Phase 4: 前端状态与测试 / 契约收口

目标：停止继续强化旧 workspace 模式，并让测试与新的正式契约一致。

#### 4.1 前端 workspace 状态收口

修改：

- `packages/web/src/stores/chatStore.ts`
- 相关调用方测试与逻辑

动作：

- 盘点所有仍会主动写入 `rightPanelMode='workspace'` 的入口
- 至少处理以下会主动切换 `workspace` 面板模式的入口：
  - `setWorkspaceOpenFile(...)`
  - `setWorkspaceRevealPath(...)`
  - `setPendingPreviewAutoOpen(...)`
- 即使短期保留相关状态字段，也不能再让这些 setter 把 UI 切向已下线模式
- 如短期不能删除所有 `workspace*` 状态，至少冻结其扩展，不再让新逻辑继续依赖它们

验收：

- 页面上不再存在仍会主动切换到 `workspace` 面板模式的真实入口

#### 4.2 测试 / 契约迁移

需要处理的测试应至少拆成两组，而不是只列少量代表样本：

1. **workspace URL / legacy file 协议下线**

- `packages/api/test/generated-file-artifacts.test.js`
- `packages/api/test/codex-event-transform.test.js`
- `packages/api/test/parse-multipart.test.js`
- `packages/web/src/components/__tests__/markdown-content-workspace-links.test.ts`

2. **PPT `worktreeId` 去语义化 / 兼容解析**

- `packages/web/src/components/__tests__/ppt-preview-canvas-helpers.test.ts`
- `packages/web/src/components/__tests__/ppt-canvas-frame.test.tsx`
- `packages/web/src/components/__tests__/ppt-preview-chat-integration.test.ts`
- `packages/web/src/components/__tests__/ppt-studio-store.test.ts`
- `packages/web/src/stores/__tests__/ppt-preview-store-helpers.test.ts`
- `packages/web/src/components/__tests__/cli-output-ppt-preview-sync.test.tsx`
- `packages/web/src/components/__tests__/ppt-studio-send-context.test.tsx`
- `packages/web/src/hooks/__tests__/useAgentMessages-ppt-studio.test.ts`
- `packages/web/src/components/__tests__/cli-output-integration.test.ts`
- `packages/web/src/components/ppt-studio/__tests__/PptSessionCard-streaming-stability.test.tsx`
- `packages/web/src/components/__tests__/ppt-studio-panel.test.tsx`
- `packages/api/test/ppt-studio-routes.test.js`
- `packages/api/test/messages-ppt-context.test.js`
- `packages/api/test/response-security-headers.test.js`

3. **前端 workspace 状态残留**

- `packages/web/src/components/__tests__/preview-auto-open-store.test.ts`

分类策略：

1. **当前已与运行时冲突的测试**
   例如 `parse-multipart`、`markdown workspace link`
   动作：直接改写到新契约

2. **当前仍与 legacy 运行时一致，但会阻碍后续收口的测试**
   例如 `generated-file-artifacts`、`codex-event-transform`
   动作：与 Phase 2 一起改写，不再把 workspace URL 视为正确目标状态

3. **当前在 PPT 主链中把 `worktreeId` 当正式语义的测试**
   例如 `ppt-preview-canvas-helpers`、`ppt-preview-chat-integration`、`ppt-studio-routes`
   动作：区分“兼容解析仍容忍旧字段”与“新主链不再依赖旧字段”两类断言，分别改写，避免 Phase 3 实施后大面积红灯但没有迁移规则

4. **与运行时一起继续强化旧状态语义的测试**
   例如 `preview-auto-open-store`
   动作：待 store 收口设计确定后同步改写

验收：

- 不再存在把 `/api/workspace/download?...` 当成新正式协议的测试
- 不再存在把“在工作区中打开”当成当前 markdown 相对链接行为的测试
- 不再存在把 `worktreeId` 当成 PPT preview/session/export/message context 新正式语义的测试
- 不再存在继续把 `rightPanelMode='workspace'` 视为活跃页面模式的新增测试语义

## Compatibility Strategy

### 保留的兼容

允许保留：

1. 历史消息中的 legacy workspace file/image/link 的只读降级展示
2. 历史数据解析阶段对旧字段的容忍

### 不再允许的兼容

不再允许：

1. 新消息继续产出 `/api/workspace/download?...` file rich block
2. 正文继续披露 workspace URL
3. 新的 PPT preview/session/export/message context 主链继续传播 `worktreeId` 作为正式语义
4. 新功能继续把 `rightPanelMode='workspace'` 当作活跃 UI 模式

## File-Level Change List

### Runtime

- `packages/web/src/components/cli-output/CliOutputBlock.tsx`
- `packages/web/src/components/ppt-studio/PptSessionCard.tsx`
- `packages/api/src/routes/projects.ts`
- `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`
- `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts`
- `packages/api/src/domains/cats/services/agents/routing/route-serial.ts`
- `packages/api/src/domains/cats/services/agents/routing/route-parallel.ts`
- `packages/api/src/routes/callbacks.ts`

### PPT Protocol

- `packages/web/src/components/ppt-studio/PptStudioPanel.tsx`
- `packages/web/src/components/ppt-studio/PptSlideStrip.tsx`
- `packages/web/src/components/ppt-studio/PptCanvasFrame.tsx`
- `packages/web/src/components/ppt-studio/ppt-preview-canvas.ts`
- `packages/web/src/stores/ppt-preview-store-helpers.ts`
- `packages/web/src/components/ppt-studio/ppt-studio-types.ts`
- `packages/api/src/routes/ppt-studio.ts`
- `packages/api/src/domains/ppt/ppt-studio-service.ts`
- `packages/api/src/routes/messages.schema.ts`
- `packages/api/src/domains/ppt/ppt-context.ts`
- `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx`
- `packages/web/src/components/cli-output/use-cli-output-ppt-preview.ts`

### State / Tests

- `packages/web/src/stores/chatStore.ts`
- `packages/web/src/components/__tests__/ppt-preview-canvas-helpers.test.ts`
- `packages/web/src/components/__tests__/ppt-canvas-frame.test.tsx`
- `packages/web/src/components/__tests__/ppt-preview-chat-integration.test.ts`
- `packages/web/src/components/__tests__/ppt-studio-store.test.ts`
- `packages/web/src/stores/__tests__/ppt-preview-store-helpers.test.ts`
- `packages/web/src/components/__tests__/cli-output-ppt-preview-sync.test.tsx`
- `packages/web/src/components/__tests__/ppt-studio-send-context.test.tsx`
- `packages/web/src/hooks/__tests__/useAgentMessages-ppt-studio.test.ts`
- `packages/web/src/components/__tests__/cli-output-integration.test.ts`
- `packages/web/src/components/ppt-studio/__tests__/PptSessionCard-streaming-stability.test.tsx`
- `packages/web/src/components/__tests__/ppt-studio-panel.test.tsx`
- `packages/api/test/generated-file-artifacts.test.js`
- `packages/api/test/codex-event-transform.test.js`
- `packages/api/test/messages-ppt-context.test.js`
- `packages/api/test/ppt-studio-routes.test.js`
- `packages/api/test/response-security-headers.test.js`
- `packages/api/test/parse-multipart.test.js`
- `packages/web/src/components/__tests__/markdown-content-workspace-links.test.ts`
- `packages/web/src/components/__tests__/preview-auto-open-store.test.ts`

## Verification Plan

### Manual verification

1. 生成普通文档文件后，聊天区文件卡片可正常显示、打开、打开文件夹
2. 生成 PPT 后，右侧 `PptSessionCard` 可正确显示生成时间和状态
3. 新消息中不再出现 `/api/workspace/download?...` file rich block
4. 新消息正文中的“文件位置”不再出现 workspace URL
5. `PPT Studio` preview/session/export 请求与响应主链不再把 `worktreeId` 作为正式活跃语义传播
6. `projects` 本地文件接口在当前线程 / projectPath 语义下仍然可用，且不会越过本轮定义的 project-boundary
7. 当正文已含新的文件位置表达时，不会重复追加“文件位置”披露

### Automated verification

至少补齐或修正以下测试方向：

1. `PptSessionCard` 元信息接口迁移测试
2. `projects` 本地文件接口的 project-boundary / projectPath 约束测试，覆盖显式 root、默认 root 推导、相对路径解析、越界 403、root 无法推导 409
3. `codex-event-transform` 不再生成 workspace file rich block
4. `generated-file-artifacts` 使用新的 canonical location 披露语义，且正文已含该位置时不重复追加
5. `parseMultipart` 只验证 `/uploads/...` 主链
6. markdown 相对链接只读降级测试
7. preview auto-open / right panel 模式更新后的 store 测试
8. PPT preview/session UI 组件、store / type 层不再继续回写或转发 `worktreeId` 的测试
9. PPT export request / result 不再把 `worktreeId` 作为正式协议字段的测试

## Rollout Strategy

建议一次 feature 分支内完成 Phase 1-4，而不是拆成长期并存的多轮弱兼容。

原因：

1. Phase 2 和 Phase 4 强相关：如果先停 runtime 产出，但不改测试，会持续红灯
2. PPT 的 runtime / protocol / prompt 是同一组语义问题，拆得太碎会导致中间态更多
3. 该 feature 的目的就是结束“半迁移状态”，不适合无限期维持多层兼容壳

若必须拆分上线，推荐顺序：

1. Phase 1 + 2
2. Phase 3
3. Phase 4

## Acceptance Criteria

F145 完成后，必须满足以下验收条件：

1. `PptSessionCard` 与相关本地文件卡片全部通过 `projects` 链路工作，且该链路已具备与 projectPath / project root 一致的边界语义
   该语义必须包含明确的请求体契约、root 推导顺序、相对路径解析规则、越界错误码，且不会破坏现有已恢复文件卡片链路
2. 新运行时消息中不再出现新生成的 `/api/workspace/download?...` file rich block
3. 新运行时消息正文中不再出现 workspace URL 形式的“文件位置”披露
4. `PptSessionCard` 不再请求 `/api/workspace/local-file-meta`
5. `PPT Studio` preview/session/export 主协议不再以 `worktreeId` 作为活跃正式语义
6. 前端 PPT session store / type model 不再继续把 `worktreeId` 当作活跃协议字段回写
7. 前端不再存在仍会主动切换到 `rightPanelMode='workspace'` 的活跃产品入口
8. 与 workspace legacy 行为相关的测试已全部迁移到新契约或明确删除
9. 历史 legacy workspace 消息仍能以“已下线 / 只读”的方式安全降级展示

## Risks

1. **PPT 改动面广**：request、response、store、prompt 都受影响，需要统一修改，避免只改一层。
2. **测试误导风险高**：旧测试会持续把收口判成回归，必须与运行时修改同步。
3. **替代链路边界若不显式收紧，会形成新宽接口**：如果只把 workspace 路由调用平移到 `projects`，但不补 project-boundary 语义，F145 会变成“换壳不收口”。
4. **兼容边界不清会反复回归**：如果不明确“历史降级可保留，但新产出不允许继续使用 legacy 协议”，系统会继续在新旧状态之间摇摆。

## References

- [docs/discussions/f143-workspace-impact-audit.md](../discussions/f143-workspace-impact-audit.md)
- [docs/features/F143-workspace-sunset.md](./F143-workspace-sunset.md)
