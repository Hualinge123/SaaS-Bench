/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { readPublicEnv } from '@/utils/client-env';

/**
 * 登录成功后跳转的主站前端 origin（默认同仓 dev：http://127.0.0.1:3003）。
 * 可通过 `VITE_MAIN_APP_URL` 或 `NEXT_PUBLIC_MAIN_APP_URL` 覆盖（勿尾斜杠）。
 */
export function resolveMainAppOrigin(): string {
  const explicit = readPublicEnv('VITE_MAIN_APP_URL') || readPublicEnv('NEXT_PUBLIC_MAIN_APP_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  return 'http://127.0.0.1:3003';
}
