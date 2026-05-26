---
feature_ids: [F140]
topics: [merge-audit, broken-merge, de-cat]
doc_kind: audit
created: 2026-05-07
author: 布偶猫/宪宪 (@opus-47)
reviewer: 缅因猫/GPT-5.5 (@gpt55)
subject_commit: 9e49fb6b6a9d35328c2f1a2bd2a5beb765b5b68f
plan_ref: docs/plans/2026-05-06-f140-merge-main.md
---

# 9e49fb6b Merge Audit — Broken Merge 排查与修复

## TL;DR

`9e49fb6b` 这次 merge（`3e52cb35` F140 ⊕ `63be2362` main，~530 commits，73 conflicts）解决冲突时存在两类问题：

- **Type X — 命名 SOP 漏执行**：Plan 写了字符串替换规则（`cat-cafe → office-claw`、`CatId → AgentId` 等），但 ~44 处实际没改；分布在 ~10 个文件，按业务影响分 P0/P1/P2 三级。
- **Type Y — 功能逻辑被吞**：合并冲突时本应"feature logic follows main"，但部分文件可能选错了边，把 main 的新功能用旧 cats 时代的逻辑覆盖了。已知一例（`scripts/build-windows-installer.mjs`，**已在 commit `ccc1f308` 修复**），其他 52 个 Plan Task 4 列出的冲突文件**未审计**。

本文档目的：
1. 落盘 Type X 的 P0/P1/P2 完整清单（机械修复）
2. 给 @gpt55 委托 Type Y 的批量审计任务（深度审查）

---

## Background

### Subject Commit

```
commit 9e49fb6b6a9d35328c2f1a2bd2a5beb765b5b68f
Merge: 3e52cb35 63be2362
    merge: integrate origin/main (~530 commits) into F140 de-cat branch
```

- **Parent 1 (3e52cb35)** = F140 分支 (`feat/decat-and-decouple-merge-main`) 旧顶端，de-cat 重命名 + jiuwenclaw vendor 双模式重构
- **Parent 2 (63be2362)** = origin/main 当时顶端
- **73 个 conflict 文件**，其中 53 个 content conflict、18 个 delete conflict、1 个 add/add、1 个 location

### Plan 文档

`docs/plans/2026-05-06-f140-merge-main.md` 是这次 merge 的指导文档，明确了：

- **Task 4 原则**："paths and naming follow this branch (de-cat), feature logic follows main (preserve new features)" — 命名跟当前分支，功能逻辑跟 main
- **Task 7-9** 列了具体字符串替换表（runtime identifiers、localStorage keys、MCP fields）
- **Task 12** 定义了 5 个 grep gate 作为 acceptance criteria
- **Task 13** 列了 V1-V7 功能验证场景

### 已知案例（已修）

**`scripts/build-windows-installer.mjs`**（commit `ccc1f308`）：

冲突解决时同一文件内不同 hunk 选了不同 parent：
- 调用点 hunk 选了 F140 边（保留 `stageJiuwenClawVendor(bundleDir, options)` 调用）
- 函数定义 hunk 选了 main 边（main 没有这两个函数 → 函数定义被吞）
- `assertJiuwenClawVendorReady` 重复定义两次（两边都 take 了）

结果：`pnpm build` 通过（不跑 .mjs），但实际运行 `node scripts/build-windows-installer.mjs` 会 `ReferenceError: stageJiuwenClawVendor is not defined`。

修复路径（Plan A）：用 `git show origin/main:scripts/build-windows-installer.mjs > <file>` 覆盖回 main 干净版本，再 apply 7 处品牌字符串替换。Net diff: `+3/-94`。

---

## Audit Method

### 已执行的检查

1. **真实 conflict marker 残留扫描**：`grep -rE "^(<{7}|>{7}|={7})"` → 0 真冲突（`shared-rules.md` 的 marker 是文档示例）
2. **Plan Task 12 的 5 个 grep gate**：
   - Gate 1（用户可见中文）：✅ PASS (0 hits)
   - Gate 2（runtime 品牌标识符）：❌ FAIL (17 hits, allowlist 1)
   - Gate 3（域模型标识符 CatId/catId/CatConfig/api/cats/）：❌ FAIL (32 hits, allowlist 2)
   - Gate 4（env vars `CAT_CAFE_`）：✅ PASS (0 hits)
   - Gate 5（skills/refs 中文+CAT_CAFE_）：✅ PASS (0 hits)
3. **`build-windows-installer.mjs` 模式扫描**：发现重复函数定义 + 调用未定义函数（已修）

### 未执行（需 @gpt55 接手）

**Type Y — 功能逻辑被吞审计**：对 Plan Task 4 列的 53 个 conflict 文件，逐个对比 `merge parent main (63be2362)` vs `HEAD merge result`，看是否丢失了 main 的功能性代码。

---

## Findings

> ⚠️ **修订标记**：Type X / Type Y 的优先级和修复策略已在 [§ Strategy Update 2026-05-07 19:25](#strategy-update-2026-05-07-1925) 重新分级。下方原始 P0/P1/P2 分类保留作为诊断历史，**实际修复请以 Strategy Update 为准**。

## Type X — 字符串没改（机械修复，可批量执行）

### P0 — 运行时协议字段，立即影响

| # | 文件 | 行 | 现状 | 应改 | Plan 任务 |
|---|---|---|---|---|---|
| 1 | `packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts` | 474 / 627 / 798 | `cat_cafe_mcp` 字段 | `office_claw_mcp` | Task 9 |
| 2 | `packages/api/src/domains/preview/bridge-script.ts` | 14 | `data-cat-cafe-bridge="true"` | `data-office-claw-bridge="true"` | Task 7 |
| 3 | `packages/api/src/domains/preview/bridge-script.ts` | 41 / 59 / 84 / 91 / 99 | `source: 'cat-cafe-bridge'` | `source: 'office-claw-bridge'` | Task 7 |
| 4 | `packages/api/src/domains/preview/bridge-script.ts` | 68 | `e.data.source !== 'cat-cafe-preview'` | `'office-claw-preview'` | Task 7 |
| 5 | `packages/api/src/domains/ppt/ppt-studio-service.ts` | 110 | `html.includes('data-cat-cafe-bridge="true"')` | `'data-office-claw-bridge="true"'` | Task 7 |

**影响**：MCP 协议字段 + preview iframe 通信 source/data attribute。如果 jiuwenclaw 后端只认 `cat_cafe_mcp` 字段，则后端必须同步更新；preview 通信同 source 才会被对端识别，否则消息静默丢弃。

**修复风险**：bridge-script.ts 的 source 字符串两边必须同时改（发送方 + 接收方 ppt-studio-service.ts），否则相互不认。

### P1 — localStorage key / DOM event，用户态/UI 影响

| # | 文件 | 行 | 现状 | 应改 |
|---|---|---|---|---|
| 6 | `packages/web/src/stores/ppt-preview-store-helpers.ts` | 35 | `'catcafe.pptStudioPreviewByThread'` | `'office-claw.pptStudioPreviewByThread'`（按 Plan Task 8 加 fallback 读旧 key）|
| 7 | `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx` | 25 | `'cat-cafe:pptStudioPanelWidthV2'` | `'office-claw:pptStudioPanelWidthV2'` |
| 8 | `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx` | 26 | `'cat-cafe:pptStudioPanelWidth'`（legacy） | 保留（fallback 读旧 key 用） |
| 9 | `packages/web/src/components/ScheduledTasksPanel.tsx` | 495 | `dispatchEvent(new Event('cat-cafe:threads-refresh'))` | `'office-claw:threads-refresh'` |
| 10 | `packages/web/src/components/cli-output/cli-output-block/useCliOutputBlockExpansion.ts` | 54 | `dispatchEvent(new Event('catcafe:chat-layout-changed'))` | `'office-claw:chat-layout-changed'` |

**影响**：
- localStorage key 不一致 → 用户已有 PPT Studio 状态可能丢失（除非加 fallback 读）
- DOM event 不一致 → listener 收不到事件，刷新动作静默失败

**修复风险**：dispatchEvent 的字符串与对应 listener 必须**双方同改**——需要 grep 找所有 `addEventListener('cat-cafe:threads-refresh', ...)` 和 `addEventListener('catcafe:chat-layout-changed', ...)` 一起改。

### P2 — 类型/变量/路由批量

总计 30+ 处，集中分布在以下文件：

| 文件 | 涉及内容 |
|---|---|
| `packages/web/src/stores/chat-types.ts` | L174 `catId?: string;` 字段定义 |
| `packages/web/src/components/agents-panel/AgentsPanel.tsx` | `handleSelectCat(catId)` |
| `packages/web/src/components/agents-panel/components/AgentListSidebar.tsx` | 3 处参数命名 `catId` |
| `packages/web/src/components/agents-panel/hooks/useEditorState.ts` | 多处 `catId` 参数 + `apiFetch('/api/cats/${cat.id}')` 路由 |
| `packages/web/src/components/agents-panel/hooks/useSelectionState.ts` | `handleSelectCat(catId: string)` |
| `packages/web/src/components/agents-panel/hooks/useOverlays.ts` | `(catId: string, ...)` 参数 |
| `packages/web/src/components/create-agent-modal/hooks/useModalState.ts` | L218 `apiFetch('/api/cats/${cat.id}')` 路由 |
| `packages/web/src/components/create-agent-modal/create-agent-modal.utils.ts` | L235-238 `generateRandomCatId()` |
| `packages/web/src/hooks/scheduler-placeholder.ts` | L8 `catId?: string \| null;` + L12 `msg.catId === 'system'` |
| `packages/mcp-server/src/tools/callback-tools.ts` | L703 描述文本 `'or catId.'` |

**特别注意 — `/api/cats/` → `/api/agents/` 路由变更**：

P2 的最高风险项。前端调用 `apiFetch('/api/cats/${id}')` 至少 2 处。**修复前必须先确认 backend 路由现状**：

- 是否已有 `/api/agents/` 路由实现？
- `/api/cats/` 是否已被弃用 / 删除 / 还在保留？
- 是否需要双路由共存做平滑迁移？

如果 backend 还只支持 `/api/cats/`，前端不能改路径——否则发请求 404。

### Type X 修复路径建议

```
P0 (3 文件，11 处) → 立即修，runtime 协议字段
↓
P1 (4 文件，5+ 处) → 修 + 加 localStorage fallback 读旧 key
↓
P2 (10 文件，30+ 处) → 类型/变量批量重命名（IDE refactor 工具更安全）
                        + /api/cats/ 路由确认 backend 状态后再改
```

每一档可独立 commit + 可独立回滚。

---

## Type Y — 功能逻辑被吞（mjs 同款破洞，待审计）

**Audit result**: see `docs/discussions/2026-05-07-9e49fb6b-merge-audit-results.md`.

### 已知一例（已修）

`scripts/build-windows-installer.mjs` — commit `ccc1f308`。

### 未审计的 52 个文件

Plan Task 4 列的 conflict 文件（除 mjs 外）：

#### Group C1 — `domains/agents/.../routing/` (4 files)
- `packages/api/src/domains/agents/services/agents/routing/AgentRouter.ts`
- `packages/api/src/domains/agents/services/agents/routing/route-helpers.ts`
- `packages/api/src/domains/agents/services/agents/routing/route-parallel.ts`
- `packages/api/src/domains/agents/services/agents/routing/route-serial.ts`

#### Group C2 — `domains/agents/.../providers/` (3 files)
- `packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts`
- `packages/api/src/domains/agents/services/agents/providers/codex-event-transform.ts`
- `packages/api/src/domains/agents/services/agents/providers/relayclaw-event-transform.ts`

#### Group C3 — `domains/agents/.../invocation/` (2 files)
- `packages/api/src/domains/agents/services/agents/invocation/InvocationQueue.ts`
- `packages/api/src/domains/agents/services/agents/invocation/QueueProcessor.ts`

#### Group C4 — `domains/agents/.../auth/` (1 file)
- `packages/api/src/domains/agents/services/auth/JiuwenPermissionBridge.ts`

#### Group C5 — `routes/` (5 files)
- `packages/api/src/routes/auth.ts`
- `packages/api/src/routes/capabilities.ts`
- `packages/api/src/routes/messages.ts`
- `packages/api/src/routes/relayclaw-security-proxy.ts`
- `packages/api/src/routes/schedule.ts`

#### Group C6 — `infrastructure/` (3 files)
- `packages/api/src/infrastructure/connectors/ConnectorRouter.ts`
- `packages/api/src/infrastructure/scheduler/templates/web-digest.ts`
- `packages/api/src/integrations/huawei-maas.ts`

#### Group C7 — `packages/web/` hooks (7 files)
- `packages/web/src/hooks/useAgentMessages.ts`
- `packages/web/src/hooks/useChatHistory.ts`
- `packages/web/src/hooks/useSendMessage.ts`
- `packages/web/src/hooks/useSocket-background-system-info.ts`
- `packages/web/src/hooks/useSocket-background.ts`
- `packages/web/src/hooks/useSocket-background.types.ts`
- `packages/web/src/hooks/useSocket.ts`

#### Group C8 — `packages/web/` components + tests (14 files)
- `packages/web/src/components/AgentsPanel.tsx`
- `packages/web/src/components/ChatContainer.tsx`
- `packages/web/src/components/ChatInput.tsx`
- `packages/web/src/components/ChatInputActionButton.tsx`
- `packages/web/src/components/ChatMessage.tsx`
- `packages/web/src/components/MessageActions.tsx`
- `packages/web/src/components/hub-agent-editor.model.ts`
- `packages/web/src/components/status-helpers.ts`
- `packages/web/src/components/__tests__/cli-output-block.test.ts`
- `packages/web/src/components/__tests__/markdown-content-alias-source.test.ts`
- `packages/web/src/components/__tests__/markdown-content-mentions.test.ts`
- `packages/web/src/components/__tests__/overflow-tooltip.test.tsx`
- `packages/web/src/components/cli-output/toCliEvents.ts`
- `packages/web/src/utils/skill-options-cache.ts`

#### Group C9 — Other (7 files，`build-windows-installer.mjs` 已修)
- `.gitignore`
- `SETUP.zh-CN.md`
- `office-claw-skills/skill-creator/SKILL.md`
- `package.json`
- `packages/api/src/index.ts`
- `packages/mcp-server/src/server-toolsets.ts`
- `packages/mcp-server/src/tools/schedule-tools.ts`

#### Group C-tests — Tests (6 files)
- `packages/api/test/f088-gateway-integration.test.js`
- `packages/api/test/invocation-queue.test.js`
- `packages/api/test/relayclaw-security-route.test.js`
- `packages/web/src/hooks/__tests__/useAgentMessages-terminal-error-suppression.test.ts`
- `packages/web/src/hooks/__tests__/useSendMessage-thread-source.test.ts`

#### Group B — Location/add conflicts (2 files)
- `packages/api/src/domains/agents/services/skillhub/SkillOptionsChangeWatcher.ts`（rename from cats/）
- `scripts/sync-jiuwenclaw-vendor.mjs`

---

## Audit Task Assignment for @gpt55

### 任务

对上述 52 个 conflict 文件，**逐个判断 9e49fb6b 解决冲突时是否丢失了 main parent (`63be2362`) 的 feature logic**。

### 方法（每个文件）

1. **快速分类（diff stat）**

   ```bash
   git diff --stat -M70 63be2362 HEAD -- <file>
   ```

   - 行数对称（+x/-x）+ 小差异 → 大概率是纯重命名 → 低风险
   - 不对称（+x/-y, x ≪ y 或 x ≫ y）+ 大差异 → 高风险，需细看

2. **细查（高风险文件）**

   ```bash
   git diff -M70 63be2362 HEAD -- <file>
   ```

   判断 diff 中 `-` 行（main 那边有但 HEAD 没有的代码）是否是：
   - ✅ 合理 — F140 主动删除的旧 cats 逻辑
   - 🚨 不合理 — main 的新功能/修复被吞了

3. **标注疑点**：对每个高风险文件，给出：
   - 文件路径
   - 疑点行号 + diff 片段
   - 判断（feature lost / OK / uncertain）
   - 建议修复方向（rename-only / re-merge from main / 保持现状）

### 期望产出

一份补充审计报告（追加到本文档 § Type Y Audit Results 段，或新建 `docs/discussions/2026-05-07-9e49fb6b-merge-audit-results.md`），包含：

- 高风险文件清单（预期 5-10 个）
- 每个的具体疑点
- 修复优先级建议

### Context for Reviewer

- **mjs 同款破洞模式**：merge 时不同 hunk 选了不同 parent，函数调用点保留 F140 边但函数定义保留 main 边（或反之），导致引用不匹配 / 逻辑断裂。
- **F140 核心 rename**：`domains/cats/` → `domains/agents/`、`CatId` → `AgentId`、`CatConfig` → `AgentConfig`、`useCatData` → `useAgentData`、`cat-cafe` → `office-claw`。**rename 在 git 默认 -M50 阈值下可能不被识别**，需要用 `-M70` 或 `--find-renames=70%` 让 diff 更准确。
- **不在审计范围**：commit `efbc4f16`（May 7，远端新增）的 ChatInput.tsx 重构 + 后续 25 个远端 commit。这些是"未 merge 的 main 新提交"，归后续 catch-up merge 处理。

### 审计时不要做

- 不要修代码——只做发现 + 报告
- 不要跑测试——审计是静态分析
- 不要改 docs——除非补审计结果

### 球权

铲屎官指示：先做 Type Y 分析，分析完成后再决定 Type X 修复 scope（P0 立即修 / P1+P2 暂缓）。

---

## Footnotes

### Related References

- Plan: `docs/plans/2026-05-06-f140-merge-main.md`
- Discussion: `docs/discussions/de-cat-merge-main-plan.md` (D1-D6, R1)
- Decisions: `docs/decisions/` (de-cat 系列)
- Feature: `docs/features/F140-de-cat-branding.md`
- Already-fixed commit: `ccc1f308 fix(windows-installer): repair broken merge from F140 jiuwenclaw vendor double-mode`

### Audit Trail

- 2026-05-07 18:50 by 布偶猫/宪宪 (@opus-47): 初版，记录 Type X P0/P1/P2 + Type Y 审计任务
- 2026-05-07 19:06 by 缅因猫/砚砚 (@gpt55): Type Y 审计结果落盘到 `docs/discussions/2026-05-07-9e49fb6b-merge-audit-results.md`

### Verification Commands Used

```bash
# Conflict marker scan
grep -rE "^(<{7}|>{7}|={7})" .

# Gate 1: user-visible Chinese
grep -rn --include='*.ts' --include='*.tsx' \
  -E '猫猫|猫粮|铲屎官|布偶猫|缅因猫|暹罗猫|狸花猫|ᓚᘏᗢ|Cat Café' \
  packages/web/src/ | grep -v '__tests__/' | grep -v '.test.' | grep -v 'showcase/'

# Gate 2: runtime brand identifiers
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' \
  -E 'cat[-_]cafe|CatCafe|catcafe|domains/cats/' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  | grep -v '__tests__/' | grep -v '.test.' | grep -v node_modules

# Gate 3: domain identifiers
grep -rn --include='*.ts' --include='*.tsx' \
  -E '\bCatId\b|\bcatId\b|\bCatConfig\b|/api/cats/' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  | grep -v '__tests__/' | grep -v '.test.' | grep -v node_modules

# Type Y diff stat (merge parent main vs HEAD)
git diff --stat -M70 63be2362 HEAD -- <file-list>

# Sample for individual file
git diff -M70 63be2362 HEAD -- packages/api/src/routes/auth.ts
```

---

## Strategy Update 2026-05-07 19:25

> By 布偶猫/宪宪 (@opus-47). 基于砚砚 Type Y audit results、平台依赖核实、和 listener/dispatcher 配对验证，重新组织 Type X 优先级与修复路径。原 P0/P1/P2 分级在上方保留作为诊断轨迹。

### Type Y 状态归档

**P1 auth blocking → 归并到 platform-cookie-restoration plan**

- 砚砚 audit results 列出的 5 处 auth 证据，全部对应 [`docs/plans/2026-05-07-platform-cookie-restoration.md`](../plans/2026-05-07-platform-cookie-restoration.md) 的修复点（cookie 注入 4 处 + 新增 `/api/login/callback` 路由 + dev cross-port proxy + huawei-cas provider 注册）
- 该 plan 已 `status: ready-for-implementation`，决策 D1-D7 锁定，含实施 Checkpoint
- **本 audit 不再单独处理 P1 auth**——等 plan 实施

**P2 huawei-maas fallback → F140 解耦的有意决策，不需恢复**

- main parent 上 `huawei-maas.ts` 的 fallback hack（"如果只有一个活跃 session 就用那个"）本质是因为 main 上 huawei-maas 自己持有独立的 `sessions: Map`，跟 platform auth session 是两套不同步的 store
- F140 通过两个有意 commit 解耦了这层依赖：
  - `3ee8a28f feat: extract Huawei integrations to @office-claw/green-package` — huawei 整体提取到独立 package
  - `174255ab fix: decouple session expiration status check before invoking MaaS models`
- 解耦后 `green-package/src/integrations/huawei-maas.ts` 用依赖注入 `getSession: SessionLookup`，不再持有 session；统一查 `authSessionStore.getByUserId(uid)`，session 来源唯一
- 设计文档：[`docs/discussions/2026-04-21-provider-runtime-decoupling-replay-summary.md`](2026-04-21-provider-runtime-decoupling-replay-summary.md)
- **fallback 是补两套不同步 store 的补丁，单一来源后不再需要**——如果 connector-triggered 流真有外部 user ID 不匹配的需求，应在 connector router 层做 ID 映射，不应让 huawei-maas 用启发式兜底（多用户环境会随机命中错误用户）
- **本 audit 不再处理 P2 huawei-maas**

### Type X 重新分级（按 runtime 影响）

#### Tier A — Runtime 已坏（必须立即修）

| # | 文件 | 行 | 现状 | 应改 | 证据 |
|---|---|---|---|---|---|
| A1 | `packages/web/src/components/agents-panel/hooks/useEditorState.ts` | 212 / 259 | `apiFetch('/api/cats/${cat.id}')` | `/api/agents/${id}` | backend `routes/agents.ts:803` 注册的是 `DELETE /api/agents/:id`，**`/api/cats/` 路由后端已不存在**，前端调 `/api/cats/` 直接 404 |
| A2 | `packages/web/src/components/create-agent-modal/hooks/useModalState.ts` | 218 | `apiFetch(cat ? '/api/cats/${cat.id}' : '/api/cats', ...)` | `/api/agents` 系列 | 同上 |
| A3 | `packages/web/src/components/ScheduledTasksPanel.tsx` | 495 | `dispatchEvent(new Event('cat-cafe:threads-refresh'))` | `'office-claw:threads-refresh'` | listener `ThreadSidebar.tsx:220` 用的是 `office-claw:threads-refresh`；其他 4 个 dispatcher（page.tsx / NewThreadContainer / useSendMessage / useChatSocketCallbacks）都已是 `office-claw:` — **ScheduledTasksPanel 是唯一漏改的 dispatcher，事件已静默失败** |
| A4 | `packages/web/src/components/cli-output/cli-output-block/useCliOutputBlockExpansion.ts` | 54 | `dispatchEvent(new Event('catcafe:chat-layout-changed'))` | `'officeclaw:chat-layout-changed'`（注意 listener 用的拼写没连字符）| listener `ScrollToBottomButton.tsx:11` 定义 `CHAT_LAYOUT_CHANGED_EVENT = 'officeclaw:chat-layout-changed'`，测试文件也是这个拼写 — **dispatcher / listener 字符串不一致，事件已断** |

修复风险：
- A1/A2 改后必须实测前端 agent 编辑/删除/创建流程能调通 backend `/api/agents/`
- A3 改完 ScheduledTasksPanel 即与全局 dispatcher / listener 一致
- A4 注意 `officeclaw:` 没连字符——保持跟现有 listener 一致；后续 P2 cleanup 可再统一所有 event 命名规范

#### Tier B — 阻塞依赖（不能现在改）

| # | 文件 | 行 | 现状 | 阻塞条件 |
|---|---|---|---|---|
| B1 | `packages/api/src/domains/agents/services/agents/providers/RelayClawAgentService.ts` | 474 / 627 / 798 | `cat_cafe_mcp` 字段 | jiuwenclaw vendor Python 后端 `vendor/jiuwenclaw/jiuwenclaw/agentserver/tool_manager.py:361` 函数名 `register_request_scoped_cat_cafe_mcp`，`interface.py:729` 解析 `request.params.get("cat_cafe_mcp")` — **后端没改前端不能改**，否则 MCP 注册功能直接坏 |

修复路径：与 jiuwenclaw 后端协调（需要 jiuwenclaw 那边先支持 `office_claw_mcp` 或加双字段兼容），前端再改。Plan Task 14 的 footnote 已标记此项为铲屎官 post-merge work。**当前前后端用同名旧字段，工作正常，不是 broken runtime**。

#### Tier C — 配对一致的命名 SOP（延后改，需双方同改）

| # | 文件 | 现状 | 修复要求 |
|---|---|---|---|
| C1 | `packages/api/src/domains/preview/bridge-script.ts` (L14/L41/L59/L68/L84/L91/L99) + `packages/api/src/domains/ppt/ppt-studio-service.ts` (L110) | dispatcher 用 `cat-cafe-bridge` / `data-cat-cafe-bridge` / `cat-cafe-preview`，listener 检测 `data-cat-cafe-bridge="true"` — 配对一致，runtime 工作正常 | 改的话**dispatcher + listener 必须同时改**，否则 preview iframe 通信会断。可以延后到下一次 cleanup |

#### Tier D — 用户态影响（P1 - 加 fallback）

| # | 文件 | 行 | 改动 |
|---|---|---|---|
| D1 | `packages/web/src/stores/ppt-preview-store-helpers.ts` | 35 | `'catcafe.pptStudioPreviewByThread'` → `'office-claw.pptStudioPreviewByThread'` + 加 fallback 读旧 key |
| D2 | `packages/web/src/components/ppt-studio/ppt-preview-chat-integration.tsx` | 25 / 26 | `'cat-cafe:pptStudioPanelWidthV2'` → `'office-claw:pptStudioPanelWidthV2'`，legacy key (L26) 保留作 fallback |

修复风险：localStorage key 改名会丢用户已有 PPT Studio 状态——必须按 Plan Task 8 加 fallback 读旧 key 才能切换。

#### Tier E — 代码质量（P2 - runtime 不影响）

| # | 影响范围 | 现状 |
|---|---|---|
| E1 | `chat-types.ts:174` `catId?: string` 字段定义 | Redis/config persistent layer 由 `compat/agentid-field-migration.ts` 自动处理 `catId → agentId` 迁移（FIELD_MAP），前端字段名只是代码可读性问题 |
| E2 | `agents-panel/` + `create-agent-modal/` 内的 `catId` 参数名 / `handleSelectCat` 函数名 / `generateRandomCatId` | 同上，代码质量问题，runtime 不影响 |
| E3 | `scheduler-placeholder.ts` `catId?: string \| null;` + `msg.catId === 'system'` | 同上 |
| E4 | `mcp-server/src/tools/callback-tools.ts:703` 描述文本 `'or catId.'` | 用户可见但只是工具描述文案 |

修复时机：纯命名问题，可以在 Tier A 修完后批量做（IDE refactor 工具最安全）。

### 修复路径建议

```
Tier A (4 处 — runtime 已坏) → 立即修，每处独立 commit
                                  ↓
Tier D (2 文件 — 用户态) → 修 + 加 localStorage fallback
                                  ↓
Tier E (10 文件 — 代码质量) → IDE batch refactor，分文件 commit
                                  ↓
Tier B (cat_cafe_mcp) → 等 jiuwenclaw vendor 后端支持新字段后再改
Tier C (bridge-script) → 双方同改，可与 Tier B 一起做
```

P1 auth 由 platform-cookie-restoration plan 独立推进，不在本 audit 修复范围。

### 验证证据

```bash
# /api/cats/ vs /api/agents/ 后端路由
grep -n "app.\(get\|post\|put\|delete\)" packages/api/src/routes/agents.ts | head
# → 全部是 /api/agents/...

# cat_cafe_mcp jiuwenclaw vendor 后端依赖
grep -rn "cat_cafe_mcp" vendor/jiuwenclaw/
# → tool_manager.py:361, interface.py:729/730/732/734/865/866/868/870

# 事件 dispatcher / listener 配对
grep -rn "'office-claw:threads-refresh'\|'cat-cafe:threads-refresh'" packages/web/src/
# → 4 dispatcher = office-claw, 1 listener = office-claw, ScheduledTasksPanel = cat-cafe（漏改）
grep -rn "addEventListener.*chat-layout\|CHAT_LAYOUT_CHANGED_EVENT" packages/web/src/
# → ScrollToBottomButton listener = 'officeclaw:chat-layout-changed'（无连字符）
```

[宪宪/Opus-47🐾]
