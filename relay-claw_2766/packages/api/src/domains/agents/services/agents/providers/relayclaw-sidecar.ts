/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import type { AgentId, RelayClawAgentConfig } from '@openjiuwen/relay-shared';
import { createModuleLogger } from '../../../../../infrastructure/logger.js';
import { getLongTermMemoryEnabled } from '../../../../../config/memory-toggle-state.js';
import { readRuntimeEnvValue } from '../../../../../config/runtime-env-store.js';
import { withBundledPythonPath } from '../../../../../utils/bundled-python-env.js';
import { resolveOfficeClawHostRoot } from '../../../../../utils/office-claw-root.js';
import { findMonorepoRoot } from '../../../../../utils/monorepo-root.js';
import {
  resolveJiuwenClawAppDir,
  resolveJiuwenClawExecutable,
  resolveJiuwenClawPythonBin,
} from '../../../../../utils/jiuwenclaw-paths.js';
import {
  buildRelayClawAppSignature,
  resolveRelayClawDisabledSkills,
  resolveRelayClawSharedSkillsDirs,
} from '../../../../../utils/relayclaw-skills.js';
import { resolveUserSkillsRoot } from '../../skillhub/SkillPaths.js';
import { tcpProbe } from '../../../../../utils/tcp-probe.js';
import type { AgentServiceOptions } from '../../types.js';
import {
  buildOfficeClawMcpEnv,
  RELAYCLAW_EXCLUDED_OFFICE_CLAW_MCP_TOOLS,
  RELAYCLAW_EXCLUDED_OFFICE_CLAW_MCP_TOOLS_ENV,
  resolveOfficeClawMcpServer,
} from './relayclaw-office-claw-mcp.js';

const log = createModuleLogger('relayclaw-sidecar');
const SEARCH_API_KEY_ENV_NAMES = ['BOCHA_API_KEY', 'JINA_API_KEY', 'PERPLEXITY_API_KEY', 'SERPER_API_KEY'] as const;

function hashOptionalEnvValue(value: string | undefined): string {
  return value ? createHash('sha256').update(value).digest('hex') : '';
}

export interface RelayClawSidecarRuntime {
  executablePath: string;
  pythonBin: string;
  appDir: string;
  useExecutable: boolean;
  homeDir: string;
  agentPort: number;
  webPort: number;
  env: Record<string, string>;
  signature: Record<string, string | number | boolean>;
}

export interface RelayClawLaunchCommand {
  command: string;
  args: string[];
  cwd: string;
}

export interface RelayClawSidecarController {
  ensureStarted(options?: AgentServiceOptions, signal?: AbortSignal): Promise<string>;
  isCurrentRuntime(options?: AgentServiceOptions): Promise<boolean>;
  /** @param reason Diagnostic tag for logs (e.g. runtime_signature_changed). */
  stop(reason?: string): void;
  getRecentLogs(): string;
  getDiagnostics(): RelayClawSidecarDiagnostics;
}

export interface RelayClawSidecarDiagnostics {
  lastStopReason?: string;
  lastSignatureDiff?: Record<string, { old: unknown; new: unknown }>;
  lastStartSummary?: {
    sidecarPid?: number;
    agentPort?: number;
    webPort?: number;
    startCount?: number;
    startedAt?: number;
  };
  lastExitSummary?: {
    code?: number | null;
    exitSignal?: string | null;
    uptimeMs?: number;
    logTail?: string;
  };
  recentLogTail?: string;
}

export interface RelayClawSidecarControllerDeps {
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  tcpProbeFn?: typeof tcpProbe;
  allocatePort?: () => Promise<number>;
}

export class DefaultRelayClawSidecarController implements RelayClawSidecarController {
  private readonly agentId: AgentId;
  private readonly config: RelayClawAgentConfig;
  private readonly spawnFn: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  private readonly tcpProbeFn: typeof tcpProbe;
  private readonly allocatePort: () => Promise<number>;
  private child: ChildProcess | null = null;
  private bootPromise: Promise<void> | null = null;
  private runtimeHash: string | null = null;
  private resolvedUrl: string | null = null;
  private recentLogs = '';
  private lastSignature: Record<string, string | number | boolean> | null = null;
  private startCount = 0;
  private lastStopReason: string | null = null;
  private lastSignatureDiff: Record<string, { old: unknown; new: unknown }> | null = null;
  private lastStartSummary: RelayClawSidecarDiagnostics['lastStartSummary'] | null = null;
  private lastExitSummary: RelayClawSidecarDiagnostics['lastExitSummary'] | null = null;

  constructor(agentId: AgentId, config: RelayClawAgentConfig, deps?: RelayClawSidecarControllerDeps) {
    this.agentId = agentId;
    this.config = config;
    this.spawnFn = deps?.spawnFn ?? ((command, args, options) => spawn(command, args, options));
    this.tcpProbeFn = deps?.tcpProbeFn ?? tcpProbe;
    this.allocatePort = deps?.allocatePort ?? findOpenPort;
  }

  async ensureStarted(options?: AgentServiceOptions, signal?: AbortSignal): Promise<string> {
    const runtime = this.buildRuntime(options);
    const runtimeHash = createHash('sha256').update(JSON.stringify(runtime.signature)).digest('hex');
    const childAlive = this.child?.killed === false && this.child.exitCode === null;

    if (childAlive && this.runtimeHash === runtimeHash && this.resolvedUrl) {
      const parsed = new URL(this.resolvedUrl);
      const port = Number.parseInt(parsed.port, 10);
      if (port > 0 && (await this.tcpProbeFn(parsed.hostname, port, 400))) {
        log.debug({ agentId: this.agentId, sidecarPid: this.child?.pid, port }, 'relayclaw sidecar reused (cache hit)');
        return this.resolvedUrl;
      }
      log.warn(
        { agentId: this.agentId, sidecarPid: this.child?.pid, port },
        'relayclaw sidecar alive but tcp probe failed — will restart',
      );
    }

    if (this.child && this.runtimeHash !== runtimeHash) {
      const diff: Record<string, { old: unknown; new: unknown }> = {};
      const allKeys = new Set([...Object.keys(this.lastSignature ?? {}), ...Object.keys(runtime.signature)]);
      for (const key of allKeys) {
        const oldVal = this.lastSignature?.[key];
        const newVal = runtime.signature[key];
        if (oldVal !== newVal) diff[key] = { old: oldVal, new: newVal };
      }
      this.lastSignatureDiff = diff;
      log.warn(
        { agentId: this.agentId, sidecarPid: this.child?.pid, signatureDiff: diff },
        'relayclaw sidecar runtime signature changed — restarting',
      );
      this.stop('runtime_signature_changed');
    }

    if (this.bootPromise) {
      await this.bootPromise;
      return this.resolvedUrl!;
    }

    this.bootPromise = this.start(runtime, signal);
    try {
      await this.bootPromise;
      return this.resolvedUrl!;
    } finally {
      this.bootPromise = null;
    }
  }

  async isCurrentRuntime(options?: AgentServiceOptions): Promise<boolean> {
    const runtime = this.buildRuntime(options);
    const runtimeHash = createHash('sha256').update(JSON.stringify(runtime.signature)).digest('hex');
    const childAlive = this.child?.killed === false && this.child.exitCode === null;
    if (!childAlive || this.runtimeHash !== runtimeHash || !this.resolvedUrl) {
      return false;
    }

    try {
      const parsed = new URL(this.resolvedUrl);
      const port = Number.parseInt(parsed.port, 10);
      return port > 0 && (await this.tcpProbeFn(parsed.hostname, port, 400));
    } catch {
      return false;
    }
  }

  stop(reason = 'unspecified'): void {
    const child = this.child;
    const willKill = Boolean(child && child.exitCode === null);
    this.lastStopReason = reason;
    if (reason !== 'runtime_signature_changed') {
      this.lastSignatureDiff = null;
    }
    log.warn(
      {
        agentId: this.agentId,
        sidecarPid: child?.pid,
        willKill,
        reason,
      },
      'relayclaw sidecar stop invoked',
    );
    if (willKill && child) {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    }
    this.child = null;
    this.runtimeHash = null;
    this.resolvedUrl = null;
  }

  getRecentLogs(): string {
    return this.recentLogs;
  }

  getDiagnostics(): RelayClawSidecarDiagnostics {
    return {
      ...(this.lastStopReason ? { lastStopReason: this.lastStopReason } : {}),
      ...(this.lastSignatureDiff ? { lastSignatureDiff: this.lastSignatureDiff } : {}),
      ...(this.lastStartSummary ? { lastStartSummary: this.lastStartSummary } : {}),
      ...(this.lastExitSummary ? { lastExitSummary: this.lastExitSummary } : {}),
      ...(this.recentLogs ? { recentLogTail: summarizeLogs(this.recentLogs) } : {}),
    };
  }

  private buildRuntime(options?: AgentServiceOptions): RelayClawSidecarRuntime {
    const callbackEnv = options?.callbackEnv ?? {};
    const appDir = resolveJiuwenClawAppDir(this.config.appDir);
    const executablePath = resolveJiuwenClawExecutable(this.config.executablePath);
    const pythonBin = resolveJiuwenClawPythonBin(this.config.pythonBin, appDir);
    const useExecutable = existsSync(executablePath);
    const homeDir = this.config.homeDir?.trim() || join(findMonorepoRoot(), '.office-claw', 'relayclaw', this.agentId as string);
    const officeClawDataDirEnv = resolve((process.env.OFFICE_CLAW_DATA_DIR ?? '').trim() || join(homedir(), '.office-claw'));
    const jiuwenclawDataDir = resolve(
      (process.env.JIUWENCLAW_DATA_DIR ?? '').trim() || join(officeClawDataDirEnv, '.jiuwenclaw'),
    );
    const apiKey = callbackEnv.API_KEY || callbackEnv.OPENAI_API_KEY || callbackEnv.OPENROUTER_API_KEY || '';
    const apiBase = callbackEnv.API_BASE || callbackEnv.OPENAI_BASE_URL || callbackEnv.OPENAI_API_BASE || '';
    const embedApiKey = callbackEnv.EMBED_API_KEY || callbackEnv.EMBED_KEY || apiKey;
    const embedApiBase = callbackEnv.EMBED_API_BASE || callbackEnv.EMBED_BASE_URL || callbackEnv.EMBED_BASE || apiBase;
    const embedModel = callbackEnv.EMBED_MODEL || callbackEnv.EMBEDDING_MODEL || 'text-embedding-v3';
    const defaultHeaders = callbackEnv.default_headers || callbackEnv.OPENAI_DEFAULT_HEADERS || '';
    const provider = apiBase.includes('openrouter.ai') ? 'OpenRouter' : 'OpenAI';
    const longTermMemoryEnabled = getLongTermMemoryEnabled();
    const memoryEngine = longTermMemoryEnabled ? 'builtin' : 'none';
    const modelName = this.config.modelName?.trim() || 'gpt-5.4';
    const projectDir = options?.workingDirectory?.trim() || '';
    const projectRoot = projectDir || process.cwd();
    const hostRoot = resolveOfficeClawHostRoot(projectRoot);
    const officeClawMcp = resolveOfficeClawMcpServer(options?.workingDirectory);
    const sharedSkillDirs = [...resolveRelayClawSharedSkillsDirs(), resolveUserSkillsRoot(hostRoot)];
    const disabledSkills = resolveRelayClawDisabledSkills(projectRoot, this.agentId as string);
    const visionApiKey = callbackEnv.VISION_API_KEY || '';
    const visionApiBase = callbackEnv.VISION_API_BASE || '';
    const visionProvider = callbackEnv.VISION_PROVIDER || '';
    const visionModelName = callbackEnv.VISION_MODEL_NAME || '';
    const visionDefaultHeaders = callbackEnv.VISION_DEFAULT_HEADERS || '';
    const imageGenApiKey = callbackEnv.IMAGE_GEN_API_KEY || '';
    const imageGenApiBase = callbackEnv.IMAGE_GEN_API_BASE || '';
    const imageGenProvider = callbackEnv.IMAGE_GEN_PROVIDER || '';
    const imageGenModelName = callbackEnv.IMAGE_GEN_MODEL_NAME || '';
    const imageGenDefaultHeaders = callbackEnv.IMAGE_GEN_DEFAULT_HEADERS || '';

    const modelContextWindowRaw = (
      callbackEnv.MODEL_CONTEXT_WINDOW ??
      ''
    ).trim();
    const modelContextWindowParsed = /^\d+$/.test(modelContextWindowRaw)
      ? Number.parseInt(modelContextWindowRaw, 10)
      : Number.NaN;
    const modelContextWindow =
      Number.isFinite(modelContextWindowParsed) && modelContextWindowParsed > 0 ? modelContextWindowParsed : undefined;

    return {
      executablePath,
      pythonBin,
      appDir,
      useExecutable,
      homeDir,
      agentPort: this.config.agentPort ?? 0,
      webPort: this.config.webPort ?? 0,
      env: {
        HOME: homeDir,
        JIUWENCLAW_DATA_DIR: jiuwenclawDataDir,
        PYTHONUNBUFFERED: '1',
        WEB_HOST: '127.0.0.1',
        API_KEY: apiKey,
        API_BASE: apiBase,
        MEMORY_ENGINE: memoryEngine,
        EMBED_API_KEY: embedApiKey,
        EMBED_API_BASE: embedApiBase,
        EMBED_MODEL: embedModel,
        ...(defaultHeaders ? { default_headers: defaultHeaders } : {}),
        MODEL_NAME: modelName,
        MODEL_PROVIDER: provider,
        ...(modelContextWindow !== undefined ? { MODEL_CONTEXT_WINDOW: String(modelContextWindow) } : {}),
        JIUWENCLAW_AGENT_ROOT: join(homeDir, 'agent'),
        JIUWENCLAW_RUNTIME_SKILLS_DIR: join(projectRoot, '.office-claw', 'relayclaw-skill-cache', this.agentId as string),
        ...(projectDir ? { JIUWENCLAW_PROJECT_DIR: projectDir } : {}),
        ...(sharedSkillDirs.length > 0 ? { JIUWENCLAW_SHARED_SKILLS_DIRS: sharedSkillDirs.join(delimiter) } : {}),
        ...(this.config.skills && this.config.skills.length > 0 ? { ENABLED_SKILLS: this.config.skills.join(',') } : {}),
        ...(disabledSkills.length > 0 ? { JIUWENCLAW_DISABLED_SKILLS: disabledSkills.join(',') } : {}),
        [RELAYCLAW_EXCLUDED_OFFICE_CLAW_MCP_TOOLS_ENV]: RELAYCLAW_EXCLUDED_OFFICE_CLAW_MCP_TOOLS.join(','),
        ...(officeClawMcp
          ? {
              OFFICE_CLAW_MCP_SERVER_PATH: officeClawMcp.serverPath,
              OFFICE_CLAW_MCP_COMMAND: officeClawMcp.command,
              OFFICE_CLAW_MCP_ARGS_JSON: JSON.stringify(officeClawMcp.args),
              OFFICE_CLAW_MCP_CWD: officeClawMcp.repoRoot,
            }
          : {}),
        ...(visionApiKey && visionApiBase && visionProvider && visionModelName
          ? {
              VISION_API_KEY: visionApiKey,
              VISION_API_BASE: visionApiBase,
              VISION_PROVIDER: visionProvider,
              VISION_MODEL_NAME: visionModelName,
              ...(visionDefaultHeaders ? { VISION_DEFAULT_HEADERS: visionDefaultHeaders } : {}),
            }
          : {}),
        ...(imageGenApiKey && imageGenApiBase && imageGenProvider && imageGenModelName
          ? {
              IMAGE_GEN_API_KEY: imageGenApiKey,
              IMAGE_GEN_API_BASE: imageGenApiBase,
              IMAGE_GEN_PROVIDER: imageGenProvider,
              IMAGE_GEN_MODEL_NAME: imageGenModelName,
              ...(imageGenDefaultHeaders ? { IMAGE_GEN_DEFAULT_HEADERS: imageGenDefaultHeaders } : {}),
            }
          : {}),
        ...buildOfficeClawMcpEnv(callbackEnv),
        // OpenTelemetry configuration for sidecar agentserver
        OTEL_ENABLED: 'true',
        OTEL_TRACES_EXPORTER: 'console',
        OTEL_METRICS_EXPORTER: 'console',
        OTEL_SERVICE_NAME: `jiuwenclaw-agentserver-${this.agentId}`,
        OTEL_LOG_MESSAGES: 'true',
      },
      signature: {
        executablePath,
        useExecutable,
        pythonBin,
        appDir,
        homeDir,
        officeClawDataDir: officeClawDataDirEnv,
        appSignature: buildRelayClawAppSignature(appDir),
        apiBase,
        defaultHeaders,
        modelName,
        provider,
        memoryEngine,
        embedApiBase,
        embedModel,
        embedKeyHash: embedApiKey ? createHash('sha256').update(embedApiKey).digest('hex') : '',
        ...Object.fromEntries(
          SEARCH_API_KEY_ENV_NAMES.map((name) => [name, hashOptionalEnvValue(readRuntimeEnvValue(name))]),
        ),
        modelContextWindow: modelContextWindow ?? 0,
        officeClawMcpPath: officeClawMcp?.serverPath ?? '',
        keyHash: apiKey ? createHash('sha256').update(apiKey).digest('hex') : '',
      },
    };
  }

  private async start(runtime: RelayClawSidecarRuntime, signal?: AbortSignal): Promise<void> {
    mkdirSync(runtime.homeDir, { recursive: true });
    const agentPort = runtime.agentPort || (await this.allocatePort());
    const webPort = runtime.webPort || (await this.allocatePort());
    this.resolvedUrl = `ws://127.0.0.1:${agentPort}`;
    this.recentLogs = '';

    const launchCommand = buildRelayClawLaunchCommand(runtime);

    // Windows Python: force UTF-8 and prepend bundled Python to PATH
    const spawnEnv: Record<string, string | undefined> = {
      ...process.env,
      ...runtime.env,
      AGENT_PORT: String(agentPort),
      WEB_PORT: String(webPort),
    };
    if (process.platform === 'win32') {
      spawnEnv.PYTHONIOENCODING = 'utf-8';
      spawnEnv.PYTHONUTF8 = '1';
      Object.assign(spawnEnv, withBundledPythonPath(spawnEnv, resolveOfficeClawHostRoot(process.cwd())));
    }

    const visionEnv = {
      VISION_API_KEY: spawnEnv.VISION_API_KEY ?? '[NOT SET]',
      VISION_API_BASE: spawnEnv.VISION_API_BASE ?? '[NOT SET]',
      VISION_PROVIDER: spawnEnv.VISION_PROVIDER ?? '[NOT SET]',
      VISION_MODEL_NAME: spawnEnv.VISION_MODEL_NAME ?? '[NOT SET]',
    };
    const imageGenEnv = {
      IMAGE_GEN_API_KEY: spawnEnv.IMAGE_GEN_API_KEY ?? '[NOT SET]',
      IMAGE_GEN_API_BASE: spawnEnv.IMAGE_GEN_API_BASE ?? '[NOT SET]',
      IMAGE_GEN_PROVIDER: spawnEnv.IMAGE_GEN_PROVIDER ?? '[NOT SET]',
      IMAGE_GEN_MODEL_NAME: spawnEnv.IMAGE_GEN_MODEL_NAME ?? '[NOT SET]',
    };
    const mainModelEnv = {
      API_KEY: spawnEnv.API_KEY ?? '[NOT SET]',
      API_BASE: spawnEnv.API_BASE ?? '[NOT SET]',
      MODEL_NAME: spawnEnv.MODEL_NAME ?? '[NOT SET]',
      MODEL_PROVIDER: spawnEnv.MODEL_PROVIDER ?? '[NOT SET]',
    };
    log.info({ agentId: this.agentId, mainModelEnv, visionEnv, imageGenEnv }, 'Multimodal env for jiuwenclaw');

    const child = this.spawnFn(launchCommand.command, launchCommand.args, {
      cwd: launchCommand.cwd,
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.runtimeHash = createHash('sha256').update(JSON.stringify(runtime.signature)).digest('hex');
    this.lastSignature = { ...runtime.signature };
    this.startCount++;
    const sidecarPid = child.pid;
    this.lastStartSummary = {
      sidecarPid,
      agentPort,
      webPort,
      startCount: this.startCount,
      startedAt: Date.now(),
    };
    log.info(
      {
        agentId: this.agentId,
        sidecarPid,
        agentPort,
        webPort,
        startCount: this.startCount,
        command: launchCommand.command,
        args: launchCommand.args,
        cwd: launchCommand.cwd,
      },
      'relayclaw sidecar spawned',
    );

    let pendingSidecarLine = '';
    let telemetryJsonBuffer = '';
    let telemetryJsonDepth = 0;

    const flushTelemetryJsonBuffer = () => {
      const block = telemetryJsonBuffer.trim();
      telemetryJsonBuffer = '';
      telemetryJsonDepth = 0;
      if (shouldForwardSidecarTelemetryJson(block)) {
        log.info({ sidecarPid }, `[SIDECAR] ${block}`);
      }
    };

    const processSidecarLogLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Forward USAGE_DEBUG lines (debug level)
      if (trimmed.includes('USAGE_DEBUG')) {
        log.debug({ sidecarPid }, `[SIDECAR] ${trimmed}`);
      }
      // Forward telemetry initialization lines (info level)
      if (trimmed.includes('[Telemetry]')) {
        log.info({ sidecarPid }, `[SIDECAR] ${trimmed}`);
      }

      if (telemetryJsonBuffer || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        telemetryJsonBuffer += `${line}\n`;
        telemetryJsonDepth += getJsonDelimiterDelta(line);
        if (telemetryJsonDepth <= 0) {
          flushTelemetryJsonBuffer();
        }
      }
    };

    const pushLog = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      this.recentLogs = `${this.recentLogs}${text}`.slice(-8000);
      const lines = `${pendingSidecarLine}${text}`.split(/\r?\n/);
      pendingSidecarLine = lines.pop() ?? '';
      // Forward sidecar telemetry and USAGE_DEBUG lines to API logger.
      for (const line of lines) {
        processSidecarLogLine(line);
      }
    };
    child.stdout?.on('data', pushLog);
    child.stderr?.on('data', pushLog);
    const spawnedAt = Date.now();
    child.once('exit', (code, exitSignal) => {
      if (this.child !== child) {
        return;
      }
      const uptimeMs = Date.now() - spawnedAt;
      const tail = summarizeLogs(this.recentLogs);
      this.lastStopReason = 'process_exited';
      this.lastSignatureDiff = null;
      this.lastExitSummary = {
        code,
        exitSignal: exitSignal ?? null,
        uptimeMs,
        ...(tail ? { logTail: tail } : {}),
      };
      log.warn(
        {
          agentId: this.agentId,
          sidecarPid,
          code,
          exitSignal,
          uptimeMs,
          startCount: this.startCount,
          logChars: this.recentLogs.length,
          ...(tail ? { logTail: tail } : {}),
          ...(this.recentLogs.length > 0 ? { stderrPreview: this.recentLogs.slice(-1500) } : {}),
        },
        'relayclaw sidecar exited',
      );
      this.child = null;
      this.runtimeHash = null;
      this.resolvedUrl = null;
    });

    if (signal?.aborted) {
      this.stop('startup_aborted_signal');
      throw new Error('jiuwen sidecar startup aborted');
    }

    const startupTs = Date.now();
    const timeoutAt = startupTs + (this.config.startupTimeoutMs ?? 180_000);
    let tcpReady = false;
    let appReady = false;
    while (Date.now() < timeoutAt) {
      if (signal?.aborted) {
        this.stop('startup_aborted_signal');
        throw new Error('jiuwen sidecar startup aborted');
      }
      if (!this.child || this.child.exitCode !== null) {
        const tail = summarizeLogs(this.recentLogs);
        log.warn(
          {
            agentId: this.agentId,
            sidecarPid,
            exitCode: this.child?.exitCode ?? null,
            logChars: this.recentLogs.length,
            ...(tail ? { logTail: tail } : {}),
            ...(this.recentLogs.length > 0 ? { stderrPreview: this.recentLogs.slice(-1500) } : {}),
          },
          'relayclaw sidecar startup failed: process exited before ready',
        );
        throw new Error(`jiuwen sidecar exited during startup${this.recentLogs ? `: ${tail}` : ''}`);
      }

      // Stage 1: TCP probe on agent port
      if (!tcpReady && (await this.tcpProbeFn('127.0.0.1', agentPort, 400))) {
        tcpReady = true;
        log.info({ agentId: this.agentId, agentPort, elapsedMs: Date.now() - startupTs }, 'jiuwen sidecar tcp_ready');
      }
      // Stage 2: App-level readiness (log marker)
      if (tcpReady && !appReady && isSidecarReady(this.recentLogs)) {
        appReady = true;
        log.info({ agentId: this.agentId, elapsedMs: Date.now() - startupTs }, 'jiuwen sidecar app_ready');
      }

      if (await isRelayClawRuntimeReady(this.tcpProbeFn, this.recentLogs, agentPort)) {
        log.info(
          { agentId: this.agentId, agentPort, webPort, elapsedMs: Date.now() - startupTs },
          'jiuwen sidecar fully ready',
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const tail = summarizeLogs(this.recentLogs);
    log.warn(
      {
        agentId: this.agentId,
        sidecarPid,
        exitCode: this.child?.exitCode ?? null,
        logChars: this.recentLogs.length,
        ...(tail ? { logTail: tail } : {}),
        ...(this.recentLogs.length > 0 ? { stderrPreview: this.recentLogs.slice(-1500) } : {}),
      },
      'relayclaw sidecar startup failed: readiness timeout',
    );
    this.stop('readiness_timeout');
    throw new Error(`jiuwen sidecar did not become ready in time${this.recentLogs ? `: ${tail}` : ''}`);
  }
}

export function buildRelayClawLaunchCommand(runtime: RelayClawSidecarRuntime): RelayClawLaunchCommand {
  if (runtime.useExecutable) {
    return {
      command: runtime.executablePath,
      args: ['--desktop-run-agentserver'],
      cwd: dirname(runtime.executablePath),
    };
  }

  return {
    command: runtime.pythonBin,
    args: ['-m', 'jiuwenclaw.app_agentserver'],
    cwd: runtime.appDir,
  };
}

export async function isRelayClawRuntimeReady(
  tcpProbeFn: typeof tcpProbe,
  recentLogs: string,
  agentPort: number,
): Promise<boolean> {
  if (!(await tcpProbeFn('127.0.0.1', agentPort, 400))) {
    return false;
  }
  if (isSidecarReady(recentLogs)) {
    return true;
  }
  return true;
}

export function isSidecarReady(recentLogs: string): boolean {
  return (
    recentLogs.includes('[JiuWenClawDeepAdapter] 初始化完成') ||
    recentLogs.includes('JiuWenClawDeepAdapter] 初始化完成')
  );
}

export function summarizeLogs(recentLogs: string): string {
  return recentLogs
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join(' | ');
}

export function shouldForwardSidecarTelemetryJson(block: string): boolean {
  return (
    block.includes('"trace_id"') ||
    block.includes('"span_id"') ||
    block.includes('"parent_id"') ||
    block.includes('"resource_metrics"') ||
    block.includes('"scope_metrics"')
  );
}

export function getJsonDelimiterDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let escaping = false;
  for (const char of line) {
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{' || char === '[') delta++;
    if (char === '}' || char === ']') delta--;
  }
  return delta;
}

async function findOpenPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate relayclaw port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}
