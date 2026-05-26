---
title: F140 Merge Main Round2
created: 2026-05-08
authors: [opus47/宪宪🐾, gpt55/砚砚（reviewer）]
status: ready-for-implementation
related:
  - docs/plans/2026-05-06-f140-merge-main.md
  - docs/plans/2026-05-07-platform-cookie-restoration.md
  - docs/features/F140-de-cat-branding.md
---

# F140 Merge Main Round2

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `origin/main` (77 commits since merge base `034c34a1`) 合并到 `feat/decat-and-decouple-merge-main`，保留分支已有的 F140 de-cat 重命名 + decoupling provider 架构 + cookie auth 修复，吸收 main 的结构性重构（chat-input/ 拆包、thread-sidebar/ 小写）和功能新增（taskRuns、PPT 预览、Windows installer 修复等）。

**核心原则**：
- **de-cat / OfficeClaw / provider 解耦相关路径和命名走分支**
- **main 自身的结构性重构（chat-input/ 拆包、thread-sidebar/ 小写、document preview、task grouped stream）吸收 main 的结构和逻辑，再套 OfficeClaw/Agent 命名**
- **逻辑走 main**（路由、消息存储、状态机等业务逻辑）

## 1. 三元组冻结

| 角色 | Commit | 描述 |
|---|---|---|
| **base** | `034c34a1` | merge base（main 上 `!692 merge main into main` by kagol, 2026-05-06） |
| **ours** | `755a7deb` | feature 分支当前 HEAD（实际 merge 时以执行时刻 HEAD 为准） |
| **theirs** | `1348b200` | `origin/main` tip（`!726 merge lk-backflow into main`） |

**分歧**：feature 分支 ahead 40 / behind 77 main commits

## 2. Pre-flight（已完成）

- [x] worktree 已建在 `/Users/tianyiliang/projects/office-claw-decat-merge-main-round2`
- [x] 分支 `feat/decat-merge-main-round2` 从 `755a7deb` 拉出
- [x] 主仓库脏状态记录：`office-claw-config.json M` + `.cat-cafe/` `.kimi/` `BACKLOG.md` `KIMI.md` 未跟踪 → 回合时需先 stash 或 commit

## 3. 冲突预知（来自 trial merge）

| 类别 | 数量 | 备注 |
|---|---|---|
| **Content conflicts** | 22 | 大部分集中在 `domains/agents/` + 前端组件 |
| **Rename/rename** | 4 | `ThreadSidebar/` 目录两边都重命名（HEAD: AgentSelector，main: thread-sidebar/CatSelector） |
| **Modify/delete** | 6 | 4 个 main 拆包删旧路径 + 2 个分支 de-cat 删 main 仍改 |

## 4. Pre-merge 关键资产清单（不能被回归）

| 资产 | 文件路径 | 来源 |
|---|---|---|
| **provider 解耦合约** | `packages/plugin-api/src/auth.ts` | F140 引入 |
| **huawei-iam / huawei-cas / no-auth providers** | `packages/green-package/src/auth/` | F140 + 5/7 plan |
| **cookie 4 处注入** | `routes/auth.ts`（islogin / login / login/callback / logout） | 5/7 plan |
| **cross-origin 直连恢复** | `packages/web/src/utils/api-client.ts`（resolveRequestCredentials） | 5/7 plan D1-R |
| **AppAuthBootstrap mode 分流** | `packages/web/src/components/AppAuthBootstrap.tsx` | 5/7 plan |
| **invitation 路由保留** | `packages/web/src/app/login/invitation/page.tsx` | 5/7 plan D3 |
| **MCP 协议字段重命名** | `office_claw_mcp`（替换 `cat_cafe_mcp`） | F140 |
| **agentId 重命名** | `agentId / targetAgents / AgentId` | F140 全栈 |

## 5. Tasks

### Task 1: 启动 merge + 落盘冲突清单

```bash
cd /Users/tianyiliang/projects/office-claw-decat-merge-main-round2
git fetch origin main
git merge origin/main
# 预期：~32 个冲突，merge 中断在冲突状态
```

冲突清单冻结到日志：
```bash
git diff --name-only --diff-filter=U > /tmp/round2-conflicts.txt
```

### Task 2: Group A — modify/delete 6 个

按"路径走 de-cat，主体跟随 main 的拆包结构"原则：

| # | 文件 | HEAD 状态 | main 状态 | 决策 | 操作 |
|---|---|---|---|---|---|
| 1 | `packages/web/src/components/ChatInput.tsx` | modified | deleted | **跟随 main 删除** | `git rm`；分支侧必要变更迁到 `chat-input/` 拆包后的对应文件 |
| 2 | `packages/web/src/components/ThreadSidebar/ThreadItem.tsx` | modified | deleted | **跟随 main 删除** | `git rm`；变更迁到 `thread-sidebar/ThreadItem.tsx`（main 已有） |
| 3 | `packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx` | modified | deleted | **跟随 main 删除** | `git rm`；变更迁到 `thread-sidebar/ThreadSidebar.tsx`（main 已有） |
| 4 | `packages/web/src/components/ThreadSidebar/__tests__/thread-item-message-avatar.test.tsx` | modified | deleted | **跟随 main 删除** | `git rm`；测试迁到 `thread-sidebar/__tests__/`（main 已有） |
| 5 | `packages/web/src/components/VoteConfigModal.tsx` | deleted | modified | **跟随分支删除** | `git rm`；main 的修改丢弃（分支 de-cat 决策已删 vote 功能，post-merge `rg` 验证无活引用） |
| 6 | `packages/web/src/components/mission-control/MissionControlPage.tsx` | deleted | modified | **跟随分支删除** | `git rm`；main 的修改丢弃（分支 de-cat 已删 mission-control，验证无活引用） |

### Task 3: Group B — rename/rename 4 个

main 把 `ThreadSidebar/` rename 到 `thread-sidebar/`（kebab-case 化），分支把同样文件 rename 到 `thread-sidebar/AgentSelector` 等（de-cat）。

**最终路径决策**：
- **目录采用 main 的 `thread-sidebar/`（小写 kebab）**
- **文件名采用分支的 de-cat（AgentSelector 而不是 CatSelector）**

| # | main 目标 | HEAD 目标 | 最终采用 |
|---|---|---|---|
| 1 | `thread-sidebar/CatSelector.tsx` | `thread-sidebar/AgentSelector.tsx` | `thread-sidebar/AgentSelector.tsx`（删 main 的 CatSelector） |
| 2 | `thread-sidebar/ThreadCatSettings.tsx` | `thread-sidebar/ThreadAgentSettings.tsx` | `thread-sidebar/ThreadAgentSettings.tsx`（删 main 的 ThreadCatSettings） |
| 3 | `thread-sidebar/__tests__/cat-selector-breed-title.test.ts` | `thread-sidebar/__tests__/agent-selector-breed-title.test.ts` | `agent-selector-breed-title.test.ts` |
| 4 | `thread-sidebar/__tests__/thread-cat-settings.test.ts` | `thread-sidebar/__tests__/thread-agent-settings.test.ts` | `thread-sidebar/__tests__/thread-agent-settings.test.ts` |

操作：保留分支侧 (HEAD) 的版本，`git rm` 掉 main 侧的 CatSelector / ThreadCatSettings 等。

### Task 4: Group C — content conflicts 22 个

按子组分批处理。**逐文件原则**：
1. 路径/命名/de-cat → 走分支
2. 业务逻辑 / 新功能（taskRuns、PPT、新事件等）→ 吸收 main
3. 套 OfficeClaw/Agent 命名

#### C1: `domains/agents/.../routing/` (2 files)
- `route-parallel.ts`、`route-serial.ts`
- 吸收 main 的 routing 改进，保留分支的 `targetAgents` / `agentId`

#### C2: `domains/agents/.../providers/` (2 files)
- `RelayClawAgentService.ts`、`relayclaw-event-transform.ts`
- 吸收 main 的事件流改进，保留 `office_claw_mcp` 字段名

#### C3: `domains/agents/.../stores/` (4 files)
- `ports/DraftStore.ts`、`ports/MessageStore.ts`、`redis/RedisDraftStore.ts`、`redis/redis-message-parsers.ts`
- 吸收 main 的 `taskRuns` 字段；保留分支的 `targetAgents`

#### C4: `domains/agents/services/types.ts` (1 file)
- 吸收 main 的新类型，保留 `agentId` 改名

#### C5: `routes/messages.ts` (1 file)
- 吸收 main 的 `taskRuns` 序列化逻辑；保留 `targetAgents` 字段

#### C6: `shared/agent-error-transform.ts` (1 file)
- 吸收 main 的错误处理，保留分支命名

#### C7: web hooks (1 file)
- `useAgentMessages.ts`：吸收 main 的 hook 逻辑改进

#### C8: web components 大组 (8 files)
- `ChatMessage.tsx`、`HubMemberOverviewCard.tsx`、`MiniThreadSidebar.tsx`、`ModelsPanel.backup.tsx`、`chat-input/components/ChatInputMenus.tsx`、`ppt-studio/ppt-preview-chat-integration.tsx`、`scheduleTask/ScheduleTaskEditorModal.tsx`、`stores/chat-types.ts`
- 吸收 main 的 UI 改进 + PPT 预览修复 + ScheduleTask 修复
- 命名走分支（agentId、targetAgents、office-claw 字面量）

#### C9: scripts (1 file)
- `scripts/start-windows.ps1`：吸收 main 的 Windows 启动 / readiness / rollback 修复，保留 `OFFICE_CLAW_*` 环境变量名

#### C10: tests (1 file)
- `packages/api/test/relayclaw-agent-service.test.js`：吸收 main 的测试改动，保留 `office_claw_mcp` 字段

### Task 5: 6 套门禁

#### Gate 1: 无冲突标记
```bash
git diff --name-only --diff-filter=U
# 预期：空
rg '<<<<<<<|>>>>>>>' --type ts --type tsx --type js
# 预期：空
```

#### Gate 2: deleted-domain final-tree audit（旧功能域不复活）
```bash
# 这些路径在最终 tree 必须不存在
for path in \
  packages/api/src/domains/leaderboard \
  packages/api/src/domains/signals \
  packages/api/src/domains/cats \
  packages/api/src/routes/leaderboard.ts \
  packages/api/src/routes/leaderboard-events.ts \
  packages/api/src/routes/callback-bootcamp-routes.ts \
  packages/api/src/routes/signals.ts \
  packages/api/src/routes/signal-collection-routes.ts \
  packages/api/src/routes/signal-podcast-routes.ts \
  packages/api/src/routes/signal-study-routes.ts \
  packages/api/src/scripts/fetch-signals.ts \
  packages/api/src/scripts/migrate-signals \
  packages/web/src/components/VoteConfigModal.tsx \
  packages/web/src/components/mission-control \
  ; do
  if [ -e "$path" ]; then
    echo "FAIL: $path 复活了"
  fi
done
# 预期：全部不存在
```

#### Gate 3: de-cat grep gate（5 套）

```bash
# 3a: user-visible text
rg '猫猫|猫粮|铲屎官|布偶猫|缅因猫|暹罗猫|狸花猫|ᓚᘏᗢ|Cat Café' \
  packages/web/src/ \
  --glob '!__tests__/' --glob '!*.test.*' --glob '!showcase/'

# 3b: runtime brand identifiers
rg 'cat[-_]cafe|CatCafe|catcafe|domains/cats/' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  --glob '!__tests__/' --glob '!*.test.*' --glob '!node_modules/'
# Allowed allowlist:
#   - compat/agentid-field-migration.ts
#   - capability-orchestrator.ts DEPRECATED_SPLIT_SERVER_IDS
#   - governance-bootstrap.ts CAT-CAFE-GOVERNANCE

# 3c: domain id identifiers
rg '\bCatId\b|\bcatId\b|\bCatConfig\b|\btargetCats\b|/api/cats/|CatSelector|ThreadCatSettings|cat_cafe_mcp' \
  packages/api/src/ packages/web/src/ packages/mcp-server/src/ \
  --glob '!__tests__/' --glob '!*.test.*' --glob '!node_modules/'
# Allowed: compat/agentid-field-migration.ts only

# 3d: env vars
rg 'CAT_CAFE_' packages/api/src/config/env-registry.ts
# 预期：空

# 3e: skill refs
rg '猫猫|铲屎官|CAT_CAFE_' office-claw-skills/refs/
# 预期：空
```

#### Gate 4: provider/auth 回归门禁

```bash
# plugin-api 包仍存在
test -d packages/plugin-api/src/auth || echo "FAIL: plugin-api/auth missing"

# green-package providers 全保留
test -f packages/green-package/src/auth/huawei-cas.ts || echo "FAIL"
test -f packages/green-package/src/auth/index.ts || echo "FAIL"

# auth.ts 4 处 setCookie 仍在
grep -c 'setSignedSessionCookie\|setCookie' packages/api/src/routes/auth.ts
# 预期：>= 4

# api-client cross-origin 逻辑保留
grep -q 'resolveRequestCredentials' packages/web/src/utils/api-client.ts || echo "FAIL"

# AppAuthBootstrap mode 分流保留
grep -q "provider?.mode === 'redirect'" packages/web/src/components/AppAuthBootstrap.tsx || echo "FAIL"
```

#### Gate 5: build / lint / test
```bash
pnpm install   # merge 后 pnpm-lock 可能有差异，重新 install
pnpm check
pnpm build
pnpm test
```

#### Gate 6: 定向测试（部分覆盖到 Gate 5 的 pnpm test 中）

| 测试文件 | 关注点 |
|---|---|
| `auth-routes.test.js` | cookie 注入 4 处 |
| `huawei-cas.test.ts` | provider 实现 |
| `relayclaw-agent-service.test.js` | `office_claw_mcp` 字段 |
| `draft-messages-merge.test.js` | `taskRuns` 字段 |
| `useAgentMessages-*.test.ts` | hook 逻辑 |

### Task 7: Commit + 回合 + Push（merge worktree → feature 分支）

```bash
# 1. 在 worktree 里：commit merge
cd /Users/tianyiliang/projects/office-claw-decat-merge-main-round2
git add -A
# git merge 实际上自动产出 merge commit（解决冲突后 git commit）
# commit message:
git commit -m "merge: sync main (77 commits) into F140 de-cat branch round2

- Resolved 22 content + 4 rename/rename + 6 modify/delete conflicts
- Adopted main's chat-input/ + thread-sidebar/ structural refactor
- Preserved branch's de-cat naming (agentId / targetAgents / office-claw)
- Preserved branch's provider decoupling (plugin-api + green-package)
- Preserved branch's cookie auth fixes (4 setCookie injection points)
- Absorbed main's taskRuns + PPT preview + Windows installer fixes
- Gates 1-6 all PASS

[宪宪/Opus-47🐾]"

# 2. 回合到 feature 分支
cd /Users/tianyiliang/projects/relay-claw
git stash push -m "round2-merge-savepoint: office-claw-config + untracked"
git merge --ff-only feat/decat-merge-main-round2
git stash pop  # 恢复脏状态
# 注意：可能 stash pop 与 office-claw-config.json 冲突，手动 resolve

# 3. Push
git push origin feat/decat-and-decouple-merge-main

# 4. 清理 worktree
git worktree remove /Users/tianyiliang/projects/office-claw-decat-merge-main-round2
git branch -d feat/decat-merge-main-round2
```

### Task 6: E2E 验证（铲屎官手动）

| # | 场景 | 验证 |
|---|---|---|
| E1 | dev 模式 cookie 流（no-auth） | DevTools Network 看到 `/api/islogin` 200 + `Set-Cookie: oc_sid=...` |
| E2 | dev 模式后续请求 | `/api/threads` 等带 cookie，200 返回 |
| E3 | start:direct 模式 | 同 E1/E2，但走 production 分支（cross-port + credentials: 'include'） |
| E4 | huawei-cas 邀请码流 | 不再死循环进 invitation 页 |
| E5 | jiuwenclaw MCP 协议 | 字段是 `office_claw_mcp` |
| E6 | PPT 预览 | main 新功能可用 |
| E7 | Windows installer | 启动加速生效 |

## 6. 不修部分（明确声明）

- ❌ 不动 `packages/plugin-api/src/auth.ts` contract
- ❌ 不动 `packages/api/src/routes/global-auth.ts`（main 0 改动）
- ❌ 不动 `packages/api/src/auth/middleware.ts`（main 0 改动）
- ❌ 不动 main 上 leaderboard / signals / podcast / study 的"复活"——它们是 de-cat 设计目标删除项，main 这 77 commits 0 次 touch
- ❌ 不在本次 PR 内做 SSOT 抽象（D6-B 决策保留为下一 PR）
- ❌ 不动主仓库 `office-claw-config.json` 等脏状态（merge 完回合后再处理）

## 7. 风险与回滚

### 7.1 风险

1. **rename/rename 解析错误**：如果手动选错路径，可能出现 thread-sidebar 下既有 CatSelector 又有 AgentSelector → Gate 3c 会捕获
2. **rename detection 边缘**：`cat-models.ts` 等 50-76% 相似度文件，main 没改所以无影响（已验证）
3. **stash pop 冲突**：主仓库 `office-claw-config.json` 当前的修改可能与 merge 后的版本冲突 → 手动 resolve

### 7.2 回滚

merge 失败任意阶段都可回滚到 worktree 创建前状态：
```bash
# 在 worktree 里
git merge --abort
# 或
git reset --hard 755a7deb

# 主 worktree 不受影响
```

最后兜底：`git worktree remove` 销毁整个隔离环境，主 worktree 永远在 755a7deb 不动。

## 8. 接力交接

**当前球权**：实施中（@opus-47/宪宪 持球）

**下一棒**：
- 完成 Task 1-5 + Task 7 后 → @gpt55/砚砚 review final tree
- Review 通过 → @co-creator 启动 Task 6 E2E 验证
- E2E 通过 → @co-creator 决策 PR 时机

**预估工作量**：merge + 冲突解决 + 门禁 1 个工作日内完成。
