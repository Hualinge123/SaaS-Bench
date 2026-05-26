/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { OfficeClawConfigEntry } from '@openjiuwen/relay-shared';
import type { AgentService } from '../../types.js';
import type { AgentRegistry } from './AgentRegistry.js';

type MaybePromise<T> = T | Promise<T>;

export type CreateAgentService = (
  registryId: string,
  config: OfficeClawConfigEntry,
) => MaybePromise<AgentService | null | undefined>;

export type DisposeAgentService = (service: AgentService) => MaybePromise<void>;

export interface AgentRegistrySynchronizerOptions {
  registry: AgentRegistry;
  createService?: CreateAgentService;
  disposeService?: DisposeAgentService;
  onDisposeError?: (err: unknown) => void;
}

export interface AgentRegistrySyncOptions {
  createService?: CreateAgentService;
  beforeRegistryUpdate?: (configs: Record<string, OfficeClawConfigEntry>) => MaybePromise<void>;
  afterRegistryUpdate?: () => MaybePromise<void>;
}

const SERVICE_RUNTIME_KEYS = [
  'id',
  'provider',
  'defaultModel',
  'accountRef',
  'providerProfileId',
  'imageModel',
  'imageAccountRef',
  'imageGenModel',
  'imageGenAccountRef',
  'commandArgs',
  'cli',
  'cliConfigArgs',
  'ocProviderName',
  'embeddedAcpExecutablePath',
  'embeddedAcpConfig',
  'skills',
] as const;

export class AgentRegistrySynchronizer {
  private readonly registry: AgentRegistry;
  private readonly defaultCreateService?: CreateAgentService;
  private readonly disposeService: DisposeAgentService;
  private readonly onDisposeError?: (err: unknown) => void;
  private serviceSignatures = new Map<string, string>();
  private syncChain: Promise<void> = Promise.resolve();

  constructor(options: AgentRegistrySynchronizerOptions) {
    this.registry = options.registry;
    this.defaultCreateService = options.createService;
    this.disposeService =
      options.disposeService ??
      ((service) => {
        const disposable = service as { dispose?: () => void | Promise<void> };
        return disposable.dispose?.();
      });
    this.onDisposeError = options.onDisposeError;
  }

  sync(configs: Record<string, OfficeClawConfigEntry>, options?: AgentRegistrySyncOptions): Promise<void> {
    const run = this.syncChain.catch(() => undefined).then(() => this.syncNow(configs, options));
    this.syncChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async syncNow(
    configs: Record<string, OfficeClawConfigEntry>,
    options?: AgentRegistrySyncOptions,
  ): Promise<void> {
    const createService = options?.createService ?? this.defaultCreateService;
    if (!createService) {
      throw new Error('AgentRegistrySynchronizer requires createService');
    }

    await options?.beforeRegistryUpdate?.(configs);

    const previousEntries = this.registry.getAllEntries();
    const previousSignatures = this.serviceSignatures;
    const nextEntries = new Map<string, AgentService>();
    const nextSignatures = new Map<string, string>();

    this.registry.reset();

    for (const [registryId, config] of Object.entries(configs)) {
      const signature = buildAgentServiceRuntimeSignature(config);
      const previousService = previousEntries.get(registryId);
      if (previousService && previousSignatures.get(registryId) === signature) {
        this.registry.register(registryId, previousService);
        nextEntries.set(registryId, previousService);
        nextSignatures.set(registryId, signature);
        continue;
      }

      const service = await createService(registryId, config);
      if (!service) {
        continue;
      }
      this.registry.register(registryId, service);
      nextEntries.set(registryId, service);
      nextSignatures.set(registryId, signature);
    }

    this.serviceSignatures = nextSignatures;

    for (const [registryId, previousService] of previousEntries.entries()) {
      if (nextEntries.get(registryId) === previousService) {
        continue;
      }
      try {
        await this.disposeService(previousService);
      } catch (err) {
        this.onDisposeError?.(err);
      }
    }

    await options?.afterRegistryUpdate?.();
  }
}

export function buildAgentServiceRuntimeSignature(config: OfficeClawConfigEntry): string {
  const record = config as unknown as Record<string, unknown>;
  const runtimeConfig: Record<string, unknown> = {};
  for (const key of SERVICE_RUNTIME_KEYS) {
    runtimeConfig[key] = record[key];
  }
  return stableStringify(runtimeConfig);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableStringify);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeForStableStringify((value as Record<string, unknown>)[key]);
  }
  return normalized;
}
