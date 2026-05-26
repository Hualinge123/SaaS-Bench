/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

const APM_RUNTIME_ENV_PREFIXES = ['APM_', 'OTEL_', 'OFFICE_CLAW_APM_', 'OFFICE_CLAW_OTEL_'] as const;

export function isApmRuntimeEnvKey(key: string): boolean {
  return APM_RUNTIME_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function clearApmRuntimeEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (isApmRuntimeEnvKey(key)) {
      delete env[key];
    }
  }
}
