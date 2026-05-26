/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAgentId, OFFICE_CLAW_CONFIGS } from '@openjiuwen/relay-shared';
import type { RelayClawAgentConfig } from '@openjiuwen/relay-shared';
import {
  RelayClawAgentService,
  type RelayClawRuntimeHandle,
} from '../domains/agents/services/agents/providers/RelayClawAgentService.js';
import {
  FrameQueue,
  type RelayClawConnection,
} from '../domains/agents/services/agents/providers/relayclaw-connection.js';
import {
  DefaultRelayClawSidecarController,
  type RelayClawSidecarController,
} from '../domains/agents/services/agents/providers/relayclaw-sidecar.js';
import type { AgentRegistry } from '../domains/agents/services/agents/registry/AgentRegistry.js';
import {
  resolveJiuwenClawAppDir,
  resolveJiuwenClawExecutable,
  resolveJiuwenClawPythonBin,
} from '../utils/jiuwenclaw-paths.js';

export interface RelayClawSecurityPermissionsConfig {
  enabled?: boolean;
  rw_enabled?: boolean;
  tools?: Record<string, unknown>;
}

export interface RelayClawSecurityClient {
  getPermissions(): Promise<RelayClawSecurityPermissionsConfig>;
  setPermissions(patch: RelayClawSecurityPermissionsConfig): Promise<RelayClawSecurityPermissionsConfig>;
}

type PermissionDecision = 'allow' | 'ask' | 'deny';

interface RelayClawAgentResponseFrame {
  ok?: boolean;
  payload?: {
    event_type?: string;
    error?: string;
    [key: string]: unknown;
  };
}

interface RelayClawRuntimeProvider {
  listRelayClawRuntimeHandles(): RelayClawRuntimeHandle[];
  ensureRelayClawRuntimeHandle?(): Promise<RelayClawRuntimeHandle>;
}

type RelayClawRuntimeProviderFactory = () => Promise<RelayClawRuntimeProvider>;

interface RelayClawSecurityTarget {
  scopeKey: string;
  requestQueues: Map<string, FrameQueue>;
  connection: RelayClawConnection;
  resolvedUrl: string;
  provider?: RelayClawRuntimeProvider;
}

const NO_LIVE_RUNTIME_ERROR = '当前没有可用的 live relayclaw runtime，或当前 runtime 尚未暴露完整安全管理接口。';

function isRelayClawRuntimeProvider(value: unknown): value is RelayClawRuntimeProvider {
  return Boolean(value && typeof value === 'object' && 'listRelayClawRuntimeHandles' in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPermissionDecision(value: unknown): value is PermissionDecision {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function readToolDecision(value: unknown): PermissionDecision | null {
  if (isPermissionDecision(value)) {
    return value;
  }
  if (isRecord(value) && isPermissionDecision(value['*'])) {
    return value['*'];
  }
  return null;
}

function hasLegacyToolStructure(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).some((key) => key !== '*');
}

export class DefaultRelayClawSecurityClient implements RelayClawSecurityClient {
  private readonly agentRegistry?: AgentRegistry;
  private readonly fallbackRuntimeProviderFactory?: RelayClawRuntimeProviderFactory;
  private fallbackRuntimeProviderPromise?: Promise<RelayClawRuntimeProvider>;

  constructor(agentRegistry?: AgentRegistry, fallbackRuntimeProviderFactory?: RelayClawRuntimeProviderFactory) {
    this.agentRegistry = agentRegistry;
    this.fallbackRuntimeProviderFactory = fallbackRuntimeProviderFactory;
  }

  async getPermissions(): Promise<RelayClawSecurityPermissionsConfig> {
    const liveTargets = await this.listLiveTargets();
    if (liveTargets.length === 0) {
      throw new Error(NO_LIVE_RUNTIME_ERROR);
    }

    const errors: string[] = [];
    for (const target of liveTargets) {
      try {
        return await this.readPermissionsFromTarget(target);
      } catch (err) {
        const firstError = err instanceof Error ? err.message : String(err);
        const refreshResult = await this.tryRefreshTarget(target);
        if (refreshResult.error) {
          errors.push(`${target.scopeKey}: ${firstError}; refresh: ${refreshResult.error}`);
          continue;
        }
        const refreshedTarget = refreshResult.target;
        if (refreshedTarget) {
          try {
            return await this.readPermissionsFromTarget(refreshedTarget);
          } catch (retryErr) {
            errors.push(
              `${target.scopeKey}: ${firstError}; retry: ${
                retryErr instanceof Error ? retryErr.message : String(retryErr)
              }`,
            );
            continue;
          }
        }
        errors.push(`${target.scopeKey}: ${firstError}`);
      }
    }

    throw new Error(`${NO_LIVE_RUNTIME_ERROR} ${errors.join('; ')}`.trim());
  }

  async setPermissions(patch: RelayClawSecurityPermissionsConfig): Promise<RelayClawSecurityPermissionsConfig> {
    const liveTargets = await this.listLiveTargets();
    if (liveTargets.length === 0) {
      throw new Error(NO_LIVE_RUNTIME_ERROR);
    }

    const failures: string[] = [];
    for (const target of liveTargets) {
      try {
        await this.applyPermissionsPatchToTarget(target, patch);
      } catch (err) {
        const firstError = err instanceof Error ? err.message : String(err);
        const refreshResult = await this.tryRefreshTarget(target);
        if (refreshResult.error) {
          failures.push(`${target.scopeKey}: ${firstError}; refresh: ${refreshResult.error}`);
          continue;
        }
        const refreshedTarget = refreshResult.target;
        if (refreshedTarget) {
          try {
            await this.applyPermissionsPatchToTarget(refreshedTarget, patch);
            continue;
          } catch (retryErr) {
            failures.push(
              `${target.scopeKey}: ${firstError}; retry: ${
                retryErr instanceof Error ? retryErr.message : String(retryErr)
              }`,
            );
            continue;
          }
        }
        failures.push(`${target.scopeKey}: ${firstError}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Failed to apply relayclaw permissions to live runtimes: ${failures.join('; ')}`);
    }

    return this.getPermissions();
  }

  private async listLiveTargets(): Promise<RelayClawSecurityTarget[]> {
    const providers: RelayClawRuntimeProvider[] = [];
    const targets: RelayClawSecurityTarget[] = [];
    for (const [, service] of this.agentRegistry?.getAllEntries() ?? []) {
      if (!isRelayClawRuntimeProvider(service)) {
        continue;
      }
      providers.push(service);
      this.appendTargetHandles(targets, service.listRelayClawRuntimeHandles(), service);
    }

    if (providers.length === 0 && this.fallbackRuntimeProviderFactory) {
      const fallbackProvider = await this.getFallbackRuntimeProvider();
      providers.push(fallbackProvider);
      this.appendTargetHandles(targets, fallbackProvider.listRelayClawRuntimeHandles(), fallbackProvider);
    }

    if (targets.length > 0) {
      return targets;
    }

    for (const provider of providers) {
      if (!provider.ensureRelayClawRuntimeHandle) {
        continue;
      }
      const runtime = await provider.ensureRelayClawRuntimeHandle();
      this.appendTargetHandles(targets, [runtime], provider);
    }
    return targets;
  }

  private getFallbackRuntimeProvider(): Promise<RelayClawRuntimeProvider> {
    this.fallbackRuntimeProviderPromise ??= this.fallbackRuntimeProviderFactory!();
    return this.fallbackRuntimeProviderPromise;
  }

  private appendTargetHandles(
    targets: RelayClawSecurityTarget[],
    runtimes: RelayClawRuntimeHandle[],
    provider?: RelayClawRuntimeProvider,
  ): void {
    for (const runtime of runtimes) {
      const target = this.targetFromRuntimeHandle(runtime, provider);
      if (target) targets.push(target);
    }
  }

  private targetFromRuntimeHandle(
    runtime: RelayClawRuntimeHandle,
    provider?: RelayClawRuntimeProvider,
  ): RelayClawSecurityTarget | null {
    if (!runtime.resolvedUrl) {
      return null;
    }
    return {
      scopeKey: runtime.scopeKey,
      requestQueues: runtime.requestQueues,
      connection: runtime.connection,
      resolvedUrl: runtime.resolvedUrl,
      provider,
    };
  }

  private async refreshTarget(target: RelayClawSecurityTarget): Promise<RelayClawSecurityTarget | null> {
    if (!target.provider?.ensureRelayClawRuntimeHandle) {
      return null;
    }
    const runtime = await target.provider.ensureRelayClawRuntimeHandle();
    return this.targetFromRuntimeHandle(runtime, target.provider);
  }

  private async tryRefreshTarget(
    target: RelayClawSecurityTarget,
  ): Promise<{ target: RelayClawSecurityTarget | null; error?: string }> {
    try {
      return { target: await this.refreshTarget(target) };
    } catch (err) {
      return {
        target: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async readPermissionsFromTarget(
    target: RelayClawSecurityTarget,
  ): Promise<RelayClawSecurityPermissionsConfig> {
    const [enabled, rw_enabled, tools] = await Promise.all([
      this.getEnabledFromTarget(target),
      this.getWorkspaceRwEnabledFromTarget(target),
      this.getToolsFromTarget(target),
    ]);
    return { enabled, rw_enabled, tools };
  }

  private async applyPermissionsPatchToTarget(
    target: RelayClawSecurityTarget,
    patch: RelayClawSecurityPermissionsConfig,
  ): Promise<void> {
    if (typeof patch.enabled === 'boolean') {
      await this.sendRequestToTarget(target, 'permissions.enabled.set', {
        enabled: patch.enabled,
      });
    }
    if (typeof patch.rw_enabled === 'boolean') {
      await this.sendRequestToTarget(target, 'permissions.file_guard.workspace.rw_enabled.set', {
        rw_enabled: patch.rw_enabled,
      });
    }
    if (patch.tools) {
      for (const [toolName, value] of Object.entries(patch.tools)) {
        if (hasLegacyToolStructure(value)) {
          throw new Error(
            `tool '${toolName}' uses a structured rule config that live runtime editing does not support yet`,
          );
        }
        const decision = readToolDecision(value);
        if (!decision) {
          throw new Error(`tool '${toolName}' is missing a valid permission decision`);
        }
        await this.sendRequestToTarget(target, 'permissions.tools.update', {
          tool: toolName,
          level: decision,
        });
      }
    }
  }

  private async getEnabledFromTarget(target: RelayClawSecurityTarget): Promise<boolean> {
    const frame = await this.sendRequestToTarget(target, 'permissions.enabled.get', {});
    const raw = frame.payload?.enabled;
    if (typeof raw === 'boolean') return raw;
    throw new Error('live runtime did not return permissions.enabled');
  }

  private async getWorkspaceRwEnabledFromTarget(target: RelayClawSecurityTarget): Promise<boolean> {
    const frame = await this.sendRequestToTarget(target, 'permissions.file_guard.workspace.rw_enabled.get', {});
    const raw = frame.payload?.rw_enabled;
    if (typeof raw === 'boolean') return raw;
    throw new Error('live runtime did not return permissions.file_guard.workspace.rw_enabled');
  }

  private async getToolsFromTarget(target: RelayClawSecurityTarget): Promise<Record<string, unknown>> {
    const frame = await this.sendRequestToTarget(target, 'permissions.tools.get', {});
    const payload = frame.payload;
    if (!isRecord(payload)) {
      throw new Error('Failed to load relayclaw permissions');
    }
    if (isRecord(payload.tools)) {
      return payload.tools;
    }
    throw new Error(payload.error || 'live runtime did not return tools');
  }

  private async sendRequestToTarget(
    target: RelayClawSecurityTarget,
    reqMethod: string,
    params: Record<string, unknown>,
  ): Promise<RelayClawAgentResponseFrame> {
    await target.connection.ensureConnected(target.resolvedUrl);

    const requestId = randomUUID();
    const queue = new FrameQueue();
    target.requestQueues.set(requestId, queue);

    try {
      target.connection.send({
        request_id: requestId,
        channel_id: 'web',
        session_id: null,
        req_method: reqMethod,
        params,
        is_stream: false,
        timestamp: Date.now() / 1000,
      });

      const frame = (await queue.take()) as RelayClawAgentResponseFrame | null;
      if (!frame) {
        throw new Error('relayclaw security proxy did not receive a response');
      }
      if (frame.ok === false) {
        throw new Error(frame.payload?.error || `relayclaw ${reqMethod} failed`);
      }
      if (frame.payload?.event_type === 'chat.error') {
        throw new Error(frame.payload?.error || `relayclaw ${reqMethod} failed`);
      }
      return frame;
    } finally {
      target.requestQueues.delete(requestId);
    }
  }
}

export function createRelayClawSecurityClient(
  projectRoot: string,
  agentRegistry?: AgentRegistry,
): RelayClawSecurityClient {
  return new DefaultRelayClawSecurityClient(agentRegistry, async () =>
    createFallbackRelayClawRuntimeProvider(projectRoot),
  );
}

function createFallbackRelayClawRuntimeProvider(projectRoot: string): RelayClawRuntimeProvider {
  const appDir = resolveJiuwenClawAppDir();
  return new RelayClawAgentService({
    agentId: createAgentId('jiuwenclaw'),
    config: {
      autoStart: true,
      executablePath: resolveJiuwenClawExecutable(),
      appDir,
      pythonBin: resolveJiuwenClawPythonBin(undefined, appDir),
      homeDir: join(projectRoot, '.office-claw', 'relayclaw', 'jiuwenclaw'),
      modelName: OFFICE_CLAW_CONFIGS.jiuwenclaw.defaultModel,
    },
  });
}
