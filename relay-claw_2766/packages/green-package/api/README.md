# @office-claw/green-package

Huawei Cloud integrations extracted from the OfficeClaw API server.

Includes: Huawei IAM auth provider, MaaS runtime config, XiaoYi WebSocket connector, HWS signer, and AOM metrics client.

## Usage

```ts
import { createHuaweiIamAuthProvider } from '@office-claw/green-package/auth';
import { resolveHuaweiMaaSRuntimeConfig } from '@office-claw/green-package/integrations';
import { XiaoyiWsManager } from '@office-claw/green-package/connectors';
```

## Guides

- [Build an Auth Provider](../../docs/guides/build-auth-provider.md)
- [Build a Provider Plugin](../../docs/guides/build-provider-plugin.md)
