/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveActiveProjectRoot } from '../utils/active-project-root.js';

const APM_ENABLED_ENV = 'APM_TRACING_ENABLED';

export interface ApmSettings {
  enabled: boolean;
  source: 'env' | 'default';
  envFilePath: string;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveEnvFilePath(projectRoot = resolveActiveProjectRoot()): string {
  return resolve(projectRoot, '.env');
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFileValue(contents: string, name: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== name) continue;
    return unquoteEnvValue(match[2] ?? '');
  }
  return undefined;
}

function formatEnvFileValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
}

function applyEnvUpdate(contents: string, name: string, value: string): string {
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  let seen = false;
  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || match[1] !== name) return line;
    seen = true;
    return `${name}=${formatEnvFileValue(value)}`;
  });
  if (!seen) nextLines.push(`${name}=${formatEnvFileValue(value)}`);
  return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function readApmSettings(projectRoot = resolveActiveProjectRoot()): ApmSettings {
  const envFilePath = resolveEnvFilePath(projectRoot);
  const envValue = process.env[APM_ENABLED_ENV];
  if (envValue !== undefined) {
    return { enabled: parseBoolean(envValue), source: 'env', envFilePath };
  }
  if (existsSync(envFilePath)) {
    const fileValue = readEnvFileValue(readFileSync(envFilePath, 'utf-8'), APM_ENABLED_ENV);
    if (fileValue !== undefined) return { enabled: parseBoolean(fileValue), source: 'env', envFilePath };
  }
  return { enabled: false, source: 'default', envFilePath };
}

export function writeApmSettings(input: { enabled: boolean }, projectRoot = resolveActiveProjectRoot()): ApmSettings {
  const envFilePath = resolveEnvFilePath(projectRoot);
  const current = existsSync(envFilePath) ? readFileSync(envFilePath, 'utf-8') : '';
  const value = input.enabled ? 'true' : 'false';
  const tmpPath = `${envFilePath}.tmp`;
  writeFileSync(tmpPath, applyEnvUpdate(current, APM_ENABLED_ENV, value), 'utf-8');
  renameSync(tmpPath, envFilePath);
  process.env[APM_ENABLED_ENV] = value;
  return { enabled: input.enabled, source: 'env', envFilePath };
}

export function isApmUploadEnabled(projectRoot = resolveActiveProjectRoot()): boolean {
  return readApmSettings(projectRoot).enabled;
}
