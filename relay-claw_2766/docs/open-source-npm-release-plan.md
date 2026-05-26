# OfficeClaw 开源版本 npm 打包发布实施方案

生成日期：2026-05-15

## 1. 目标

建立一条只发布开源基线 npm 包的发布链路。开源版本不包含华为内部实现包、不包含示例 provider。

本方案的目标是：

1. 明确哪些包进入开源 npm 发布白名单。
2. 明确包之间的依赖顺序和 provider 解耦边界。
3. 给出可执行的 build、pack、smoke、publish 流程。
4. 给出必须落地的自动化门禁，防止后续重新引入华为包或 workspace 硬依赖。

## 2. 发布边界

### 2.1 开源 npm 发布包

| 发布顺序 | 路径 | npm 包名 | 说明 |
|---:|---|---|---|
| 1 | `packages/shared` | `@openjiuwen/relay-shared` | 共享类型、schema、registry 和工具 |
| 2 | `packages/plugin/api` | `@openjiuwen/relay-api-server-contracts` | API 侧插件契约 |
| 3 | `packages/plugin/web` | `@openjiuwen/relay-web-contracts` | Web 侧插件契约 |
| 4 | `packages/core` | `@openjiuwen/relay-core` | headless runtime、provider plugin contract |
| 5 | `packages/storage-sqlite/api` | `@openjiuwen/relay-storage-sqlite` | SQLite evidence / scheduler provider 实现 |
| 6 | `packages/mcp-server` | `@openjiuwen/relay-mcp-server` | MCP server 运行包 |
| 7 | `packages/api` | `@openjiuwen/relay-api-server` | API server 运行包 |
| 8 | `packages/web` | `@openjiuwen/relay-web` | Web app shell、组件、hooks、stores、services、utils 和样式 |

### 2.2 不进入开源 npm 发布

| 路径 | npm 包名 | 原因 |
|---|---|---|
| `packages/green-package` | `@office-claw/green-package-runtime` | 华为内部 runtime 壳包 |
| `packages/green-package/api` | `@office-claw/green-package` | 华为内部 auth、metrics、MaaS 等实现 |
| `packages/green-package/web` | `@office-claw/green-package-web` | 华为内部 web 扩展 |

## 3. 依赖关系

开源发布包的内部依赖关系如下：

```text
@openjiuwen/relay-shared
  <- @openjiuwen/relay-api-server-contracts peer
  <- @openjiuwen/relay-core dependency
  <- @openjiuwen/relay-mcp-server dependency
  <- @openjiuwen/relay-api-server dependency

@openjiuwen/relay-api-server-contracts
  <- @openjiuwen/relay-core peer
  <- @openjiuwen/relay-storage-sqlite dependency
  <- @openjiuwen/relay-api-server dependency

@openjiuwen/relay-web-contracts
  no internal runtime dependency

@openjiuwen/relay-core
  <- @openjiuwen/relay-api-server dependency

@openjiuwen/relay-storage-sqlite
  provider package, independently installed and loaded by env

@openjiuwen/relay-mcp-server
  independently installable runtime package

@openjiuwen/relay-api-server
  depends on shared, contracts, core
  must not depend on relay-storage-sqlite

@openjiuwen/relay-web
  depends on shared and web-facing runtime dependencies
  exposes app, components, hooks, stores, services, utils, lib, and styles.css
```

关键边界：

1. `@openjiuwen/relay-api-server` 不得依赖 `@openjiuwen/relay-storage-sqlite`。
2. SQLite evidence / scheduler 通过 provider env 加载：

```bash
OFFICE_CLAW_EVIDENCE_PROVIDER=sqlite
OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/evidence
OFFICE_CLAW_SCHEDULER_PROVIDER=sqlite
OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/scheduler
```

3. Auth、metrics、catalog、storage、evidence、scheduler 都按 provider 模块扩展，不把具体实现塞进 `api-server` 发布依赖。

## 4. 当前必须保持的包配置

所有开源发布包应满足：

```json
{
  "type": "module",
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

例外：

1. `@openjiuwen/relay-api-server` 的 `main` 当前是 `dist/index.js`，可接受。
2. `@openjiuwen/relay-api-server` 和 `@openjiuwen/relay-mcp-server` 是可运行服务包，额外提供 `bin`。

明确禁止：

```text
private: true
workspace:
file:
link:
@office-claw/green-package*
```

这些禁止项只针对开源发布包的发布 tarball 和 runtime dependencies。private 示例包和华为内部包可以保留在 monorepo 中，但不得进入开源 npm 发布流程。

## 5. 发布前门禁脚本

建议新增脚本：

```bash
pnpm check:npm-open-source
```

建议实现文件：

```text
scripts/check-open-source-npm-packages.mjs
```

### 5.1 包集合校验

脚本应把“哪些包允许发布”作为单一事实源。实现上维护两个集合：开源发布白名单和明确排除列表。

开源发布白名单：

```js
const PUBLIC_PACKAGES = [
  '@openjiuwen/relay-shared',
  '@openjiuwen/relay-api-server-contracts',
  '@openjiuwen/relay-web-contracts',
  '@openjiuwen/relay-core',
  '@openjiuwen/relay-storage-sqlite',
  '@openjiuwen/relay-mcp-server',
  '@openjiuwen/relay-api-server',
  '@openjiuwen/relay-web',
];
```

明确排除列表：

```js
const EXCLUDED_PACKAGES = {
  '@office-claw/green-package-runtime': 'Huawei internal runtime shell',
  '@office-claw/green-package': 'Huawei internal provider implementation',
  '@office-claw/green-package-web': 'Huawei internal web extension',
};
```

校验步骤：

1. 枚举 workspace 中所有 `packages/**/package.json`，排除 `node_modules` 和 `dist`。
2. 读取每个 package 的 `name`。
3. `PUBLIC_PACKAGES` 中每个包都必须存在，缺失则失败。
4. workspace 中每个具名包必须属于 `PUBLIC_PACKAGES` 或 `EXCLUDED_PACKAGES`，否则失败。
5. `PUBLIC_PACKAGES` 中的包不得是 `private: true`。
6. `EXCLUDED_PACKAGES` 中的示例包和当前不发布包应保持 `private: true`；如果某个 excluded 包不是 private，脚本应提示它不会发布，但需要人工确认原因。

这个集合对比比只在依赖里 grep 禁止包更可靠：它能同时发现“白名单漏包”和“新增包未归类”两类问题。

### 5.2 发布包内容检查

脚本至少检查：

1. 白名单包都有 `license`。
2. scoped public 包都有 `publishConfig.access = public`。
3. 白名单包都有 `README.md`。
4. 白名单包都有 `LICENSE`。
5. 白名单包的 direct dependencies 不包含任何 `EXCLUDED_PACKAGES`。
6. `@openjiuwen/relay-api-server` 的 dependencies、peerDependencies、optionalDependencies 都不包含 `@openjiuwen/relay-storage-sqlite`。
7. `@openjiuwen/relay-api-server` 的 build script 不包含 `@openjiuwen/relay-storage-sqlite`。
8. `pnpm pack` 后 tarball 内 `package.json` 不包含 `workspace:`、`file:`、`link:`。
9. `exports` 指向的文件都存在于 tarball。
10. `main`、`types` 指向的文件都存在于 tarball。

### 5.3 smoke install

`smoke:npm-open-source` 应在临时目录安装 tarball：

```bash
mkdir -p "$TMPDIR/officeclaw-npm-smoke"
cd "$TMPDIR/officeclaw-npm-smoke"
echo '{"private":true,"type":"module"}' > package.json
pnpm add --ignore-scripts /path/to/packs/*.tgz
```

然后执行 import smoke：

```bash
node -e "
await import('@openjiuwen/relay-shared');
await import('@openjiuwen/relay-api-server-contracts');
await import('@openjiuwen/relay-web-contracts');
await import('@openjiuwen/relay-core');
await import('@openjiuwen/relay-storage-sqlite');
await import('@openjiuwen/relay-mcp-server');
await import('@openjiuwen/relay-api-server/server');
await import('@openjiuwen/relay-web');
await import('@openjiuwen/relay-web/components');
await import('@openjiuwen/relay-web/config');
await import('@openjiuwen/relay-web/constants');
await import('@openjiuwen/relay-web/hooks');
await import('@openjiuwen/relay-web/lib');
await import('@openjiuwen/relay-web/pages');
await import('@openjiuwen/relay-web/services');
await import('@openjiuwen/relay-web/shared');
await import('@openjiuwen/relay-web/stores');
await import('@openjiuwen/relay-web/utils');
console.log('import-smoke-ok');
"
```

## 6. 本地发布前验收

这一节不是正式发布步骤，而是发布前在本机或 CI 上跑的一次验收流水线。它回答一个问题：当前源码生成的 npm tarball 是否真的可以作为开源包被安装和 import。

推荐把构建、pack、tarball 检查收敛到一个默认快速验收脚本：

```bash
pnpm verify:npm-open-source
```

建议脚本拆成三个内部阶段：

```json
{
  "scripts": {
    "build:npm-open-source": "node scripts/build-open-source-npm-packages.mjs",
    "check:npm-open-source": "node scripts/check-open-source-npm-packages.mjs",
    "smoke:npm-open-source": "node scripts/check-open-source-npm-packages.mjs --smoke-install",
    "pack:npm-open-source": "node scripts/check-open-source-npm-packages.mjs --pack-destination dist/packs --keep-packs --clean-pack-destination",
    "verify:npm-open-source": "pnpm install --frozen-lockfile && pnpm build:npm-open-source && pnpm check:npm-open-source"
  }
}
```

其中：

1. `build:npm-open-source` 只构建 8 个开源白名单包，并按拓扑顺序执行。
2. `check:npm-open-source` 负责 pack、检查 tarball 元数据、检查禁止依赖和入口文件存在性。
3. `smoke:npm-open-source` 负责慢速真实安装和 import smoke。
4. `verify:npm-open-source` 是日常本地快速验收命令。

`smoke:npm-open-source` 会解析并安装真实 runtime 依赖，可能较慢。它不放进默认快速验收，只在正式发布前或手动发布 CI 中执行。

### 6.1 构建范围

`scripts/build-open-source-npm-packages.mjs` 固定构建白名单包：

```text
@openjiuwen/relay-shared
@openjiuwen/relay-api-server-contracts
@openjiuwen/relay-web-contracts
@openjiuwen/relay-core
@openjiuwen/relay-storage-sqlite
@openjiuwen/relay-mcp-server
@openjiuwen/relay-api-server
@openjiuwen/relay-web
```

不要用 `pnpm -r run build` 作为开源发布构建命令，因为它会把 `green-package`、示例 provider 等非开源发布目标带进链路。`packages/web` 在开源发布链路中使用专用的 `build:npm`，避免影响现有 app build。

### 6.2 检查范围

`check:npm-open-source` 做这些事即可：

1. 先校验 workspace 包集合：每个具名包必须属于 `PUBLIC_PACKAGES` 或 `EXCLUDED_PACKAGES`。
2. 确认 8 个白名单包全部存在，且没有 `private: true`。
3. 只对 8 个白名单包执行 `pnpm pack` 到临时目录。
4. 检查 tarball 内 `package.json` 没有 `workspace:`、`file:`、`link:`。
5. 检查 tarball 内没有 `@office-claw/green-package*` 依赖。
6. 检查 `@openjiuwen/relay-api-server` tarball 不依赖 `@openjiuwen/relay-storage-sqlite`。
7. 检查 `main`、`types`、`exports` 指向的文件存在。
8. 不做真实安装，保持本地检查快速稳定。

### 6.3 smoke install 范围

`smoke:npm-open-source` 做这些事：

1. 复用 `check:npm-open-source` 的包集合、pack 和 tarball 检查。
2. 在临时空项目中安装 8 个 tarball。
3. import 每个公开入口。

这个命令会安装 `api-server`、`sqlite` 等包的真实第三方依赖，因此可能明显慢于 `check:npm-open-source`。它是发布前最终验收，不是日常开发检查。

### 6.4 排查时的手动命令

正常发布前只跑：

```bash
pnpm verify:npm-open-source
```

只有脚本失败需要定位时，才手动拆开执行：

```bash
pnpm build:npm-open-source
pnpm check:npm-open-source
pnpm smoke:npm-open-source
node --test packages/api/test/package-decoupling.test.js
node --test packages/api/test/storage-module.test.js
```

这样文档和执行入口都保持单一，避免手工维护一长串逐包命令。

## 7. Changesets 发布流程

### 7.1 调整 changeset ignore

`.changeset/config.json` 应继续 ignore：

```json
[
  "@office-claw/green-package-runtime",
  "@office-claw/green-package",
  "@office-claw/green-package-web"
]
```

如果 `@office-claw/green-package*` 后续迁出仓库或不在 workspace 中，ignore 可以同步移除。

### 7.2 生成 changeset

```bash
pnpm changeset
```

只选择开源白名单包。

版本策略：

1. 初次公开发布建议统一 `0.1.0`。
2. 后续兼容改动用 `patch`。
3. 新增公开 API 用 `minor`。
4. 破坏公开契约用 `major`，在 `0.x` 阶段也要在 changelog 里明确。

### 7.3 版本更新

```bash
pnpm version-packages
pnpm install --lockfile-only
```

### 7.4 发布

推荐新增脚本：

```json
{
  "scripts": {
    "release:npm-open-source": "node scripts/release-open-source-npm-packages.mjs",
    "release:npm-open-source:no-smoke": "node scripts/release-open-source-npm-packages.mjs --skip-smoke",
    "release:npm-open-source:local": "node scripts/release-open-source-npm-packages.mjs --local-only",
    "release:npm-open-source:local:no-smoke": "node scripts/release-open-source-npm-packages.mjs --local-only --skip-smoke"
  }
}
```

执行：

```bash
npm login
npm whoami
pnpm release:npm-open-source
```

如果已经单独执行过慢速 smoke，或需要在受限环境里跳过真实安装检查，可以执行：

```bash
pnpm release:npm-open-source:no-smoke
```

也可以使用环境变量：

```bash
SKIP_NPM_OPEN_SOURCE_SMOKE=1 pnpm release:npm-open-source
```

本地伪发布只生成 tarball 到 `dist/packs`，不执行远端发布：

```bash
pnpm release:npm-open-source:local
```

如需跳过慢速 smoke：

```bash
pnpm release:npm-open-source:local:no-smoke
```

CI 中使用：

```bash
pnpm release:npm-open-source
```

并设置：

```text
NODE_AUTH_TOKEN
```

## 8. GitHub Actions 发布工作流

建议新增：

```text
.github/workflows/npm-open-source-release.yml
```

触发：

```yaml
on:
  workflow_dispatch:
```

第一版建议只允许手动触发。等流程稳定后，再考虑 tag 或 release branch 自动发布。

核心 job：

```yaml
name: Open Source npm Release

on:
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm build:npm-open-source
      - run: pnpm check:npm-open-source
      - run: pnpm smoke:npm-open-source
      - run: pnpm changeset publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

发布前必须在 npm 创建 automation token，并写入 GitHub secret：

```text
NPM_TOKEN
```

## 9. 消费方安装示例

最小 API server 消费：

```bash
pnpm add @openjiuwen/relay-api-server
```

如果使用 SQLite evidence / scheduler：

```bash
pnpm add @openjiuwen/relay-storage-sqlite
```

配置：

```bash
OFFICE_CLAW_EVIDENCE_PROVIDER=sqlite
OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/evidence
OFFICE_CLAW_SCHEDULER_PROVIDER=sqlite
OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/scheduler
```

如果使用 memory storage：

```bash
MEMORY_STORE=1
```

如果使用 Redis storage：

```bash
REDIS_URL=redis://127.0.0.1:6379
```

## 10. 开源版和华为版分流

开源版本默认值：

```bash
OFFICE_CLAW_AUTH_PROVIDER=no-auth
OFFICE_CLAW_EVIDENCE_PROVIDER=noop
OFFICE_CLAW_SCHEDULER_PROVIDER=noop
OFFICE_CLAW_METRICS_PROVIDER=noop
```

华为版本通过内部 preset 设置：

```bash
OFFICE_CLAW_AUTH_PROVIDER=<huawei-provider-id>
OFFICE_CLAW_AUTH_PROVIDER_MODULES=@office-claw/green-package/providers-plugin
OFFICE_CLAW_METRICS_PROVIDER=<huawei-provider-id>
OFFICE_CLAW_METRICS_PROVIDER_MODULES=@office-claw/green-package/metrics-plugin
```

开源 npm 发布流程不得默认设置或打包这些华为模块。

安装器层面建议拆 profile：

```text
open-source
huawei
```

`open-source` profile 不得引用：

```text
packages/green-package
@office-claw/green-package
@office-claw/green-package-web
@office-claw/green-package-runtime
```

## 11. 第一版落地任务清单

### 必做

1. 新增 `scripts/check-open-source-npm-packages.mjs`。
2. 新增根脚本 `build:npm-open-source`。
3. 新增根脚本 `check:npm-open-source`。
4. 新增根脚本 `release:npm-open-source`。
5. 调整 `.changeset/config.json`，确保忽略示例 provider、华为内部包。
6. 跑通本地 `build -> test -> pack -> smoke install`。
7. 跑通 `changeset publish` 到 npm dry-run 或测试 scope。

## 12. 验收标准

一次开源 npm 发布必须满足：

1. workspace 中每个具名包都已归类到发布白名单或排除清单。
2. 只发布 8 个白名单包。
3. 任意白名单包 tarball 中无 `workspace:`、`file:`、`link:`。
4. 任意白名单包 tarball 中无 `@office-claw/green-package*` 依赖。
5. `@openjiuwen/relay-api-server` tarball 中无 `@openjiuwen/relay-storage-sqlite` 依赖。
6. 8 个 tarball 可在空项目中安装。
7. 8 个包的公开入口可被 Node import。
8. `relay-storage-sqlite` 可作为 provider 被 `OFFICE_CLAW_*_PROVIDER_MODULES` 动态加载。
9. 发布流程不触碰 `packages/green-package`。
