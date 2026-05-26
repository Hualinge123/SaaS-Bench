---
feature_ids: []
topics: [provider-runtime, plugins, npm, packaging, integration]
doc_kind: note
created: 2026-04-25
---

# Build a Provider Plugin

这份文档回答的是解耦后的 runtime provider 怎么做成独立 npm 包，以及接进 OfficeClaw 启动链后哪里会生效。

## 1. 解耦后的边界

provider runtime 解耦后，平台关心的是一个稳定 contract，而不是 provider 代码放在哪个目录。

结论是：

1. 你的 client provider 不需要继续放在主仓库某个 `vendor/` 目录里。
2. 推荐形态是一个独立 npm 包，导出默认 `OfficeClawProviderPlugin`。
3. 平台启动时通过 `ProviderPluginRegistry` 发现这个包，然后按agent 配置里的 `provider` 字符串去拿对应 plugin。

也就是说，主应用只负责：

1. 安装 provider 包
2. 在启动时发现它
3. 在 agent config 里把某个 agent 的 `provider` 指到它支持的 provider id

provider 本身负责：

1. 创建 `AgentService`
2. 声明 binding metadata
3. 可选地声明 MCP config 读写

## 2. 包结构长什么样

最小建议结构：

```text
my-provider/
  package.json
  tsconfig.json
  src/
    index.ts
    MyAgentService.ts
```

建议直接按 `@office-claw/provider-*` 命名，因为当前自动发现逻辑会扫描：

1. `node_modules/@office-claw/provider-*`
2. monorepo 下的 `packages/provider-*`

如果包名不匹配这个模式，当前默认 discovery 不会自动捞到它。

## 3. `package.json` 需要什么

最小可发布样板的接口定义参见 `packages/core/src/plugin/types.ts` 中的 `OfficeClawProviderPlugin`：

```json
{
  "name": "@office-claw/provider-myclient",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "clowder": {
    "kind": "provider",
    "providers": ["myclient"]
  },
  "scripts": {
    "build": "tsc",
    "prepare": "tsc",
    "clean": "rm -rf dist"
  },
  "peerDependencies": {
    "@openjiuwen/relay-core": ">=0.1.0",
    "@openjiuwen/relay-shared": ">=0.1.0"
  },
  "devDependencies": {
    "@openjiuwen/relay-core": "workspace:*",
    "@openjiuwen/relay-shared": "workspace:*",
    "typescript": "^5.3.3"
  }
}
```

这里最关键的是三件事：

1. 默认导出要能在 `dist/index.js` 被 import 到
2. `clowder.kind` 必须是 `provider`
3. `clowder.providers` 要列出它支持的 provider id

## 4. 代码契约是什么

provider 包的核心 contract 在 [packages/core/src/plugin/types.ts](packages/core/src/plugin/types.ts:1)。

一个最小 provider 看起来像这样：

```ts
import type {
  AgentMessage,
  AgentService,
  AgentServiceOptions,
  AgentServiceFactoryContext,
  OfficeClawProviderPlugin,
} from '@openjiuwen/relay-core';

class MyAgentService implements AgentService {
  constructor(private readonly catId: string) {}

  async *invoke(prompt: string, options?: AgentServiceOptions): AsyncIterable<AgentMessage> {
    yield {
      type: 'session_init',
      catId: this.catId,
      sessionId: options?.sessionId ?? `myclient-${Date.now()}`,
      timestamp: Date.now(),
    };

    yield {
      type: 'text',
      catId: this.catId,
      content: `reply from myclient: ${prompt}`,
      timestamp: Date.now(),
    };

    yield {
      type: 'done',
      catId: this.catId,
      isFinal: true,
      timestamp: Date.now(),
    };
  }
}

const plugin: OfficeClawProviderPlugin = {
  name: 'myclient',
  providers: ['myclient'],
  createAgentService(ctx: AgentServiceFactoryContext): AgentService {
    return new MyAgentService(ctx.catId);
  },
};

export default plugin;
```

如果你的 provider 还需要校验 profile、声明 builtin client、写 CLI MCP config 或注入凭据环境变量，可以继续实现这些可选字段：

1. `binding`
2. `validateBinding`
3. `accountSpecs`
4. `mcpConfigWriter`
5. `mcpConfigReader`
6. `mcpConfigPath`
7. `resolveCredentialEnv`

## 5. 凭据环境变量注入（resolveCredentialEnv）

如果你的 provider 需要向 AgentService 子进程传递 API key、base URL、认证模式等凭据信息，实现 `resolveCredentialEnv`。

平台在每次 agent 调用时，会把 `resolveCredentialEnv` 返回的 `Record<string, string>` 合并到子进程的 `callbackEnv` 中。

### CredentialResolutionContext

```ts
interface CredentialResolutionContext {
  agentId: AgentId;
  provider: string;
  defaultModel?: string;
  resolvedAccount: RuntimeProviderProfile | null;
  effectiveProtocol: string | null;
  configProjectRoot: string;
  userId: string;
  agentConfig: AgentConfig;
  boundAccountRef?: string | null;
  modelConfigBinding?: {
    id: string;
    protocol?: ProviderProfileProtocol;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    models: string[];
  } | null;
}
```

关键字段：

| 字段 | 含义 |
|------|------|
| `resolvedAccount` | 平台解析后的 provider profile（api_key / oauth / builtin） |
| `effectiveProtocol` | 生效的协议（anthropic / openai / google / huawei_maas / 自定义） |
| `modelConfigBinding` | 如果用户绑定了 model config source（如 HuaweiMaaS），这里是解析后的 binding |
| `boundAccountRef` | 经过剥离继承默认后的显式账户绑定 ID |
| `agentConfig` | 完整的 agent 配置（含 defaultModel、ocProviderName 等） |

### 最小实现

一个接 OpenAI 兼容 API 的自定义 provider：

```ts
import type {
  CredentialResolutionContext,
  OfficeClawProviderPlugin,
} from '@openjiuwen/relay-core';

const plugin: OfficeClawProviderPlugin = {
  name: 'my-llm',
  providers: ['my-llm'],
  createAgentService(ctx) { /* ... */ },
  binding: { builtinClient: null, expectedProtocol: 'openai' },

  resolveCredentialEnv(ctx: CredentialResolutionContext): Record<string, string> {
    const env: Record<string, string> = {};
    if (ctx.resolvedAccount?.authType === 'api_key') {
      if (ctx.resolvedAccount.apiKey) env.OPENAI_API_KEY = ctx.resolvedAccount.apiKey;
      if (ctx.resolvedAccount.baseUrl) env.OPENAI_BASE_URL = ctx.resolvedAccount.baseUrl;
    }
    return env;
  },
};

export default plugin;
```

### 协议复用

如果你的 provider 底层走的是 anthropic / openai / google 协议，可以直接复用平台提供的 protocol helpers：

```ts
import {
  buildAnthropicProtocolEnv,
  buildOpenAiProtocolEnv,
  buildGoogleProtocolEnv,
} from '@openjiuwen/relay-api-server/config/plugins/protocol-credential-helpers';

resolveCredentialEnv(ctx) {
  const base = buildOpenAiProtocolEnv(ctx);
  base.MY_CUSTOM_HEADER = 'value';
  return base;
}
```

### 覆盖与叠加

`resolveCredentialEnv` 返回的所有 key-value 会通过 `Object.assign(callbackEnv, credentialEnv)` 合并到子进程环境变量中。如果你需要在基础协议 env 上叠加自定义变量（如 Dare 的 `DARE_API_KEY`），在 resolver 内部先调 protocol helper 再叠加即可。

### effectiveProtocol 怎么来的

平台按以下优先级决定 `effectiveProtocol`：

1. `resolvedAccount.protocol`（非 builtin 账户自带协议声明）
2. `modelConfigBinding.protocol`（model config source 声明的协议）
3. `plugin.binding.expectedProtocol`（你在 plugin 上声明的默认协议）

你的 resolver 收到的 `ctx.effectiveProtocol` 已经是最终结果。

### 不需要 resolveCredentialEnv 的情况

如果你的 provider 不依赖 API key / OAuth 凭据（比如纯本地进程、A2A 协议），不实现即可。平台在缺少 `resolveCredentialEnv` 时不会注入任何凭据 env。

## 6. 打成 npm 包后，主应用怎么接

接入路径是：

1. `pnpm add @office-claw/provider-myclient`
2. 确保包已经 build 出 `dist/index.js`
3. 重启 API，让启动流程重新执行 provider discovery
4. 把 agent config 里的 `provider` 设成 `myclient`

启动侧不需要再给 provider 专门加一个新的 hardcoded switch。当前 discovery 逻辑在 [packages/core/src/plugin/registry.ts](packages/core/src/plugin/registry.ts:1)。

平台启动时会：

1. 先注册 builtin plugins
2. 再扫描 `node_modules/@office-claw/provider-*`
3. 发现带有 `clowder.kind === "provider"` 的包
4. import 它的主入口并注册

注意一个当前实现细节：

1. 如果包只有 `src/index.ts`，没有 build 出 `dist/index.js`
2. registry 会把它当成“开发态未构建包”，不会注册成功

所以“安装完 npm 包但没 build”在当前实现里等于没接上。

## 7. 启动配置需要改哪里

provider runtime 这边，启动配置的关键不是加 env，而是让agent 配置引用正确的 provider id。

通常需要确认：

1. agent config 的 `provider` 与 `plugin.providers` 里声明的字符串一致
2. `createAgentService()` 里依赖的 env 已经存在
3. 如果 provider 依赖 provider profile / accountRef，对应 profile 已在平台中配置

换句话说，解耦后“启动更新”主要是：

1. 安装新包
2. 重启 API
3. 更新 agent config / provider profile

而不是回到 `packages/api/src/index.ts` 再写一段 provider 分发逻辑。

## 8. 什么时候还需要改主仓库

正常第三方 provider 不需要改主仓库。

只有下面几类场景，才应该碰平台代码：

1. 你要新增 provider contract 本身的能力
2. 你要新增新的启动发现规则
3. 你要给 builtin provider 集合增加一个开箱即用 provider

否则，provider 包应当保持独立发布、独立迭代。

## 9. 参考实现

最值得直接对照的文件：

1. [packages/core/src/plugin/types.ts](packages/core/src/plugin/types.ts:1) — `OfficeClawProviderPlugin` 和 `CredentialResolutionContext` 接口定义
2. [packages/core/src/plugin/registry.ts](packages/core/src/plugin/registry.ts:1) — `ProviderPluginRegistry` 发现和注册逻辑
3. [packages/api/src/config/plugins/builtin-providers.ts](packages/api/src/config/plugins/builtin-providers.ts:1) — 6 个 builtin plugin 的接线（含 resolveCredentialEnv）
4. [packages/api/src/config/plugins/builtin-credential-resolvers.ts](packages/api/src/config/plugins/builtin-credential-resolvers.ts:1) — 各 provider 的凭据解析实现
5. [packages/api/src/config/plugins/protocol-credential-helpers.ts](packages/api/src/config/plugins/protocol-credential-helpers.ts:1) — 可复用的协议级 env 构建 helpers
6. [packages/api/test/builtin-provider-credential-env.test.js](packages/api/test/builtin-provider-credential-env.test.js:1) — resolver 单元测试
