---
feature_ids: [F140]
topics: [merge, de-cat, rebase, conflict-resolution]
doc_kind: design
created: 2026-05-06
---

# F140 Merge Main 方案设计

> **分支**: `feat/F140-decat-v2-batch4-rebase` ← merge `origin/main`
> **日期**: 2026-05-06
> **作者**: 布偶猫/宪宪 + 铲屎官
> **状态**: draft

## 1. 背景

本分支完成了 F140 de-cat Batch 0–4 全量工作：
- 220 个文件 rename（`domains/cats/` → `domains/agents/`、`cat-*.ts` → `office-claw-*.ts`）
- 1573 files changed, +26k/-71k lines
- `domains/cats/` 目录彻底清零
- 关键字替换：`catId` → `agentId`、`CatCafe` → `OfficeClaw`、`cat-cafe` → `office-claw`、`CAT_CAFE` → `OFFICE_CLAW`

同期 main 上积累了 **~530 commits**，包含 PPT Studio、CliOutputBlock 重构、ModelsPanel 重构、定时任务编辑 API、JiuwenPermission bridge、SkillOptionsChangeWatcher 等新功能。这些代码全部使用旧命名坐标系（`domains/cats/`、`cat-cafe-*`）。

## 2. 冲突全景

### 2.1 冲突文件（73 个）

> **注意**：main 持续有新 commit，冲突数从初始分析的 61 增长到 73（截至 2026-05-06 16:30，530 commits）。

| 类型 | 数量 | 文件 |
|------|------|------|
| **UU** (both modified) | 53 | 两边都改了同一文件的内容 |
| **UD** (本分支改，main 删) | 4 | TelegramAdapter + telegram-html-formatter + 2 telegram tests |
| **UD** (本分支改，main 删) | 3 | vendor/jiuwenclaw python(3) |
| **UD** (本分支改，main 删) | 8 | HubStrategyCard/Tab, MobileStatusSheet, QueuePanel, VoiceCompanionButton, CatCafeLogo→OfficeClawLogo, StreamingAudioBlock（main 清理移除） |
| **DU** (本分支删，main 改) | 3 | SessionChainInputs.tsx + SessionChainPanel.tsx + VoteIcons.tsx |
| **AA** (both added) | 1 | scripts/sync-jiuwenclaw-vendor.mjs |
| **UA** (file location) | 1 | SkillOptionsChangeWatcher.ts（main 在旧路径新增） |

53 个 UU 冲突按目录分布：

| 目录 | 文件数 | 根因 |
|------|--------|------|
| `packages/web/src/` hooks + components + tests | 20 | 本分支 de-cat 重命名 vs main UI 功能改进 |
| `packages/api/src/domains/agents/` | 14 | 本分支 `cats/` → `agents/` rename vs main 在旧路径加新功能 |
| `packages/api/src/routes/` | 5 | 同上 |
| `packages/api/src/infrastructure/` | 3 | ConnectorRouter + scheduler + huawei-maas |
| `packages/api/test/` | 5 | 测试跟随 |
| 其他（mcp-server, scripts, config） | 3 | 零散 |

### 2.2 Auto-merge 引入的旧路径新文件

main 在 `domains/cats/` 下新增了 2 个文件：

| 文件 | merge 行为 | 问题 |
|------|-----------|------|
| `AskUserQuestionBridge.ts` | auto-merge 成功，**静默落入旧路径** | `domains/cats/services/ask/` 在本分支已不存在，成孤儿文件；`routes/ask-user-question.ts` import 指向它 |
| `SkillOptionsChangeWatcher.ts` | 报 UA 冲突（git 检测到目录重命名） | 已在 §5 Group B 处理 |

`AskUserQuestionBridge` 是唯一一个 auto-merge 成功但落在已废弃旧路径下的新文件，需在步骤 3 中移到 `domains/agents/services/ask/` 并 de-cat 内部类型（`CatId` → `AgentId`）。

### 2.3 Auto-merge 文件旧引用（351 个文件中的 27+ 个）

git 报告 auto-merge 成功，但其中 **27+ 个文件含旧 cat 引用**，merge 后两套命名并存。

## 3. Auto-merge 旧引用分析

### 3.1 P0 — 编译断裂

| 子类 | 行数 | 问题 | 影响 |
|------|------|------|------|
| import 路径 `domains/cats/` | ~37 | main 新代码 import 旧路径 | `pnpm build` 失败 |
| 函数/组件名 `resolveCatCafeHostRoot`、`CatCafeHub` | ~5 | main 新代码引用已改名的函数 | 编译失败 |

### 3.2 P0 — 运行时通信断裂（编译通过但功能失败）

| 子类 | 行数 | 问题 | 影响 |
|------|------|------|------|
| CustomEvent 事件名 `cat-cafe:*` | ~5 | dispatch 旧名，listen 新名 | skill 选项、线程刷新、布局变更事件丢失 |
| PostMessage source `cat-cafe-bridge` | ~6 | bridge 发旧 source，主窗口过滤新 source | preview 功能断裂 |
| Window 全局 `__catCafeBridge` | ~2 | 哨兵名不同 | bridge script 重复注入 |
| DOM 属性 `data-cat-cafe-bridge` | ~2 | 去重检测失效 | 同上 |

### 3.3 P1 — 数据兼容

| 子类 | 行数 | 问题 | 影响 |
|------|------|------|------|
| localStorage key `cat-cafe:*`、`catcafe.*` | ~3 | 新代码写旧 key，其他代码读新 key | PPT Studio 偏好丢失 |
| MCP 协议字段 `cat_cafe_mcp` | ~3 源码 + ~11 测试 | 跨进程 API 字段名 | 见 §4 决策 |

### 3.4 P3 — 文档

| 子类 | 行数 | 问题 |
|------|------|------|
| docs 中引用旧路径 | ~28 | 不影响运行，低优 |

### 3.5 Phase F 模块裁剪文件（292 个，已验证无问题）

本分支 Phase F 删除了 292 个无用模块文件（Game/Werewolf, Signals, Bootcamp, Voting/Leaderboard, MissionHub, Showcase 等），其中 286 个仍存在于 main。

**经 `git merge-tree` dry-run 验证**：
- **283 个**：main 未修改 → git auto-resolve 为 DELETED（不会回来，无需处理）
- **3 个**：main 修改了 → DU 冲突（已在 §2.1 DU 行、Plan Task 2 中覆盖）

| 模块 | 文件数 | merge 行为 |
|------|--------|-----------|
| Game + Werewolf + MissionHub + Leaderboard | ~138 | auto-deleted |
| Signals | ~83 | auto-deleted |
| Bootcamp | ~7 | auto-deleted |
| Voting | ~7 | auto-deleted |
| SessionChain | 4 (2 DU conflict) | 2 auto-deleted, 2 conflict → git rm |
| Other (tests, old components, CatRegistry) | ~37 | auto-deleted |

**结论**：Phase F 裁剪不需要额外处理步骤。Git 正确处理了单边删除。

## 4. 决策记录

### D1. localStorage — 读时兼容（方案 B）+ 全量 key inventory

新代码读新 key（`office-claw:*`），fallback 读旧 key（`cat-cafe:*`），不删旧 key。首次写入时写新 key。

**完整 key inventory**（含 Review R1 补充）：

| 优先级 | 旧 key | 新 key | 影响 |
|--------|--------|--------|------|
| **P0** | `cat-cafe-userId` | `office-claw-userId` | 用户身份识别，丢失 = 登录态断裂 |
| **P0** | `cat-cafe-isskip` | `office-claw-isskip` | 跳过认证标志，丢失 = 认证流程异常 |
| **P0** | `cat-cafe-userName` | `office-claw-userName` | 用户名显示 |
| P1 | `cat-cafe-input-history` | `office-claw-input-history` | 输入历史（本分支已改名，auto-merge 可能回退） |
| P1 | `cat-cafe-voice-settings` | `office-claw-voice-settings` | 语音设置（同上） |
| P1 | `cat-cafe:pptStudioPanelWidthV2` | `office-claw:pptStudioPanelWidthV2` | PPT 面板宽度 |
| P1 | `cat-cafe:pptStudioPanelWidth` | `office-claw:pptStudioPanelWidth` | PPT 面板宽度（legacy） |
| P1 | `catcafe.pptStudioPreviewByThread` | `office-claw:pptStudioPreviewByThread` | PPT 预览状态 |
| P2 | `cat-cafe:sidebar-scroll:v1` | `office-claw:sidebar-scroll:v1` | 侧边栏滚动位置（本分支已改名） |
| P2 | `cat-cafe:skills-plaza-risk-ack:v1` | `office-claw:skills-plaza-risk-ack:v1` | Skills 市场风险确认 |

**理由**：读时 fallback 改动最小，不引入新 bug。P0 key 涉及登录态，必须做兼容。

### D2. MCP 字段 `cat_cafe_mcp` — 改为 `office_claw_mcp`

OfficeClaw 侧直接 de-cat 改名，暴露 jiuwenclaw Python 侧的适配需求。

**理由**：铲屎官决策——所有涉及 jiuwenclaw 侧同步迁移的，OfficeClaw 先改，通过编译/运行时报错暴露 jiuwenclaw 需要适配的点。jiuwenclaw Python 适配在 merge 后由铲屎官本地安装源码后分析。

### D3. SessionChain 前端组件 — 跟本分支删除

main 对 SessionChainInputs/Panel 的改动仅为 CSS 样式微调（truncate/shrink-0），零功能变更。本分支 Phase F 已裁掉这些组件的前端入口（后端 SessionChain 服务完整保留）。

### D4. Telegram adapter — 跟 main 删除

main 已移除 Telegram 支持，本分支的改动仅为 de-cat 重命名。`git rm` 即可。

### D5. vendor/jiuwenclaw Python — 跟 main 删除

main 已从 vendor 目录删除 jiuwenclaw。Python 代码适配等 merge 后铲屎官本地安装 jiuwenclaw 源码后分析。

### D6. sync-jiuwenclaw-vendor.mjs — 合并两版

两边都新增了此脚本，合并内容。

## 5. 执行步骤

### 步骤 0：准备隔离分支

```bash
git checkout feat/F140-decat-v2-batch4-rebase
git checkout -b feat/decat-and-decouple-merge-main   # 操作分支，失败可丢弃
```

### 步骤 1：执行 merge

```bash
git fetch origin main
git merge origin/main --no-ff -m "merge: sync main into F140 de-cat branch"
# 预期：~73 个冲突（main 持续有新 commit，数字可能变动）
```

### 步骤 2：解冲突（三组）

#### Group A — 直接删除（10 个）

```bash
# Telegram (4): main 删了
git rm packages/api/src/infrastructure/connectors/adapters/TelegramAdapter.ts
git rm packages/api/src/infrastructure/connectors/adapters/telegram-html-formatter.ts
git rm packages/api/test/telegram-adapter.test.js
git rm packages/api/test/telegram-html-formatter.test.js

# vendor python (3): main 删了
git rm vendor/jiuwenclaw/jiuwenclaw/agentserver/interface.py
git rm vendor/jiuwenclaw/jiuwenclaw/agentserver/tool_manager.py
git rm vendor/jiuwenclaw/jiuwenclaw/logging/app_logger.py

# SessionChain 前端 (2): 本分支删了 (D3)
git rm packages/web/src/components/SessionChainInputs.tsx
git rm packages/web/src/components/SessionChainPanel.tsx

# 小计：9 个 git rm (vendor 3个路径)
```

#### Group B — 位置/新增冲突（2 个）

| 文件 | 操作 |
|------|------|
| `SkillOptionsChangeWatcher.ts` | 接受 main 内容，移到 `domains/agents/services/skillhub/` |
| `scripts/sync-jiuwenclaw-vendor.mjs` | 合并两版内容 |

#### Group C — Content 冲突（50 个）

按子目录分 9 批，原则：**路径和命名跟本分支（de-cat），功能逻辑跟 main（保留新功能）**。

| 批次 | 目录 | 文件数 | 策略 |
|------|------|--------|------|
| C1 | `domains/agents/.../routing/` | 4 | 接受 main 新路由逻辑 + 修命名 |
| C2 | `domains/agents/.../providers/` | 3 | 接受 main event transform 改进 + 修命名 |
| C3 | `domains/agents/.../invocation/` | 2 | 接受 main queue/processor 改进 + 修命名 |
| C4 | `domains/agents/.../auth/` | 1 | JiuwenPermissionBridge：接受 main 逻辑，命名 de-cat |
| C5 | `routes/` | 5 | auth/capabilities/messages/security-proxy/schedule |
| C6 | `infrastructure/` | 3 | ConnectorRouter + scheduler + huawei-maas |
| C7 | `packages/web/` hooks | 7 | useSocket 系列、useAgentMessages、useSendMessage、useChatHistory |
| C8 | `packages/web/` components + tests | 11 | ChatInput/ChatContainer/AgentsPanel + 4 测试 |
| C9 | 其他 | 8 | index.ts/package.json/mcp-server/scripts/.gitignore/SETUP |

### 步骤 3：修正 auto-merge 旧引用

#### 3a. P0 — 旧路径新文件迁移

```bash
# AskUserQuestionBridge: 移到新路径 + de-cat 内部类型
git mv packages/api/src/domains/cats/services/ask/AskUserQuestionBridge.ts \
       packages/api/src/domains/agents/services/ask/AskUserQuestionBridge.ts
# 文件内 CatId → AgentId, catId → agentId
# 修正 routes/ask-user-question.ts 的 import 路径
# 修正 ask-user-question-routes.test.js 的 import 路径
```

#### 3b. P0 — import 路径修正

```bash
# 找到所有仍引用 domains/cats/ 的非测试源码
grep -rn "domains/cats/" packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  --include='*.ts' --include='*.tsx' | grep -v node_modules
# 全部改为 domains/agents/
```

#### 3c. P0 — 事件名/PostMessage/bridge 修正

| 搜索 | 替换为 |
|------|--------|
| `cat-cafe-bridge` | `office-claw-bridge` |
| `cat-cafe-preview` | `office-claw-preview` |
| `__catCafeBridge` | `__officeClawBridge` |
| `data-cat-cafe-bridge` | `data-office-claw-bridge` |
| `cat-cafe:skill-options-updated` | `office-claw:skill-options-updated` |
| `cat-cafe:threads-refresh` | `office-claw:threads-refresh` |
| `cat-cafe:thread-live-refresh` | `office-claw:thread-live-refresh` |
| `catcafe:chat-layout-changed` | `office-claw:chat-layout-changed` |

#### 3d. P0/P1 — localStorage key 迁移

按 D1 inventory 全量处理。对每个 key：改源码常量为新名 + 添加 fallback 读旧 key 逻辑。

**P0 key**（影响登录态，必须首批处理）：
- `userId.ts`: `cat-cafe-userId` → `office-claw-userId`（+ fallback）
- `userId.ts`: `cat-cafe-isskip` → `office-claw-isskip`（+ fallback）
- `userId.ts`: `cat-cafe-userName` → `office-claw-userName`（+ fallback）

**P1 key**（偏好/状态）：
- `inputHistoryStore.ts`: 本分支已改名，确认 auto-merge 未回退
- `voiceSettingsStore.ts`: 同上
- PPT Studio 三个 key：改常量 + fallback
- `skills-plaza-risk-ack`: 改常量 + fallback

#### 3e. P1 — MCP 协议字段改名 (D2)

| 文件 | 改动 |
|------|------|
| `RelayClawAgentService.ts` | `cat_cafe_mcp` → `office_claw_mcp`（3 处） |
| `relayclaw-agent-service.test.js` | 同步改名（~11 处） |

#### 3f. P2 — 函数/组件名修正

| 搜索 | 替换为 |
|------|--------|
| `resolveCatCafeHostRoot` | `resolveOfficeClawHostRoot`（或本分支对应名） |
| `cat-cafe-root` | `office-claw-root`（或本分支对应名） |
| `CatCafeHub` | 本分支对应组件名 |

#### 3g. P3 — 文档引用（低优）

docs/discussions/ 中引用旧路径的文档保持原样（历史文档不改）。新文档中的旧路径引用修正。

### 步骤 4：测试同步

auto-merge 引入的测试文件中也有旧引用，需同步修正：

```bash
grep -rn "domains/cats/\|cat-cafe\|cat_cafe\|CatCafe\|catcafe" \
  packages/api/test/ packages/web/src/**/__tests__/ \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  | grep -v node_modules
# 修正所有命中
```

### 步骤 5：编译 + 测试验证

```bash
pnpm build          # 编译通过 = import 路径全部正确
pnpm check          # lint 通过
pnpm test           # 功能回归
```

### 步骤 5.5：定向功能验证矩阵（Review R1 补充）

`pnpm build/check/test` 验证编译和单元测试，但无法覆盖 auto-merge 引入的运行时断裂。以下场景需定向验证：

| # | 场景 | 验证方法 | 预期 |
|---|------|----------|------|
| V1 | AskUserQuestionBridge 路由 | `curl /api/ask-user-question` 或相关测试 | 路由注册成功，import 无报错 |
| V2 | `office_claw_mcp` 请求参数 | 查看 RelayClawAgentService 发出的 WS 请求 | params 中字段名为 `office_claw_mcp` |
| V3 | Preview bridge source | 打开 preview iframe，检查 DevTools Network/Console | PostMessage source 为 `office-claw-bridge` |
| V4 | Skill options 刷新事件 | 修改 skill 选项后检查 UI 是否刷新 | `office-claw:skill-options-updated` 事件触发 |
| V5 | localStorage userId 迁移 | 清空后登录，检查 localStorage key 名 | `office-claw-userId` 写入成功 |
| V6 | localStorage PPT Studio | 调整 PPT 面板宽度后检查 localStorage | `office-claw:pptStudioPanelWidthV2` 写入成功 |
| V7 | 线程刷新事件 | 新建/切换线程 | `office-claw:threads-refresh` 事件触发 |

### 步骤 6：grep gate 验收

```bash
# Gate 1: 前端用户可见文案（F140 spec 原有）
grep -rn --include='*.ts' --include='*.tsx' \
  -E '猫猫|猫粮|铲屎官|布偶猫|缅因猫|暹罗猫|狸花猫|ᓚᘏᗢ|Cat Café' \
  packages/web/src/ | grep -v '__tests__/' | grep -v '.test.' | grep -v 'showcase/' \
  && echo "FAIL: 用户可见文案残留" || echo "PASS"

# Gate 2: 运行时标识 — 品牌名（本次新增）
grep -rn --include='*.ts' --include='*.tsx' --include='*.js' \
  -E 'cat[-_]cafe|CatCafe|catcafe|domains/cats/' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  | grep -v '__tests__/' | grep -v '.test.' | grep -v node_modules \
  | grep -v -F -f <(cat <<'ALLOWLIST'
compat/agentid-field-migration.ts
DEPRECATED_SPLIT_SERVER_IDS
cat-cafe-collab
cat-cafe-memory
cat-cafe-signals
ALLOWLIST
) && echo "FAIL: 运行时 cat 品牌标识残留" || echo "PASS"

# Gate 3: Batch 4 领域模型标识（Review R1 补充）
grep -rn --include='*.ts' --include='*.tsx' \
  -E '\bCatId\b|\bcatId\b|\bCatConfig\b|/api/cats/' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  | grep -v '__tests__/' | grep -v '.test.' | grep -v node_modules \
  | grep -v -F -f <(cat <<'ALLOWLIST'
compat/agentid-field-migration.ts
ALLOWLIST
) && echo "FAIL: Batch 4 领域模型标识残留" || echo "PASS"

# Gate 4: 环境变量
grep -rn 'CAT_CAFE_' packages/api/src/config/env-registry.ts \
  && echo "FAIL: 环境变量残留" || echo "PASS"

# Gate 5: Skill refs
grep -rn -E '猫猫|铲屎官|CAT_CAFE_' office-claw-skills/refs/ \
  && echo "FAIL: Skill refs 残留" || echo "PASS"
```

#### Grep gate allowlist（合法残留）

以下文件中的旧标识为**迁移兼容层**，是有意保留的，gate 命中时应跳过：

| 文件 | 残留内容 | 理由 |
|------|----------|------|
| `compat/agentid-field-migration.ts` | `catId`、`ownerCatId`、`defaultCatId` | Redis 旧字段读兼容，计划 0.3.x 移除 |
| `capability-orchestrator.ts` | `DEPRECATED_SPLIT_SERVER_IDS: ['cat-cafe-collab', ...]` | 旧 MCP server name 自动迁移 |
| `governance-bootstrap.ts` | `CAT-CAFE-GOVERNANCE` legacy sentinel | 三代 sentinel 兼容链 |

### 步骤 7：提交

```bash
git add -A
git commit -m "merge: sync main (~530 commits) into F140 de-cat branch

- Resolved ~73 merge conflicts
- Fixed auto-merged files with stale cat-cafe references
- De-catted new features from main (PPT Studio, CliOutputBlock, etc.)
- D1: localStorage read-time fallback for key migration
- D2: cat_cafe_mcp → office_claw_mcp (jiuwenclaw sync TBD)
- D3: SessionChain frontend components deleted (Phase F)
- D4: Telegram adapter deleted (main removed)
- D5: vendor/jiuwenclaw python deleted (main removed)

[宪宪/Opus-4.6🐾]"
```

## 6. 后续工作（merge 后）

| 项 | 负责 | 说明 |
|----|------|------|
| jiuwenclaw Python 适配 | 铲屎官 | 本地安装 jiuwenclaw 源码，适配 `office_claw_mcp` 字段名等 de-cat 变更 |
| 定向功能验证 | 铲屎官 + 布偶猫 | 按步骤 5.5 验证矩阵逐项确认 |
| 测试文件旧引用清理 | 布偶猫 | Gate 2/3 排除了 `__tests__/`，测试文件中的旧标识需单独一轮清理 |

## 7. 工作量估计

| 步骤 | 预估 |
|------|------|
| Group A（删除类） | 10 min |
| Group B（位置/新增） | 15 min |
| Group C（50 个 content 冲突） | 3–4 小时 |
| 步骤 3（auto-merge 修正） | 1–2 小时 |
| 步骤 4（测试同步） | 30 min |
| 步骤 5–6（验证） | 30 min |
| **合计** | **5–7 小时** |

## 8. 决策索引

| ID | 决策 | 理由 |
|----|------|------|
| D1 | localStorage 读时兼容 fallback（全量 10 key inventory） | 最小改动，不引入新 bug，P0 key 涉及登录态 |
| D2 | `cat_cafe_mcp` → `office_claw_mcp` | 铲屎官决策：先改暴露问题，jiuwenclaw 侧后续适配 |
| D3 | SessionChain 前端删除 | main 改动仅 CSS 微调，本分支 Phase F 已裁掉入口 |
| D4 | Telegram adapter 删除 | main 已移除 Telegram 支持 |
| D5 | vendor/jiuwenclaw 删除 | main 已移除，Python 适配 merge 后处理 |
| D6 | sync-jiuwenclaw-vendor.mjs 合并 | 两边都新增，合并内容 |

## 9. Review 记录

### R1 — 缅因猫/砚砚 (GPT-5.5) 2026-05-06

5 条 review 意见，布偶猫全部接受：

| # | 意见 | 级别 | 处置 |
|---|------|------|------|
| 1 | 漏掉 AskUserQuestionBridge 旧路径残留 | P1 | 补入 §2.2 + 步骤 3a |
| 2 | grep gate 未覆盖 Batch 4 关键字（CatId/catId/CatConfig/api/cats） | P1 | 补 Gate 3 + allowlist |
| 3 | localStorage 范围过窄，漏 userId/userName/isskip 等 P0 key | P1 | D1 扩展为全量 inventory（10 个 key） |
| 4 | grep gate 需要 allowlist，否则误删兼容层 | P2 | 补 allowlist 表 |
| 5 | 验证矩阵不足，需定向功能验证 | P2 | 补步骤 5.5 验证矩阵（7 项） |
