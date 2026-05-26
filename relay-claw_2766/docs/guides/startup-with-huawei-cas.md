---
feature_ids: []
topics: [auth, startup, huawei-cas, green-package, decat]
doc_kind: guide
created: 2026-05-13
---

# Startup Guide: Huawei CAS Auth Mode

解耦分支（decat）下，以 huawei-cas 认证模式启动 OfficeClaw 的完整流程。

## 前置条件

- Node.js >= 20, pnpm >= 9
- Redis 可用（或使用 `--memory` 跳过）
- `packages/green-package` 源码在工作区中（包含 huawei-cas provider 实现）

## 1. 安装依赖

```bash
pnpm install
```

如果遇到 `prepare` 脚本报错（shared 包尚未构建），使用：

```bash
NODE_ENV=development CI=1 pnpm install --ignore-scripts
```

## 2. 构建

构建有严格顺序依赖。`pnpm --filter @openjiuwen/relay-api-server run build` 内部已编排好顺序：

```
shared → core → plugin-api → green-package → storage-sqlite → api
```

完整构建：

```bash
pnpm build
```

> `green-package/web`（Next.js overlay）构建失败不影响开源前端。开源前端使用 `packages/web`（Vite）。

## 3. 配置 .env

关键配置项：

```bash
# ── Auth Provider ──
# huawei-cas 在 green-package 中实现，需要通过模块加载路径注册
OFFICE_CLAW_AUTH_PROVIDER=huawei-cas
OFFICE_CLAW_AUTH_PROVIDER_MODULES=@office-claw/green-package/providers-plugin

# ── Evidence / Scheduler（推荐，否则回落内存模式）──
OFFICE_CLAW_EVIDENCE_PROVIDER=sqlite
OFFICE_CLAW_EVIDENCE_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/evidence
OFFICE_CLAW_SCHEDULER_PROVIDER=sqlite
OFFICE_CLAW_SCHEDULER_PROVIDER_MODULES=@openjiuwen/relay-storage-sqlite/scheduler

# ── Ports ──
FRONTEND_PORT=3003
API_SERVER_PORT=3004
NEXT_PUBLIC_API_URL=http://localhost:3004

# ── Redis ──
REDIS_PORT=6399
```

### Auth Provider 加载原理

解耦后 auth provider 通过动态模块加载注册，不再硬编码：

1. `OFFICE_CLAW_AUTH_PROVIDER` 指定激活的 provider id（`no-auth` / `huawei-cas`）
2. `OFFICE_CLAW_AUTH_PROVIDER_MODULES` 指定模块加载路径（逗号分隔）
3. 启动时 `createAuthModule()` 先注册内置 `no-auth`，再 `import()` 外部模块
4. 外部模块导出 `authProviders: AuthProvider[]`，自动注册到 registry
5. 根据 `OFFICE_CLAW_AUTH_PROVIDER` 从 registry 中解析激活的 provider

`no-auth` 模式不需要 `OFFICE_CLAW_AUTH_PROVIDER_MODULES`，因为它是内置的。

### Worktree 环境

在 worktree 中开发时，端口需隔离避免冲突：

```bash
REDIS_PORT=6388
FRONTEND_PORT=3005
API_SERVER_PORT=3006
NEXT_PUBLIC_API_URL=http://localhost:3006
```

## 4. 启动

```bash
# 稳定模式（production 前端 + 非 watch API）
pnpm start:direct

# 开发模式（vite dev 热重载）
pnpm dev:direct
```

`pnpm start:direct` 等价于 `bash scripts/start-dev.sh --prod-web --profile=opensource`。

启动流程：

1. Redis 启动（或 `--memory` 跳过）
2. 前端构建（`--prod-web` 时执行 `vite build`，`--quick` 复用已有 `dist/`）
3. API Server 启动（端口 `API_SERVER_PORT`）
4. Frontend 启动（`--prod-web` → `vite preview`，否则 `vite dev`）

## 5. 验证

```bash
# API 健康检查
curl http://localhost:3004/health

# 浏览器访问前端
open http://localhost:3003
```

huawei-cas 模式下会重定向到华为云 CAS 登录页。

## 6. 对比：no-auth 模式

纯开源模式不需要 green-package 的 auth provider：

```bash
OFFICE_CLAW_AUTH_PROVIDER=no-auth
# 不需要 OFFICE_CLAW_AUTH_PROVIDER_MODULES
```

## 7. 前端变更说明

`packages/web` 已从 Next.js 迁移到 Vite：

| 项目 | 旧（Next.js） | 新（Vite） |
|------|---------------|-----------|
| 开发命令 | `next dev` | `vite`（`pnpm run dev`） |
| 生产构建 | `next build` | `vite build`（`pnpm run build`） |
| 生产启动 | `next start` | `vite preview`（`pnpm run start`） |
| 产物目录 | `.next/` | `dist/` |
| 端口配置 | CLI `-p` 参数 | `FRONTEND_PORT` env（`vite.config.ts` 读取） |
| 缓存目录 | `.next/cache` | `node_modules/.vite` |

`scripts/start-dev.sh` 已适配以上所有变更。

## 8. 已清理的跨层依赖

本次解耦同步清理了以下问题：

| 文件 | 处理 | 原因 |
|------|------|------|
| `api/src/auth/providers/huawei-iam.ts` | 删除 | 死代码，零消费者 |
| `api/src/utils/signer.ts` | 删除 | 死代码，零消费者 |
| `green-package/api/src/connectors/` | 搬回 api core | XiaoYi 是平台连接器，属于开源核心 |
| `green-package` `./connectors` 导出 | 移除 | 随 XiaoYi 搬迁一并清理 |
| `green-package` `ws` 依赖 | 移除 | 仅 connectors 使用，无其他消费者 |
