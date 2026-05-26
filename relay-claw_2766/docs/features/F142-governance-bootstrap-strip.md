---
feature_ids: [F142]
related_features: [F070]
topics: [governance, bootstrap, workspace, external-project]
doc_kind: spec
created: 2026-04-21
---

# F142: Governance Bootstrap 内容剥离 + 外部项目自动初始化

> **Status**: spec | **Owner**: Ragdoll
> **Evolved from**: F070（Portable Governance）Phase 1-3

## Why

F070 设计 governance bootstrap 时，假设派遣猫的 runtime 是原生 Claude/Codex/Gemini CLI——因此 bootstrap 向工作区写入 `CLAUDE.md`（managed block）、`.claude/skills` symlink 等 provider 专属文件，并在 preflight gate 中检查这些文件是否存在。

实际运行分析发现（2026-04-21 梳理）：

1. **jiuwenclaw 不读取任何 provider 文件**——CLAUDE.md、AGENTS.md、GEMINI.md、`.claude/skills`、`.claude/hooks` 在 vendor 代码中 0 引用。jiuwenclaw 的 skills 通过 `JIUWENCLAW_SHARED_SKILLS_DIRS` 环境变量直传，系统提示词由 API 侧 `SystemPromptBuilder` 组装注入。
2. **这些文件的唯一消费者是 `governance-preflight.ts`**——它检查文件是否存在作为"bootstrap 成功"的标记。实质上是**用产物当 marker**。
3. **外部工作区需要用户手动确认 bootstrap**（discover → confirm 流程），而默认 workspace 自动 bootstrap。两者行为不一致，增加了用户操作成本且无实际安全价值——旧版降级场景下，旧版代码会自动引导用户重新生成缺失文件。

## What

### 1. 删除 provider 专属产物的生成

Bootstrap 不再生成：
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` 中的 managed block
- `.claude/skills`、`.codex/skills`、`.gemini/skills` symlinks
- `.claude/hooks`、`.codex/hooks`、`.gemini/hooks` symlinks

Bootstrap 保留生成：
- 方法论模板（`BACKLOG.md`、`docs/SOP.md`、`docs/features/TEMPLATE.md`、`.gitkeep` 等）——外部项目与默认工作区一致
- `.office-claw/governance-registry.json`（审计追踪）
- `.office-claw/governance-bootstrap-report.json`（调试排障）

### 2. 外部项目自动 bootstrap（与 workspace 一致）

- 外部项目在 thread 创建时自动 bootstrap，无需用户手动确认
- 静默写入，不提示用户
- 时机与默认 workspace 相同：`POST /api/threads` → `resolveThreadProjectPath()` → bootstrap

### 3. 简化 preflight gate

- 不再检查 CLAUDE.md 存在性 + managed block
- 不再检查 `.claude/skills` symlink 存在性
- 简化为：检查 registry entry 存在 → 不存在则 auto-bootstrap（而非 block）

### 4. 废弃确认流程 UI

- 移除 `GovernanceBlockedCard` 组件
- 移除 `governance_blocked` 事件类型
- 简化 `HubGovernanceTab`（移除 discover + confirm 流程）
- 废弃 `POST /api/governance/confirm` 和 `POST /api/governance/discover` 端点

## Non-goals

- 不主动删除旧版已生成的 CLAUDE.md / symlinks（孤儿文件留给用户手动清理）
- 不处理降级兼容（旧版 preflight 会引导用户重新生成缺失文件，天然自愈）
- 不清理 `JIUWENCLAW_RUNTIME_SKILLS_DIR` 环境变量（已确认 jiuwenclaw 不读取，但属独立 TD，不在本 feature scope）

## Compatibility

| 场景 | 处理 |
|------|------|
| 旧工作区已有 CLAUDE.md + symlinks | 不删除，新版 bootstrap 跳过 provider 文件，旧文件原样保留 |
| 旧 registry entry（confirmedByUser=true） | 兼容，新版 auto-sync 时走新逻辑（不写 provider 文件） |
| 旧 registry entry（confirmedByUser=false） | 新版直接 auto-bootstrap，跳过确认 |
| 降级回旧版 | 旧版 preflight 检测缺少 CLAUDE.md → 弹 GovernanceBlockedCard → 用户点击重新 bootstrap（自愈） |

## Impact Analysis

### 后端改动

| 文件 | 改动 |
|------|------|
| `governance-bootstrap.ts` | 删除 PROVIDER_FILES / PROVIDER_SKILLS_DIRS / PROVIDER_HOOKS_DIRS 循环（:75-90），保留方法论模板 + registry + report |
| `governance-preflight.ts` | 删除 CLAUDE.md 存在性检查（:88-105）+ skills symlink 检查（:107-127），简化为 auto-bootstrap |
| `governance-pack.ts` | 删除 `MANAGED_BLOCK_START/END`、`getGovernanceManagedBlock()`、`PROVIDER_FILES` 常量。保留 `GOVERNANCE_PACK_VERSION`（版本升级）+ `computePackChecksum()` |
| `routes/threads.ts` | 删除 `usedDefaultWorkspace` 条件（:277-278），所有 thread 创建统一 auto-bootstrap |
| `invoke-single-cat.ts` | 简化 governance gate（:640-678），auto-bootstrap 替代 block + `governance_blocked` 事件 |
| `route-helpers.ts` | 从 `USER_FACING_SYSTEM_INFO_TYPES` 中移除 `governance_blocked`（:199） |
| `capability-orchestrator.ts` | `tryGovernanceBootstrap()` 不再返回 `needsConfirmation`，直接 bootstrap |
| `routes/capabilities.ts` | 废弃 `/api/governance/confirm`（:862-892）、`/api/governance/discover`（:912-942）端点 |
| `relayclaw-sidecar.ts` | （不在 scope，`JIUWENCLAW_RUNTIME_SKILLS_DIR` 清理为独立 TD） |

### 前端改动

| 文件 | 改动 |
|------|------|
| `GovernanceBlockedCard.tsx` | 整体删除 |
| `HubGovernanceTab.tsx` | 删除 discover + confirm 流程 |
| `ChatMessage.tsx` | 删除 `governance_blocked` variant 渲染（:217-227） |
| `useSocket-background-system-info.ts` | 删除 `governance_blocked` 事件处理（:257-283） |
| `useAgentMessages.ts` | 删除 `governance_blocked` 事件处理（:995-1010） |

### 类型定义改动

| 文件 | 改动 |
|------|------|
| `chat-types.ts` | 删除 `governance_blocked` variant（:243） |
| `capability.ts` | 简化 `GovernancePackMeta`，`confirmedByUser` 保留但不再作为 gate（兼容旧 registry） |

### 测试改动

| 文件 | 改动 |
|------|------|
| `governance-bootstrap.test.js` | 更新：不再断言 provider 文件生成 |
| `governance-preflight.test.js` | 简化：删除 CLAUDE.md / symlink 检查断言 |
| `governance-blocked-event.test.js` | 删除 |
| `governance-confirm.test.js` | 删除 |
| `governance-integration.test.js` | 更新：移除 `needsConfirmation` 和 `MANAGED_BLOCK_START` 断言，适配 auto-bootstrap 行为 |
| `governance-pack.test.js` | 简化：删除 managed block 相关断言 |
| `setup-skills-sync.test.js` | 删除 skills symlink 断言 |
| `governance-blocked-card.test.ts`（前端） | 随组件删除一起删除 |
| `chat-message-local-file-dedupe.test.tsx`（前端） | 移除 `GovernanceBlockedCard` 的 `vi.mock`（:38） |
| `chat-message-memo.test.tsx`（前端） | 移除 `GovernanceBlockedCard` 的 `vi.mock`（:42） |

## Acceptance Criteria

- [ ] AC-1: Bootstrap 不再生成 CLAUDE.md / AGENTS.md / GEMINI.md 中的 managed block
- [ ] AC-2: Bootstrap 不再生成 `.claude/skills`、`.codex/skills`、`.gemini/skills` symlinks
- [ ] AC-3: Bootstrap 不再生成 `.claude/hooks`、`.codex/hooks`、`.gemini/hooks` symlinks
- [ ] AC-4: 外部项目在 thread 创建时自动 bootstrap，无需用户手动确认
- [ ] AC-5: 外部项目与默认 workspace bootstrap 产物一致（方法论模板 + registry + report）
- [ ] AC-6: Preflight gate 不再检查 provider 文件存在性，改为 auto-bootstrap
- [ ] AC-7: 前端不再出现 GovernanceBlockedCard
- [ ] AC-8: `governance_blocked` 事件类型从后端事件链路中完整移除（`invoke-single-cat` 不再 yield、`route-helpers` 不再列入 `USER_FACING_SYSTEM_INFO_TYPES`、前端不再处理）
- [ ] AC-9: `/api/governance/confirm` 和 `/api/governance/discover` 端点已废弃（返回 410 Gone 或直接移除）
- [ ] AC-10: 旧版 bootstrap 过的工作区（含 CLAUDE.md + symlinks）在新版下正常工作（不删除旧文件）
- [ ] AC-11: 新版 bootstrap 过的工作区在旧版下降级自愈（旧版引导用户重新 bootstrap）
- [ ] AC-12: GOVERNANCE_PACK_VERSION 升级，registry health 适配新版本

## Dependencies

| 依赖 | 关系 |
|------|------|
| F070 Portable Governance | Evolved from — 简化其 bootstrap 产物和 gate 逻辑 |

## Risk

1. **旧版兼容降级**：旧版 preflight 会 block 新版 bootstrap 过的目录，但 GovernanceBlockedCard 可自愈。Release note 注明即可。
2. **方法论模板写入外部项目**：BACKLOG.md 出现在项目根目录可能被 git track。用户需自行 gitignore 或接受。
3. **外部目录不可写**：既有问题，不在 F142 scope。不可写目录下猫也无法工作，属 `validateProjectPath` 通用改进，记为独立 TD。

## Key Decisions

| 决策 | 理由 | 来源 |
|------|------|------|
| 删除 provider 文件生成 | jiuwenclaw 不读取，仅 preflight 用作 marker，价值不足 | 2026-04-21 梳理 |
| 外部项目自动 bootstrap | 与 workspace 行为一致，降低用户操作成本 | 铲屎官决策 |
| 方法论模板外部项目也写 | 与 workspace 保持一致 | 铲屎官决策 |
| 静默写入不提示 | 减少 UI 打扰 | 铲屎官决策 |
| 不处理降级兼容 | 旧版 GovernanceBlockedCard 天然自愈 | 分析确认 |
| JIUWENCLAW_RUNTIME_SKILLS_DIR 不在 scope | 死变量清理属独立 TD，不增加本 feature 外部影响 | 铲屎官决策 |
