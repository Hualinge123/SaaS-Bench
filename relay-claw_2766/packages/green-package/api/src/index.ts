export { createHuaweiCasAuthProvider } from './auth/huawei-cas.js';
export { createHuaweiIamAuthProvider } from './auth/huawei-iam.js';
export { createHuaweiOauthAuthProvider } from './auth/huawei-oauth.js';
export {
  buildHuaweiMaaSAuthorization,
  type HuaweiMaaSRuntimeConfig,
  resolveHuaweiMaaSRuntimeConfig,
  type SessionLike,
  type SessionLookup,
} from './integrations/huawei-maas.js';
export {
  type AomAccessCodeResult,
  buildAomEndpoint,
  type CasCredential,
  ensurePrometheusInstance,
  extractRegion,
  fetchAomAccessCode,
  type PrometheusInstance,
} from './metrics/aom-access-code-client.js';
export type { Logger } from './types.js';
export * as signer from './utils/signer.js';
