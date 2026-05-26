---
feature_ids: []
topics: [auth, plugin-api, npm, packaging, integration]
doc_kind: note
created: 2026-04-25
---

# Build an Auth Provider

这份文档回答的是 auth 解耦后，认证提供方怎么做成独立 npm 包，以及主应用启动时需要怎么接。

## 1. 解耦后的边界

auth provider 和 client provider 现在是两条独立扩展线。

它们的职责不同：

1. client provider 负责模型/agent runtime 调用
2. auth provider 负责把“凭证输入”转换成“身份结果”

auth provider 不应该再负责：

1. session issuance
2. middleware 注入
3. 业务路由编排
4. 平台级副作用回滚

这些都由平台 runtime 负责。auth provider 只实现 `AuthProvider` contract。

## 2. 当前主应用怎么加载 auth provider

auth provider 的加载入口在 [packages/api/src/auth/module.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/src/auth/module.ts:1)。

启动时会做几件事：

1. 先注册 builtin providers：`no-auth`、`huawei-iam`
2. 再读取 `CAT_CAFE_AUTH_PROVIDER_MODULES`
3. 对每个模块 specifier 执行动态 `import()`
4. 从模块导出里收集 provider
5. 用 `CAT_CAFE_AUTH_PROVIDER` 选 active provider
6. 如果 provider 定义了 `bootstrap()`，启动时调用一次

因此，auth provider 作为独立包接入时，不需要改 API 主代码，但需要更新启动 env。

## 3. `package.json` 需要什么

和 runtime provider 不一样，auth provider 当前不依赖自动扫描命名规则，也不需要 `clowder.kind` 元数据。

一个最小 package.json 可以是：

```json
{
  "name": "@examples/my-auth-provider",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "prepare": "tsc",
    "clean": "rm -rf dist"
  },
  "peerDependencies": {
    "@openjiuwen/relay-api-server-contracts": ">=0.1.0"
  },
  "devDependencies": {
    "@openjiuwen/relay-api-server-contracts": "workspace:*",
    "typescript": "^5.3.3"
  }
}
```

重点是：

1. 包能被正常 `import()` 到
2. 主入口导出可识别的 auth provider 对象
3. 发布前已经 build 出 `dist/index.js`

## 4. 代码契约是什么

contract 定义在 [packages/plugin-api/src/auth.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/plugin-api/src/auth.ts:1)。

最小可用 provider 形态如下：

```ts
import type { AuthProvider } from '@openjiuwen/relay-api-server-contracts/auth';

const authProvider: AuthProvider = {
  id: 'my-auth',
  displayName: 'My Auth',
  presentation: {
    mode: 'form',
    fields: [
      { name: 'workspace', label: 'Workspace', type: 'text', required: true },
      { name: 'token', label: 'Token', type: 'password', required: true },
    ],
    submitLabel: 'Sign In',
    description: 'Use your workspace token.',
  },
  async authenticate(input) {
    const workspace = String(input.credentials.workspace ?? '');
    const token = String(input.credentials.token ?? '');

    if (!workspace || !token) {
      return { success: false, message: 'Missing credentials' };
    }

    return {
      success: true,
      principal: {
        userId: `my-auth:${workspace}`,
        displayName: workspace,
        expiresAt: null,
        providerState: { workspace },
      },
    };
  },
};

export default authProvider;
```

这个 contract 最重要的约束是：

1. `authenticate()` 只做 credentials -> principal
2. provider-specific 状态可以放 `providerState`
3. session 由平台创建，不由 provider 创建

如果需要额外能力，可以实现：

1. `bootstrap()`
2. `handleCallback()`
3. `restoreSession()`
4. `refresh()`
5. `logout()`
6. `postLoginInit()`
7. `getPublicConfig()`

## 5. 可以怎么导出

当前 auth provider registry 支持三种导出形式，定义在 [packages/api/src/auth/provider-registry.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/src/auth/provider-registry.ts:1)：

1. `export default authProvider`
2. `export const authProvider = ...`
3. `export const authProviders = [providerA, providerB]`

如果模块导出的对象都不满足 duck-typing 检查，启动时会报：

1. `Auth provider module '<specifier>' exported no auth providers`

## 6. 主应用启动要怎么改

auth provider 作为独立包接入时，启动侧至少要改两个 env：

```bash
CAT_CAFE_AUTH_PROVIDER=my-auth
CAT_CAFE_AUTH_PROVIDER_MODULES=@examples/my-auth-provider
```

如果有多个模块，可以逗号分隔：

```bash
CAT_CAFE_AUTH_PROVIDER_MODULES=@examples/my-auth-provider,@examples/backup-auth-provider
```

然后：

1. 安装包
2. 确保它已经 build
3. 重启 API

前端登录页不需要再手写新页面。它会读取 provider 的 `presentation`，自动按 `mode` 渲染：

1. `auto`
2. `form`
3. `redirect`

所以“启动要不要更新”的答案是：**要更新，但主要更新 env 和部署包，不是改前端登录页和后端主入口分发逻辑。**

## 7. `postLoginInit()` 和业务副作用怎么放

这块最容易做重。

建议规则是：

1. `authenticate()` 只判断身份和返回 principal
2. 登录后才做的平台初始化逻辑放 `postLoginInit()`
3. `postLoginInit()` 失败不应回滚已经成功的认证

适合放到 `postLoginInit()` 的事情包括：

1. 模型列表刷新
2. 配额同步
3. 外部平台初始化

不适合放进去的是：

1. 平台 session 创建
2. 路由响应拼装
3. Fastify middleware 注入

## 8. 当前 builtin 和第三方包的关系

当前仓库里 `no-auth` 和 `huawei-iam` 仍以内建实现存在于 API 包内，这是为了开箱即用。

但第三方 auth provider 的推荐形态仍然是独立 npm 包。也就是说：

1. builtin provider 可以留在平台仓库
2. 第三方 provider 应该作为外部包发布
3. 启动时通过 env 决定激活哪个 provider

这和 client provider 的“独立 package + 启动发现”思路是一致的，只是接线方式不同。

## 9. 参考实现

最直接的参考：

1. [packages/plugin-api/src/auth.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/plugin-api/src/auth.ts:1)
2. [packages/api/src/auth/module.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/src/auth/module.ts:1)
3. [packages/api/src/auth/provider-registry.ts](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/src/auth/provider-registry.ts:1)
4. [packages/api/test/fixtures/custom-auth-provider.mjs](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/test/fixtures/custom-auth-provider.mjs:1)
5. [packages/api/test/auth-external-provider-e2e.test.js](/Users/lang/workspace/gitcode/relay-claw-decoupling-main-20260421/packages/api/test/auth-external-provider-e2e.test.js:1)
