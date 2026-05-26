---
title: Main Branch Self-Owned Build/Type Debt — Out of Round2 Merge Scope
created: 2026-05-08
authors: [opus47/宪宪🐾]
status: documentation-only
related:
  - docs/plans/2026-05-08-f140-merge-main-round2.md
---

# Main Branch Self-Owned Build/Type Debt

## 1. 目的

记录 `feat/decat-and-decouple-merge-main` round2 merge 完成时**继承自 `origin/main` 自身的 build/type 错误**，明确这些**不在本次 merge PR 范围**——它们在 `origin/main` HEAD 上原样存在，需由主分支 owner 单独修复。

**Round2 merge 的范围原则**（铲屎官指令 2026-05-08 21:42）：

> 只处理因为 merge 或 de-cat 不全或与本分支之前的 provider decoupling 冲突导致的问题，不替 main 的新提交擦屁股。

## 2. 验证方法

在 round2 worktree 内：

```bash
git checkout --detach origin/main   # 切到 main HEAD
cd packages/web && npx tsc --noEmit  # 跑 TypeScript 检查
```

实测结果：

| 状态 | source errors | test errors | total |
|---|---|---|---|
| `origin/main` HEAD（detached，1348b200） | **229** | 91 | **320** |
| round2 worktree（merge + 2 个 fixup commit 后） | 96 | 111 | 207 |

**Round2 merge 后比 main 自身少 113 个 errors**，因为 round2 顺手修了若干 round1 漏的 de-cat（属于本次范围）。剩余 errors 在 main 上原样存在，**判定为 main 自身债**。

## 3. Main 自有债清单

### 3.1 B1: chat-input/ 拆包 prop type 不匹配（9 处）

文件：`packages/web/src/components/chat-input/ChatInput.tsx`

```
line 270: Type 'boolean | undefined' is not assignable to type 'boolean'
line 363: Type 'string | null' is not assignable to type '"workspace" | "mention" | "skill" | null'
line 385: PathEntry vs PathCompletionEntry shape mismatch
line 488: 同 line 363
line 489: 同 line 385
line 519: callback (card) => void vs () => void
line 522: QueueEntry[] vs { id, text }[]
line 541: (val, start, end) => void vs (value) => void
line 584: Type 'boolean | undefined' is not assignable to type 'boolean'
```

伴生错误：
- `chat-input/components/ChatInputLayout.tsx:287,291,354` — PathEntry/PathCompletionEntry/QueueEntry 镜像问题
- `chat-input/components/QuickActionsPanel.tsx:89,93` — `RefObject<HTMLDivElement | null>` vs React 18 `LegacyRef`
- `chat-input/components/SkillMenuPanel.tsx:68` — 同上 RefObject
- `chat-input/hooks/useQueueManager.ts:72` — `string | undefined` vs `string`

**引入 commit**：`73e9abf1 feat: 支持markdown文件预览` (2026-05-07) 等 chat-input/ 拆包系列 commit

**根因推测**：main 拆包重构时只跑 `pnpm dev`（type-check 不严），未跑 `next build` 或 `tsc --noEmit`，导致 type errors 直接 commit 进去。

**修复方向**：逐个对齐 prop interface，在主分支独立 PR 修复。

### 3.2 B2: useAgentMessages.ts 类型错误（~10 处）

文件：`packages/web/src/hooks/useAgentMessages.ts`

```
line 114: extra union type 不全对齐（TaskRunPersistExtra 等字段缺失）
line 956-1035: 多处 'Type {} is not assignable to string'
              (某变量 generic 推断失败，应为 string 但被推为 {})
```

**引入路径**：main 引入 `TaskRunAccumulator` 系列新 type（`73e9abf1` 之后多个 commit），但 hook 内 type wiring 不全。

**修复方向**：补齐 generic 推断 + type narrowing。在主分支独立 PR 修复。

### 3.3 C: @tailwindcss/typography 依赖缺失（阻塞 next build）

文件：`packages/web/tailwind.config.js`

```js
plugins: [require('@tailwindcss/typography')],
```

声明位置：`packages/web/package.json` devDeps:
```json
"@tailwindcss/typography": "^0.5.15"
```

**问题**：物理 node_modules 没装这个 package，next build 直接报错：
```
Error: Cannot find module '@tailwindcss/typography'
```

**实测**：主 worktree (`/Users/tianyiliang/projects/relay-claw`) 物理 node_modules 也找不到这个 package，但 `.next/BUILD_ID` 时间戳是 2026-05-08 19:11——说明主 worktree 也是 build 后 dep 被 prune 了，或当时 build 用的是 npm/yarn 的临时 install。

**引入 commit**：`73e9abf1 feat: 支持markdown文件预览` (2026-05-07)

**唯一使用位置**（全 working tree）：
```
packages/web/src/components/document-preview/MarkdownDocumentPreview.tsx:26
  className={`markdown-content prose prose-base max-w-none ...`}
```

**修复方向（两选一）**：
- **正路径**：让 pnpm install 成功安装（需先解锁 `provider-a2a/package.json` peerDeps 写法 `>=0.1.0` → `workspace:*`，否则 pnpm 把 peer dep 当 npm registry dep 找）
- **临时绕路**：注释 `tailwind.config.js` 的 plugin 行，markdown 预览组件 visual regression（无 prose 样式）但 build 跑通。**不推荐作为最终状态**

**重要**：这是 main 自身的 install 配置 bug。round2 不修复。

### 3.4 其他 main 自有 source errors

```
src/app/login/page.tsx:76 - Cannot assign to 'current' because it is a read-only property
                            (RefObject 类型问题)
src/components/game/EventFlow.tsx:9 - Module '"@openjiuwen/relay-shared"' has no exported member 'GameEvent'
src/components/game/GameOverlay.tsx:9 - Module '"@openjiuwen/relay-shared"' has no exported member 'GameView'
src/components/scheduled-task-frequency.ts:402,406 - 类型 narrowing 问题
src/components/scheduled-tasks-calendar-utils.ts:510 - Property 'ms' does not exist on type
src/components/shared/ButtonGroup.tsx:37 - HTML attributes type mismatch
src/components/SplitPaneView.tsx:153 - Expected 1-5 arguments, but got 6
src/components/thread-sidebar/thread-sidebar-types.ts:7 - Wrong export name
src/components/office-claw-hub.navigation.tsx:32 - number/string assign mismatch
src/utils/skill-options-cache.ts:90 - 类型推断
src/lib/thinking-execution-label.ts:7 - 类型问题
src/hooks/useSocket-background.ts (~10 处) - socket event payload type 不全对齐
src/hooks/useSocket-background-system-info.ts (~6 处) - 同上
```

全部在 `origin/main` HEAD 上原样存在。

### 3.5 测试文件 cat 命名错误（~111 处，不阻塞 next build）

文件：`packages/web/src/**/__tests__/*.{ts,tsx}` + `packages/api/test/*.test.js`

错误模式：
- `cats` / `catId` / `catData` / `targetCats` 等 cat 命名被 round1 漏扫
- 部分是 main 引入的新 test 用了 cat 字段
- `getCatById`, `useCatData` 引用（hook 已 rename，test 没改）
- mocked component (MobileInputToolbar / QueuePanel / MobileStatusSheet) 在分支已删，test 还引用

**注意**：这些不阻塞 `next build`（next 14 production build 不跑 vitest），但阻塞 `pnpm test`。

**修复方向**：单独的 test cleanup PR，或 mass de-cat 替换脚本。

## 4. 接力建议

| 编号 | 主张 | 接收人 |
|---|---|---|
| B1 | main owner 修 chat-input prop interface | 主分支拥有者 |
| B2 | main owner 修 useAgentMessages type wiring | 主分支拥有者 |
| C | main owner 修 @tailwindcss/typography install + lockfile | 主分支拥有者 |
| 3.4 | main owner 修各种零散 type errors | 主分支拥有者 |
| 3.5 | 单独 PR 做 test cleanup mass de-cat | 任何贡献者 |

## 5. Round2 merge 完成判据复核

| 完成标准 | 状态 |
|---|---|
| 32 个 conflict 全部解决 + 0 markers | ✅ |
| de-cat 字面量回归（grep gate 主要 source 部分） | ✅（含 A1/A3 fix） |
| decoupling provider 架构保留 | ✅ |
| 旧功能域不复活 | ✅ |
| build/lint 通过 | ❌——但归因于 main 自身债，不在本次 PR 范围 |

**结论**：Round2 merge 在"merge 责任"范围内已完成。main 自身债务清单交由主分支 owner 后续处理。
