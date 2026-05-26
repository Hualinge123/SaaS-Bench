---
feature_ids: [F143]
related_features: [F063, F082, F089, F120, F131]
topics: [workspace, security, deprecation, artifact, frontend, api]
doc_kind: spec
created: 2026-04-23
---

# F143: Workspace 能力下线方案

> **Status**: done | **Owner**: Maine Coon（Codex） | **Priority**: P0 | **Completed**: 2026-04-23
> **Trigger**: 安全分析确认 `/api/workspace/*` 残余能力可被滥用，且 OfficeClaw 当前产品形态已不再依赖 F063 的 Workspace Explorer 体验

## Why

当前工程虽然已经向 OfficeClaw 方向演进，但由 F063/F082/F089/F120/F131 引入或耦合的 **workspace 文件服务能力** 并未真正退出系统，而是以“后端路由 + 残余前端调用 + 生成文件链路 + 上传落盘链路”的形式继续存在。

这带来两个问题：

1. **安全问题**：workspace 能力当前不是“一个前端面板”，而是一组仍在注册和可访问的 API、路径解析助手、工作区注册机制和下载/预览链路。仅隐藏 UI 不会消除攻击面。
2. **产品债务**：OfficeClaw 当前主路径里已看不到完整的 workspace 面板渲染链，但 store、hook、测试、消息 rich block、CLI 输出块、运行日志入口仍在耦合这套能力，形成大量死代码和半存活链路。

因此，本 feature 的目标不是“继续修 F063”，而是**在 OfficeClaw 语境下正式下线 workspace 文件服务能力**，同时把仍然需要保留的“线程 projectPath 生命周期”“消息附件/生成文件”能力迁移或保留在更窄、更安全的专用链路中。

## Decision

### 结论

选择 **Sunset（整体下线）**，不选择 **Harden（继续加固并保留）**。

### 原因

1. OfficeClaw 当前主界面不再以 Workspace Explorer 作为协作主入口，保留这整套能力的产品价值已经显著下降。
2. workspace 风险点不是单一 handler，而是整组能力共享同一个 `getWorktreeRoot()` / worktree registry / workspace URL 语义；继续保留意味着长期维护高风险文件系统接口。
3. 当前残余依赖已足够分散，继续“只补一个洞”会留下更多边角口子，不如显式退出整块能力。

### 退出原则

1. **先 fail-closed，再删代码**：先让 workspace API 面整体失活，再做彻底清理。
2. **不保留“伪下线”状态**：不接受“前端不暴露，但后端仍可访问”的中间态。
3. **保留真正有业务价值的能力，但迁移到专用链路**：如消息附件、上传文件、生成文件下载，不再走 workspace API。

## Scope

### In scope

- 下线后端 `workspace` 相关路由注册与实现
- 移除服务于 `/api/workspace/*`、workspace URL 协议、worktreeId 文件打开链路的 worktree registry / root 解析能力
- 清理前端 workspace store 状态、hook、组件、测试
- 清理消息/上传/rich block 对 workspace URL 的依赖
- 清理 terminal / tmux / embedded browser 对 worktreeId / workspace registry 的隐式耦合，或在迁移完成前显式关闭相关入口
- 为历史消息中的 legacy workspace 文件引用（`contentBlocks` / rich blocks）定义兼容/降级策略
- 更新文档和 feature truth，明确 F063/F131 sunset，F082/F120 改为去除对 workspace registry 的依赖

### Out of scope

- 不在本 feature 内设计新的“IDE 内文件浏览器”
- 不在本 feature 内恢复任何 workspace 面板替代品
- 不在本 feature 内重做通用本地文件浏览协议；若确需保留，必须作为独立 feature 重新立项
- 不在本 feature 内移除或重命名线程 `projectPath` 机制
- 不在本 feature 内修改“线程创建时自动分配默认目录”的产品语义；当前 `monorepoRoot/workspace/<timestamp>` 命名即使带有 workspace 历史包袱，也视为线程默认项目目录机制的一部分
- 不在本 feature 内删除线程删除接口上的 `workspaceDelete*` 请求/响应语义，也不移除前端相应的“工作目录已删除/保留”反馈；如需改名或重构，另起 feature

## Boundary Clarification

本 feature 要下线的是以下能力：

- `/api/workspace/*` 全部路由
- `worktreeId -> 本地目录` 的 registry / root fallback / workspace URL 协议
- `WorkspacePanel` 及其导航、打开本地文件、本地 reveal 等 UI 行为
- 消息 rich block / 上传 / generated artifact 对 `/api/workspace/download`、`/api/workspace/file/raw`、`/api/workspace/open*` 的依赖

本 feature 明确保留的是以下能力：

- 线程 `projectPath` 字段及其生命周期
- 创建线程时在缺省情况下分配默认项目目录的能力
- 删除线程时“是否同时删除工作目录”的后端逻辑、响应头和前端提示
- 任何基于 `projectPath` 但不暴露通用文件服务的线程级产品语义

换言之，**本 feature 下线的是 workspace 文件服务，不是线程默认工作目录机制**。如果后续要把 `workspace/<timestamp>` 命名本身改成 `projects/<timestamp>` 或别的形式，应单独立项。

## Current Footprint

workspace 能力当前横跨四层：**API 路由层、路径/工作区基础设施层、消息/上传/artifact 生产层、前端消费层**。

### 1. 后端路由层

当前仍注册：

- `packages/api/src/routes/workspace.ts`
- `packages/api/src/routes/workspace-edit.ts`
- `packages/api/src/routes/workspace-git.ts`
- 注册位置：`packages/api/src/index.ts`

主要端点包括：

- `GET /api/workspace/worktrees`
- `GET /api/workspace/tree`
- `GET /api/workspace/file`
- `GET /api/workspace/file/raw`
- `GET /api/workspace/download`
- `POST /api/workspace/search`
- `POST /api/workspace/reveal`
- `POST /api/workspace/open`
- `POST /api/workspace/open-local`
- `POST /api/workspace/open-local-folder`
- `POST /api/workspace/local-file-meta`
- `POST /api/workspace/navigate`
- `POST /api/workspace/edit-session`
- `PUT /api/workspace/file`
- `POST /api/workspace/file/create`
- `POST /api/workspace/dir/create`
- `DELETE /api/workspace/file`
- `POST /api/workspace/file/rename`
- `POST /api/workspace/upload`
- `GET /api/workspace/git-log`
- `GET /api/workspace/git-status`
- `GET /api/workspace/git-show`
- `GET /api/workspace/git-health`

### 2. 路径/工作区基础设施层

仍存在以下核心 helper：

- `packages/api/src/domains/workspace/workspace-security.ts`
- `packages/api/src/domains/workspace/workspace-edit.ts`

其中最关键的耦合点包括：

- `getWorktreeRoot()`
- `ensureRegisteredWorktreeRoot()`
- `resolveWorktreeIdByPath()`
- `getRegisteredWorktreeRoot()`
- linked root 持久化与 registry

这些 helper 不仅服务于 workspace 面板，还被下列链路复用：

- `packages/api/src/routes/messages.ts`
- `packages/api/src/routes/terminal.ts`
- `packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts`
- `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts`
- `packages/api/src/domains/cats/services/agents/providers/image-paths.ts`

### 3. 消息 / 上传 / artifact 生产层

workspace 语义已渗透到消息附件和 rich block：

- `packages/api/src/routes/messages.ts`
  - multipart 附件上传默认会解析 thread 的 projectPath，再 `ensureRegisteredWorktreeRoot(...)`
- `packages/api/src/routes/parse-multipart.ts`
  - `saveUploadedAttachmentsToWorkspace(...)`
- `packages/api/src/routes/image-upload.ts`
  - `saveUploadedImagesToWorkspace(...)`
  - `saveUploadedAttachmentsToWorkspace(...)`
- `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`
  - 为生成文件构造 `/api/workspace/download?...`
- `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts`
  - 把 `/api/workspace/download?...` 视为 workspace artifact
- `packages/api/src/domains/cats/services/agents/providers/image-paths.ts`
  - 将 `/api/workspace/file/raw?...`、`/api/workspace/download?...` 解析回本地文件路径

这意味着，workspace 能力并不是“只读文件树”；它已经是**消息附件和生成文件协议的一部分**。

### 4. 前端消费层

虽然主聊天页当前不再直接渲染 `WorkspacePanel`，但残余消费面仍然很广：

- 组件 / hooks / store
  - `packages/web/src/components/WorkspacePanel.tsx`
  - `packages/web/src/components/workspace/*`
  - `packages/web/src/hooks/useWorkspace.ts`
  - `packages/web/src/hooks/useFileManagement.ts`
  - `packages/web/src/hooks/useGitPanel.ts`
  - `packages/web/src/hooks/useGitHealth.ts`
  - `packages/web/src/hooks/useWorkspaceNavigate.ts`
  - `packages/web/src/hooks/usePreviewAutoOpen.ts`
  - `packages/web/src/stores/chatStore.ts` 中整组 `workspace*` 状态和 `rightPanelMode`
- 残余调用方
  - `packages/web/src/components/ContentBlocks.tsx`
  - `packages/web/src/components/rich/FileBlock.tsx`
  - `packages/web/src/components/ChatMessage.tsx`
  - `packages/web/src/components/cli-output/CliOutputBlock.tsx`
  - `packages/web/src/components/RightStatusPanel.tsx`

### 5. 测试与文档层

workspace 相关测试覆盖面很大，说明这不是局部能力：

- `packages/api/test/workspace-*.test.js`
- `packages/web/src/components/__tests__/workspace-*.test.*`
- `packages/web/src/components/__tests__/cli-output-block.test.ts`
- `packages/web/src/components/__tests__/file-block-open.test.tsx`
- `packages/api/test/image-upload.test.js`
- `packages/api/test/codex-event-transform.test.js`
- `packages/api/test/generated-file-artifacts.test.js`

文档依赖主要集中在：

- `docs/features/F063-hub-workspace-explorer.md`
- `docs/features/F082-git-health-panel.md`
- `docs/features/F089-hub-terminal-tmux.md`
- `docs/features/F120-hub-embedded-browser.md`
- `docs/features/F131-workspace-navigator.md`

### 6. 相邻但不下线的线程工作目录机制

以下能力虽然名称中仍带有 `workspace` 历史痕迹，但不属于本 feature 的删除范围：

- `packages/api/src/routes/threads.ts`
  - 创建线程时，若未提供合法 `projectPath`，仍会创建默认目录并写入线程 `projectPath`
  - 删除线程时，仍会处理“是否同时删除该线程工作目录”的请求与响应头
- `packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx`
  - 仍会消费 `x-office-claw-workspace-delete-*` 响应头并展示“工作目录已删除/保留”提示
- `packages/web/src/components/ThreadSidebar/DirectoryPickerModal.tsx`
  - 当前 `workspacePath` 命名实际承担“默认线程目录/项目目录”选择语义

这些能力需要在文档和实施时与 `/api/workspace/*`、worktree registry、workspace URL 协议严格区分。

## Target State

下线完成后，系统应满足以下终态：

1. API 进程中不再注册 `workspaceRoutes` / `workspaceEditRoutes` / `workspaceGitRoutes`
2. 系统中不存在“客户端传 `worktreeId` → 服务端解析本地目录 → 暴露本地文件”的通用接口
3. 消息附件、生成文件、图片预览不再依赖 `/api/workspace/*`
4. 前端不再保留 `WorkspacePanel`、workspace 专用 hooks、`rightPanelMode='workspace'` 等状态模型
5. terminal/tmux/embedded browser 如需保留，不再依赖 workspace worktree registry；如不能立即解耦，则先显式关闭或改参
6. 历史消息中的 legacy workspace 文件引用（无论来自 `contentBlocks[type=file]` 还是 `rich.blocks[kind=file]`）都会被显式降级为“历史 workspace 文件，能力已下线”的只读展示，不再尝试按旧协议打开
7. 线程 `projectPath`、默认目录分配、线程删除时的工作目录反馈保持可用，不因本 feature 被误删
8. 文档层明确声明：F063/F131 在 OfficeClaw 中 sunset；F082 需要去掉对 workspace registry 的依赖；F120 中 browser preview 子能力已在后续 F144 中 sunset，仅 `html_widget` 等内联可视化能力保留

## Implementation Plan

整个下线工作分为 **Phase 0 紧急止血** 和 **Phase 1-4 完整拆除**。

### Phase 0: 紧急止血（P0，当天完成）

目标：先关闭风险面，允许短时间内留少量死代码。

#### 0.1 停止注册 workspace 路由

修改：

- `packages/api/src/index.ts`

措施：

- 移除或显式开关禁用：
  - `workspaceRoutes`
  - `workspaceEditRoutes`
  - `workspaceGitRoutes`

要求：

- 默认关闭，不允许“OfficeClaw 生产环境继续暴露 workspace API”
- 优先选择**不注册路由**，而不是继续注册后返回 401/403

#### 0.2 立即删掉 `decodeRegisteredWorktreeRoot()` fallback

修改：

- `packages/api/src/domains/workspace/workspace-security.ts`

措施：

- `getWorktreeRoot()` 禁止接受可伪造的 `workspace_root_...` 解码结果
- `getRegisteredWorktreeRoot()` 只允许返回真实 registry 命中，不再做解码 fallback

说明：

即使 Phase 0 尚未完全删掉死代码，这一步也必须单独完成，因为它是当前任意目录根注入的核心放大器。

#### 0.3 停止生成新的 workspace URL

修改：

- `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`
- `packages/api/src/routes/image-upload.ts`

措施：

- 不再生成 `/api/workspace/download?...`
- 不再生成 `/api/workspace/file/raw?...`

短期策略：

- 对 workspace 生成文件 rich block 直接降级为纯文本路径披露
- 对图片/附件统一走已有 `/uploads/` 能力，或直接禁用该条 workspace 分支

#### 0.4 同步上线历史消息降级保护

目标：

- 避免出现“后端 `/api/workspace/*` 已 404，但前端仍把历史消息当可打开 workspace 文件处理”的半坏窗口

修改：

- `packages/web/src/components/ContentBlocks.tsx`
- `packages/web/src/components/rich/FileBlock.tsx`
- `packages/web/src/components/ChatMessage.tsx`
- `packages/web/src/stores/chat-types.ts`

措施：

- 前端在读取历史消息时，同时识别两类 legacy workspace 文件引用：
  - `contentBlocks[type=file]` 中的 `/api/workspace/download?...` / `/api/workspace/file/raw?...`
  - `rich.blocks[kind=file]` 中的 `worktreeId` / `workspacePath` / workspace URL
- 对上述历史引用统一渲染为非交互“已下线”状态，不再触发 `/api/workspace/open*`、`/api/workspace/local-file-meta` 或旧下载 URL
- 这组前端保护必须与“停止 route registration”同版发布，或先于后端下线发布；不允许后端先 404、前端后补降级

### Phase 1: 后端 API 与基础设施退出

目标：删除 workspace 作为“通用本地文件服务”的后端基础设施。

#### 1.1 删除路由实现与导出

文件：

- `packages/api/src/routes/workspace.ts`
- `packages/api/src/routes/workspace-edit.ts`
- `packages/api/src/routes/workspace-git.ts`
- `packages/api/src/routes/index.ts`

动作：

- 删除 route export
- 删除 route 文件
- 删除相关注释和 feature 链接

#### 1.2 删除 workspace domain helper

文件：

- `packages/api/src/domains/workspace/workspace-security.ts`
- `packages/api/src/domains/workspace/workspace-edit.ts`

动作：

- 删除服务于 `/api/workspace/*` 和 workspace URL 协议的 worktree registry / linked roots / workspace path resolution
- 删除 edit token 逻辑

前提：

- 需要先清掉所有对这些 helper 的调用方
- 不应影响 `threads.ts` 使用的 `validateProjectPath()`、线程 `projectPath` 持久化以及默认目录创建逻辑

### Phase 2: 消息附件与生成文件链路迁移

目标：保住真正需要的“附件/文件产出”能力，但不再走 workspace。

#### 2.1 multipart 附件上传回退到 uploadDir

文件：

- `packages/api/src/routes/messages.ts`
- `packages/api/src/routes/parse-multipart.ts`

动作：

- 删除 `resolveMultipartWorkspaceTarget()`
- 删除 `ensureRegisteredWorktreeRoot(...)`
- `parseMultipart(...)` 不再接收 workspace target resolver
- 所有附件统一走 `saveUploadedAttachments(...)`

结果：

- 用户发文件不再落到 workspace/projectPath 下
- 消息附件全部进入 uploadDir 管理

#### 2.2 删除 workspace upload helper

文件：

- `packages/api/src/routes/image-upload.ts`

动作：

- 删除 `saveUploadedImagesToWorkspace(...)`
- 删除 `saveUploadedAttachmentsToWorkspace(...)`
- 删除 `WorkspaceUploadTarget`
- 所有 URL 统一收敛到 `/uploads/` 或新的专用 artifact URL

#### 2.3 generated-file artifact 协议改造

文件：

- `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`
- `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts`
- `packages/api/src/domains/cats/services/agents/providers/image-paths.ts`

设计选择：

**短期方案（推荐）**

- workspace 文件不再生成可点击 rich block
- 仅在消息正文中追加“文件位置：...”文本披露
- `generated-file-artifacts.ts` 不再把 `workspace` 当作 artifact source

**中期方案（如业务需要）**

- 另立 `artifact` 路由，采用显式 artifact id / metadata store，不暴露本地目录结构

本 feature 建议采用短期方案，原因：

- 目标是下线整块 workspace，不应该在同一轮再发明“变体 workspace”
- 文本披露足以保住调试可见性，不会再次引入通用文件系统服务

#### 2.4 历史消息兼容策略

目标：避免老消息在路由下线后进入“前端仍尝试打开，但后端恒 404”的半坏状态。

策略选择：

- **采用前端显式降级，不保留后端只读兼容层**

兼容对象：

- `contentBlocks[type=file]`
- `extra.rich.blocks[kind=file]`

具体规则：

- 读取历史消息时，若上述任一文件块仍带有 `worktreeId` / `workspacePath` / `/api/workspace/download?...` / `/api/workspace/file/raw?...` 语义：
  - 前端继续识别这是“历史 workspace 文件”
  - 但不再调用 `/api/workspace/open*`、`/api/workspace/local-file-meta` 或任何 workspace URL
  - UI 显示非交互状态，例如“历史 workspace 文件，能力已下线”
  - 若存在 `workspacePath`，可只读展示其原始路径文本，便于人工定位
- 新消息不再写入 `worktreeId` / `workspacePath` 这类 workspace 文件协议字段，也不再生成新的 workspace 下载/原图 URL

原因：

- 保留只读兼容路由会延长高风险文件服务的存活时间，不符合本 feature 的安全目标
- 前端显式降级能保住历史可解释性，同时避免用户点击后才发现是 404

### Phase 3: 前端清理

目标：删除 UI、store、hook、残余动作和对应测试。

#### 3.1 删除 workspace UI 模块

删除：

- `packages/web/src/components/WorkspacePanel.tsx`
- `packages/web/src/components/workspace/*`
  - `WorkspaceTree.tsx`
  - `CodeViewer.tsx`
  - `ChangesPanel.tsx`
  - `GitPanel.tsx`
  - `JsxPreview.tsx`
  - `BrowserPanel.tsx`
  - `LinkedRootsManager.tsx`
  - 以及只服务于该面板的 browser/preview/tree 辅助组件

保留审慎项：

- `ResizeHandle.tsx` 若被其他地方复用，可保留；若仅服务 workspace，则一并删除

#### 3.2 删除 workspace hooks

删除：

- `packages/web/src/hooks/useWorkspace.ts`
- `packages/web/src/hooks/useFileManagement.ts`
- `packages/web/src/hooks/useGitPanel.ts`
- `packages/web/src/hooks/useGitHealth.ts`
- `packages/web/src/hooks/useWorkspaceNavigate.ts`
- `packages/web/src/hooks/usePreviewAutoOpen.ts`

说明：

- `useWorkspaceNavigate` / `usePreviewAutoOpen` 当前仍通过 store 把右面板切到 `workspace`，属于残余导航链，必须一起退出

#### 3.3 清理 chatStore 的 workspace 状态

修改：

- `packages/web/src/stores/chatStore.ts`

删除：

- `rightPanelMode: 'workspace'`
- `workspaceWorktreeId`
- `workspaceOpenTabs`
- `workspaceOpenFilePath`
- `workspaceOpenFileLine`
- `workspaceEditToken`
- `workspaceEditTokenExpiry`
- `_workspaceFileSetAt`
- `workspaceRevealPath`
- `pendingPreviewAutoOpen`
- 对应 setter / restore / navigation helper

结果：

- 前端状态模型不再默认携带“还有个隐藏 workspace 面板”假设

#### 3.4 清理残余调用方

文件：

- `packages/web/src/components/ContentBlocks.tsx`
- `packages/web/src/components/rich/FileBlock.tsx`
- `packages/web/src/components/ChatMessage.tsx`
- `packages/web/src/components/cli-output/CliOutputBlock.tsx`
- `packages/web/src/components/RightStatusPanel.tsx`
- `packages/web/src/components/ChatContainer.tsx`
- `packages/web/src/stores/chat-types.ts`
- `packages/web/src/components/ThreadSidebar/active-workspace.ts`
- `packages/web/src/components/ThreadSidebar/DirectoryPickerModal.tsx`

处理原则：

- 删除 `/api/workspace/open`
- 删除 `/api/workspace/local-file-meta`
- 删除 `/api/workspace/open-local`
- 删除 `/api/workspace/open-local-folder`
- 删除 “查看日志 → 打开 workspace 目录” 入口
- `ContentBlocks` / `FileBlock` 里的文件行为降级为：
  - 若是 `/uploads/`：下载/预览
  - 若是历史 workspace 文件：显示“已下线”状态与原始路径文本，不提供打开动作
  - 若是其他非上传文件：只显示文件名，不提供本地打开动作
- `ChatMessage.tsx` 中基于 workspace 下载 URL 的去重逻辑仅保留 legacy 识别能力，不得继续把 workspace URL 当成可操作协议

类型与命名要求：

- `chat-types.ts` 中仅服务于 workspace 文件协议的字段应删除或改为 deprecated 只读兼容字段
- `worktreeId` / `workspacePath` 若继续保留给历史消息兼容使用，必须明确标注为 legacy，不得再作为新写入协议
- `active-workspace.ts`、`DirectoryPickerModal.tsx` 中的 `workspace` 命名若实际表达的是线程项目目录语义，应重命名为 `projectPath` / `defaultProjectPath`；若本轮不改名，也需显式标注为 naming debt，而不是继续混同为文件服务能力

### Phase 4: Terminal / tmux / preview 解耦

目标：处理 workspace 文件服务与 F089/F120 的残余耦合；后续 F144 已进一步 sunset F120 中的 browser preview / preview gateway 主链路。

#### 4.1 terminal route 退出或改参

文件：

- `packages/api/src/routes/terminal.ts`

当前问题：

- `/api/terminal/sessions` 仍接受 `worktreeId`
- `terminal.ts` 直接调用 `getWorktreeRoot(worktreeId)`

可选方案：

- **方案 A（推荐，短期）**：暂时关闭 terminal route 中依赖 worktree 的会话创建能力
- **方案 B（中期）**：改为基于 `threadId -> thread.projectPath -> validated cwd`

本 feature 推荐方案 A，原因：

- workspace sunset 的主目标是收紧文件系统能力
- 如果 terminal 仍要存在，应单独以“线程/projectPath 驱动的 terminal”重新立项

#### 4.2 tmux spawn override 解耦

文件：

- `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts`
- `packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts`

当前问题：

- `resolveWorktreeIdByPath(workingDirectory)` 被用于 pane spawn override

措施：

- 短期直接移除基于 worktreeId 的 spawn override
- 若仍需 pane 绑定，改为 thread-scoped / projectPath-scoped id，不再依赖 workspace registry

## Cleanup Inventory

### 后端删除 / 修改

| 类型 | 文件 | 动作 |
|------|------|------|
| 路由 | `packages/api/src/routes/workspace.ts` | 删除 |
| 路由 | `packages/api/src/routes/workspace-edit.ts` | 删除 |
| 路由 | `packages/api/src/routes/workspace-git.ts` | 删除 |
| 域逻辑 | `packages/api/src/domains/workspace/workspace-security.ts` | 删除或拆空，仅保留不属于 workspace 文件服务的公共校验逻辑 |
| 域逻辑 | `packages/api/src/domains/workspace/workspace-edit.ts` | 删除 |
| 路由注册 | `packages/api/src/index.ts` | 取消注册 |
| 路由导出 | `packages/api/src/routes/index.ts` | 删除 export |
| 消息上传 | `packages/api/src/routes/messages.ts` | 删除 workspace target 分支 |
| multipart 解析 | `packages/api/src/routes/parse-multipart.ts` | 删除 workspace 保存分支 |
| 上传 | `packages/api/src/routes/image-upload.ts` | 删除 workspace upload 分支 |
| provider rich block | `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts` | 移除 workspace URL |
| artifact 识别 | `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts` | 移除 workspace source |
| 本地路径提取 | `packages/api/src/domains/cats/services/agents/providers/image-paths.ts` | 移除 workspace URL 解析 |
| terminal | `packages/api/src/routes/terminal.ts` | 解耦或关闭 worktree 会话 |
| tmux 绑定 | `packages/api/src/domains/cats/services/agents/invocation/invoke-single-cat.ts` | 移除 `resolveWorktreeIdByPath()` |
| tmux 绑定 | `packages/api/src/domains/cats/services/agents/providers/CodexAgentService.ts` | 移除 worktreeId 推导 |
| 线程目录生命周期 | `packages/api/src/routes/threads.ts` | 保留；仅允许重命名注释/术语，不纳入下线删除范围 |

### 前端删除 / 修改

| 类型 | 文件 / 目录 | 动作 |
|------|-------------|------|
| 面板 | `packages/web/src/components/WorkspacePanel.tsx` | 删除 |
| 子组件 | `packages/web/src/components/workspace/` | 删除 workspace 专属组件 |
| hooks | `packages/web/src/hooks/useWorkspace.ts` | 删除 |
| hooks | `packages/web/src/hooks/useFileManagement.ts` | 删除 |
| hooks | `packages/web/src/hooks/useGitPanel.ts` | 删除 |
| hooks | `packages/web/src/hooks/useGitHealth.ts` | 删除 |
| hooks | `packages/web/src/hooks/useWorkspaceNavigate.ts` | 删除 |
| hooks | `packages/web/src/hooks/usePreviewAutoOpen.ts` | 删除 |
| store | `packages/web/src/stores/chatStore.ts` | 删除 workspace 状态和 action |
| 类型协议 | `packages/web/src/stores/chat-types.ts` | 删除新写入用的 workspace 文件协议字段，或将历史字段标为 legacy |
| 消息渲染 | `packages/web/src/components/ContentBlocks.tsx` | 删除 workspace open 逻辑 |
| rich file | `packages/web/src/components/rich/FileBlock.tsx` | 删除 workspace open 逻辑 |
| 消息去重/展示 | `packages/web/src/components/ChatMessage.tsx` | 删除对 workspace download URL 的新协议依赖，保留历史 block 降级识别 |
| CLI 输出 | `packages/web/src/components/cli-output/CliOutputBlock.tsx` | 删除 local-file-meta/open-local 逻辑 |
| 状态面板 | `packages/web/src/components/RightStatusPanel.tsx` | 删除 runtime logs -> workspace 跳转 |
| 聊天容器 | `packages/web/src/components/ChatContainer.tsx` | 删除 workspace navigate / auto-open 依赖 |
| 线程目录分组 | `packages/web/src/components/ThreadSidebar/active-workspace.ts` | 若表达的是 project 语义则重命名，否则至少标记 naming debt |
| 新建线程 | `packages/web/src/app/(main)/page.tsx` | 将默认目录选择语义与 workspace 文件服务语义分离 |
| 目录选择器 | `packages/web/src/components/ThreadSidebar/DirectoryPickerModal.tsx` | 将默认目录选择语义与 workspace 文件服务语义分离 |

## Feature Truth Updates

| Feature | 本文结论 | 说明 |
|------|------|------|
| `F063-hub-workspace-explorer` | sunset | 主能力就是 workspace explorer，本 feature 下线其后端 API、前端面板与协议依赖 |
| `F131-workspace-navigator` | sunset | 依赖 workspace navigator / open-local / reveal 语义，在 OfficeClaw 中一并退出 |
| `F082-git-health-panel` | 保留 feature，移除 workspace 依赖 | git health 若仍有价值，应改为 thread/projectPath 或其他安全上下文驱动，而不是继续绑在 worktree registry 上 |
| `F120-hub-embedded-browser` | 部分 sunset | browser preview / preview gateway / auto-open 已在 F144 sunset；`html_widget` 等内联可视化能力保留，且不再依赖 workspace registry |

### Source-of-Truth Actions

以下动作属于实施清单的一部分，不可只改 `F143` 本文后停止：

- 更新以下 feature 源文档中的状态/依赖/范围描述，使其与本设计一致：
  - `docs/features/F063-hub-workspace-explorer.md`
  - `docs/features/F082-git-health-panel.md`
  - `docs/features/F120-hub-embedded-browser.md`
  - `docs/features/F131-workspace-navigator.md`
- 运行 feature index 生成脚本刷新机器索引：
  - `scripts/generate-feature-index.mjs`
- 刷新产物：
  - `docs/features/index.json`

约束：

- `docs/features/index.json` 是脚本生成物，不应手工编辑
- 如未刷新 index，视为 feature truth 未同步完成

### 测试清理

#### 后端测试

删除或改写：

- `packages/api/test/workspace-edit.test.js`
- `packages/api/test/workspace-file-management.test.js`
- `packages/api/test/workspace-navigate.test.js`
- `packages/api/test/workspace-project-context.test.js`
- `packages/api/test/workspace-raw-endpoint.test.js`
- `packages/api/test/workspace-security.test.js`

改写：

- `packages/api/test/image-upload.test.js`
- `packages/api/test/codex-event-transform.test.js`
- `packages/api/test/generated-file-artifacts.test.js`

#### 前端测试

删除或改写：

- `packages/web/src/components/__tests__/workspace-*.test.*`
- `packages/web/src/components/__tests__/cli-output-block.test.ts`
- `packages/web/src/components/__tests__/file-block-open.test.tsx`
- `packages/web/src/components/__tests__/content-blocks-file-attachment.test.tsx`
- `packages/web/src/components/__tests__/chat-message-lightbox.test.ts`
- `packages/web/src/components/__tests__/chat-message-local-file-dedupe.test.tsx`
- `packages/web/src/components/__tests__/workspace-navigate-store.test.ts`
- 所有仅为 `WorkspacePanel` / `useWorkspaceNavigate` 做 `vi.mock(...)` 的测试

特别关注：以下“不是 workspace 专项命名、但直接依赖 workspace hooks/store”的测试也必须纳入清理或改写范围：

- `packages/web/src/components/__tests__/chat-container-auth-gate.test.tsx`
- `packages/web/src/components/__tests__/chat-container-pending-send-guard.test.tsx`
- `packages/web/src/components/__tests__/chat-container-recognition-loading.test.tsx`
- `packages/web/src/components/__tests__/chat-container-inline-authorization.test.tsx`
- `packages/web/src/components/__tests__/chat-container-right-panel-hidden.test.tsx`
- `packages/web/src/components/__tests__/chat-container-empty-state.test.tsx`
- `packages/web/src/components/__tests__/business-theme-token-usage.test.tsx`
- `packages/web/src/__tests__/game-thread-switch-recovery.test.ts`
- `packages/web/src/components/__tests__/preview-auto-open-store.test.ts`

处理原则：

- 删除仅为 `useWorkspaceNavigate` / `usePreviewAutoOpen` / `rightPanelMode='workspace'` / `pendingPreviewAutoOpen` / `workspace*` store 字段服务的断言与 mock
- 若测试目标本身与 workspace sunset 无关，则应保留测试主体，只移除其对旧 workspace 状态模型的耦合

#### 必须保留的线程删除保护测试

以下测试虽然含有 `workspaceDelete*` 术语，但属于线程工作目录生命周期保护网，不在本轮删除范围：

- `packages/api/test/threads-endpoint.test.js`
  - 保留覆盖 `x-office-claw-workspace-delete-*` 响应头、shared directory skip reason、删除/保留分支的用例
- `packages/web/src/components/ThreadSidebar/__tests__/thread-delete-confirm.test.ts`
  - 保留覆盖“工作目录已删除/保留” toast 与删除确认交互的用例

## Rollout Strategy

### Step 1: 安全收口

顺序：

1. 先上线或同版上线历史消息的前端降级保护
2. 停止新 workspace URL 的生成
3. 停止 route registration
4. 删除可伪造 root fallback

验收：

- 任意 `/api/workspace/*` 请求得到 404
- 历史消息中的 legacy workspace 文件引用不会再触发 `/api/workspace/*` 请求
- 线程创建仍能正常生成 `projectPath`
- 线程删除仍能返回 `x-office-claw-workspace-delete-*` 头并被前端正确消费
- 消息发送、普通文本聊天、非附件路径不受影响

### Step 2: 附件与 rich block 迁移

顺序：

1. multipart 附件统一切到 uploadDir
2. image/file rich block 不再引用 workspace URL
3. 前端对历史 workspace 文件引用显式降级
4. 前端 file block 改为仅对 `/uploads/` 提供交互

验收：

- 用户仍可发送附件
- 上传图片仍可预览
- 历史消息中的 workspace 文件块不会再触发 `/api/workspace/*` 请求
- 非 upload 的“本地 workspace 文件”不再出现可点击打开按钮，而是展示已下线状态

### Step 3: 删除前端残余状态与组件

顺序：

1. 删除 hooks
2. 删除 store 字段
3. 删除组件与测试

验收：

- 前端 bundle 中不再包含 `WorkspacePanel`
- 不再存在 `rightPanelMode='workspace'` 逻辑

### Step 4: terminal/tmux 独立收尾

顺序：

1. 关闭 worktree 驱动的 terminal session 创建
2. 移除 `resolveWorktreeIdByPath` 在 tmux 中的使用
3. 如需要，后续另立 feature 重建 terminal cwd 绑定

## Risks

1. **附件行为变化**：原先落在 thread projectPath 下的附件将改为统一落在 uploadDir，可能影响个别依赖“附件就在项目目录”的隐式逻辑。
2. **历史消息体验回退**：老消息里的 workspace 文件块将从“可点击”变为“只读降级提示”，需要产品接受这种兼容策略。
3. **生成文件可操作性下降**：workspace 生成文件 rich block 降级为文本披露后，用户无法一键下载/打开本地文件。
4. **terminal / browser 功能连带受影响**：若 F089/F120 某些实现仍依赖 worktree registry，下线 workspace 后必须接受短期能力回退或参数调整。
5. **测试面很大**：workspace 曾是一个 feature family，不是单点能力；删除时需要允许一次性移除较多测试，而不是逐个修补旧断言。
6. **边界误伤风险**：如果实施者没有严格区分 workspace 文件服务与线程 `projectPath` 生命周期，可能误删线程默认目录机制和删除提示链路。

## Open Questions

1. 是否需要在本轮保留“上传文件下载”之外的任何本地文件下载能力？
2. terminal 是否仍是 OfficeClaw 的目标能力？如果是，应立即补一个独立 design，而不是继续借用 workspace registry。

## Acceptance Criteria

- [x] AC-1: API 进程不再注册 `workspaceRoutes` / `workspaceEditRoutes` / `workspaceGitRoutes`
- [x] AC-2: `getWorktreeRoot()` 不再接受任何可伪造的 encoded root fallback
- [x] AC-3: 系统中不再生成 `/api/workspace/download?...` 或 `/api/workspace/file/raw?...` 新链接
- [x] AC-4: multipart 附件上传不再依赖 `ensureRegisteredWorktreeRoot()` 或 workspace target
- [x] AC-5: `WorkspacePanel`、workspace hooks、workspace store 状态从前端主代码中移除
- [x] AC-6: 前端不存在 `rightPanelMode='workspace'` 的行为分支
- [x] AC-7: `ContentBlocks` / `FileBlock` / `ChatMessage` / `CliOutputBlock` 不再调用 `/api/workspace/open*` 或 `/api/workspace/local-file-meta`；历史 `contentBlocks` / rich blocks 中的 legacy workspace 文件引用仅做已下线提示
- [x] AC-8: `terminal.ts` / `invoke-single-cat.ts` / `CodexAgentService.ts` 不再依赖 `resolveWorktreeIdByPath()` 或 `getWorktreeRoot()`
- [x] AC-9: `threads.ts` 的 `projectPath` 生命周期、默认目录创建、`x-office-claw-workspace-delete-*` 语义保持可用
- [x] AC-10: workspace 相关测试被删除或迁移，测试集不再假设 workspace API 存在
- [x] AC-11: 文档明确声明 F063/F131 sunset；F082 去除 workspace registry 依赖；F120 的 browser preview 子能力后续由 F144 sunset

## Follow-ups

1. 若后续仍需要“本地生成文件下载”，单独立项设计 `artifact` 路由与元数据存储。
2. 若后续仍需要 terminal，单独立项设计 thread/projectPath 驱动的 cwd 绑定，不再使用 workspace registry。
3. 若需要运行日志查看，单独设计“日志 API / 日志面板”，不再复用 workspace tree。
