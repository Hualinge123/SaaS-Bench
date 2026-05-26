---
title: F143 Workspace Sunset Impact Audit
status: draft
created: 2026-04-28
topics: [workspace, audit, regression, restore, ppt, attachments]
related_features: [F143, F063, F082, F089, F120, F131]
---

# F143 Workspace 下线影响排查清单

## 目标

本文档不讨论 F143 是否应该继续推进，也不强制要求继续下线 `workspace`。

本文档只回答一个问题：**F143 workspace 下线后，哪些功能受到了影响；这些功能当前分别处于已恢复、部分恢复、仍受影响，还是有意下线的状态。**

目的是为后续收口提供一张完整清单，避免把以下几类情况混在一起：

1. 原本就是 F143 有意关闭的能力
2. 已经迁移到新链路、功能已恢复的能力
3. 主路径已恢复但仍有残留断点的能力
4. 仍在运行时依赖 legacy workspace 协议、尚未收口的能力

## 审计结论摘要

F143 影响的能力面主要分为七类：

1. `workspace API` 本身
2. 消息附件上传与访问
3. 生成文件、`send_file_to_user`、rich block
4. PPT Studio、HTML 转 PPT 预览与成品文件
5. 线程工作目录、项目目录选择
6. 前端 workspace 面板与相关 store 状态语义
7. 测试、断言与契约层残留

当前整体状态：

1. `workspace` 路由本体已经下掉
2. 普通消息附件上传与访问已经迁到 `uploads`
3. 普通本地生成文件打开主链已经迁到 `projects`
4. PPT 相关链路主路径可用，但 live protocol 仍在传播 `worktreeId`
5. 后端仍可能继续生成新的 legacy workspace 文件引用
6. 前端 workspace 面板已不再渲染，但 store 语义残留较多
7. 测试与契约层仍有多处把旧 workspace 行为当成正确预期

## 状态定义

### 已恢复

曾受 F143 影响，但现在已经通过新链路恢复，主路径可用。

### 部分恢复

主路径已可用，但仍保留旧 workspace 语义、旧字段或局部断点。

### 仍受影响

当前仍存在明确功能缺口，或运行时仍会走 legacy workspace 协议。

### 已明确下线

这是 F143 有意关闭的能力，不应和“漏修”混为一谈，但需要在后续收口时单独归档。

### 测试 / 契约层残留

运行时代码已经部分或全部迁移，但测试、断言或契约仍把旧 workspace 协议当成正确预期。这类残留不会直接出现在用户页面上，但会持续阻碍后续收口，并制造“代码想下线、测试想保留”的冲突。

## 影响清单

| 功能面 | F143 影响方式 | 当前状态 | 当前链路 / 残留问题 | 关键代码 |
|---|---|---|---|---|
| `/api/workspace/*` 路由族 | 直接停止注册 | 已明确下线 | `workspaceRoutes`、`workspaceEditRoutes`、`workspaceGitRoutes` 已不再注册 | `packages/api/src/index.ts` |
| Workspace Explorer / WorkspacePanel | UI 不再挂载 | 已明确下线 | 右侧栏不再渲染 `WorkspacePanel` | `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:192` |
| workspace 文件树 / 文件浏览 / reveal / open-local-file 旧 API | 旧入口失效 | 已明确下线 | 无新通用替代；属于 F143 目标内下线 | `docs/features/F143-workspace-sunset.md` |
| 普通消息附件上传落盘 | 原先可能走 workspace/projectPath | 已恢复 | 统一改走 `saveUploadedAttachments(...)`，落到 `/uploads/...` | `packages/api/src/routes/parse-multipart.ts:105-110`, `packages/api/src/routes/image-upload.ts:136-176` |
| 普通附件下载 / 展示 | 原先可能依赖 `/api/workspace/download` | 已恢复 | 前端优先消费 `/uploads/` 或受保护资源下载 | `packages/web/src/components/ContentBlocks.tsx`, `packages/web/src/components/rich/FileBlock.tsx` |
| 历史 legacy workspace 附件消息 | 后端 404 后前端可能半坏 | 已恢复 | 明确显示“历史 workspace 文件/图片，能力已下线” | `packages/web/src/components/ContentBlocks.tsx:69-80,95-137`, `packages/web/src/components/rich/FileBlock.tsx:36-84` |
| `send_file_to_user` 普通本地生成文件卡片 | 原 workspace 打开链断掉 | 已恢复 | 已迁到 `/api/projects/local-file-meta`、`/api/projects/open-local`、`/api/projects/open-local-folder` | `packages/web/src/components/cli-output/CliOutputBlock.tsx:475-537` |
| `send_file_to_user` 文件元信息校验 | 旧 `/api/workspace/local-file-meta` 失效 | 已恢复（普通卡片） | 普通生成文件卡片已改新接口 | `packages/web/src/components/cli-output/CliOutputBlock.tsx:475-489` |
| `send_file_to_user` 与 rich block 去重 | 旧 workspace file block 可能重复显示 | 部分恢复 | 前端已做 legacy workspace block 去重，但上游仍可能继续产新 legacy block | `packages/web/src/components/ChatMessage.tsx:59-83` |
| 后端生成新的 workspace file rich block | F143 要求停止生成 | 仍受影响 | `codex-event-transform` 仍会为 `.ppt` / `.pptx` 生成 `/api/workspace/download?...` | `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:76-105,285-299` |
| 新消息正文里的“文件位置”披露 | 本应不再暴露 workspace URL | 仍受影响 | `appendGeneratedFileLocationDisclosure()` 仍直接把 artifact `url` 写进正文；若上游是 workspace URL，会继续泄露旧协议 | `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts:36-70` |
| rich block 生成文件协议 | 本应迁到新专用协议或纯路径披露 | 部分恢复 | `/uploads/` callback 文件没问题；provider 侧 legacy workspace file 仍可能出现 | `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts:31-34` |
| 图片 / 文件本地路径反解 | 原先可能依赖 workspace raw/download URL | 已恢复 | `image-paths.ts` 只解析 `/uploads/` | `packages/api/src/domains/cats/services/agents/providers/image-paths.ts:26-66` |
| PPT Studio 页面预览 (`/api/ppt-studio/slide`) | 原先可能借 worktree 语义 | 部分恢复 | 路径安全解析已基于 `projectRoot`，但 slide URL 仍继续拼接 `worktreeId`，live protocol 未收口 | `packages/web/src/components/ppt-studio/ppt-preview-canvas.ts:33-47`, `packages/api/src/domains/ppt/ppt-studio-service.ts:183-230` |
| PPT Studio session 发现 / 轮询 | 依赖 workspace registry 风险 | 部分恢复 | 轮询主链可用，但前端请求和后端 snapshot 仍持续传递 / 回写 `worktreeId` | `packages/web/src/components/ppt-studio/PptStudioPanel.tsx:57-78`, `packages/api/src/domains/ppt/ppt-studio-service.ts:183-230` |
| PPT Studio 打开 pages 文件夹 | 原 workspace open folder 链路失效 | 已恢复 | 改为 `/api/projects/open-local-folder` | `packages/web/src/components/ppt-studio/PptStudioPanel.tsx:242-260` |
| PPT Studio 成品 PPT 卡片“打开 / 打开文件夹” | 原 workspace open 链路失效 | 已恢复 | 打开动作已走 `/api/projects/open-local` / `open-local-folder` | `packages/web/src/components/ppt-studio/PptSessionCard.tsx:237-259` |
| PPT Studio 成品 PPT 卡片“文件存在性 / 生成时间校验” | 原 workspace meta 链路失效 | 仍受影响 | 这里还在请求 `/api/workspace/local-file-meta`，和普通生成文件卡片不一致 | `packages/web/src/components/ppt-studio/PptSessionCard.tsx:191-205` |
| PPT 发送上下文 `pptContext` | 原语义含 `worktreeId` | 部分恢复 | 现在主链用 `projectRoot`，但 schema 仍允许仅 `worktreeId`，前后端仍传播该字段 | `packages/api/src/routes/messages.schema.ts:21-32`, `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:41-49` |
| CLI 输出触发 PPT 预览同步 | 使用当前 `workspaceWorktreeId` 注入 PPT session | 部分恢复 | 功能能用，但 store 仍把老的 `workspaceWorktreeId` 继续灌入 PPT session | `packages/web/src/components/cli-output/use-cli-output-ppt-preview.ts:57-67` |
| 线程默认工作目录机制 | 名称上带 workspace，易误伤 | 已保留且可用 | 创建线程默认目录、删除线程时删除目录逻辑仍在 | `packages/api/src/routes/threads.ts`, `packages/api/src/domains/cats/services/stores/ports/ThreadStore.ts` |
| 线程删除时“工作目录已删除 / 保留”提示 | 可能被 F143 误删 | 已恢复 / 保留 | 相关响应头和前端提示仍在工作 | `packages/api/src/index.ts:293-301`, `packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx:544-591` |
| 新线程选择项目目录 | 可能依赖旧 workspace 选择流 | 已恢复 | 已走 `/api/projects/cwd`、`/api/projects/pick-directory`、`/api/projects/browse` | `packages/web/src/app/(main)/page.tsx`, `packages/web/src/components/ThreadSidebar/DirectoryPickerModal.tsx` |
| 当前线程“打开工作空间目录” | 原 workspace open-local-folder 语义变化 | 已恢复 | 已走 `/api/projects/open-directory` | `packages/web/src/components/RightContentHeader.tsx:363-383`, `packages/api/src/routes/projects.ts:643-675` |
| Markdown 中历史 workspace 文档相对链接 | 旧链接不可再打开 | 已恢复 | 不再尝试打开，显示“历史 workspace 文档链接已下线” | `packages/web/src/components/MarkdownContent.tsx:452-476` |
| 前端 `rightPanelMode='workspace'` / `workspaceWorktreeId` / open tabs 等 store 状态 | 旧工作区语义残留 | 部分恢复 | UI 不再挂 workspace panel，但状态写入还在，可能造成 silent failure 或后续混淆 | `packages/web/src/stores/chatStore.ts:941-1039` |
| 生成文件位置披露测试仍期望输出 `/api/workspace/download` | 固化当前 legacy 行为，阻碍后续收口 | 测试 / 契约层残留 | 测试仍把 legacy workspace URL 视为正确正文披露结果，会阻碍后续将正文位置披露迁离 workspace 协议 | `packages/api/test/generated-file-artifacts.test.js:11-49`, `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts:36-70` |
| multipart 测试仍期望附件落到 workspace target | 运行时代码与测试契约冲突 | 测试 / 契约层残留 | 测试仍验证 `/api/workspace/download?...`，与当前 `/uploads/...` 主链冲突 | `packages/api/test/parse-multipart.test.js:149-184`, `packages/api/src/routes/parse-multipart.ts:39-42,105-110` |
| markdown workspace link 测试仍期望“在工作区中打开” | 运行时代码与测试契约冲突 | 测试 / 契约层残留 | 生产代码已改成“历史 workspace 文档链接已下线”，但测试仍把 workspace 可导航视为正确预期 | `packages/web/src/components/__tests__/markdown-content-workspace-links.test.ts:79-105`, `packages/web/src/components/MarkdownContent.tsx:452-476` |
| preview auto-open 测试仍期望切到 `rightPanelMode='workspace'` | 测试与运行时共同强化旧 workspace 状态语义 | 测试 / 契约层残留 | 测试和 store 当前实现都仍把 preview auto-open 视为 workspace 面板语义的一部分 | `packages/web/src/components/__tests__/preview-auto-open-store.test.ts:55-58`, `packages/web/src/stores/chatStore.ts:1035-1039` |

## 按状态分组

### 已恢复

1. 普通消息附件上传与下载

现在 multipart 附件已经统一落到 `uploads`，不再依赖 workspace 落盘。

证据：

`packages/api/src/routes/parse-multipart.ts`

`packages/api/src/routes/image-upload.ts`

2. 普通 `send_file_to_user` 生成文件卡片

文件存在性检查、打开文件、打开文件夹都已经迁到 `projects` 路由。

证据：

`packages/web/src/components/cli-output/CliOutputBlock.tsx:469-537`

`packages/api/src/routes/projects.ts:678-802`

3. 当前线程工作目录的打开

头部“打开工作空间目录”已经走 `/api/projects/open-directory`。

证据：

`packages/web/src/components/RightContentHeader.tsx:363-383`

`packages/api/src/routes/projects.ts:643-675`

4. 新建线程时的项目目录选择

目录浏览、目录选择、默认目录获取都走 `projects` 体系。

证据：

`packages/web/src/app/(main)/page.tsx`

`packages/web/src/components/ThreadSidebar/DirectoryPickerModal.tsx`

5. 历史 legacy workspace 文件、图片、文档链接的前端降级

不会再盲目打旧接口，而是显示“已下线”。

证据：

`packages/web/src/components/ContentBlocks.tsx`

`packages/web/src/components/rich/FileBlock.tsx`

`packages/web/src/components/MarkdownContent.tsx`

### 部分恢复

1. `send_file_to_user` 和文件 rich block 的去重 / 展示

前端已经知道如何识别 legacy workspace file block，并尽量去重。
但后端还可能继续产出新的 legacy workspace file block，所以这不是彻底修复。

证据：

`packages/web/src/components/ChatMessage.tsx:59-83`

对照后端残留：

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:76-105`

2. PPT Studio 页面预览 (`/api/ppt-studio/slide`) 与 session 发现 / 轮询

PPT 主链虽然已经以 `projectRoot` 为安全边界，但前端请求、后端返回、slide URL 以及 session snapshot 仍在 live protocol 中继续传递 `worktreeId`。

证据：

`packages/web/src/components/ppt-studio/PptStudioPanel.tsx:57-78`

`packages/web/src/components/ppt-studio/ppt-preview-canvas.ts:33-47`

`packages/api/src/domains/ppt/ppt-studio-service.ts:183-230`

3. PPT 上下文协议

PPT 功能已经主要走 `projectRoot`，但 `worktreeId` 不只是 store 里的兼容字段，而是消息契约和 prompt 语义仍在接纳并使用的 live protocol 组成部分。

证据：

`packages/api/src/routes/messages.schema.ts:21-32`

`packages/api/src/domains/ppt/ppt-context.ts:7-50`

`packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:41-49`

`packages/web/src/components/cli-output/use-cli-output-ppt-preview.ts:57-67`

`packages/web/src/components/ppt-studio/ppt-preview-canvas.ts:28-41`

#### 详细说明: PPT Studio 页面预览与 session 发现 / 轮询

##### 背景

这个点之所以不能再标为“已恢复”，是因为它不是单纯的旧字段残留，而是 **前端请求、后端返回和页面预览 URL 仍在 live protocol 中持续传递 `worktreeId`**。

也就是说，PPT 主链虽然不再依赖 workspace registry 做安全解析，但它还没有彻底脱离旧 workspace 语义。

##### 当前实现

前端轮询 session 时，会在有 `session.worktreeId` 的情况下继续把它带到 `/api/ppt-studio/session` 请求中:

`packages/web/src/components/ppt-studio/PptStudioPanel.tsx:57-78`

```ts
if (session.worktreeId) params.set('worktreeId', session.worktreeId);
```

前端构建 slide URL 时，也会继续把 `worktreeId` 拼到 `/api/ppt-studio/slide` 上:

`packages/web/src/components/ppt-studio/ppt-preview-canvas.ts:33-47`

```ts
if (worktreeId) params.set('worktreeId', worktreeId);
```

后端 `ppt-studio-service` 不仅接收 `worktreeId`，还会把它继续回写到:

1. slide meta 的 `url`
2. session snapshot 的 `worktreeId`
3. export 结果里的 `worktreeId`

见:

`packages/api/src/domains/ppt/ppt-studio-service.ts:183-230`

##### 页面表现

从用户角度看，这一项不像“文件打不开”那样直接爆炸；PPT 预览、轮询、切页等主路径大多数时候仍然可用。

但从页面和运行时的真实关系来看，它仍然表现出一种“表面新链路、底层旧语义未收口”的状态:

1. 页面上的 PPT Studio 体验看起来已经是专用能力
2. 但请求参数、slide URL 和 session 结构里仍持续出现 `worktreeId`
3. 这意味着只要后续某个分支重新把 `worktreeId` 当成正式依赖，旧心智模型就会继续被放大

##### 为什么归类为“部分恢复”

如果按本文档自己的定义，`已恢复` 要求主路径通过新链路恢复，且不再依赖旧语义作为 live protocol 的组成部分。

而这里的实际状态是:

1. 路径安全边界确实已经迁到 `projectRoot`
2. 但 live request、live response 和 preview URL 仍在继续传播 `worktreeId`
3. 因此它更接近“主路径可用，但协议层未收口”的部分恢复

##### 后续收口选项

1. 明确 `worktreeId` 在 PPT preview/session 协议里是否仍有正式产品语义
2. 如果没有，逐步从前端请求、后端响应和 slide URL 中移除它
3. 将 PPT 主链的正式协议文档收敛为 `projectRoot + pagesDir + htmlPath`

#### 详细说明: `send_file_to_user` 和文件 rich block 的去重 / 展示

##### 背景

这个点的本质是: **前端展示层已经学会绕开旧数据，但后端生产层还在继续制造旧数据。**

因此它只能归类为“部分恢复”，而不是“彻底恢复”。

相关对象可以拆成三类:

1. `send_file_to_user`
这是工具调用结果里带出来的本地生成文件列表，当前前端主要靠它来生成可打开的本地文件卡片。

相关代码:

`packages/web/src/components/cli-output/local-generated-files.ts`

`packages/web/src/components/cli-output/CliOutputBlock.tsx`

2. file rich block
这是消息里的富文本文件块，历史上可能携带以下字段:

1. `url=/api/workspace/download?...`
2. `workspacePath=...`
3. `worktreeId=...`

相关代码:

`packages/web/src/components/rich/FileBlock.tsx`

`packages/web/src/components/ChatMessage.tsx`

3. legacy workspace file block
这是第 2 类 file rich block 中仍然带旧 workspace 协议的数据块。例如:

```json
{
  "kind": "file",
  "url": "/api/workspace/download?worktreeId=wt-1&path=output%2Fdemo.xlsx",
  "fileName": "demo.xlsx",
  "workspacePath": "output/demo.xlsx",
  "worktreeId": "wt-1"
}
```

F143 之后，这类 block 不应该再作为“新产物”继续出现。

##### 当前实现

当前已经恢复的部分在于，前端展示生成文件时已经不再主要依赖这类 old workspace rich block，而是优先依赖 `send_file_to_user`。

主链路在:

`packages/web/src/components/cli-output/local-generated-files.ts:332-366`

这里会从工具调用明细中提取:

1. `send_file_to_user` 的 `abs_file_path_list`
2. 文件类型
3. `LocalGeneratedFile[]`

然后 `CliOutputBlock` 会把这些文件渲染成新的本地文件卡片，并使用新接口:

1. `/api/projects/local-file-meta`
2. `/api/projects/open-local`
3. `/api/projects/open-local-folder`

见:

`packages/web/src/components/cli-output/CliOutputBlock.tsx:469-537`

但问题在于，同一个文件可能仍会同时以两种形式进入同一条消息:

1. 作为 `send_file_to_user` 的本地文件卡片
2. 作为旧的 workspace file block 出现在 `contentBlocks` 或 `rich.blocks`

如果前端不做处理，用户会在同一条消息里看到两份“同一个文件”的展示:

1. 一张新的、可打开的本地文件卡片
2. 一张旧的、显示“历史 workspace 文件，能力已下线”的 file block

所以前端加了去重逻辑。

代码在:

`packages/web/src/components/ChatMessage.tsx:59-83`

它的流程是:

1. 先从 CLI 事件中提取 `send_file_to_user` 生成的文件名集合
2. 再去过滤 `contentBlocks` 和 `rich.blocks`
3. 如果某个 file block 看起来只是同一个 legacy workspace 文件的另一种表示，就把它隐藏掉

核心函数是:

1. `filterDuplicateWorkspaceContentBlocks(...)`
2. `filterDuplicateWorkspaceRichBlocks(...)`

判断方式大致是:

1. 如果 block 是 `file`
2. 从 `workspacePath` 或 `/api/workspace/download?...path=...` 中拿到文件路径
3. 提取文件名
4. 如果这个文件名已经在 `send_file_to_user` 生成文件列表里出现过，就不再渲染这个旧 block

这就是“前端已经知道如何识别 legacy workspace file block，并尽量去重”的具体含义。

##### 页面表现

但它仍不能算彻底修复，因为这只是展示层兜底，不是源头治理。

问题源头仍在后端:

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:76-105`

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:285-299`

这里的 `buildWorkspaceFileRichBlocks()` 仍会继续生成新的 workspace file rich block。

这意味着:

1. 前端一边努力把 legacy block 隐掉
2. 后端一边还在继续产出新的 legacy block

因此现在的状态更像“前端追着擦脏数据”，而不是“上游已经不再制造脏数据”。

在页面上会出现三类典型现象:

1. 理想情况
如果 `send_file_to_user` 和 legacy rich block 指向同一文件且文件名一致，前端去重成功，用户只看到新的本地文件卡片。

2. 去重失败
如果文件名、路径形式或命名方式不一致，前端识别失败，用户会在同一条消息里同时看到:
一张新的本地文件卡片和一张“历史 workspace 文件，能力已下线”的旧文件块。

3. 只有旧 rich block，没有 `send_file_to_user`
这种情况下，前端没有新卡片可优先展示，只能把旧 block 当成“历史 workspace 文件”渲染。
对用户来说，这明明是刚刚新生成的文件，却被页面展示成“历史已下线文件”，语义上是错误的。

##### 为什么归类为“部分恢复”

因此这一项最准确的状态不是“已恢复”，而是:

1. 展示层基本恢复
2. 协议层和生产层仍未收口

##### 后续收口选项

1. 保持当前前端去重兜底，但承认后端协议仍未收口
2. 停止后端继续生成新的 legacy workspace file block，使前端不再需要持续屏蔽脏数据
3. 进一步收敛正文与 rich block 的文件展示协议，只保留一条正式来源

#### 详细说明: PPT 上下文协议中的 `worktreeId` 残留

##### 背景

这个点的核心不是“PPT 功能现在不能用”，而是 **PPT 主链已经迁到 `projectRoot`，但消息协议、前端 session 和部分 URL 参数里仍在传播旧的 `worktreeId` 语义**。

因此它属于“部分恢复”: 主流程大体可用，但协议层还没有完全收口。

##### 当前实现

从当前实现看，PPT 相关功能真正依赖的关键上下文已经是 `projectRoot`。

后端 `ppt-studio` 路由里，无论是:

1. `GET /api/ppt-studio/session`
2. `GET /api/ppt-studio/slide`
3. `GET /api/ppt-studio/download`
4. `POST /api/ppt-studio/export`

都要求或主要依赖 `projectRoot`:

`packages/api/src/routes/ppt-studio.ts`

而真正的路径解析和越界控制也已经基于 `projectRoot` 完成:

`packages/api/src/domains/ppt/ppt-studio-service.ts`

这说明 PPT 的文件安全边界已经明显迁到 `projectRoot`，但这并不等于 live protocol 已经彻底收口。

但协议层仍残留 `worktreeId`，具体体现在三个位置。

第一，消息发送 schema 仍允许 `pptContext` 通过 `worktreeId` 满足校验。

`packages/api/src/routes/messages.schema.ts:21-32`

这里的约束是:

1. `pptContext` 可以带 `worktreeId`
2. 也可以带 `projectRoot`
3. 校验规则是两者有一个就行

也就是说，协议层仍然承认“只有 `worktreeId` 的 PPT 上下文”是合法的。

第二，前端在构建 PPT 消息上下文时，仍会继续把 `worktreeId` 带上。

`packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:41-49`

`buildPptMessageContext(...)` 的逻辑是:

1. 如果 `session.projectRoot` 存在，就带上 `projectRoot`
2. 如果 `session.worktreeId` 存在，就继续带上 `worktreeId`

第三，PPT 预览 URL 和前端同步逻辑仍保留 `worktreeId` 注入。

例如:

`packages/web/src/components/cli-output/use-cli-output-ppt-preview.ts:57-67`

这里会把当前 `workspaceWorktreeId` 填入 PPT session。

再例如:

`packages/web/src/components/ppt-studio/ppt-preview-canvas.ts:28-41`

`buildPptSlideUrl(...)` 在构建 `/api/ppt-studio/slide` 的 URL 时，如果有 `worktreeId`，也会继续拼到 query 里。

##### 页面表现

这一项不像“文件打不开”那样直接体现在用户页面上，它更常见的表现是 **页面主链能用，但消息契约、prompt 语义和 session 模型仍带着旧心智模型运行**。

用户在页面上看到的是:

1. `PPT Studio` 预览
2. “打开 pages 文件夹”
3. “导出 PPT”

这些操作实际上都已经是基于 `projectRoot` 的专用产品能力；但内部状态却仍携带 `worktreeId`，使实现层看起来像还挂在旧 workspace 模型上。

这种不一致短期内不一定造成立即的页面故障，但会让后续开发者误以为:

1. `worktreeId` 仍然是正式依赖
2. 某些 PPT 功能仍应围绕 workspace registry 设计
3. PPT 是构建在旧 workspace 体系上的，而不是已经迁出的专用链路

##### 为什么归类为“部分恢复”

更准确地说，它当前的状态是:

1. 用户主路径基本可用
2. 后端核心边界已经迁到 `projectRoot`
3. 但消息契约、session 模型、prompt 语义和 URL 仍在传播旧 `worktreeId` 语义

因此它不是“仍受影响”的直接用户故障，而是协议层尚未收口。

##### 后续收口选项

1. 保留 `worktreeId` 作为纯兼容字段，但不再作为正式语义继续使用
2. 继续去语义化，在前后端逐步移除不再必要的 `worktreeId` 传递
3. 将 `pptContext` 的正式契约明确收敛为 `projectRoot + pagesDir` 主导

### 测试 / 契约层残留

1. 生成文件位置披露测试仍期望输出 `/api/workspace/download`

测试仍把 legacy workspace URL 视为正文位置披露的正确结果，这会直接阻碍后续将正文文件位置改造成新专用链路或纯路径披露。

证据：

`packages/api/test/generated-file-artifacts.test.js:11-49`

2. multipart 测试仍期望附件落到 workspace target

测试仍验证 `parseMultipart` 会生成 `/api/workspace/download?...`，与当前 multipart 附件统一走 `/uploads/...` 的运行时主链相冲突。

证据：

`packages/api/test/parse-multipart.test.js:149-184`

`packages/api/src/routes/parse-multipart.ts:39-42,105-110`

3. markdown workspace link 测试仍期望“在工作区中打开”

前端测试仍把相对 md 链接视为 workspace 可导航链接，但生产代码已经改成“历史 workspace 文档链接已下线”。

证据：

`packages/web/src/components/__tests__/markdown-content-workspace-links.test.ts:79-105`

`packages/web/src/components/MarkdownContent.tsx:452-476`

#### 详细说明: 测试 / 契约层残留

##### 背景

这类问题不会直接出现在用户页面上，但它会持续影响后续收口，因为它让测试和契约继续把旧 workspace 行为定义为“正确结果”。

换句话说，运行时代码已经开始去 workspace 化，但测试仍在强化旧协议。

##### 当前实现

当前至少有四类明确残留:

1. `generated-file-artifacts` 测试仍断言正文应继续输出 `/api/workspace/download?...`
2. `parse-multipart` 测试仍断言附件应落到 workspace target，并生成 workspace download URL
3. markdown workspace link 测试仍断言相对 md 链接应该是“在工作区中打开”
4. preview auto-open store 测试仍断言 `setPendingPreviewAutoOpen(...)` 应切到 `rightPanelMode='workspace'`

这些预期分别与当前生产行为冲突:

1. `generated-file-artifacts` 这一项并不是“当前测试与运行时冲突”，而是测试把当前仍存在的 legacy 行为固化成正确预期，未来会阻碍继续收口
2. multipart 运行时主链已经统一改走 `/uploads/...`
3. 相对 markdown workspace link 的生产行为已经改为“历史 workspace 文档链接已下线”
4. preview auto-open 这项不是“测试先于运行时冲突”，而是测试与当前 store 一起继续强化旧 workspace 状态语义

##### 页面表现

它们不一定直接让页面损坏，但会造成更隐蔽的问题:

1. 工程师尝试继续收口旧协议时，测试会把这些收口判成回归，或者让团队误以为旧行为仍是正式契约
2. 团队会被旧测试持续拉回旧语义
3. 某些测试甚至会与运行时一起强化旧状态模型，而不是只作为“历史遗留”存在
4. 代码想下线、测试想保留，导致系统长期处于半迁移状态

##### 为什么归类为“测试 / 契约层残留”

因为这类问题的主要矛盾不在运行时用户路径，而在“系统如何定义正确行为”。

更准确地说:

1. 运行时代码已经部分迁移，或仍处于 legacy 过渡态
2. 测试和契约仍把旧 workspace 行为视为正确预期，或者与运行时一起继续强化旧语义
3. 这会系统性阻碍后续收口

##### 后续收口选项

1. 把仍验证旧 workspace 协议的测试单独盘点成迁移清单
2. 对每条测试明确判断: 保留、改写、删除
3. 先统一新的正式契约，再更新测试，避免运行时和测试层长期相互拉扯

3. 前端 workspace store 状态

`workspaceWorktreeId`、`rightPanelMode='workspace'`、`workspaceOpenTabs` 等仍在被写入。
由于 panel 已不挂载，很多场景不会直接报错，但状态语义已经和真实产品能力不一致。

证据：

`packages/web/src/stores/chatStore.ts:941-1039`

#### 详细说明: 前端 workspace store 状态残留

##### 背景

这个点的核心不是“WorkspacePanel 还在页面上显示”，恰恰相反，**面板本身已经不再挂载，但 store 里与 workspace 面板相关的一整组状态仍在继续存在并被写入。**

因此它属于“部分恢复”: 页面外观已经下线，但状态模型仍然带着旧的 workspace 语义继续运行。

##### 当前实现

先看现在已经明确关闭的部分。

在右侧副面板区域，代码已经明确写了:

`packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:192`

> workspace 已下线，不再挂载 `WorkspacePanel`

也就是说，从用户可见页面上，传统的 Workspace Explorer / WorkspacePanel 已经不再作为正式 UI 出现。

但在 `chatStore` 中，F63 时代遗留的一整组 workspace 状态还在:

`packages/web/src/stores/chatStore.ts:941-1039`

包括:

1. `rightPanelMode: 'workspace'`
2. `workspaceWorktreeId`
3. `workspaceOpenTabs`
4. `workspaceOpenFilePath`
5. `workspaceOpenFileLine`
6. `workspaceEditToken`
7. `workspaceEditTokenExpiry`
8. `workspaceRevealPath`
9. `pendingPreviewAutoOpen`

更关键的是，这些状态不只是“躺在那里没人用”，而是仍有 setter 在继续主动写入。例如:

1. `setWorkspaceWorktreeId(...)`
2. `setWorkspaceOpenFile(...)`
3. `setWorkspaceRevealPath(...)`
4. `setPendingPreviewAutoOpen(...)`

其中多个 setter 会直接把 `rightPanelMode = 'workspace'` 写回 store。

##### 页面表现

这就带来一个实现和页面语义脱节的问题: 状态层仍然认为“workspace 右侧面板是一个可切换目标”，但实际页面已经不再挂载对应的 UI。

从页面视角看，这个残留会带来三类影响。

第一类是 silent failure。

也就是某些旧逻辑仍然会试图把系统切到 `workspace` 模式，或者仍然向 workspace 面板投递“打开某个文件”“reveal 某个路径”“预览自动打开”这样的状态；但因为面板已经不在，用户不会看到对应结果。

这类问题不一定会直接抛错，所以很容易在测试时被忽略。页面上表现为:

1. 某个动作触发了
2. store 状态也改了
3. 但右侧并没有出现任何用户预期的面板反馈

第二类是对新功能的状态污染。

例如当前 PPT Studio 仍然共享 `rightPanelMode` 这个状态模型，而这个模型同时保留:

1. `status`
2. `workspace`
3. `pptStudio`

见:

`packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:16`

这意味着“workspace 虽然页面已下线，但仍然是状态模型里的合法枚举值”。后续任何右侧栏相关功能，如果不小心复用或沿用这套状态模型，就可能继续把已经不再存在的 `workspace` 作为真实分支处理。

第三类是开发理解成本增加。

对后来维护这段代码的人来说，看到 store 里还有大量 `workspace*` 状态，很容易得出错误判断:

1. workspace 面板只是暂时隐藏
2. 某些能力可能还依赖 workspace 面板恢复
3. 相关 setter 仍然是有效产品入口

但真实情况是:

1. 面板已经不挂载
2. 多数旧入口已经失去实际可见落点
3. 保留下来的很多状态更像历史兼容壳，而不是活跃产品能力

##### 为什么归类为“部分恢复”

这一项之所以不归类为“仍受影响”，是因为它主要是 **状态层与实现层的债务**，不是一个用户当前必现的功能损坏点。用户大多数主流程仍可用。

但它也不能算“已恢复”，因为:

1. 状态模型仍在持续传播旧 workspace 语义
2. 某些动作仍可能把界面状态切到一个页面上已不存在的模式
3. 它为后续继续误用 workspace 语义留下了入口

因此更准确的结论是:

1. 页面级 workspace 面板已下线
2. store 级 workspace 状态尚未收口
3. 当前属于“状态残留仍活跃，但用户可见 UI 已消失”的部分恢复状态

##### 后续收口选项

1. 保留这些状态作为兼容壳，但冻结不再扩展
2. 将仍会写入 `rightPanelMode='workspace'` 的入口逐步清理掉
3. 重新定义右侧面板状态模型，只保留真实还存在的页面模式

### 仍受影响

1. `PptSessionCard` 仍使用已下线的 `/api/workspace/local-file-meta`

影响：

1. PPT Studio 成品 PPT 卡片的文件存在性校验失效
2. 生成时间读取失效
3. streaming 阶段轮询等待文件出现的逻辑失效

证据：

`packages/web/src/components/ppt-studio/PptSessionCard.tsx:191-205`

这和普通生成文件卡片已经迁到 `/api/projects/local-file-meta` 明显不一致。

#### 详细说明: `PptSessionCard` 仍调用旧的 `/api/workspace/local-file-meta`

##### 背景

这个问题主要出现在 **PPT Studio 右侧预览面板** 中，也就是用户生成 PPT 相关内容后，右侧打开的 PPT 预览区。

核心组件:

1. `packages/web/src/components/ppt-studio/PptSessionCard.tsx`
2. `packages/web/src/components/ppt-studio/PptStudioPanel.tsx`
3. `packages/web/src/components/cli-output/CliOutputBlock.tsx`

##### 当前实现

典型用户路径是:

1. 用户在聊天区触发 PPT 生成
2. CLI 输出里出现 PPT 相关产物
3. 右侧打开 PPT Studio 预览
4. 在预览区看到一个“成品 PPT 文件卡片”
5. 用户查看该文件是否已生成、生成时间、点击打开或打开文件夹

`PptSessionCard` 这张卡片会展示:

1. 文件名
2. 生成时间
3. “打开文件夹”按钮
4. “打开”按钮

代码位置:

`packages/web/src/components/ppt-studio/PptSessionCard.tsx:138-160`

`packages/web/src/components/ppt-studio/PptSessionCard.tsx:233-260`

现在真正受影响的是这张卡片的“文件存在性校验”和“生成时间读取”链路。虽然“打开”和“打开文件夹”按钮已经迁到了新链路:

1. `/api/projects/open-local`
2. `/api/projects/open-local-folder`

但在渲染前，它仍会先调用旧接口检查文件元信息:

`packages/web/src/components/ppt-studio/PptSessionCard.tsx:194`

```ts
const response = await apiFetch('/api/workspace/local-file-meta', ...)
```

而这个接口已经属于 F143 下线范围。

##### 页面表现

用户在页面上的可见感知通常不是直接看到“404”，而是以下几种异常表现:

1. 成品 PPT 卡片的“生成时间”不稳定或拿不到
2. 流式生成阶段的等待体验不对，轮询检测文件出现的逻辑不可靠
3. 卡片状态和真实文件状态不一致: 文件可能已经生成，甚至“打开”按钮也能成功，但卡片自身的“验证文件中”或错误状态不准确

这一点容易被忽略，因为普通聊天消息里的本地生成文件卡片已经改成了新接口:

`packages/web/src/components/cli-output/CliOutputBlock.tsx:475`

所以如果只测聊天区文件卡片，会觉得已经修好了；但右侧 PPT Studio 那张专门的成品 PPT 卡片，实际上还有一个没迁完的分支。

##### 为什么归类为“仍受影响”

这不是单纯的协议残留，而是一个仍然会直接影响页面状态正确性的运行时断点。

更准确地说:

1. 聊天区里的普通生成文件卡片大体恢复
2. 右侧 PPT Studio 的成品 PPT 卡片状态校验链路仍受影响
3. 用户可见页面上会出现状态显示不准的问题

##### 后续收口选项

1. 将 `PptSessionCard` 的元信息请求迁到 `/api/projects/local-file-meta`
2. 对齐普通本地生成文件卡片与 PPT 成品卡片的状态校验实现
3. 明确 PPT Studio 文件卡片是否继续保留独立轮询逻辑，还是复用统一本地文件状态模型

2. 后端仍会生成新的 workspace 下载 rich block

影响：

1. 新消息里仍可能出现 `/api/workspace/download?...`
2. 前端只能把它降级成“历史 workspace 文件，能力已下线”
3. 用户感知是“刚生成的文件却不可交互”

证据：

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:76-105`

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:285-299`

#### 详细说明: 后端仍会生成新的 legacy workspace file rich block

##### 背景

这个问题主要影响 **聊天消息区**，尤其是一条 assistant 消息里文件产物的展示方式。

相关组件:

1. `packages/web/src/components/ChatMessage.tsx`
2. `packages/web/src/components/rich/FileBlock.tsx`
3. `packages/web/src/components/ContentBlocks.tsx`
4. 后端生成逻辑: `packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts`

##### 当前实现

典型用户路径是:

1. 用户让模型生成某个文件，尤其是 `.ppt` 或 `.pptx`
2. 模型执行过程中，后端把文件变化事件转成消息内容
3. 聊天区出现文件相关展示

理想状态下，页面应该主要通过 `send_file_to_user` 展示新的本地文件卡片，并允许用户打开或打开文件夹。

但现在后端在处理 `file_change` 时，仍然会额外生成一种旧的 file rich block:

`packages/api/src/domains/cats/services/agents/providers/codex-event-transform.ts:95`

```ts
url: `/api/workspace/download?worktreeId=...&path=...`
```

##### 页面表现

如果这个 legacy rich block 最终被渲染出来，聊天区会出现一个 `FileBlock`。而 `FileBlock` 对 legacy workspace 文件的处理是:

`packages/web/src/components/rich/FileBlock.tsx:53-75`

它会直接显示:

1. 文件名
2. 副标题: `历史 workspace 文件，能力已下线`
3. 位置: `workspacePath`
4. 一个“已下线”标签
5. 不给正常下载或打开动作

页面上会出现三种情况:

1. 去重成功
如果同一个文件也通过 `send_file_to_user` 进来了，而且文件名能对上，`ChatMessage.tsx` 的去重逻辑会把这个旧 block 隐掉，用户最终只看到新的本地文件卡片。

2. 去重失败
如果文件名、路径形式、命名方式不完全一致，前端可能去重失败。用户会在同一条消息里同时看到:
一张新的本地文件卡片和一张旧的、显示“历史 workspace 文件，能力已下线”的文件块。

3. 没有 `send_file_to_user`，只有旧 block
这种情况下，聊天区只能展示旧 block。对用户来说，明明是刚刚新生成的文件，页面却把它展示成“历史 workspace 文件，能力已下线”，语义上是错误的。

##### 为什么归类为“仍受影响”

这不是单纯的“协议没清理完”，而是后端仍在继续生产新的 legacy 文件块。

更准确地说:

1. 问题发生在聊天消息内容区
2. 有时会被前端去重掩盖
3. 有时会直接以“已下线文件块”的形式暴露给用户
4. 用户可能看到“新生成文件被当成历史下线文件展示”的怪现象

##### 后续收口选项

1. 停止 `codex-event-transform.ts` 继续生成新的 workspace file rich block
2. 明确规定文件展示的唯一正式来源是 `send_file_to_user`、新专用 artifact 协议，还是其他链路
3. 在后端生产层收口后，再评估前端 legacy 去重是否可以逐步简化

3. 生成文件位置披露仍可能把 legacy workspace URL 写进正文

影响：

1. 正文中的“文件位置：...”仍可能出现已下线 URL
2. 不只是 rich block 坏，连正文也会继续暴露旧协议

证据：

`packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts:36-70`

接入点：

`packages/api/src/domains/cats/services/agents/routing/route-serial.ts:707`

`packages/api/src/domains/cats/services/agents/routing/route-parallel.ts:563`

`packages/api/src/routes/callbacks.ts:446`

#### 详细说明: 正文“文件位置”仍可能写出 legacy workspace URL

##### 背景

这个问题主要发生在 **聊天消息正文**，不是文件卡片区域，而是消息文本本身。

相关后端逻辑:

1. `packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts`
2. 接入点:
3. `packages/api/src/domains/cats/services/agents/routing/route-serial.ts`
4. `packages/api/src/domains/cats/services/agents/routing/route-parallel.ts`
5. `packages/api/src/routes/callbacks.ts`

前端显示组件:

1. `packages/web/src/components/MarkdownContent.tsx`
2. `packages/web/src/components/ChatMessage.tsx`

##### 当前实现

典型用户路径是:

1. 模型生成了一个文件
2. 后端在保存消息时，自动给正文补一段“文件位置”
3. 这段文字出现在消息正文中

页面上可能出现类似:

```md
文件位置:
- report.docx: /api/workspace/download?worktreeId=wt-1&path=output%2Freport.docx
```

生成逻辑在:

`packages/api/src/domains/cats/services/agents/routing/generated-file-artifacts.ts:66-70`

```ts
const disclosure = missingArtifacts
  .map((artifact) => `- ${artifact.fileName}: ${resolveArtifactLocation(artifact)}`)
```

而 `resolveArtifactLocation()` 现在直接返回 `artifact.url`。

##### 页面表现

因此即使前端把 legacy file block 隐掉了，正文中的字符串也不会自动消失。页面上可能出现这种组合:

1. 上面是一张新的本地文件卡片，用户可以打开
2. 下面正文又写着一个 `/api/workspace/download?...` 的旧地址

从用户视角，会有几种混乱:

1. 把它当成可用链接
正文里直接出现 `/api/workspace/download?...`，用户自然会认为这是一个当前可用的文件地址。

2. 即使不可点，也会像内部实现泄露
这种内容不像正常产品文案，更像内部协议细节直接暴露到了 UI。

3. 正文和文件卡片信息冲突
卡片走的是新链路，正文却展示旧链路。用户会看到“页面操作是新的，文本说明还是旧的”。

这个点比 rich block 更隐蔽，因为 file rich block 至少已经有“历史 workspace 文件，能力已下线”的显式提示；而正文中的“文件位置”只是普通文本，不会自带“已下线”警示，用户更容易误当成当前真实可用的地址。

##### 为什么归类为“仍受影响”

这不是静态兼容字段残留，而是会直接影响消息正文可信度的运行时问题。

更准确地说:

1. 它影响消息正文区域的可信度
2. 即使卡片恢复了，文本仍可能继续输出旧 workspace 协议
3. 用户会在同一条消息里同时看到“新链路交互 + 旧链路文本说明”

##### 后续收口选项

1. 调整 `generated-file-artifacts.ts`，不要再把 legacy workspace URL 作为正文位置披露
2. 如果仍需披露位置，优先使用本地相对路径、专用 artifact URL，或更面向用户的文本描述
3. 与文件卡片展示协议保持一致，避免正文和卡片分别说两套来源

#### 页面视角的整体串联

如果把用户一次“生成 PPT / 文档文件”的完整页面体验串起来，实际可能是这样的:

1. 聊天区里，`CliOutputBlock` 已经出现一张新的本地文件卡片
2. 同一条消息里，又混进来一个 legacy workspace file block
3. 正文下面还补了一段 `/api/workspace/download?...` 的“文件位置”
4. 右侧 PPT Studio 里，成品 PPT 卡片又因为旧 `local-file-meta` 接口，状态显示不稳定

于是用户会在一个界面里同时看到三种不一致:

1. 聊天区新卡片: 像是已经修好了
2. 聊天区旧 file block 或旧 URL: 像是还没修
3. 右侧 PPT 卡片状态: 像是局部又坏着

这就是为什么这三个点虽然都属于“workspace 下线残留影响”，但它们分布在不同页面区域:

1. 聊天消息卡片区
2. 聊天消息正文区
3. 右侧 PPT Studio 面板区

### 已明确下线

以下能力不是漏修，但建议在后续收口中单独归档，避免再次误判成 bug：

1. `/api/workspace/*` 路由整体
2. WorkspacePanel / Workspace Explorer 可视面板
3. 通用 workspace 文件树、旧文件 reveal、旧 open-local 流
4. 基于 workspace 协议的历史消息文件可交互打开

证据：

`packages/api/src/index.ts`

`packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx:192`

## 当前最值得继续收口的点

从现状看，后续最值得优先收口的是以下五项：

1. 将 `PptSessionCard` 的文件元信息接口从 `/api/workspace/local-file-meta` 迁到 `/api/projects/local-file-meta`
2. 停止 `codex-event-transform.ts` 继续生成新的 workspace file rich block
3. 调整 `generated-file-artifacts.ts`，不要再把 legacy workspace URL 写入正文“文件位置”披露
4. 决定 `worktreeId` 在 PPT 体系里是保留兼容字段，还是继续去语义化
5. 决定 `chatStore` 中的 workspace 状态是冻结保留，还是继续清理，避免后续逻辑继续依赖这些残留状态

## 备注

本文件是一次现状审计，不代表最终产品决策。

后续若决定继续恢复部分 workspace 相关能力，建议基于本清单为每一项增加单独的结论字段：

1. 保持下线
2. 恢复并迁移到新专用链路
3. 保持兼容但不再扩展
4. 删除残留实现
