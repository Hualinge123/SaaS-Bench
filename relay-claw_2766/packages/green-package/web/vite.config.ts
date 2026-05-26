/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv, defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function buildClientDefine(merged: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (k.startsWith('NEXT_PUBLIC_') || k.startsWith('VITE_')) {
      out[`import.meta.env.${k}`] = JSON.stringify(v ?? '');
    }
  }
  out['import.meta.env.API_CLOWDER_HOST'] = JSON.stringify(merged.API_CLOWDER_HOST ?? '');
  out['import.meta.env.DEFAULT_API_CLIENT_URL'] = JSON.stringify(
    merged.DEFAULT_API_CLIENT_URL ?? 'http://127.0.0.1:3004',
  );
  out['import.meta.env.CAN_CREATE_MODEL'] = JSON.stringify(merged.CAN_CREATE_MODEL ?? '0');
  return out;
}

export default defineConfig(({ mode }) => {
  const merged: Record<string, string | undefined> = {
    ...(process.env as Record<string, string | undefined>),
    ...loadEnv(mode, repoRoot, ''),
  };

  const frontendPort = Number(merged.FRONTEND_PORT) || 3003;
  const apiPort =
    Number(merged.API_SERVER_PORT) ||
    (Number(merged.FRONTEND_PORT) ? Number(merged.FRONTEND_PORT) + 1 : 3004);
  const apiTarget = (
    merged.VITE_API_URL ||
    merged.NEXT_PUBLIC_API_URL ||
    `http://127.0.0.1:${apiPort}`
  ).replace(/\/+$/, '');

  const devHostRaw = merged.VITE_DEV_HOST?.trim();
  const devHost: string | boolean =
    devHostRaw === undefined || devHostRaw === ''
      ? '127.0.0.1'
      : devHostRaw === 'true'
        ? true
        : devHostRaw === 'false'
          ? false
          : devHostRaw;

  return {
    root: __dirname,
    envDir: repoRoot,
    envPrefix: ['DISABLED_USE_DEFINE_INSTEAD'],
    define: buildClientDefine(merged),
    plugins: [react()],
    server: {
      host: devHost,
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      host: devHost,
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../../web/src'),
        '@green': path.resolve(__dirname, 'src'),
      },
    },
    // Use the main packages/web public assets so green-package can load icons and shared resources
    publicDir: path.resolve(repoRoot, 'packages/web/public'),
  };
});
