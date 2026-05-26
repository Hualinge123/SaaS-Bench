/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Mass Models Routes — 聚合当前已配置的模型列表
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readAcpModelProfiles } from '../config/acp-model-profiles.js';
import {
  HUAWEI_MAAS_MODEL_SOURCE_ID,
  findProjectModelConfigBinding,
  isModelConfigProviderFallbackEnabled,
  readProjectModelConfigBindings,
  normalizeBaseUrlForServiceType,
  resolveProjectModelConfigPath,
  maskModelConfigApiKey,
  type HuaweiAIServiceType,
} from '../config/model-config-profiles.js';
import { readProviderProfiles } from '../config/provider-profiles.js';
import { resolveProtocolCredential } from '../integrations/protocol-credential-adapter.js';
import { findMonorepoRoot } from '../utils/monorepo-root.js';
import { resolveUserId } from '../utils/request-identity.js';
import {
  type ProviderProfilesRoutesOptions,
  projectQuerySchema,
  resolveProjectRoot,
} from './provider-profiles.shared.js';

export interface MassModelInfo {
  id: string;
  name: string;
  provider: string;
  accountRef?: string;
  kind: 'provider' | 'acp';
  protocol?: string;
  enabled: boolean;
  description?: string;
  labels?: string[]; // 标签
  developer?: string; // 提供者
  icon?: string; // 图标 URL
  baseUrl?: string;
  accessMode?: 'huawei_maas_access';
  serviceType?: 'maas' | 'claw-plan';
}

export interface MassModelsResponse {
  projectPath: string;
  models: MassModelInfo[];
}

function shouldRefreshFromHeaders(headers: Record<string, unknown>): boolean {
  const raw = headers['x-refresh'];
  if (Array.isArray(raw)) {
    return raw.some((value) => typeof value === 'string' && /^(1|true)$/i.test(value.trim()));
  }
  return typeof raw === 'string' && /^(1|true)$/i.test(raw.trim());
}

const queryModelsBodySchema = z
  .object({
    baseUrl: z.string().trim().min(1),
    apiKey: z.string().trim().min(1),
  })
  .strict();

function normalizeModelQueryItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

function isBlockedLocalModelHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function buildBearerAuthorizationHeader(apiKey: string): string {
  const normalizedApiKey = apiKey
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .trim();
  return /^bearer\s+/i.test(normalizedApiKey) ? normalizedApiKey : `Bearer ${normalizedApiKey}`;
}

function toQueriedModelList(
  payload: Record<string, unknown>,
  baseUrl?: string,
): Array<{ id: string; name: string; object: string; baseUrl?: string }> {
  const rawModels = normalizeModelQueryItems(payload.data ?? payload.models);
  return rawModels
    .map((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
      const object = typeof item.object === 'string' && item.object.trim() ? item.object.trim() : 'model';
      return { id, name, object, ...(baseUrl ? { baseUrl } : {}) };
    })
    .filter((item) => item.id);
}

function buildMaaSModelBaseUrls(baseUrl: string): string[] {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = new URL(normalizedBaseUrl);
  const pathWithoutVersion = url.pathname.replace(/\/(?:v1|v2)$/i, '').replace(/\/+$/, '');
  return ['v2', 'v1'].map((version) => {
    const next = new URL(url.toString());
    next.pathname = `${pathWithoutVersion}/${version}`;
    return next.toString().replace(/\/+$/, '');
  });
}

function uniqueBaseUrls(baseUrls: string[]): string[] {
  const seen = new Set<string>();
  return baseUrls.filter((baseUrl) => {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildMaaSTestConnectionBaseUrls(baseUrl: string): string[] {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const candidates = [normalizedBaseUrl];
  try {
    const url = new URL(normalizedBaseUrl);
    if (url.hostname.toLowerCase() === 'api.modelarts-maas.com') {
      candidates.push(...buildMaaSModelBaseUrls(normalizedBaseUrl));
    }
  } catch {
    return candidates;
  }
  return uniqueBaseUrls(candidates);
}

function isMaskedApiKey(apiKey?: string): boolean {
  return typeof apiKey === 'string' && /[*•]/.test(apiKey);
}

const MAAS_MAP: Record<string, Partial<MassModelInfo>> = {
  'deepseek-r1-250528': {
    name: 'DeepSeek-R1-0528',
    description:
      'DeepSeek-R1是一款高效智能体模型，具备强大的长文本处理能力和卓越的成本效益，助力企业实现更智能化的应用。',
    labels: ['文本生成', 'Function Call', '深度思考', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'DeepSeek-V3': {
    name: 'DeepSeek-V3',
    description: 'DeepSeek-V3 是一款高性能的 AI 语言模型，专为复杂任务设计，具备强大的文本理解和生成能力。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v3.1-terminus': {
    name: 'DeepSeek-V3.1-128K',
    description: 'DeepSeek-V3.1 是在 DeepSeek-V3.1-Base 的基础上进行后训练得到的。',
    labels: ['文本生成', 'Function Call', '深度思考', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v3.2': {
    name: 'DeepSeek-V3.2',
    description:
      'DeepSeek-V3.2 是一款在计算效率与出色推理及代理能力之间实现出色平衡的模型，整体性能达到了 GPT-5 的水平。',
    labels: ['文本生成', 'Function Call', '深度思考', '160K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'glm-5': {
    name: 'GLM-5',
    description:
      'GLM-5 在各类学术基准测试中实现了显著提升，并在全球所有开源模型中，在推理、编程和智能体任务方面达到顶尖水平。',
    labels: ['文本生成', 'Function Call', '深度思考', '198K'],
    developer: '智谱.AI',
    icon: '/images/zhipu.svg',
  },
  'glm-5.1': {
    name: 'GLM-5.1',
    description:
      'GLM-5.1 是智谱最新旗舰模型，代码能力大大增强，长程任务显著提升，能够在单次任务中持续、自主地工作长达 8 小时，完成从规划、执行到迭代优化的完整闭环，交付工程级成果。',
    labels: ['文本生成', 'Function Call', '深度思考', '198K'],
    developer: '智谱.AI',
    icon: '/images/zhipu.svg',
  },
  'Kimi-K2': {
    name: 'Kimi-K2',
    description: 'Kimi K2 是一款先进的混合专家（MoE）语言模型，拥有 320 亿激活参数和 1 万亿总参数。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: 'Kimi',
    icon: '/images/kimi.svg',
  },
  'longcat-flash-chat': {
    name: 'LongCat-Flash-Chat',
    description:
      '美团LongCat-Flash-Chat，采用高效 MoE 架构，总参数 560B ，激活仅需 18.6B-31.3B ，推理效率更高，适配复杂智能体应用。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: '美团龙猫',
    icon: '/avatars/assistant.svg',
  },
  'qwen3-235b-a22b': {
    name: 'Qwen3-235B-A22B',
    description:
      'Qwen3-235B-A22B是一款因果语言模型，拥有总计2,350亿参数，其中激活220亿参数，非嵌入参数达2,340亿，包含94层结构。',
    labels: ['文本生成', '深度思考', 'Function Call', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-32b': {
    name: 'Qwen3-32B',
    description:
      'Qwen3-32B是一款因果语言模型，拥有328亿参数，其中非嵌入参数为312亿，包含64层结构，采用GQA架构，Q有64个注意力头，KV有8个注意力头。',
    labels: ['文本生成', '深度思考', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-coder-480b-a35b-instruct': {
    name: 'Qwen3-Coder-480B-A35B-Instruct',
    description: 'Qwen3-Coder在Agent编码、Agent浏览器使用和其他基础编码任务中表现出色，成绩可媲美Claude Sonnet。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-30b-a3b': {
    name: 'Qwen3-30B-A3B-128K',
    description: 'Qwen3-30B-A3B是一款因果语言模型，拥有总共305亿参数，其中激活33亿参数，非嵌入参数为299亿。',
    labels: ['文本生成', '深度思考', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
};

export const MAAS_MODEL_WHITELIST = [
  'GLM-5',
  'GLM-5.1',
  'DeepSeek-V3.2',
] as const;

const MAAS_MODEL_WHITELIST_SET = new Set<string>(MAAS_MODEL_WHITELIST);
const MAAS_MODEL_WHITELIST_INDEX = new Map<string, number>(MAAS_MODEL_WHITELIST.map((name, index) => [name, index]));
const MAAS_MAP_BY_NORMALIZED_ID = new Map(
  Object.entries(MAAS_MAP).map(([id, info]) => [id.trim().toLowerCase(), info] as const),
);

function resolveKnownModelInfo(modelId: string): Partial<MassModelInfo> {
  return MAAS_MAP[modelId] ?? MAAS_MAP_BY_NORMALIZED_ID.get(modelId.trim().toLowerCase()) ?? {};
}

function normalizeModelList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }
  return [];
}

function uniqueById(models: MassModelInfo[]): MassModelInfo[] {
  const seen = new Set<string>();
  return models.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mergePayloadModelsById(models: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of models) {
    const rawId = item.id;
    const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : '';
    if (!id || byId.has(id)) continue;
    byId.set(id, item);
  }
  return [...byId.values()];
}

export function toMassModelList(models: Array<Record<string, unknown>>): MassModelInfo[] {
  return models.map((item, index) => {
    const rawId = item.id;
    const rawName = item.name;
    const rawDescription = item.description ?? item.descriptionssss ?? item.desc;
    const modelId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : `maas:${index}`;
    const name =
      typeof rawName === 'string' && rawName.trim()
        ? rawName.trim()
        : typeof rawId === 'string' && rawId.trim()
          ? rawId.trim()
          : modelId;
    return {
      ...item,
      id: `model_config:${HUAWEI_MAAS_MODEL_SOURCE_ID}:${modelId}`,
      name,
      provider: 'Huawei MaaS',
      accountRef: HUAWEI_MAAS_MODEL_SOURCE_ID,
      kind: 'provider',
      protocol: 'huawei_maas',
      enabled: true,
      ...(typeof item.baseUrl === 'string' && item.baseUrl.trim() ? { baseUrl: item.baseUrl.trim() } : {}),
      ...(typeof rawDescription === 'string' && rawDescription.trim() ? { description: rawDescription.trim() } : {}),
      ...(resolveKnownModelInfo(modelId)),
    } satisfies MassModelInfo;
  });
}

export function filterMaaSModelsByWhitelist(models: MassModelInfo[]): MassModelInfo[] {
  return models
    .filter((model) => MAAS_MODEL_WHITELIST_SET.has(model.name))
    .sort((left, right) => {
      const leftIndex = MAAS_MODEL_WHITELIST_INDEX.get(left.name) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = MAAS_MODEL_WHITELIST_INDEX.get(right.name) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
}

function toConfiguredModelList(
  bindings: Array<{
    id: string;
    models: string[];
    displayName?: string;
    description?: string;
    icon?: string;
    protocol?: string;
    baseUrl?: string;
    modelBaseUrls?: Record<string, string>;
    modelDescriptions?: Record<string, string>;
    modelIcons?: Record<string, string>;
    accessMode?: 'huawei_maas_access';
    serviceType?: 'maas' | 'claw-plan';
  }>,
): MassModelInfo[] {
  return bindings.flatMap((binding) =>
    binding.models.map((modelName) => ({
      id: `model_config:${binding.id}:${modelName}`,
      name: modelName,
      provider: binding.protocol === 'huawei_maas' ? 'Huawei MaaS' : binding.displayName?.trim() || binding.id,
      accountRef: binding.id,
      kind: 'provider' as const,
      ...(binding.protocol ? { protocol: binding.protocol } : {}),
      enabled: true,
      ...(binding.modelBaseUrls?.[modelName] || binding.baseUrl
        ? { baseUrl: binding.modelBaseUrls?.[modelName] || binding.baseUrl }
        : {}),
      ...(binding.accessMode ? { accessMode: binding.accessMode } : {}),
      ...(binding.serviceType ? { serviceType: binding.serviceType } : {}),
      description:
        binding.protocol === 'huawei_maas'
          ? '来自 ~/.office-claw/model.json'
          : binding.description?.trim(),
      ...(binding.icon ? { icon: binding.icon } : {}),
      ...(binding.modelDescriptions?.[modelName] ? { description: binding.modelDescriptions[modelName] } : {}),
      ...(binding.modelIcons?.[modelName] ? { icon: binding.modelIcons[modelName] } : {}),
      ...(binding.serviceType === 'claw-plan' ? resolveKnownModelInfo(modelName) : {}),
    })),
  );
}

async function readCachedMaaSModels(modelJsonPath: string): Promise<Array<Record<string, unknown>>> {
  const modelJsonRaw = await readFile(modelJsonPath, 'utf-8');
  if (!modelJsonRaw.trim()) return [];
  const parsed = JSON.parse(modelJsonRaw) as Record<string, unknown>;
  return normalizeModelList(parsed[HUAWEI_MAAS_MODEL_SOURCE_ID]);
}

async function readCachedModelConfig(modelJsonPath: string): Promise<Record<string, unknown>> {
  const modelJsonRaw = await readFile(modelJsonPath, 'utf-8');
  if (!modelJsonRaw.trim()) return {};
  const parsed = JSON.parse(modelJsonRaw) as unknown;
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
}

async function aggregateConfiguredModels(projectRoot: string): Promise<MassModelsResponse> {
  const [providerProfiles, acpModelProfiles] = await Promise.all([
    readProviderProfiles(projectRoot),
    readAcpModelProfiles(projectRoot),
  ]);

  const providerModels = providerProfiles.providers.flatMap((profile) =>
    (profile.models ?? []).map((modelName) => ({
      id: `provider:${profile.id}:${modelName}`,
      name: modelName,
      provider: profile.displayName,
      kind: 'provider' as const,
      ...(profile.protocol ? { protocol: profile.protocol } : {}),
      enabled: true,
      description: `来自 ${profile.displayName}`,
    })),
  );

  const acpModels = acpModelProfiles.profiles.map((profile) => ({
    id: `acp:${profile.id}:${profile.model}`,
    name: profile.model,
    provider: profile.displayName,
    kind: 'acp' as const,
    ...(profile.provider ? { protocol: profile.provider } : {}),
    enabled: true,
    description: `ACP Model Profile · ${profile.displayName}`,
  }));

  return {
    projectPath: projectRoot,
    models: uniqueById([...providerModels, ...acpModels]),
  };
}

export const maasModelsRoutes: FastifyPluginAsync<ProviderProfilesRoutesOptions> = async (app, opts) => {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const handleListModels = async (request: any, reply: any) => {
    const parsed = projectQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query', details: parsed.error.issues };
    }

    const projectRoot = await resolveProjectRoot(parsed.data.projectPath);
    if (!projectRoot) {
      reply.status(400);
      return { error: 'Invalid project path: must be an existing directory under allowed roots' };
    }

    const modelJsonPath = resolveProjectModelConfigPath(projectRoot);
    const modelConfigBindings = (await readProjectModelConfigBindings(projectRoot)) ?? [];
    const configuredNonHuaweiModels = toConfiguredModelList(
      modelConfigBindings.filter((binding) => binding.protocol !== 'huawei_maas'),
    );
    const shouldRefresh = shouldRefreshFromHeaders(request.headers as Record<string, unknown>);

    if (!shouldRefresh) {
      try {
        const cachedModels = await readCachedMaaSModels(modelJsonPath);
        if (cachedModels.length > 0) {
          const filteredMaaSModels = filterMaaSModelsByWhitelist(toMassModelList(cachedModels));
          return {
            success: true,
            list: [...filteredMaaSModels, ...configuredNonHuaweiModels],
            projectPath: projectRoot,
          };
        }
      } catch (readError) {
        if ((readError as { code?: string })?.code !== 'ENOENT') {
          console.warn('读取 model.json 失败，继续调用远程接口:', readError);
        }
      }
    }

    const userId = resolveUserId(request);
    if (userId) {
      try {
        const runtimeConfig = resolveProtocolCredential('huawei_maas', userId);
        if (!runtimeConfig) throw new Error('huawei_maas credential not available');
        const incomingModels: Array<Record<string, unknown>> = [];
        const modelBaseUrls = buildMaaSModelBaseUrls(runtimeConfig.baseUrl);
        let successCount = 0;
        let lastStatus = '';
        for (const baseUrl of modelBaseUrls) {
          const modelResponse = await fetchImpl(`${baseUrl}/models`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json;charset=utf8',
              ...runtimeConfig.defaultHeaders,
            },
          });

          if (!modelResponse.ok) {
            lastStatus = `${modelResponse.status}`;
            continue;
          }

          const data = (await modelResponse.json()) as Record<string, unknown>;
          incomingModels.push(
            ...normalizeModelList(data.data).map((model) => ({
              ...model,
              baseUrl,
            })),
          );
          successCount += 1;
        }
        if (successCount === 0) {
          throw new Error(lastStatus || 'no model endpoint available');
        }
        let existingModels: Array<Record<string, unknown>> = [];

        await mkdir(dirname(modelJsonPath), { recursive: true });
        let existingConfig: Record<string, unknown> = {};
        try {
          existingConfig = await readCachedModelConfig(modelJsonPath);
          existingModels = await readCachedMaaSModels(modelJsonPath);
        } catch (readError) {
          if ((readError as { code?: string })?.code !== 'ENOENT') {
            console.warn('读取 model.json 失败，将以新数据继续写入:', readError);
          }
        }

        const mergedModels = mergePayloadModelsById([...incomingModels, ...existingModels]);
        await writeFile(
          modelJsonPath,
          `${JSON.stringify({ ...existingConfig, [HUAWEI_MAAS_MODEL_SOURCE_ID]: mergedModels }, null, 2)}\n`,
          'utf-8',
        );
        const filteredMaaSModels = filterMaaSModelsByWhitelist(toMassModelList(mergedModels));
        return {
          success: true,
          list: [...filteredMaaSModels, ...configuredNonHuaweiModels],
          projectPath: projectRoot,
        };
      } catch (error) {
        console.error('获取 Huawei MaaS 模型失败，将回退到本地聚合模型列表:', error);
      }
    }

    if (configuredNonHuaweiModels.length > 0) {
      return {
        success: true,
        list: configuredNonHuaweiModels,
        projectPath: projectRoot,
      };
    }

    if (isModelConfigProviderFallbackEnabled()) {
      return await aggregateConfiguredModels(projectRoot);
    }

    return {
      projectPath: projectRoot,
      models: [],
    } satisfies MassModelsResponse;
  };

  app.get('/api/maas-models', handleListModels);

  app.post('/api/maas-models-query', async (request, reply) => {
    const parsed = queryModelsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Missing baseUrl or apiKey', details: parsed.error.issues };
    }

    let modelUrl: URL;
    try {
      modelUrl = new URL(`${buildMaaSModelBaseUrls(parsed.data.baseUrl)[0]}/models`);
    } catch {
      reply.status(400);
      return { error: 'Invalid baseUrl' };
    }

    if (isBlockedLocalModelHost(modelUrl)) {
      reply.status(400);
      return { error: 'Invalid baseUrl: localhost is not allowed' };
    }

    request.log.info({ baseUrlHost: modelUrl.host }, 'maas_models_query_started');

    try {
      const models: Array<{ id: string; name: string; object: string; baseUrl?: string }> = [];
      let firstError: { status: number; body: string } | null = null;
      const authorization = buildBearerAuthorizationHeader(parsed.data.apiKey);
      for (const baseUrl of buildMaaSModelBaseUrls(parsed.data.baseUrl)) {
        const endpoint = `${baseUrl}/models`;
        const response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: {
            Authorization: authorization,
          },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          firstError ??= { status: response.status, body: errorBody };
          request.log.warn({ statusCode: response.status, baseUrlHost: modelUrl.host }, 'maas_models_query_failed');
          continue;
        }

        const payload = (await response.json()) as Record<string, unknown>;
        models.push(...toQueriedModelList(payload, baseUrl));
      }
      const uniqueModels = mergePayloadModelsById(models);
      if (uniqueModels.length === 0 && firstError) {
        reply.status(firstError.status);
        return { error: `HTTP ${firstError.status}: ${firstError.body}` };
      }
      request.log.info({ baseUrlHost: modelUrl.host, modelCount: uniqueModels.length }, 'maas_models_query_success');
      return { models: uniqueModels };
    } catch (error) {
      request.log.warn({ err: error, baseUrlHost: modelUrl.host }, 'maas_models_query_failed');
      reply.status(500);
      return { error: error instanceof Error ? error.message : 'Query failed' };
    }
  });

  app.post('/api/maas-test-connection', async (request, reply) => {
    const { baseUrl, apiKey, model, serviceType, sourceId, projectPath } = request.body as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      serviceType?: string;
      sourceId?: string;
      projectPath?: string;
    };

    let resolvedBaseUrl = baseUrl?.trim();
    let resolvedApiKey = apiKey?.trim();
    const resolvedModel = model?.trim();

    if (sourceId?.trim()) {
      const projectRoot = await resolveProjectRoot(projectPath);
      if (!projectRoot) {
        reply.status(400);
        return { error: 'Invalid project path: must be an existing directory under allowed roots' };
      }
      const binding = await findProjectModelConfigBinding(projectRoot, sourceId);
      if (!binding || binding.protocol !== 'openai') {
        reply.status(404);
        return { error: `model config source "${sourceId}" not found` };
      }
      resolvedBaseUrl = resolvedModel && binding.modelBaseUrls?.[resolvedModel]
        ? binding.modelBaseUrls[resolvedModel]
        : resolvedBaseUrl || binding.baseUrl;
      resolvedApiKey = resolvedApiKey && !isMaskedApiKey(resolvedApiKey) ? resolvedApiKey : binding.apiKey;
    }

    if (!resolvedBaseUrl || !resolvedApiKey) {
      reply.status(400);
      return { error: 'Missing baseUrl or apiKey' };
    }

    // 如果 apiKey 包含脱敏标记 ****，从已保存的配置中读取真实 apiKey
    let effectiveApiKey = resolvedApiKey;
    if (isMaskedApiKey(resolvedApiKey) && sourceId) {
      const projectRoot = await resolveProjectRoot(projectPath ?? '');
      if (projectRoot) {
        const bindings = await readProjectModelConfigBindings(projectRoot);
        const binding = bindings?.find((b) => b.id === sourceId.trim());
        if (binding?.apiKey) {
          const masked = maskModelConfigApiKey(binding.apiKey);
          if (resolvedApiKey === masked) {
            effectiveApiKey = binding.apiKey;
          }
        }
      }
    }

    const authorization = buildBearerAuthorizationHeader(effectiveApiKey);

    // 规范化 baseUrl：根据 serviceType 补全路径
    let normalizedUrl = resolvedBaseUrl.trim().replace(/\/+$/, '');
    if (serviceType === 'maas' || serviceType === 'claw-plan') {
      normalizedUrl = normalizeBaseUrlForServiceType(normalizedUrl, serviceType as HuaweiAIServiceType);
    }

    // 去掉尾部 /chat/completions 或 /models 避免双拼
    normalizedUrl = normalizedUrl.replace(/\/(?:chat\/completions|models)$/i, '');

    request.log.info({ baseUrlHost: new URL(normalizedUrl).host, serviceType }, 'maas_test_connection_started');

    // 第一步：GET /models — 验证连通性和认证，和 /api/maas-models-query 一致
    const modelsEndpoint = `${normalizedUrl}/models`;
    try {
      const modelsRes = await fetch(modelsEndpoint, {
        method: 'GET',
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(15_000),
      });

      if (modelsRes.ok) {
        // 连通且认证有效，如果提供了 model 名则检查是否在模型列表中
        if (resolvedModel) {
          try {
            const payload = (await modelsRes.json()) as Record<string, unknown>;
            const models = toQueriedModelList(payload);
            const found = models.some(
              (m) =>
                m.id.toLowerCase() === resolvedModel.toLowerCase() ||
                m.name.toLowerCase() === resolvedModel.toLowerCase(),
            );
            if (!found && models.length > 0) {
              return { success: true, warning: `模型 "${resolvedModel}" 不在可用列表中，可用模型: ${models.slice(0, 5).map((m) => m.name).join(', ')}` };
            }
          } catch {
            // JSON 解析失败不影响判断连通性成功
          }
        }
        return { success: true };
      }

      // GET /models 返回非 2xx，分情况处理
      // 401/403 → 认证失败（但服务器可达）
      if (modelsRes.status === 401 || modelsRes.status === 403) {
        reply.status(modelsRes.status);
        return { error: `认证失败 (HTTP ${modelsRes.status}): 请检查 API Key 是否正确` };
      }

      // 404 → /models 端点不存在，回退到 POST /chat/completions
      if (modelsRes.status === 404) {
        request.log.info({ baseUrlHost: new URL(normalizedUrl).host }, 'maas_test_connection_models_not_found_fallback');
        const chatEndpoint = `${normalizedUrl}/chat/completions`;
        const chatRes = await fetch(chatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
          },
          body: JSON.stringify({
            model: resolvedModel || 'default',
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (chatRes.ok) {
          return { success: true };
        }
        const chatErrorBody = await chatRes.text();
        reply.status(chatRes.status);
        return { error: `HTTP ${chatRes.status}: ${chatErrorBody}` };
      }

      // 其他非 2xx 状态码
      const errorBody = await modelsRes.text();
      reply.status(modelsRes.status);
      return { error: `HTTP ${modelsRes.status}: ${errorBody}` };
    } catch (error) {
      request.log.warn({ err: error }, 'maas_test_connection_failed');
      reply.status(500);
      return { error: error instanceof Error ? error.message : '连接失败，请检查 Base URL 是否正确' };
    }
  });

  app.post('/api/maas-send', async (_request, reply) => {
    reply.status(410);
    return {
      error: 'OfficeClaw no longer proxies Huawei MaaS model calls. Runtime auth is passed to downstream agents.',
    };
  });
};
