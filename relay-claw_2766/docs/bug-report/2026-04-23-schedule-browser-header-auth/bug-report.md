---
feature_ids: []
topics:
  - scheduler
  - authorization
doc_kind: bug-report
created: 2026-04-23
---

# Schedule Browser Header Auth Bug Report

## 报告人

铲屎官在 Apifox/本地 API 手测中发现：`/api/schedule/tasks` 只要随便带一个 `X-Office-Claw-User`，即使用户名无效，也能返回 200。

## 复现步骤

1. 启动 `codex/relay-claw-api-authorization` 分支 API。
2. 请求 `GET /api/schedule/tasks`，带 `X-Office-Claw-User: attacker`。
3. 预期：`401`，因为 header 只能作为主认证 session 查找键。
4. 实际：`200`，旧实现把 header 本身当成已认证 browser caller。

## 根因分析

`resolveScheduleCaller()` 只调用 `resolveHeaderUserId()`，没有校验这个 userId 是否对应服务端已有登录态。`X-Office-Claw-User` 因此从“身份查找键”退化成“自声明身份”，任意客户端都能伪造。

## 修复方案

新增 `browserUserVerifier` 注入点，schedule browser caller 必须通过主认证 verifier。生产环境从 `auth.ts` 接入 `verifyPrimaryUserId()`，复用现有 CAS 登录 session；callback caller 继续使用 `InvocationRegistry.verify()`。

## 验证方式

- 红灯：`schedule-authorization.test.js` 新增无效 browser header 用例，旧实现 `200 !== 401`。
- 绿灯：`CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 pnpm --dir packages/api exec node --test test/schedule-authorization.test.js test/schedule-trigger-validation.test.js test/schedule-routes-logging.test.js` → `18/18 pass`。
- 回归：`pnpm --dir packages/mcp-server exec node --test test/schedule-tools.test.js` → `3/3 pass`。
