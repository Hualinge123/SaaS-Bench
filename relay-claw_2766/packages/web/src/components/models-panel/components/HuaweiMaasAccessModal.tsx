/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import { Button } from '@/components/shared/Button';
import { MaskIcon } from '@/components/shared/MaskIcon';
import { getHuaweiMaasPurchaseUrl, HUAWEI_MAAS_SERVICE_CONFIGS } from '../utils';
import type { HuaweiMaasServiceType } from '../utils';

export interface HuaweiMaasAccessModalProps {
  show: boolean;
  activeServiceType: HuaweiMaasServiceType;
  apiKey: string;
  loading: boolean;
  saving: boolean;
  canConfirm: boolean;
  activeHasApiKey: boolean;
  updatingApiKey: boolean;
  apiKeyUrl: string;
  onServiceTypeChange: (value: HuaweiMaasServiceType) => void;
  onApiKeyChange: (value: string) => void;
  onUpdateApiKey: () => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function HuaweiMaasAccessModal({
  show,
  activeServiceType,
  apiKey,
  loading,
  saving,
  canConfirm,
  activeHasApiKey,
  updatingApiKey,
  apiKeyUrl,
  onServiceTypeChange,
  onApiKeyChange,
  onUpdateApiKey,
  onClose,
  onConfirm,
}: HuaweiMaasAccessModalProps) {
  if (!show) return null;
  const activeServiceConfig = HUAWEI_MAAS_SERVICE_CONFIGS[activeServiceType];
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay-backdrop-strong)] px-4 pt-[96px]"
      data-testid="models-huawei-maas-access-modal"
    >
      <div className="relative w-full max-w-[700px] rounded-[8px] border border-[var(--modal-border)] bg-[var(--modal-surface)] p-6 shadow-[var(--modal-shadow)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="absolute right-5 top-5 flex h-6 w-6 items-center justify-center rounded text-[var(--modal-close-icon)] transition-colors hover:bg-[var(--modal-close-hover-bg)] hover:text-[var(--modal-close-icon-hover)]"
        >
          <MaskIcon name="close" className="h-4 w-4" />
        </button>

        <div className="pr-10">
          <h3 className="text-[16px] font-bold text-[var(--modal-title-text)]">接入MaaS模型</h3>
        </div>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <div className="text-[12px] leading-[18px] text-[var(--modal-text)]">接入类型</div>
            <div className="flex flex-wrap gap-2">
              {(['claw-plan', 'maas'] as const).map((serviceType) => {
                const active = activeServiceType === serviceType;
                return (
                  <button
                    key={serviceType}
                    type="button"
                    onClick={() => onServiceTypeChange(serviceType)}
                    className={[
                      'h-[28px] min-w-[156px] rounded-[6px] border px-4 text-[12px] transition-colors',
                      active
                        ? 'border-[#1677ff] bg-white text-[#1677ff]'
                        : 'border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--text-primary)] hover:border-[#1677ff]',
                    ].join(' ')}
                    data-testid={`models-huawei-maas-service-${serviceType}`}
                  >
                    {HUAWEI_MAAS_SERVICE_CONFIGS[serviceType].label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[12px] leading-[18px] text-[var(--modal-text)]">API Key</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                data-testid="models-huawei-maas-api-key-input"
                name="huawei_maas_api_key"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                placeholder="立即创建或粘贴已有的“西南-贵阳一”API Key"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={(activeHasApiKey && !updatingApiKey) || loading || saving}
                className="ui-input h-[28px] min-w-0 flex-1 disabled:bg-[#f3f4f6] disabled:text-[var(--text-muted)]"
              />
              {activeHasApiKey && !updatingApiKey ? (
                <button
                  type="button"
                  onClick={onUpdateApiKey}
                  className="shrink-0 text-[12px] text-[var(--text-accent)] hover:underline"
                  data-testid="models-huawei-maas-api-key-update"
                >
                  更新
                </button>
              ) : (
                <a
                  href={apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[12px] text-[var(--text-accent)] hover:underline"
                >
                  创建API Key
                </a>
              )}
            </div>
          </div>

          <div className="space-y-2" data-testid="models-huawei-maas-purchase-section">
            <div className="text-[12px] leading-[18px] text-[var(--text-muted)]">{activeServiceConfig.helpText}</div>
            <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[#e8edf6] bg-[linear-gradient(90deg,#f4f3ff_0%,#eef8ff_100%)] px-6 py-5">
              <div className="min-w-0">
                <div className="text-[16px] font-semibold leading-[24px] text-[var(--text-primary)]">
                  {activeServiceConfig.purchaseTitle}
                </div>
                <p className="mt-2 text-[14px] leading-[22px] text-[var(--text-secondary)]">
                  {activeServiceConfig.purchaseDescription}
                </p>
              </div>
              <a
                href={getHuaweiMaasPurchaseUrl(activeServiceType)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="models-huawei-maas-purchase-link"
                className="inline-flex h-[36px] shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-white px-6 text-[14px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                {activeServiceConfig.btnText}
              </a>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="default" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            disabled={!canConfirm}
            loading={saving}
            onClick={onConfirm}
            data-testid="models-huawei-maas-confirm"
          >
            确认
          </Button>
        </div>
      </div>
    </div>
  );
}
