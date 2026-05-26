/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Global Metrics Service
 *
 * Singleton for immediate metric reporting (e.g., login events).
 * Only supports initialization via CAS login credentials (AK/SK + SecurityToken).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AomMetricsReporter } from './aom-reporter.js';
import { createAomMetricsReporter } from './aom-reporter.js';
import { createTokenUsageReporter, type TokenUsageReporter } from './token-usage-reporter.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveActiveProjectRoot } from '../../utils/active-project-root.js';

let reporter: AomMetricsReporter | null = null;
let tokenUsageReporter: TokenUsageReporter | null = null;
let initPromise: Promise<boolean> | null = null;

const DEFAULT_VERSION = '0.1.0';

function readClawVersion(): string {
  try {
    const projectRoot = resolveActiveProjectRoot();
    
    const packageJsonPath = resolve(projectRoot, 'package.json');
    const packageVersion = readVersionFromJsonFile(packageJsonPath);
    if (packageVersion) return packageVersion;

    const releaseJsonPath = resolve(projectRoot, '.office-claw-release.json');
    const releaseVersion = readVersionFromJsonFile(releaseJsonPath);
    if (releaseVersion) return releaseVersion;

    return DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

function readVersionFromJsonFile(filePath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    return typeof parsed?.version === 'string' && parsed.version.trim().length > 0
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Start the periodic token usage reporter.
 * Called after successful credential-based init.
 */
export function startTokenUsageReporter(intervalMs?: number): void {
  if (tokenUsageReporter) return; // already running
  if (!reporter) return;

  tokenUsageReporter = createTokenUsageReporter({
    reporter,
    intervalMs: intervalMs ?? 60_000,
  });
  tokenUsageReporter.start();
  console.log('[MetricsService] Token usage reporter started');
}

export interface InitResult {
  initialized: boolean;
  wasFirstInit: boolean;
}

export interface MetricsReporterInitConfig {
  endpoint: string;
  token: string;
  projectId: string;
  instanceId?: string;
}

export async function initMetricsFromConfig(
  config: MetricsReporterInitConfig,
  log?: FastifyBaseLogger,
): Promise<InitResult> {
  if (reporter) {
    return { initialized: true, wasFirstInit: false };
  }

  if (initPromise) {
    const result = await initPromise;
    return { initialized: result, wasFirstInit: false };
  }

  const promise = (async () => {
    try {
      reporter = createAomMetricsReporter({
        endpoint: config.endpoint,
        projectId: config.projectId,
        token: config.token,
        instanceId: config.instanceId,
        clawVersion: readClawVersion(),
      });
      log?.info('[MetricsService] Initialized from provider config');
      return true;
    } catch (error) {
      log?.error({ error }, '[MetricsService] Failed to initialize');
      return false;
    }
  })();
  initPromise = promise;

  const initialized = await promise;
  initPromise = null;
  return { initialized, wasFirstInit: initialized };
}

export function getMetricsReporter(): AomMetricsReporter | null {
  return reporter;
}

export function resetMetricsReporter(): void {
  reporter = null;
  initPromise = null;
}

export async function reportMetric(
  name: string,
  value: number,
  labels?: Record<string, string>,
  log?: FastifyBaseLogger,
): Promise<boolean> {
  if (!reporter) {
    log?.warn('[MetricsService] Reporter not initialized, skipping metric report');
    return false;
  }
  const result = await reporter.reportSingleMetric(name, value, labels);
  if (result.success) {
    log?.info({ metricName: name }, '[MetricsService] Metric reported successfully');
  } else {
    log?.warn(
      {
        metricName: name,
        status: result.status,
        message: result.message,
      },
      '[MetricsService] Metric report failed',
    );
  }
  return result.success;
}
