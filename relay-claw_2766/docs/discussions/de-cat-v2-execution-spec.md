---
feature_ids: [F140]
related_features: []
topics: [branding, de-cat, office-claw, dead-code, execution-plan]
doc_kind: spec
created: 2026-04-23
---

# F140 v2: De-Cat Execution Spec (2026-04-23)

> **Status**: draft | **Owner**: Claude + Codex 联合分析 | **Branch**: `feat/F140-decat-v2-batch4-rebase`
> **前置**: F140 Phase A/M/F 已完成，PR #407 已合入

## 背景

F140 第一轮（2026-04-10 ~ 04-21）完成了系统 prompt、MCP 工具名、功能封堵（Phase F）和部分配置文件重命名。PR #407 在此基础上进一步做了 config 文件名迁移和文档清理。

本 spec 是第二轮执行计划，目标是**完全去猫化**：用户界面零猫痕 + 代码层无误导性残留 + 已封堵功能的死代码物理删除。

## 决策记录

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| D1 | Signal/Study/Podcast 全量删除 | OfficeClaw 不提供知识阅读器功能 | 2026-04-23 |
| D2 | 毛线球（TaskPanel）删除 | OfficeClaw 不提供任务追踪面板 | 2026-04-23 |
| D3 | 右侧 Workspace 面板全量删除 | RightStatusPanel/WorkspacePanel 已不渲染，确认移除 | 2026-04-23 |
| D4 | Bootcamp 前端断开并删除 | 后端路由已断，前端仍为僵尸渲染 | 2026-04-23 |
| D5 | Mission Control 前端组件删除 | 页面路由已删，26 个组件为孤儿代码 | 2026-04-23 |
| D6 | Agent guide 品牌迁移声明已加入 | CLAUDE.md/AGENTS.md/GEMINI.md/KIMI.md 顶部加 Branding Migration Notice | 2026-04-23 |
| D7 | Governance 标记已统一 | `CAT-CAFE-GOVERNANCE` → `OFFICECLAW-GOVERNANCE` (四个 agent guide) | 2026-04-23 |

---

## Batch 0: 死代码物理删除

> **目标**: 把 Phase F 封堵但保留的 ~130 个孤儿文件物理删除，减少后续 batch 的改动面
> **风险**: 中 — 需确认无 import 残留导致编译失败
> **验收**: `pnpm build` 通过，前端正常加载

### 0-A. Game 系统 (~29 files)

| 目录/文件 | 文件数 | 说明 |
|-----------|--------|------|
| `packages/api/src/domains/cats/services/game/` | 19 | 全目录删除（含 werewolf 子目录） |
| `packages/api/src/routes/games.ts` | 1 | 路由文件（已从 index.ts 摘除） |
| `packages/api/src/routes/game-actions.ts` | 1 | 路由文件 |
| `packages/api/src/routes/game-command-interceptor.ts` | 1 | 路由文件 |
| `packages/web/src/components/game/` | 7 | 全目录删除 |
| `packages/web/src/stores/gameStore.ts` | 1 | 状态管理 |
| `packages/web/src/hooks/useGameApi.ts` | 1 | API hook |
| `packages/web/src/hooks/useGameReconnect.ts` | 1 | Socket hook |

**清理引用**:
- `packages/shared/src/types/` 中 game 相关类型（如 game.ts）
- 测试文件中的 game mock/fixture

### 0-B. Leaderboard (~12 files)

| 目录/文件 | 文件数 | 说明 |
|-----------|--------|------|
| `packages/api/src/domains/leaderboard/` | 7 | 全目录删除 |
| `packages/api/src/routes/leaderboard.ts` | 1 | 路由文件 |
| `packages/api/src/routes/leaderboard-events.ts` | 1 | 路由文件 |
| `packages/web/src/components/HubLeaderboardTab.tsx` | 1 | Hub tab 组件 |
| `packages/web/src/components/leaderboard-cards.tsx` | 1 | 展示组件 |
| `packages/web/src/components/leaderboard-phase-bc.tsx` | 1 | 展示组件 |

**清理引用**:
- `packages/shared/src/types/leaderboard.ts`
- 相关测试文件

### 0-C. Voting (~3 files)

| 文件 | 说明 |
|------|------|
| `packages/api/src/routes/votes.ts` | 路由文件 |
| `packages/web/src/components/VoteConfigModal.tsx` | UI 组件 |
| `packages/web/src/components/VoteActiveBar.tsx` | UI 组件 |

**清理引用**:
- `packages/api/src/domains/cats/services/agents/routing/vote-intercept.ts`
- 测试文件中 vote 相关 fixture

### 0-D. Bootcamp (~5 files)

| 文件 | 说明 |
|------|------|
| `packages/api/src/routes/bootcamp.ts` | 路由文件 |
| `packages/api/src/routes/callback-bootcamp-routes.ts` | 回调路由 |
| `packages/api/src/domains/cats/services/bootcamp/` | 2 文件 |
| `packages/web/src/components/BootcampListModal.tsx` | **仍被 ChatContainer 渲染 — 需先断引用** |

**断引用（必须先做）**:
- `ChatContainer.tsx` 中移除 `BootcampListModal` import 和渲染
- `ChatEmptyState.tsx` 中移除训练营入口

### 0-E. Signal/Study/Podcast (~48 files)

| 目录/文件 | 文件数 | 说明 |
|-----------|--------|------|
| `packages/api/src/domains/signals/` | 33 | 全目录删除 |
| `packages/api/src/routes/signals.ts` | 1 | 路由文件 |
| `packages/api/src/routes/signal-study-routes.ts` | 1 | 路由文件 |
| `packages/api/src/routes/signal-collection-routes.ts` | 1 | 路由文件 |
| `packages/api/src/routes/signal-podcast-routes.ts` | 1 | 路由文件 |
| `packages/web/src/components/signals/` | 11 | 全目录删除 |

**断引用**:
- MCP server 中 signal 工具仍 active — 需从 `server-toolsets.ts` 摘除
- 前端 signal 组件的渲染入口

### 0-F. Mission Control 前端组件 (~26 files)

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `packages/web/src/components/mission-control/` | 26 | 全目录删除（页面路由已在 Phase F 中删除） |

**清理引用**:
- 检查是否有其他组件 import 了 mission-control 目录下的文件

### 0-G. 毛线球 TaskPanel

| 文件 | 说明 |
|------|------|
| `packages/web/src/components/TaskPanel.tsx` | 左侧边栏底部面板 |

**断引用**:
- `ThreadSidebar.tsx` 中移除 TaskPanel import 和渲染
- chatStore 中相关状态（如有）

### 0-H. 右侧 Workspace 面板

| 文件 | 说明 |
|------|------|
| `packages/web/src/components/RightStatusPanel.tsx` | 右侧状态面板（已不渲染） |
| `packages/web/src/components/WorkspacePanel.tsx` | 右侧文件浏览器（已不渲染） |
| `packages/web/src/components/PlanBoardPanel.tsx` | 嵌入 RightStatusPanel |
| `packages/web/src/components/SessionChainPanel.tsx` | 嵌入 RightStatusPanel |
| `packages/web/src/components/audit/AuditExplorerPanel.tsx` | 嵌入 RightStatusPanel |

**断引用**:
- chatStore 中 `rightPanelMode`、`workspaceWorktreeId` 等状态
- 相关测试文件

### Batch 0 验收

```bash
pnpm build                    # 编译通过
pnpm lint                     # 类型检查通过
# 前端能正常启动和渲染
# 无 import 报错
```

---

## Batch 1: 低风险命名清洁

> **目标**: 清理内部常量、注释、组件名中的 cat-cafe 残留（不碰核心 schema/路由/目录结构）
> **风险**: 低
> **验收**: `pnpm build` + 定向 grep 零命中
> **状态**: ✅ 完成 | commit `1a9e2ae9` | 2026-04-24
> **执行方式**: 铲屎官在 Claude 指导下使用 VS Code 全局 Replace + git mv，Claude 做注释清理和验收 grep

### 1-A. 前端组件重命名

| 当前 | 改为 | 文件 |
|------|------|------|
| `CatCafeHub` (组件名+文件名) | `OfficeClawHub` | `CatCafeHub.tsx` → `OfficeClawHub.tsx` |
| `CatCafeLogo` (组件名+文件名) | `OfficeClawLogo` | `icons/CatCafeLogo.tsx` → `icons/OfficeClawLogo.tsx` |
| `"Cat Café Hub"` (UI 文本) | `"OfficeClaw Hub"` | Hub 弹窗标题 |

### 1-B. 内部常量/事件名

| 当前 | 改为 | 文件 |
|------|------|------|
| `CAT_CAFE_DIR` | `OFFICE_CLAW_DIR` | `office-claw-catalog-store.ts` |
| `GEMINI_CAT_CAFE_ENV_PLACEHOLDERS` | `GEMINI_OFFICE_CLAW_ENV_PLACEHOLDERS` | `mcp-config-adapters.ts` |
| `'catcafe.ui.thinkingExpandedByDefault'` | `'officeclaw.ui.thinkingExpandedByDefault'` | `chatStore.ts` |
| `'catcafe:chat-layout-changed'` | `'officeclaw:chat-layout-changed'` | `A2ACollapsible.tsx`, `ScrollToBottomButton.tsx` |
| `CAT_ERROR: 'cat_error'` | `AGENT_ERROR: 'agent_error'` | `EventAuditLog.ts` |
| `'CAT_NOT_ACTIVE'` | `'AGENT_NOT_ACTIVE'` | `queue.ts` |

**localStorage 迁移**: 跳过。该 key 仅存储 UI 偏好（thinking 是否默认展开），丢失后恢复默认值，用户无感知。

### 1-C. 推送通知 tag

| 当前 | 改为 | 文件 |
|------|------|------|
| `'cat-decision-'` | `'oc-decision-'` | `push-notification-policy.ts` |
| `'cat-reply-'` | `'oc-reply-'` | `push-notification-policy.ts` |

> **实际执行**: 跳过。代码已迁移到 `OFFICE_DECISION_TAG_PREFIX` 并保留 `LEGACY_DECISION_TAG_PREFIX` 做向后兼容。

### 1-D. 注释清理

搜索范围: `packages/web/src/`, `packages/api/src/`, `packages/shared/src/`
关键词: `CatCafe`, `cat cafe`, `cat-cafe`, `clowder`, `CAT_CAFE`
只改注释，不改代码逻辑。

> **实际执行**: 清理了 `invoke-single-cat.ts` 中 3 处 `CAT_ERROR` 注释引用。

### Batch 1 验收

```bash
pnpm build
# 定向 grep 零命中:
grep -rn 'CAT_CAFE_DIR\|GEMINI_CAT_CAFE\|catcafe\.\|catcafe:' packages/
grep -rn 'CatCafeHub\|CatCafeLogo' packages/web/src/ --include='*.ts' --include='*.tsx'
grep -rn "'cat-decision-\|'cat-reply-'" packages/web/src/
```

> **验收结果**: 全部零命中 ✅

---

## Batch 2: 配置/类型别名去猫

> **目标**: 收敛 shared/api 中保留的猫语义别名和 fallback 常量
> **风险**: 中 — 前端多模块直接依赖
> **验收**: `pnpm build` + 前端 mention/transcription 功能正常
> **状态**: ✅ 完成 | commit `d8d99b06` | 2026-04-24
> **执行方式**: 铲屎官在 Claude 指导下 VS Code Replace CAT_CONFIGS → OFFICE_CLAW_CONFIGS + 手动删除别名定义和 re-export

### 2-A. `CAT_CONFIGS` 别名删除

当前 `packages/shared/src/types/cat.ts` 中 `CAT_CONFIGS` 是 `OFFICE_CLAW_CONFIGS` 的别名。

消费链:
- `packages/web/src/hooks/useCatData.ts`
- `packages/web/src/lib/mention-highlight.ts`
- `packages/web/src/stores/chatStore.ts`
- `packages/web/src/utils/transcription-corrector.ts`

**做法**: 所有消费点改用 `OFFICE_CLAW_CONFIGS`，然后删除 `CAT_CONFIGS` 导出。

### 2-B. 兼容层导出清理

检查 `packages/shared/src/types/cat.ts` 和 `cat-breed.ts` 中是否有其他仅为兼容保留的导出，一并清理。

### 2-C. `.env.example` 最终统一

确认所有变量使用 `OFFICE_CLAW_*` 前缀，无 `CAT_CAFE_*` 残留。

### Batch 2 验收

```bash
pnpm build
grep -rn 'CAT_CONFIGS' packages/ --include='*.ts' --include='*.tsx' | grep -v '.test.'
# 前端测试: mention highlight, transcription corrector
```

> **验收结果**: CAT_CONFIGS 零命中，别名和 re-export 已删除 ✅

---

## Batch 3: 用户可见 surface 全量去猫

> **目标**: 清理所有用户直接看到的文字、Header、错误消息、安装器文案
> **风险**: 低（纯文本替换）
> **验收**: 全链路 UI 无猫痕
> **状态**: ✅ 完成 | commit `c7fee565` | 2026-04-24
> **执行方式**: 逐条对比 F140 spec 条目与当前代码，大部分已在 Phase A / Batch 0 中完成

### 3-A. 参照 F140 Phase A-fix 清单

F140 spec 中 `A-f1` ~ `A-f9` 共 9 项后端残留。

> **实际执行**:
> - A-f1~A-f3: 跳过 — 超时消息使用 agent 名 (Claude/Codex/Gemini)，不是猫语义
> - A-f4~A-f6: 已在 Phase A 完成
> - A-f7: 本次完成 — McpPromptInjector.ts 注释 `猫` → `智能体`
> - A-f8: 跳过 — quota.ts 注释描述数据源，agent 名是事实
> - A-f9: 已无残留

### 3-B. 参照 F140 Phase B 清单

F140 spec 中 `F01` ~ `F52` 共 52 项前端文案。

> **实际执行**:
> - Batch 0 删除的组件自动跳过: F02, F10, F11, F14, F15, F16, F23, F34, F41, F42, F43
> - Phase A 已完成: F01, F03~F09, F13, F17~F22, F24~F27, F29, F31~F33, F35, F37, F45~F50, F52
> - F28, F30, F51: 已无残留（代码已更新或文件不存在）
> - F36 (A2A 互调): 跳过 — "互调"是 A2A 准确技术描述，非猫语义
> - F38, F40: 跳过 — displayName 已使用中文名，非猫语义（displayName 策略另议）
> - F44: 跳过 — 语音纠正词典包含 agent 名，非猫语义

### 3-C. Governance 治理块

F140 spec 中 `A-g1` ~ `A-g5` governance sentinel 和正文。

> **实际执行**: 全部已在 D7 和 governance-pack.ts 中完成（OFFICE-CLAW-GOVERNANCE sentinel + 三代兼容）。

### 3-D. 安装器/启动脚本文案

> **实际执行**: 无猫主题残留。

### Batch 3 验收

F140 spec 中的 grep gate 全绿。手动验收: 新安装用户全链路无猫痕。

> **验收结果**: 全部零命中 ✅

---

## Batch 4: 领域模型专项去猫

> **目标**: 重命名核心类型、API 路由、目录结构
> **风险**: 极高 — 影响 ~366 源码文件 + ~83 测试文件，前后端契约
> **前置**: Batch 0-3 已完成，设计文档已由铲屎官批准（2026-04-24）
> **状态**: ✅ 全部完成 | commits `27fcb3dc`..`b8bce898` + 跨进程 rename 待提交
> **Rebase**: squash → `d66cec87` → rebase onto `origin/main` | 67 conflicts resolved | 4 cat 残留待修 (R1-R4)

### 设计决策（D8-D13，2026-04-24 铲屎官批准）

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| D8 | `CatId` → 什么？ | `AgentId` | agent 最直观；MemberId 太泛，BotId 有负面含义 |
| D9 | JSON `catId` 字段是否改？ | 改，不需要 API 版本控制 | 桌面应用，无外部 API 消费者，monorepo 同步改 |
| D10 | `/api/cats/*` 路由是否改？ | 改为 `/api/agents/*`，不需要 redirect | 同上 |
| D11 | `domains/cats/` 目录是否改？ | 改为 `domains/agents/`，`git mv` 保留历史 | 纯内部组织 |
| D12 | Redis 已存储数据怎么办？ | 读时兼容旧字段名，写时用新字段名，自然过渡 | 无需迁移脚本或清数据 |
| D13 | 外部消费者？ | 没有。无 OpenAPI spec，shared 包仅 monorepo 内消费 | — |

### 升级兼容方案

**核心原则**: 不写迁移脚本，不清数据。读时兼容旧字段名，写时用新字段名，自然过渡。

**独立 compat 模块**:

```
packages/api/src/compat/catid-field-migration.ts
```

单个函数 `migrateAgentIdFields(data)` 处理所有旧字段名映射:
- `catId` → `agentId`
- `ownerCatId` → `ownerAgentId`
- `defaultCatId` → `defaultAgentId`

**调用点**:
1. Redis store 反序列化路径（~5 个 store 文件，各加一行调用）
2. Catalog JSON loader（1 个文件，breed 数组也过一遍）

**Lua 脚本**: 读时检查两个字段名（`agentId` 优先，fallback `catId`），写时只写新名。

**生命周期**: 仅当前过渡版本需要。后续版本删除方式:
1. 删 `compat/catid-field-migration.ts`
2. grep `migrateAgentIdFields`，删掉所有调用点
3. 完事

不需要 feature flag，不需要版本检测。

### 影响面分析

| 范畴 | 文件数 | 说明 |
|------|--------|------|
| 类型定义 (shared) | ~47 | `CatId`, `CatBreed`, `CatConfig`, `CatState`, `CatColor`, `CatProvider`, `CatVariant` |
| API 路由 + 域逻辑 (api) | ~186 | routes/cats.ts, domains/cats/ 全部 168 文件 |
| 前端 (web) | ~88 | stores, hooks, components 里的 `catId` 引用 |
| 其他包 (core/mcp/provider) | ~17 | plugin types, tool definitions |
| 测试 | ~83 | 跟随源码改 |
| **合计** | **~366 源码 + ~83 测试** | dist 自动重生成，不计 |

### 重命名映射表

| 当前 | 改为 | 类型 |
|------|------|------|
| `CatId` | `AgentId` | branded type |
| `catId` | `agentId` | 字段名/变量名/参数名 |
| `createCatId()` | `createAgentId()` | factory function |
| `CatBreed` | `AgentBreed` | interface |
| `CatVariant` | `AgentVariant` | interface |
| `CatFeatures` | `AgentFeatures` | interface |
| `CatConfig` / `OfficeClawConfigEntry` | `AgentConfig` | interface (合并) |
| `CatState` | `AgentState` | interface |
| `CatColor` | `AgentColor` | interface |
| `CatProvider` | `AgentProvider` | type alias |
| `CatStatus` | `AgentStatus` | type alias |
| `CatRegistry` | `AgentRegistry` | class |
| `cat.ts` | `agent.ts` | 文件名 |
| `cat-breed.ts` | `agent-breed.ts` | 文件名 |
| `domains/cats/` | `domains/agents/` | 目录名 |
| `routes/cats.ts` | `routes/agents.ts` | 文件名 |
| `/api/cats` | `/api/agents` | API 路由 |
| `ownerCatId` | `ownerAgentId` | Redis/Lua 字段 |
| `defaultCatId` | `defaultAgentId` | 配置字段 |

### 执行分层（每层 build 验证）

**Phase 4-1: 类型层 (shared)**
- 重命名 `cat.ts` → `agent.ts`, `cat-breed.ts` → `agent-breed.ts`
- 重命名所有 Cat* 类型 → Agent*
- 更新 `ids.ts` 中 `CatId` → `AgentId`
- 更新 `index.ts` re-exports
- 验证: `pnpm --dir packages/shared build`

**Phase 4-2: 目录 + 路由层 (api)**
- `git mv packages/api/src/domains/cats/ packages/api/src/domains/agents/`
- `git mv packages/api/src/routes/cats.ts packages/api/src/routes/agents.ts`
- 修所有 import 路径
- 路由注册 `/api/cats` → `/api/agents`
- 验证: `pnpm --dir packages/api build`

**Phase 4-3: 字段名全量替换 (all packages)**
- `catId` → `agentId`（变量名、参数名、对象字段）
- `ownerCatId` → `ownerAgentId`
- `defaultCatId` → `defaultAgentId`
- 配套函数名: `findCatByMention` → `findAgentByMention`, `getAllCatIds` → `getAllAgentIds` 等
- 验证: `pnpm build`

**Phase 4-4: 升级兼容模块**
- 创建 `packages/api/src/compat/catid-field-migration.ts`
- 在 5 个 Redis store + 1 个 catalog loader 注入兼容调用
- 更新 Lua 脚本读取逻辑
- 验证: `pnpm build`

**Phase 4-5: 前端 + 测试跟随**
- stores, hooks, components 中的 `catId` 引用
- 测试文件跟随修改
- 配置模板 `office-claw-template.json` 更新
- 验证: `pnpm build` + 定向 grep 零命中

### Batch 4 验收

```bash
pnpm build
# grep gate:
grep -rn 'CatId\|catId\|CatBreed\|CatConfig\|CatState' packages/*/src/ --include='*.ts' --include='*.tsx' | grep -v 'compat/' | grep -v 'migration'
# 期望: 零命中（compat 模块内的旧字段名字符串除外）
# 前端启动 + Hub 面板正常
# Redis 读写兼容验证
```

### Batch 4 执行记录（2026-04-24）

**主体提交**: `27fcb3dc` + `3ac28433`（800+ 文件，Phase 4-1 ~ 4-4 完成）

**Quality Gate 发现的 bug（已修复，待提交）**:

| 文件 | 问题 | 根因 |
|------|------|------|
| `mention-highlight.ts` (×4) | 参数名改了但函数体仍用旧名 → ReferenceError | Phase 4-3 参数/body 不一致 |
| `chatStore.ts` (×5) | 反向：参数保留旧名但 body 被改成新名 | 同上 |
| `ThreadItem.tsx` (×6) | 同 mention-highlight 模式 | 同上 |
| `HubMemberOverviewCard.tsx` | `configCat` prop 改名但调用方未跟随 | Phase 4-5 跨文件 prop rename 遗漏 |
| `config-viewer-tabs.tsx` / `OfficeClawHub.tsx` | 同上，传入 `configCat=` 但组件已改为 `configAgent` | 同上 |
| `ReplyPill.test.tsx` / `hub-agent-editor.test.tsx` | 测试文件中的旧名 | 同上 |
| `RedisMessageStore.ts` | `hydrateMessages()` 未调用 `migrateAgentIdFields()` | Phase 4-4 遗漏第二条读路径 |
| `interface.py` (jiuwenclaw) | API 发 `office_claw_mcp` 但 Python 读 `cat_cafe_mcp` → MCP 工具注入失败 | Phase 4-5 wire protocol key 改了但 Python 端未同步 |

**函数名重命名（Phase 4-3 遗漏，已补完）**: commit `b8bce898`（101 文件）

| 位置 | 旧名 | 新名 | 引用数 |
|------|------|------|--------|
| `chatStore.ts` | `setTargetCats()` | `setTargetAgents()` | 6 |
| `useAgentData.ts` | `getCatsByBreed()` | `getAgentsByBreed()` | 4 |
| `callbacks.ts` | `explicitTargetCats` / `targetCatsExtra` | → `*Agents` | 内部变量 |
| `mcp-server/callback-tools.ts` | `normalizeTargetCats()` | `normalizeTargetAgents()` | 3 |
| `InvocationQueue.ts` | `hasQueuedAgentForCat()` | `hasQueuedAgent()` | 2 |
| 62 个 API 测试文件 | `catId` / `targetCats` / `callerCatId` | → `agentId` / `targetAgents` / `callerAgentId` | — |
| ~20 个 Web 测试文件 | mock 函数名同步更新 | — | — |

**跨进程标识符重命名（Phase 4-5 补完）**: 待提交（24 文件）

| 位置 | 旧名 | 新名 | 说明 |
|------|------|------|------|
| `env-registry.ts` + 4 处引用 | `OFFICE_CLAW_CAT_ID` | `OFFICE_CLAW_AGENT_ID` | 环境变量 |
| `tmux-gateway.ts` / `tmux-agent-spawner.ts` | `catcafe-` 前缀 | `officeclaw-` 前缀 | tmux socket 进程间约定 |
| `DareAgentService.ts` | `name: 'cat_cafe'` | `name: 'office_claw'` | MCP server 注册名 |
| `vendor/jiuwenclaw/tool_manager.py` | `_CAT_CAFE_*` 常量/函数/ContextVar | `_OFFICE_CLAW_*` | Python 内部标识 |
| `vendor/jiuwenclaw/interface.py` | `cat_cafe_mcp` 参数名 | `office_claw_mcp`（保留 fallback） | 兼容旧版 wire protocol |
| 9 个测试文件 | 同步更新断言 | — | — |

**回归修复：静态 MCP 工具遮蔽临时工具**（Phase 4-5 改名引入）

| 文件 | 修改 | 说明 |
|------|------|------|
| `tool_manager.py` | 清理过滤器兼容 `"cat-cafe*"` 旧前缀 | `_CAT_CAFE_SERVER_NAME_PREFIX` → `_OFFICE_CLAW_SERVER_NAME_PREFIX` 后，`.mcp.json` 中残留的 `cat-cafe-collab` 不再被清理，常驻 MCP 服务（无回调凭证）遮蔽了临时工具 |
| `capability-orchestrator.ts` | `DEPRECATED_SPLIT_SERVER_IDS` 标记旧条目为 `enabled: false` | sync 时从 `.mcp.json` 删除旧 `cat-cafe-*` 条目，防止下次启动重新注册 |

**有意保留的兼容标识符**:
- `compat/agentid-field-migration.ts` 中的旧字段名字符串（迁移逻辑必须引用旧名）
- `interface.py` 中 `request.params.get("cat_cafe_mcp")` fallback（向后兼容旧版 API 调用方）
- `tool_manager.py` 中 `_COMPAT_SERVER_NAME_PREFIX = "cat-cafe"` 清理过滤器（向后兼容升级路径）

### Rebase 执行记录（2026-04-25）

**分支**: `feat/F140-decat-v2-batch4-rebase` | **策略**: 将 Batch 0-4 全部改动 squash 为单 commit `d66cec87` 后 rebase 到 `origin/main`

**冲突概况**: 67 个文件冲突（12 UU、23 DU、22 UD、10 AU），分三批 agent 并行解决

| 冲突类型 | 数量 | 处理策略 |
|----------|------|----------|
| UU (双修) | 12 | 逐文件合并，优先 main 的新代码 + 我们的 rename |
| DU (我删/main改) | 23 | 大部分为 Batch 0 已删文件，main 有改动 → 确认仍删 |
| UD (main删/我改) | 22 | 逐个判断：main 删的组件若已 dead code 则不恢复 |
| AU (main新增/我有同路径) | 10 | 保留 main 版本 + 应用我们的 rename |

**Build 修复（3 轮）**:

| 轮次 | 问题 | 文件 | 修复 |
|------|------|------|------|
| 1 | ChatContainer.tsx 语法错误（缺 `)}` 闭合） | `ChatContainer.tsx:541` | 补充缺失的条件表达式闭合 |
| 1 | 13+ TypeScript 错误：stale `domains/cats/` import 路径 | 7 个路由/服务文件 | 更新为 `domains/agents/` |
| 1 | 已删模块 import（preview/workspace-security） | `index.ts`, `messages.ts` | 移除 dead imports |
| 2 | governance 文件引用不存在的符号（23 TS 错误） | `governance-bootstrap.ts`, `governance-preflight.ts` | 回退到 main 的简单版本 + 仅做参数 rename |
| 2 | `invoke-single-agent.ts` 调用签名不匹配 | `invoke-single-agent.ts` | 移除多余的第 3 参数 |
| 3 | 停止回答按钮始终显示（UI bug） | `ChatInputActionButton.tsx` | 见下方 |

**停止回答 UI Bug**:

Merge agent 在解决 ChatInputActionButton.tsx 冲突时，将 main 的嵌套 priority chain 展平，把 `onStop`（停止回答）检查提到了顶层。正确结构是 `onStop` 必须在 `isQueueMode` guard 内部：

```
isQueueMode ? (hasText ? queueSend : onStop ? stopButton : null) : hasText ? sendButton : null
```

修复：`isQueueMode` 从 `Boolean(hasActiveInvocation && hasText && !disabled)` 改为 `Boolean(hasActiveInvocation && onQueueSend)`，恢复嵌套结构。

**历史文档回退**: 146 个设计文档（`docs/` 下的 ADR、讨论记录、feature spec）被机械式 de-cat，违反"历史文档保持原样作为审计线索"原则。commit `3c42d276` 全部回退到 main 版本。

**待修复的 4 处 cat 残留**:

| # | 文件 | 问题 | 修复方案 |
|---|------|------|----------|
| R1 | `RightStatusPanel.tsx` | 全文件使用旧猫命名（useCatData, CatTokenUsage 等） | 删除（已确认 dead code，零 import） |
| R2 | `(main)/page.tsx:48` | 派发 `'cat-cafe:threads-refresh'` 但 ThreadSidebar 监听 `'office-claw:threads-refresh'` | 改为 `'office-claw:threads-refresh'` |
| R3 | `resolve-target-cat.ts` | 文件名未 rename（内部类型已改） | `git mv` → `resolve-target-agent.ts` |
| R4 | `callback-dispatch-agent-task-routes.ts:12` | import 路径仍引用 `resolve-target-cat.js` | 随 R3 更新 |

---

## 排期与并行度

```
Batch 0 (死代码删除)     ──── 可立即开始，独立 PR ────┐
Batch 1 (命名清洁)       ──── Batch 0 之后 ──────────┤
Batch 2 (别名去猫)       ──── Batch 1 之后 ──────────┤  → Batch 3 → Batch 4(需设计)
                                                      │
Agent Guide 更新          ──── ✅ 已完成 ─────────────┘
```

每个 Batch 一个 PR，commit message 格式: `refactor(F140): Batch N — 简述`

## 工作量估算

| Batch | 估算文件数 | 风险 | 预计工时 |
|-------|----------|------|---------|
| 0 | ~130 删除 | 中 | 2-3h |
| 1 | ~15 修改 | 低 | 1h |
| 2 | ~8 修改 | 中 | 1h |
| 3 | ~50 修改 | 低 | 2h |
| 4 | ~250 修改 | 极高 | 需设计文档 |

## 注意事项

1. **pnpm check 不能作为唯一 CI 门禁** — 仓库现存 biome 格式化问题和 `.playwright-browsers` 等未跟踪产物会干扰
2. **不要误提交无关文件** — `office-claw-skills/.playwright-browsers/`, `pptx-craft/*.json` 等
3. **每批只 `git add` 本批文件** — 避免携带脏文件
4. **docs/ 历史文档不改** — ADR、讨论记录保持原样作为审计线索（F140 spec 中已有此约定）
