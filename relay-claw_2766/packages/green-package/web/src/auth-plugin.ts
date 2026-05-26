import type { WebAuthPlugin } from '@openjiuwen/relay-web-contracts/auth';

export const greenWebAuthPlugin: WebAuthPlugin = {
  id: 'green-package-web-auth',
  displayName: 'Green Package Web Auth',
  routes: [
    { path: '/login', module: 'green-package/login' },
    { path: '/login/callback', module: 'green-package/login/callback' },
    { path: '/login/invitation', module: 'green-package/login/invitation' },
  ],
};
