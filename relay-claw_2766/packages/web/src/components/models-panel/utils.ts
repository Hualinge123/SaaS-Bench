/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { API_URL } from '@/utils/api-client';
import { readPublicEnv } from '@/utils/client-env';

// === Constants ===
export const ADD_MODEL = '添加模型';
export const MODEL_TITLE = '模型';
export const SEARCH_PLACEHOLDER = '搜索模型';
export const EMPTY_STATE_TITLE = '暂无模型';
export const HUAWEI_MAAS_GROUP_LABEL = '华为云 MaaS';
export const CUSTOM_MODEL_GROUP_LABEL = '自定义模型';
export const SELF_HUAWEI_MAAS_GROUP_LABEL = '自接入华为云 MaaS';
export const FREE_HUAWEI_MAAS_GROUP_LABEL = '免费体验华为云MaaS';
export const CLAW_PLAN_GROUP_LABEL = 'Claw Plan';
export const PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_LABEL = '按需收费华为云MaaS';
export const VENDOR_ICON = '/images/vendor.svg';
export const DEFAULT_DEVELOPER = '华为云 MaaS';
export const UNKNOWN_PROTOCOL_LABEL = 'unknown';
export const CREATE_MODEL_LABEL = '新建模型';
export const CREATE_MODEL_RISK_ACK_KEY = 'create-model-risk-ack:v1';
export const CREATE_MODEL_RISK_TITLE = '风险提示';
export const CREATE_MODEL_RISK_MESSAGE =
  '请注意，当您使用第三方模型时，您承诺将严格遵守第三方的相关条款（包括但不限于 license 协议）。华为云不对第三方产品的合规性和安全性作保证，请您使用前慎重考虑并评估风险。';
export const HUAWEI_MAAS_ACCESS_LABEL = '接入华为云Maas模型';
export const HUAWEI_MAAS_ACCESS_URL = 'https://api.modelarts-maas.com';
export const HUAWEI_MAAS_CLAW_PLAN_URL = 'https://api.modelarts-maas.com/plan';
const HUAWEI_MAAS_ACCESS_V1_URL = 'https://api.modelarts-maas.com/v1';
const HUAWEI_MAAS_ACCESS_V2_URL = 'https://api.modelarts-maas.com/v2';
const LEGACY_HUAWEI_MAAS_ACCESS_URL = 'https://api.modelarts-maas.com/openai/v1';
const LEGACY_HUAWEI_MAAS_ACCESS_V2_URL = 'https://api.modelarts-maas.com/openai/v2';
const LEGACY_HUAWEI_MAAS_CLAW_PLAN_URL = 'https://api.modelarts-maas.com/plan/v2';
export const DEFAULT_MAAS_API_KEY_URL = 'https://console.huaweicloud.com/modelarts/?region=cn-southwest-2#/model-studio/authmanage';
export const DEFAULT_CLAW_PLAN_PURCHASE_URL =
  'https://console.huaweicloud.com/modelarts/?region=cn-southwest-2#/model-studio/resourcePlanManagement';
export const DEFAULT_PAY_AS_YOU_GO_MAAS_PURCHASE_URL =
  'https://console.huaweicloud.com/modelarts/?region=cn-southwest-2#/model-studio/deployment';

export function getMaaSApiKeyUrl(): string {
  return readPublicEnv('PUBLIC_MAAS_API_KEY_URL')?.trim() || DEFAULT_MAAS_API_KEY_URL;
}

export function getHuaweiMaasPurchaseUrl(serviceType: HuaweiMaasServiceType): string {
  if (serviceType === 'claw-plan') {
    return readPublicEnv('PUBLIC_CLAW_PLAN_PURCHASE_URL')?.trim() || DEFAULT_CLAW_PLAN_PURCHASE_URL;
  }
  return readPublicEnv('PUBLIC_PAY_AS_YOU_GO_MAAS_PURCHASE_URL')?.trim() || DEFAULT_PAY_AS_YOU_GO_MAAS_PURCHASE_URL;
}

export const DEFAULT_CLAW_PLAN_MODEL_IDS = ['glm-5', 'deepseek-v3.2', 'kimi-k2'] as const;
export const CREATE_MODEL_CANCEL_LABEL = '取消';
export const TEST_CONNECTION_LABEL = '测试连接';
export const SAVE_MODEL_LABEL = '保存';
export const DELETE_MODEL_LABEL = '删除';
export const MODEL_ICON_MAX_BYTES = 200 * 1024;
export const DEFAULT_MODEL_ICON_SRC = '/images/mode-default-icon.svg';
export const MODEL_NAME_VALIDATION_MESSAGE = '支持中英文、数字及 :._/|\\-，仅支持中英文、数字开头结尾，长度2-64';
export const MODEL_NAME_EDGE_PATTERN = '[A-Za-z0-9\\u4E00-\\u9FFF]';
export const MODEL_NAME_BODY_PATTERN = '[A-Za-z0-9\\u4E00-\\u9FFF:._/|\\\\-]';
export const MODEL_NAME_PATTERN = new RegExp(
  `^${MODEL_NAME_EDGE_PATTERN}(?:${MODEL_NAME_BODY_PATTERN}{0,62}${MODEL_NAME_EDGE_PATTERN})$`,
);

// === Protocol & Access Mode Constants ===
export const HUAWEI_MAAS_PROTOCOL = 'huawei_maas';
export const HUAWEI_MAAS_ACCESS_MODE = 'huawei_maas_access';
export const HUAWEI_MAAS_GROUP_KEY = 'huawei_maas';
export const SELF_HUAWEI_MAAS_ACCESS_GROUP_KEY = 'self_huawei_maas_access';
export const FREE_HUAWEI_MAAS_GROUP_KEY = 'free_huawei_maas';
export const CLAW_PLAN_GROUP_KEY = 'claw_plan';
export const PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_KEY = 'pay_as_you_go_huawei_maas';
export const HUAWEI_MAAS_ACCESS_MODAL_MODE = 'huawei-maas-access';

const MODEL_GROUP_ORDER: Record<string, number> = {
  [HUAWEI_MAAS_GROUP_KEY]: 0,
  [CLAW_PLAN_GROUP_KEY]: 1,
  [PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_KEY]: 2,
};

// === Derived Types ===
export type HuaweiMaasAccessModeType = typeof HUAWEI_MAAS_ACCESS_MODE;
export type HuaweiMaasServiceType = 'maas' | 'claw-plan';

export const HUAWEI_MAAS_SERVICE_CONFIGS: Record<
  HuaweiMaasServiceType,
  {
    sourceId: string;
    label: string;
    displayName: string;
    baseUrl: string;
    defaultModels?: readonly string[];
    helpText?: string;
    purchaseTitle: string;
    purchaseDescription: string;
    btnText?: string;
  }
> = {
  'claw-plan': {
    sourceId: 'huawei-maas-claw-plan',
    label: '华为云MaaS Claw Plan',
    displayName: CLAW_PLAN_GROUP_LABEL,
    baseUrl: HUAWEI_MAAS_CLAW_PLAN_URL,
    defaultModels: DEFAULT_CLAW_PLAN_MODEL_IDS,
    helpText: '没有订阅？',
    purchaseTitle: '华为云MaaS Claw Plan',
    purchaseDescription: '低门槛解锁大模型算力，按需采购；覆盖DeepSeek、GLM、Kimi等主流大模型',
    btnText: '去购买',
  },
  maas: {
    sourceId: 'huawei-maas-pay-as-you-go',
    label: '华为云MaaS 按需计费',
    displayName: PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_LABEL,
    baseUrl: HUAWEI_MAAS_ACCESS_URL,
    helpText: '没有开通？',
    purchaseTitle: '华为云MaaS 模型推理服务',
    purchaseDescription: '预置服务为您提供付费API服务，开通后体验或调用以实际用量进行扣费',
    btnText: '去开通',
  },
};

export function parseModelIdList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return Array.from(
    new Set(
      value
        .split(/[,，/|]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function resolveHuaweiMaasAccessModelIds(
  serviceType: HuaweiMaasServiceType,
  overrideModels: string | undefined,
): string[] {
  const parsed = parseModelIdList(overrideModels);
  if (parsed.length > 0) return parsed;
  return [...(HUAWEI_MAAS_SERVICE_CONFIGS[serviceType].defaultModels ?? [])];
}

// === Types (re-exported for convenience) ===
import type { ModelCardData, MassModelResponseItem, HeaderInputRow } from './types/models-panel';

// === Validation ===
export function isValidModelName(value: string): boolean {
  return MODEL_NAME_PATTERN.test(value);
}

// === String Helpers ===
export function pickStringField(item: MassModelResponseItem, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = item[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,，/|]/).map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeUpdatedAt(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

export function formatCustomModelUpdatedAt(value: unknown): string | null {
  const normalized = normalizeUpdatedAt(value);
  if (normalized === undefined) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

export function normalizeBaseUrlForComparison(baseUrl: string | undefined): string {
  return baseUrl?.trim().replace(/\/+$/, '').toLowerCase() ?? '';
}

export function isHuaweiMaasAccessBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = normalizeBaseUrlForComparison(baseUrl);
  return [
    HUAWEI_MAAS_ACCESS_URL,
    HUAWEI_MAAS_ACCESS_V1_URL,
    HUAWEI_MAAS_ACCESS_V2_URL,
    LEGACY_HUAWEI_MAAS_ACCESS_URL,
    LEGACY_HUAWEI_MAAS_ACCESS_V2_URL,
  ].some(
    (candidate) => normalized === normalizeBaseUrlForComparison(candidate),
  );
}

export function isHuaweiMaasClawPlanBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = normalizeBaseUrlForComparison(baseUrl);
  return [HUAWEI_MAAS_CLAW_PLAN_URL, LEGACY_HUAWEI_MAAS_CLAW_PLAN_URL].some(
    (candidate) => normalized === normalizeBaseUrlForComparison(candidate),
  );
}

export function resolveHuaweiMaasServiceType(
  value: Pick<ModelCardData, 'serviceType' | 'baseUrl'>,
): HuaweiMaasServiceType | undefined {
  if (value.serviceType === 'maas' || value.serviceType === 'claw-plan') return value.serviceType;
  if (isHuaweiMaasClawPlanBaseUrl(value.baseUrl)) return 'claw-plan';
  if (isHuaweiMaasAccessBaseUrl(value.baseUrl)) return 'maas';
  return undefined;
}

// === Model Normalization ===
export function normalizeModel(item: MassModelResponseItem, index: number): ModelCardData {
  const nameFromKnownFields = pickStringField(item, [
    'name', 'modelName', 'model_name', 'displayName', 'display_name', '名称',
  ]);

  const genericStringEntries = Object.entries(item).filter(
    ([key, value]) => typeof value === 'string' && key !== 'id' && key !== 'object',
  ) as Array<[string, string]>;

  const inferredName =
    nameFromKnownFields ?? genericStringEntries.find(([key]) => !/desc|description|描述/i.test(key))?.[1]?.trim() ?? '';

  const inferredDescription = pickStringField(item, ['description', 'desc', '描述']) ?? '';

  const id = String(item.id ?? `${inferredName || 'model'}-${index}`);
  const object = String(item.object ?? 'model');
  const labels = normalizeStringArray(item.labels || []);
  const developer = pickStringField(item, ['developer', 'provider', 'vendor', 'publisher', 'company']) ?? DEFAULT_DEVELOPER;
  const icon = pickStringField(item, ['icon', 'logo', 'image', 'avatar']);
  const protocol = pickStringField(item, ['protocol']) ?? UNKNOWN_PROTOCOL_LABEL;
  const baseUrl = typeof item.baseUrl === 'string' && item.baseUrl.trim() ? item.baseUrl.trim() : undefined;
  const accessMode = item.accessMode === HUAWEI_MAAS_ACCESS_MODE ? HUAWEI_MAAS_ACCESS_MODE : undefined;
  const serviceType =
    item.serviceType === 'maas' || item.serviceType === 'claw-plan'
      ? item.serviceType
      : resolveHuaweiMaasServiceType({ baseUrl });
  const updatedAt = normalizeUpdatedAt(item.updatedAt ?? item.updated_at ?? item.updateTime ?? item.update_time);
  const resolvedDeveloper = isHuaweiMaasAccessBaseUrl(baseUrl) ? '其他' : developer;

  return {
    id,
    object,
    name: inferredName,
    description: inferredDescription,
    labels,
    developer: resolvedDeveloper,
    icon,
    protocol,
    ...(baseUrl ? { baseUrl } : {}),
    ...(accessMode ? { accessMode } : {}),
    ...(serviceType ? { serviceType } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

// === Grouping ===
export function isSelfHuaweiMaaSAccessCard(card: Pick<ModelCardData, 'accessMode' | 'baseUrl' | 'serviceType'>): boolean {
  return Boolean(resolveHuaweiMaasServiceType(card));
}

export function protocolGroupLabel(card: Pick<ModelCardData, 'protocol' | 'accessMode' | 'baseUrl' | 'serviceType'>): string {
  const serviceType = resolveHuaweiMaasServiceType(card);
  if (serviceType === 'claw-plan') return CLAW_PLAN_GROUP_LABEL;
  if (serviceType === 'maas') return PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_LABEL;
  const trimmed = card.protocol.trim();
  if (trimmed.toLowerCase() === HUAWEI_MAAS_PROTOCOL) return FREE_HUAWEI_MAAS_GROUP_LABEL;
  return CUSTOM_MODEL_GROUP_LABEL;
}

export function protocolGroupKey(card: Pick<ModelCardData, 'protocol' | 'accessMode' | 'baseUrl' | 'serviceType'>): string {
  const serviceType = resolveHuaweiMaasServiceType(card);
  if (serviceType === 'claw-plan') return CLAW_PLAN_GROUP_KEY;
  if (serviceType === 'maas') return PAY_AS_YOU_GO_HUAWEI_MAAS_GROUP_KEY;
  const trimmed = card.protocol.trim().toLowerCase();
  if (trimmed === HUAWEI_MAAS_PROTOCOL) return HUAWEI_MAAS_GROUP_KEY;
  return 'custom_models';
}

export function buildModelSearchText(card: ModelCardData): string {
  return [
    card.name, card.description, card.id, card.object, card.developer, card.protocol,
    card.serviceType, protocolGroupLabel(card), ...card.labels,
  ].join(' ').toLowerCase();
}

export interface ModelCardGroup {
  key: string;
  label: string;
  items: ModelCardData[];
}

function sortModelCardGroups(groups: ModelCardGroup[]): ModelCardGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      const leftOrder = MODEL_GROUP_ORDER[left.group.key] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = MODEL_GROUP_ORDER[right.group.key] ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.index - right.index;
    })
    .map(({ group }) => group);
}

export function groupCards(cards: ModelCardData[]): ModelCardGroup[] {
  const groups = cards.reduce<ModelCardGroup[]>((acc, item) => {
    const key = protocolGroupKey(item);
    const existing = acc.find((group) => group.key === key);
    if (existing) {
      existing.items.push(item);
      return acc;
    }
    acc.push({ key, label: protocolGroupLabel(item), items: [item] });
    return acc;
  }, []);
  return sortModelCardGroups(groups);
}

// === Icon URL ===
export function resolveUploadedIconUrl(icon?: string | null): string | null {
  const trimmed = icon?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/uploads/') ? `${API_URL}${trimmed}` : trimmed;
}

// === Source ID ===
export function resolveModelConfigSourceId(cardId: string): string | null {
  if (!cardId.startsWith('model_config:')) return null;
  const parts = cardId.split(':');
  if (parts.length < 3) return null;
  const sourceId = parts[1]?.trim();
  return sourceId ? sourceId : null;
}

export function generateModelConfigSourceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === 'string' && uuid.trim()) {
    return uuid.replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

// === Headers ===
export function generateHeaderRowId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === 'string' && uuid.trim()) {
    return uuid;
  }
  return `hdr-${Math.random().toString(16).slice(2, 10)}`;
}

export function createEmptyHeaderRow(): HeaderInputRow {
  return { id: generateHeaderRowId(), key: '', value: '' };
}

export function headersObjectToRows(headers?: Record<string, string> | null): HeaderInputRow[] {
  if (!headers) return [];
  return Object.entries(headers).map(([key, value]) => ({
    id: generateHeaderRowId(),
    key,
    value,
  }));
}

export function parseHeadersJson(value: string): Record<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers 必须是 JSON 对象');
  }
  const entries = Object.entries(parsed).map(([key, rawValue]) => {
    const normalizedKey = key.trim();
    const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!normalizedKey || !normalizedValue) {
      throw new Error('Headers 的 key 和 value 都必须是非空字符串');
    }
    return [normalizedKey, normalizedValue] as const;
  });
  return Object.fromEntries(entries);
}

export type BuildHeadersResult = {
  headers: Record<string, string> | null;
  errorIndex: number | null;
  errorMessage: string | null;
};

export function buildHeadersObject(rows: HeaderInputRow[]): BuildHeadersResult {
  const normalizedEntries: Array<readonly [string, string]> = [];
  const rowIndexMap: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    if (!key || !value) {
      return {
        headers: null,
        errorIndex: i,
        errorMessage: '请求头的键名和值都必须填写',
      };
    }
    normalizedEntries.push([key, value] as const);
    rowIndexMap.push(i);
  }

  if (normalizedEntries.length === 0) return { headers: null, errorIndex: null, errorMessage: null };

  const duplicatedIndex = normalizedEntries.findIndex(
    ([key], idx) => normalizedEntries.findIndex(([k]) => k === key) !== idx,
  );
  if (duplicatedIndex !== -1) {
    return {
      headers: null,
      errorIndex: rowIndexMap[duplicatedIndex],
      errorMessage: `请求头键名重复：${normalizedEntries[duplicatedIndex][0]}`,
    };
  }

  return { headers: Object.fromEntries(normalizedEntries), errorIndex: null, errorMessage: null };
}

// === Risk Acknowledgement ===
export function isEnvFlagEnabled(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

export function hasCreateModelRiskAgreed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = window.localStorage.getItem(CREATE_MODEL_RISK_ACK_KEY);
    return value === 'true' || value === '1';
  } catch {
    return false;
  }
}

export function markCreateModelRiskAgreed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CREATE_MODEL_RISK_ACK_KEY, 'true');
  } catch {
    // ignore storage failure
  }
}
