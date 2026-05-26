# OfficeClaw — Claude Agent Guide

## Branding Migration Notice
This project was renamed from "Cat Café" (cat-cafe) to **OfficeClaw** (office-claw) in 2026-04.
Historical docs, feature files, and ADRs may still reference the old brand (cat-cafe, Cat Café, clowder, 猫咖, 智能体咖啡).
**Canonical names now**: OfficeClaw, office-claw, @office-claw/*. Do NOT introduce new cat-cafe references.
Active migration tracked in: `docs/features/F140-de-cat-branding.md`

## Identity
You are the Claude agent (Claude), the lead architect and core developer of this OfficeClaw instance.

## Safety Rules (Iron Laws)
1. **Data Storage Sanctuary** — Never delete/flush your Redis database, SQLite files, or any persistent storage. Use temporary instances for testing.
2. **Process Self-Preservation** — Never kill your parent process or modify your startup config in ways that prevent restart.
3. **Config Immutability** — Never modify `office-claw-config.json`, `.env`, or MCP config at runtime. Config changes require human action.
4. **Network Boundary** — Never access localhost ports that don't belong to your service.

## Common Commands

```bash
# Install & Build
pnpm install              # Install dependencies
pnpm build                # Build all packages (required before running)
pnpm dev                  # Run all packages in parallel dev mode

# Start
pnpm start                # Start via runtime worktree (Redis + API + Frontend)
pnpm start:direct         # Start directly in current checkout (bypass worktree)
pnpm start --memory       # No Redis, in-memory mode (data lost on restart)
pnpm start --quick        # Skip rebuild, use existing dist/

# Code Quality
pnpm check                # Biome lint + format + feature doc + env-port drift checks
pnpm check:fix            # Auto-fix lint issues
pnpm lint                 # TypeScript type check (per-package tsc --noEmit)

# Testing
pnpm test                         # Run all tests across packages
pnpm --filter @openjiuwen/relay-api-server run test:public    # API public test suite (excludes long-running)
pnpm --filter @openjiuwen/relay-api-server run test:redis     # Redis integration tests
pnpm --filter @openjiuwen/relay-api-server run test <file>    # Run specific API test file

# Package-specific
pnpm --filter @openjiuwen/relay-web run dev    # Frontend dev server only
pnpm --filter @openjiuwen/relay-api-server run dev    # API dev server only
```

## Architecture Overview

**Monorepo (pnpm workspaces):**

| Package | Description |
|---------|-------------|
| `packages/api` | Fastify backend (port 3004) — domains, routes, services, integrations |
| `packages/web` | Next.js frontend (port 3003) — React UI with Zustand state |
| `packages/shared` | Shared types, schemas, utils, registry |
| `packages/mcp-server` | MCP servers for agent collaboration (collab, memory, signals) |

**Key directories in `packages/api/src`:**
- `domains/` — Core domain logic (cats, memory, signals, workspace, terminal, etc.)
- `routes/` — Fastify route handlers
- `services/` — Infrastructure and external service adapters
- `integrations/` — Third-party connectors (Feishu, DingTalk, etc.)

**Skills System (`office-claw-skills/`):**
- Dynamic skill loading via `manifest.yaml`
- Skills are triggered by keywords (see manifest for triggers/not_for rules)
- `refs/` contains reference docs (not skills themselves)

**MCP Servers (`packages/mcp-server/dist/`):**
- `collab.js` — Cross-agent collaboration
- `memory.js` — Evidence store / long-term memory
- `signals.js` — Signal management

**Runtime Worktree Architecture:**
`pnpm start` creates an isolated `../cat-cafe-runtime` worktree tracking `origin/main`, keeping your dev checkout clean. Use `pnpm start:direct` to bypass this and run directly.

## Ports

| Service | Port | Required |
|---------|------|----------|
| Frontend (Next.js) | 3003 | Yes |
| API Backend | 3004 | Yes |
| Redis | 6399 | Yes (or use `--memory`) |

## Development Flow
See `office-claw-skills/` for the full skill-based workflow:
- `feat-lifecycle` — Feature lifecycle management
- `tdd` — Test-driven development
- `quality-gate` — Pre-review self-check
- `request-review` — Cross-cat review requests
- `merge-gate` — Merge approval process

## Code Standards
- File size: 200 lines warning / 350 hard limit
- No `any` types
- Biome: `pnpm check` / `pnpm check:fix`
- Types: `pnpm lint`
- Biome config: single quotes, trailing commas, indent 2 spaces, line width 120

## Windows 快速出包验证（不出 exe）

用于改完代码后快速验证安装包完整性，不需要跑完整 NSIS/exe 流程。

### 前置：杀掉旧进程

```bash
taskkill //F //IM redis-server.exe 2>/dev/null
taskkill //F //IM OfficeClaw.exe 2>/dev/null
# 杀 OfficeClaw 相关 node 进程（注意不要杀当前 claude session）
for pid in $(tasklist | grep node.exe | awk '{print $2}'); do
  wmic process where "ProcessId=$pid" get CommandLine 2>/dev/null | grep -qi "OfficeClaw" && taskkill //F //PID $pid
done
```

### 1. 清理环境（全新安装验证时）

```bash
# 全局 profiles
rm -f ~/.office-claw/provider-profiles* ~/.office-claw/acp-model-profiles* ~/.office-claw/known-project-roots.json ~/.office-claw/migrated-project-roots.json
# 安装目录 profiles + catalog
INSTALL_DIR="/c/Users/Administrator/AppData/Local/Programs/OfficeClaw"
rm -f "$INSTALL_DIR/.office-claw/provider-profiles"* "$INSTALL_DIR/.office-claw/acp-model-profiles"* "$INSTALL_DIR/.office-claw/office-claw-catalog.json"
```

### 2. Build + Bundle

```bash
cd D:/02.code/office-claw
pnpm build
node scripts/build-windows-installer.mjs --bundle-only
# 产物在 dist/windows/bundle/
```

#### 分阶段构建（加速迭代）

首次需完整构建，之后可按需只跑某个阶段：

```bash
# 完整构建（首次）
node scripts/build-windows-installer.mjs --bundle-only

# 只改了 JS/TS 代码，Python 没变 → 跳过 pip install（省 5-10 分钟）
node scripts/build-windows-installer.mjs --bundle-only --skip-build --skip-python

# 只改了 C# launcher → 只重编 launcher 到已有 bundle
node scripts/build-windows-installer.mjs --launcher-only

# bundle 已就绪 → 只打 NSIS exe
node scripts/build-windows-installer.mjs --nsis-only

# 完整出 exe（bundle + nsis）
node scripts/build-windows-installer.mjs
```

| 参数 | 作用 | 耗时 |
|------|------|------|
| `--bundle-only` | 构建 bundle 但不打 NSIS exe | ~10 min |
| `--skip-build` | 跳过 `pnpm build`，复用已有 dist/.next | 省 ~2 min |
| `--skip-python` | 跳过 Python embed 下载 + pip install，复用已有 tools/python | 省 ~5 min |
| `--launcher-only` | 只重编 C# 桌面启动器到已有 bundle | ~30 sec |
| `--nsis-only` | 只将已有 bundle 打包成 exe | ~1 min |

### 3. 部署到安装目录（替代 exe 安装）

```bash
INSTALL_DIR="/c/Users/Administrator/AppData/Local/Programs/OfficeClaw"
BUNDLE_DIR="D:/02.code/office-claw/dist/windows/bundle"

# 同步 managed paths
for item in packages scripts office-claw-skills tools installer-seed vendor \
  .office-claw-release.json .env.example LICENSE office-claw-template.json modelarts-preset.json pnpm-workspace.yaml; do
  [ -e "$BUNDLE_DIR/$item" ] && rm -rf "$INSTALL_DIR/$item" && cp -a "$BUNDLE_DIR/$item" "$INSTALL_DIR/$item"
done

# 同步 launcher + DLLs
for f in OfficeClaw.exe OfficeClaw.exe.config Microsoft.Web.WebView2.Core.dll \
  Microsoft.Web.WebView2.WinForms.dll WebView2Loader.dll; do
  [ -e "$BUNDLE_DIR/$f" ] && cp -f "$BUNDLE_DIR/$f" "$INSTALL_DIR/$f"
done
[ -d "$BUNDLE_DIR/assets" ] && rm -rf "$INSTALL_DIR/assets" && cp -a "$BUNDLE_DIR/assets" "$INSTALL_DIR/assets"
```

### 4. 跑 installer 生成配置

```bash
INSTALL_DIR="C:/Users/Administrator/AppData/Local/Programs/OfficeClaw"
node "$INSTALL_DIR/scripts/install-auth-config.mjs" modelarts-preset apply \
  --project-dir "$INSTALL_DIR" \
  --api-key "<your-api-key>"
```

### 5. 验证配置

```bash
node -e "
const fs = require('fs');
const dir = '$INSTALL_DIR/.office-claw';
const pp = JSON.parse(fs.readFileSync(dir+'/provider-profiles.json','utf8'));
pp.providers.filter(p=>!p.builtin).forEach(p => console.log(p.id, p.kind, p.command||''));
const cat = JSON.parse(fs.readFileSync(dir+'/office-claw-catalog.json','utf8'));
cat.breeds.forEach(b => { const v=b.variants[0]; console.log(b.catId, v.provider, v.accountRef); });
"
```

期望输出：
- `modelarts-shared api_key`
- `relay-teams acp <INSTALL_DIR>\tools\python\Scripts\relay-teams.exe`
- catalog 里 office/dare、assistant/relayclaw、agentteams/acp 三条

### 6. 启动服务 & 端到端验证

调试时跳过华为云登录：在 `.env` 中加 `OFFICE_CLAW_SKIP_AUTH=1`，`/api/islogin` 会直接返回已登录。

```bash
# 启动（或通过 OfficeClaw.exe）
cd "$INSTALL_DIR" && node scripts/start-entry.mjs start
```

浏览器打开后分别发送：
- `@office 请只回复 OK` — 验证 dare agent
- `@assistant 请只回复 OK` — 验证 relayclaw agent
- `@agentteams 请只回复 ACP OK` — 验证 ACP relay-teams

### 关键文件打包清单

`build-windows-installer.mjs` 的 `copyTopLevelProject()` 和 `WINDOWS_MANAGED_TOP_LEVEL_PATHS` 控制哪些文件进包。如果新增了运行时需要的顶层文件，必须同时加到这两处：
- `WINDOWS_MANAGED_TOP_LEVEL_PATHS` — 升级时覆盖
- `copyTopLevelProject()` 的 entries 数组或 cpSync 调用 — 打包时复制
