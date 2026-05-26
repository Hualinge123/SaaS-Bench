# OfficeClaw 开源 npm 发布使用指导

> 架构设计见 `docs/open-source-npm-release-plan.md`，本文档只讲操作。

本文档覆盖以下 8 个开源白名单包的发布流程：

| 包名 | 路径 |
|---|---|
| `@openjiuwen/relay-shared` | `packages/shared` |
| `@openjiuwen/relay-api-server-contracts` | `packages/plugin/api` |
| `@openjiuwen/relay-web-contracts` | `packages/plugin/web` |
| `@openjiuwen/relay-core` | `packages/core` |
| `@openjiuwen/relay-storage-sqlite` | `packages/storage-sqlite/api` |
| `@openjiuwen/relay-mcp-server` | `packages/mcp-server` |
| `@openjiuwen/relay-api-server` | `packages/api` |
| `@openjiuwen/relay-web` | `packages/web` |

`@office-claw/green-package*`、示例 provider 等不在此列。

## 开发自验证

改完代码后、提交 PR 前，确认当前改动没有破坏开源包的构建和打包结构。

它会按顺序做三件事：按 lockfile 安装依赖 → 只构建 8 个白名单包 → 检查 tarball 元数据（包归类、禁止依赖、入口文件是否存在等）。整个过程不安装真实第三方依赖，速度可控。

```bash
pnpm verify:npm-open-source
```

---

## 正式发布

将 8 个开源白名单包发布到 npm 远端或生成本地 tarball 的完整流程。

### 1. 确认环境 [可选]

建议确认当前分支只包含本次要发布的内容。`release:npm-open-source` 不会因为工作区 dirty 自动阻断发布，所以发布前需要自己确认 `git status` 里没有不该进入包的源码改动。

```bash
git status --short --branch
```

### 2. 自验证 [必须]

确认当前代码能正常构建，且 8 个白名单包的 tarball 元数据完整（包归类正确、无禁止依赖、入口文件齐全）。这一步还没改版本号，验证的是代码本身。

```bash
pnpm verify:npm-open-source
```

### 3. 生成 changeset [可选]

选择本次要发布的包和版本策略。只选 8 个 `@openjiuwen/*` 白名单包。`patch` 修 bug，`minor` 加兼容 API，`major` 破契约。

发远端时必须要有 changeset；如果 PR 阶段已通过 CI 或 changeset bot 生成过，跳过此步。只发本地也可跳过。

```bash
pnpm changeset
```

### 4. 更新版本号 [可选]

`version-packages` 消费 changeset、更新 `package.json` 和 `CHANGELOG.md`。`install --lockfile-only` 更新 lockfile 以匹配新版本。

发远端时必须执行；只发本地可跳过。

```bash
pnpm version-packages && pnpm install --lockfile-only
```

### 5. 发布 [必须]

`release:npm-open-source` 会依次执行各包 `build`（包内会清理自己的 `dist/`）→ 一次性打包到 `dist/packs` → tarball 检查 → smoke → 推送。检查、smoke、本地 tarball 和远端发布都复用 `dist/packs` 里的同一批 `.tgz`。

远端发布成功后，`dist/packs` 会保留本次发布使用的 tarball 和 `open-source-npm-packs.json`。

推送远端前会解包 `dist/packs` 里的每个 tarball 并输出摘要，包括包名、版本、当前 gitHead、tarball 哈希、`package.json` 哈希，以及 `main` / `types` / `bin` / `exports` 指向的关键文件哈希。完整摘要保存到 `dist/packs/open-source-npm-publish-summary.txt`，命令结束前会打印精简索引。

**发到远端：**

发远端前需先登录 npm，且账号须已加入 `@openjiuwen` 组织并具备 publish 权限。`npm whoami` 确认当前登录账号；未登录则 `npm login`。CI 或非交互环境可直接配置 token：`npm config set //registry.npmjs.org/:_authToken <your-token>`。

```bash
pnpm release:npm-open-source
```

**发到本地（不推送 npm，tarball 留在 `dist/packs`）：**

```bash
pnpm release:npm-open-source:local
```

**可用参数：**

| 参数 | 作用 |
|---|---|
| `--skip-smoke` | 跳过慢速真实安装 smoke。smoke 会在临时空项目中真实安装 8 个包并 import 入口，验证消费方能正常使用。首次发布或改动较大时建议保留；纯文档/配置类改动可跳过 |
| `--local-only` | 只生成并验证 `dist/packs` 里的 tarball，不推送远端 |
| `SKIP_NPM_OPEN_SOURCE_SMOKE=1` | 等价于 `--skip-smoke`，环境变量方式 |

示例：

```bash
# 发远端，不跑 smoke
pnpm release:npm-open-source:no-smoke

# 发本地，不跑 smoke
pnpm release:npm-open-source:local:no-smoke
```

### 6. 发布后确认 [可选]

抽查远端版本号是否已更新。

```bash
npm view @openjiuwen/relay-api-server version
npm view @openjiuwen/relay-mcp-server version
npm view @openjiuwen/relay-storage-sqlite version
npm view @openjiuwen/relay-web version
```

在空项目中验证消费方能正常安装和 import：

```bash
mkdir officeclaw-npm-check && cd officeclaw-npm-check && pnpm init
pnpm add @openjiuwen/relay-api-server @openjiuwen/relay-storage-sqlite
node -e "import('@openjiuwen/relay-api-server/server').then(() => console.log('ok'))"
pnpm add @openjiuwen/relay-web react react-dom react-router-dom
node -e "Promise.all(['', '/components', '/config', '/constants', '/hooks', '/lib', '/pages', '/services', '/shared', '/stores', '/utils'].map((entry) => import('@openjiuwen/relay-web' + entry))).then(() => console.log('web ok'))"
```

---

## 故障排查

| 报错 | 处理 |
|---|---|
| `xxx is not classified as public or excluded` | 新包没归类。去 `scripts/open-source-npm-package-list.mjs` 加入 `PUBLIC_PACKAGES` 或 `EXCLUDED_PACKAGES` |
| `uses forbidden spec workspace:*` / `file:` / `link:` | tarball 里有本地依赖写法，检查对应包的 `package.json` |
| `must not depend on relay-storage-sqlite` | API server 直接依赖了 SQLite provider，从 `dependencies` 里删掉（provider 是用户按需装的） |
| smoke 很慢 | 正常，`better-sqlite3` 等需要编译。日常用 `verify:npm-open-source` 就行 |

---

## 命令速查

| 命令 | 名称 | 做什么 | 产物 |
|---|---|---|---|
| `pnpm build:npm-open-source` | 构建 | 按顺序运行 8 个白名单包的构建；`relay-web` 使用专用 `build:npm` | 各包 `dist/` |
| `pnpm check:npm-open-source` | 检查 | 包归类校验 → tarball 元数据检查（禁止依赖、入口文件等） | 检查报告 |
| `pnpm smoke:npm-open-source` | 烟雾测试 | 在空项目中真实安装 8 个包 + import 入口 | import 成功/失败 |
| `pnpm pack:npm-open-source` | 打包 | 清理旧包 → 生成 `.tgz` 和 manifest | `dist/packs/*.tgz`、`dist/packs/open-source-npm-packs.json` |
| `pnpm changeset` | 生成 changeset | 选择发布的包和版本策略，生成 changeset | `.changeset/*.md` |
| `pnpm version-packages` | 更新版本 | 消费 changeset，更新版本号和 CHANGELOG | 版本号、CHANGELOG、lockfile 更新 |
| `pnpm verify:npm-open-source` | 快速自检 | 安装 → 构建 → 检查（不含真实依赖） | 构建产物 + 检查报告 |
| `pnpm release:npm-open-source` | 全量发布 | 各包 build → 一次打包 → 检查同一批 tarball → 烟雾测试同一批 tarball → 推送同一批 tarball | 远端 npm 包已更新，`dist/packs` 保留发布包 |
| `pnpm release:npm-open-source:no-smoke` | 快速发布 | 各包 build → 一次打包 → 检查同一批 tarball → 推送同一批 tarball（跳过烟雾测试） | 远端 npm 包已更新，`dist/packs` 保留发布包 |
| `pnpm release:npm-open-source:local` | 本地全量验证 | 各包 build → 一次打包 → 检查同一批 tarball → 烟雾测试同一批 tarball（不推送） | `dist/packs/*.tgz`、`dist/packs/open-source-npm-packs.json` |
| `pnpm release:npm-open-source:local:no-smoke` | 本地快速验证 | 各包 build → 一次打包 → 检查同一批 tarball（不推送、不烟雾） | `dist/packs/*.tgz`、`dist/packs/open-source-npm-packs.json` |
