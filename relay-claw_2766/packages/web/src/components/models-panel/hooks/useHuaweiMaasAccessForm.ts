/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useToastStore } from '@/stores/toastStore';
import { apiFetch } from '@/utils/api-client';
import { readPublicEnv } from '@/utils/client-env';
import {
  getMaaSApiKeyUrl,
  HUAWEI_MAAS_SERVICE_CONFIGS,
  resolveHuaweiMaasServiceType,
  resolveHuaweiMaasAccessModelIds,
} from '../utils';
import type { HuaweiMaasServiceType } from '../utils';
import type { ModelConfigProviderItem } from '../types/models-panel';

type ProviderByService = Partial<Record<HuaweiMaasServiceType, ModelConfigProviderItem>>;

export interface UseHuaweiMaasAccessFormResult {
  activeServiceType: HuaweiMaasServiceType;
  setActiveServiceType: (value: HuaweiMaasServiceType) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  loading: boolean;
  saving: boolean;
  canConfirm: boolean;
  activeHasApiKey: boolean;
  updatingApiKey: boolean;
  apiKeyUrl: string;
  startApiKeyUpdate: () => void;
  handleConfirm: () => Promise<void>;
}

export function useHuaweiMaasAccessForm(
  open: boolean,
  onClose: () => void,
  onSaved: () => Promise<void>,
): UseHuaweiMaasAccessFormResult {
  const currentProjectPath = useChatStore((s) => s.currentProjectPath);
  const [activeServiceType, setActiveServiceType] = useState<HuaweiMaasServiceType>('claw-plan');
  const [apiKey, setApiKey] = useState('');
  const [providersByService, setProvidersByService] = useState<ProviderByService>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingApiKey, setUpdatingApiKey] = useState(false);

  const projectPath = currentProjectPath && currentProjectPath !== 'default' ? currentProjectPath : undefined;
  const sharedProvider = providersByService['claw-plan'] ?? providersByService.maas;
  const activeProvider = providersByService[activeServiceType];
  const existingApiKey = activeProvider?.apiKey || sharedProvider?.apiKey || '';
  const activeHasApiKey = existingApiKey.trim().length > 0;
  const canConfirm = ((activeHasApiKey && !updatingApiKey) || apiKey.trim().length > 0) && !loading && !saving;
  const apiKeyUrl = getMaaSApiKeyUrl();

  const profilesUrl = useMemo(() => {
    if (!projectPath) return '/api/model-config-profiles';
    const query = new URLSearchParams({ projectPath });
    return `/api/model-config-profiles?${query.toString()}`;
  }, [projectPath]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(profilesUrl);
      const body = (await res.json().catch(() => ({}))) as {
        providers?: ModelConfigProviderItem[];
      };
      if (!res.ok) {
        setProvidersByService({});
        return;
      }

      const nextProviders: ProviderByService = {};
      for (const provider of body.providers ?? []) {
        const serviceType = resolveHuaweiMaasServiceType(provider);
        if (serviceType && !nextProviders[serviceType]) {
          nextProviders[serviceType] = provider;
        }
      }
      setProvidersByService(nextProviders);

      const sharedApiKey = nextProviders['claw-plan']?.apiKey || nextProviders.maas?.apiKey || '';
      if (sharedApiKey) {
        setApiKey(sharedApiKey);
      }
    } finally {
      setLoading(false);
    }
  }, [profilesUrl]);

  useEffect(() => {
    if (!open) return;
    void loadProfiles();
  }, [open, loadProfiles]);

  useEffect(() => {
    if (!open || updatingApiKey || !existingApiKey) return;
    setApiKey(existingApiKey);
  }, [existingApiKey, open, updatingApiKey]);

  useEffect(() => {
    if (open) return;
    setActiveServiceType('claw-plan');
    setApiKey('');
    setProvidersByService({});
    setUpdatingApiKey(false);
  }, [open]);

  const startApiKeyUpdate = useCallback(() => {
    setUpdatingApiKey(true);
    setApiKey('');
  }, []);

  const handleConfirm = useCallback(async () => {
    const trimmedApiKey = apiKey.trim();
    if ((!activeHasApiKey && !trimmedApiKey) || saving) return;

    const config = HUAWEI_MAAS_SERVICE_CONFIGS[activeServiceType];
    const provider =
      activeProvider ?? (activeHasApiKey && activeServiceType === 'claw-plan' ? sharedProvider : undefined);
    const shouldReuseExistingApiKey = activeHasApiKey && !updatingApiKey;
    setSaving(true);

    try {
      let models: string[];
      let modelBaseUrls: Record<string, string> | undefined;

      if (activeServiceType === 'maas') {
        if (shouldReuseExistingApiKey) {
          if (activeProvider?.serviceType !== 'maas') {
            throw new Error('已接入 API Key 无法直接切换到按需计费，请点击“更新”后重新输入 API Key。');
          }
          models = activeProvider.models?.map((item) => item.trim()).filter(Boolean) ?? [];
          modelBaseUrls = activeProvider.modelBaseUrls;
        } else {
          const res = await apiFetch('/api/maas-models-query', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseUrl: config.baseUrl, apiKey: trimmedApiKey }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            models?: Array<{ id?: string; baseUrl?: string }>;
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? `查询已购模型失败 (${res.status})`);
          }
          models = Array.isArray(body.models)
            ? body.models
              .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
              .filter((id): id is string => id.length > 0)
            : [];
          const baseUrlEntries = (body.models ?? [])
            .map((item) => {
              const id = typeof item?.id === 'string' ? item.id.trim() : '';
              const baseUrl = typeof item?.baseUrl === 'string' ? item.baseUrl.trim() : '';
              return id && baseUrl ? ([id, baseUrl] as const) : null;
            })
            .filter((entry): entry is readonly [string, string] => entry !== null);
          if (baseUrlEntries.length > 0) {
            modelBaseUrls = Object.fromEntries(baseUrlEntries);
          }
        }

        if (models.length === 0) {
          throw new Error('未查询到已购模型，请确认 API Key 是否正确或是否已购买模型。');
        }
      } else {
        models = resolveHuaweiMaasAccessModelIds(
          activeServiceType,
          readPublicEnv('PUBLIC_CLAW_PLAN_MODELS')?.trim(),
        );
      }

      const sourceId = provider?.id || config.sourceId;
      const basePayload = {
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        serviceType: activeServiceType,
        ...(models.length > 0 ? { models } : {}),
        ...(modelBaseUrls ? { modelBaseUrls } : {}),
        ...(projectPath ? { projectPath } : {}),
        ...(!shouldReuseExistingApiKey && trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      };
      const isUpdate = Boolean(provider?.id);
      const url = isUpdate
        ? `/api/model-config-profiles/${encodeURIComponent(sourceId)}`
        : '/api/model-config-profiles';
      const res = await apiFetch(url, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isUpdate ? basePayload : { ...basePayload, sourceId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `请求失败 (${res.status})`);
      }

      useToastStore.getState().addToast({
        type: 'success',
        title: '模型接入成功。',
        message: '模型接入成功。',
        duration: 3000,
      });
      setUpdatingApiKey(false);
      onClose();
      await onSaved();
    } catch {
      useToastStore.getState().addToast({
        type: 'error',
        title: '模型接入失败，请核对接入信息后重试。',
        message: '模型接入失败，请核对接入信息后重试。',
        duration: 5000,
      });
    } finally {
      setSaving(false);
    }
  }, [activeHasApiKey, activeProvider, activeServiceType, apiKey, onClose, onSaved, projectPath, saving, sharedProvider, updatingApiKey]);

  return {
    activeServiceType,
    setActiveServiceType,
    apiKey,
    setApiKey,
    loading,
    saving,
    canConfirm,
    activeHasApiKey,
    updatingApiKey,
    apiKeyUrl,
    startApiKeyUpdate,
    handleConfirm,
  };
}
