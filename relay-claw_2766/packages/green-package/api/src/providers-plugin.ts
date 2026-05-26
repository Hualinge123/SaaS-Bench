import { createHuaweiCasAuthProvider, createHuaweiIamAuthProvider, createHuaweiOauthAuthProvider } from './auth/index.js';

/** Export auth providers in plugin-registry-compatible shape. */
export const authProviders = [createHuaweiIamAuthProvider(), createHuaweiCasAuthProvider(), createHuaweiOauthAuthProvider()];
