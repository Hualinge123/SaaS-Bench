import type { CredentialResolutionContext } from '@openjiuwen/relay-core';
import { createModuleLogger } from '../../infrastructure/logger.js';
import { resolveProtocolCredential } from '../../integrations/protocol-credential-adapter.js';
import { resolveRelayModelContextWindow } from '../relay-model-context-window.js';
import {
  OC_API_KEY_ENV,
  OC_BASE_URL_ENV,
  writeOpenCodeRuntimeConfig,
} from '../../domains/agents/services/agents/providers/opencode-config-template.js';
import {
  buildAnthropicProtocolEnv,
  buildGoogleProtocolEnv,
  buildHuaweiMaaSProtocolEnv,
  buildOpenAiProtocolEnv,
} from './protocol-credential-helpers.js';

const log = createModuleLogger('builtin-credential-resolvers');

export async function resolveAnthropicCredentialEnv(ctx: CredentialResolutionContext): Promise<Record<string, string>> {
  return buildAnthropicProtocolEnv(ctx);
}

export function resolveOpenAiCredentialEnv(ctx: CredentialResolutionContext): Record<string, string> {
  return buildOpenAiProtocolEnv(ctx);
}

export function resolveGoogleCredentialEnv(ctx: CredentialResolutionContext): Record<string, string> {
  return buildGoogleProtocolEnv(ctx);
}

function requireProtocolCredential(userId: string) {
  const result = resolveProtocolCredential('huawei_maas', userId);
  if (!result) throw new Error('huawei_maas protocol configured but credential not available');
  return result;
}

export async function resolveDareCredentialEnv(ctx: CredentialResolutionContext): Promise<Record<string, string>> {
  const base =
    ctx.effectiveProtocol === 'huawei_maas'
      ? buildHuaweiMaaSProtocolEnv(requireProtocolCredential, ctx)
      : ctx.effectiveProtocol === 'openai'
        ? buildOpenAiProtocolEnv(ctx)
        : ctx.effectiveProtocol === 'anthropic'
          ? await buildAnthropicProtocolEnv(ctx)
          : {};

  const overlay: Record<string, string> = {};
  if (ctx.effectiveProtocol === 'huawei_maas' || ctx.modelConfigBinding?.protocol === 'openai') {
    overlay.OFFICE_CLAW_DARE_ADAPTER = 'openai';
    if (base.OPENAI_API_KEY) overlay.DARE_API_KEY = base.OPENAI_API_KEY;
    if (base.OPENAI_BASE_URL) overlay.DARE_ENDPOINT = base.OPENAI_BASE_URL;
  } else if (ctx.resolvedAccount?.authType === 'api_key') {
    if (ctx.resolvedAccount.protocol) overlay.OFFICE_CLAW_DARE_ADAPTER = ctx.resolvedAccount.protocol;
    if (ctx.resolvedAccount.apiKey) overlay.DARE_API_KEY = ctx.resolvedAccount.apiKey;
    if (ctx.resolvedAccount.baseUrl) overlay.DARE_ENDPOINT = ctx.resolvedAccount.baseUrl;
  }

  return { ...base, ...overlay };
}

export async function resolveOpenCodeCredentialEnv(ctx: CredentialResolutionContext): Promise<Record<string, string>> {
  const base = await buildAnthropicProtocolEnv(ctx);

  const ocProviderName = ctx.agentConfig?.ocProviderName?.trim();
  if (ctx.resolvedAccount?.authType !== 'api_key' || !ocProviderName || !ctx.defaultModel) return base;

  const assembledModel = ctx.defaultModel.startsWith(`${ocProviderName}/`)
    ? ctx.defaultModel
    : `${ocProviderName}/${ctx.defaultModel}`;
  base.OFFICE_CLAW_ANTHROPIC_MODEL_OVERRIDE = assembledModel;

  try {
    const apiType: 'openai' | 'anthropic' | 'google' =
      ocProviderName === 'anthropic' ? 'anthropic' : ocProviderName === 'google' ? 'google' : 'openai';
    const rawModels = ctx.resolvedAccount.models ?? [ctx.defaultModel];
    const prefix = `${ocProviderName}/`;
    const bareModels = rawModels.map((m: string) => (m.startsWith(prefix) ? m.slice(prefix.length) : m));
    const configPath = writeOpenCodeRuntimeConfig(ctx.configProjectRoot, ctx.agentId as string, {
      providerName: ocProviderName,
      models: bareModels,
      defaultModel: assembledModel,
      apiType,
      hasBaseUrl: !!ctx.resolvedAccount.baseUrl,
    });
    base.OPENCODE_CONFIG = configPath;
    if (ctx.resolvedAccount.apiKey) base[OC_API_KEY_ENV] = ctx.resolvedAccount.apiKey;
    if (ctx.resolvedAccount.baseUrl) base[OC_BASE_URL_ENV] = ctx.resolvedAccount.baseUrl;
    log.debug(
      { agentId: ctx.agentId, configPath, provider: ocProviderName, apiType },
      'OpenCode runtime config written',
    );
  } catch (err) {
    log.warn({ agentId: ctx.agentId, err }, 'Failed to write OpenCode runtime config — falling back to env vars');
  }

  return base;
}

export function resolveRelayClawCredentialEnv(ctx: CredentialResolutionContext): Record<string, string> {
  const base =
    ctx.effectiveProtocol === 'huawei_maas'
      ? buildHuaweiMaaSProtocolEnv(requireProtocolCredential, ctx)
      : buildOpenAiProtocolEnv(ctx);

  const relayCtx = resolveRelayModelContextWindow({
    defaultModel: ctx.defaultModel,
    embeddedAcpContextWindow: ctx.agentConfig?.embeddedAcpConfig?.contextWindow,
  });
  if (relayCtx != null && relayCtx > 0) {
    base.MODEL_CONTEXT_WINDOW = String(relayCtx);
  }

  if (ctx.imageModel && ctx.imageAccountBinding) {
    const { apiKey, baseUrl, headers, protocol, modelBaseUrls } = ctx.imageAccountBinding;
    const visionModelBaseUrl =
      ctx.imageModel && modelBaseUrls
        ? modelBaseUrls[ctx.imageModel]
        : undefined;
    const visionBaseUrl = visionModelBaseUrl?.trim() || baseUrl;
    if (apiKey) {
      base.VISION_API_KEY = apiKey;
    }
    if (visionBaseUrl) {
      base.VISION_API_BASE = visionBaseUrl;
    }
    base.VISION_PROVIDER = protocol === 'huawei_maas' ? 'HuaweiMaaS' : 'OpenAI';
    base.VISION_MODEL_NAME = ctx.imageModel;
    if (headers && Object.keys(headers).length > 0) {
      base.VISION_DEFAULT_HEADERS = JSON.stringify(headers);
    }
  }

  if (ctx.imageGenModel && ctx.imageGenAccountBinding) {
    const { apiKey, baseUrl, headers, protocol, modelBaseUrls } = ctx.imageGenAccountBinding;
    const imageGenModelBaseUrl =
      ctx.imageGenModel && modelBaseUrls
        ? modelBaseUrls[ctx.imageGenModel]
        : undefined;
    const imageGenBaseUrl = imageGenModelBaseUrl?.trim() || baseUrl;
    if (apiKey) {
      base.IMAGE_GEN_API_KEY = apiKey;
    }
    if (imageGenBaseUrl) {
      base.IMAGE_GEN_API_BASE = imageGenBaseUrl;
    }
    base.IMAGE_GEN_PROVIDER = protocol === 'huawei_maas' ? 'HuaweiMaaS' : 'OpenAI';
    base.IMAGE_GEN_MODEL_NAME = ctx.imageGenModel;
    if (headers && Object.keys(headers).length > 0) {
      base.IMAGE_GEN_DEFAULT_HEADERS = JSON.stringify(headers);
    }
  }

  return base;
}
