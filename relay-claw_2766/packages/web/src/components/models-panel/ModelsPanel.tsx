/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

'use client';

import { useCallback, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useConfirm } from '@/components/useConfirm';
import { apiFetch } from '@/utils/api-client';
import { useChatStore } from '@/stores/chatStore';
import { CenteredLoadingState } from '@/components/shared/CenteredLoadingState';
import { EmptyDataState } from '@/components/shared/EmptyDataState';
import { NoSearchResultsState } from '@/components/shared/NoSearchResultsState';
import { hasCreateModelRiskAgreed, markCreateModelRiskAgreed, EMPTY_STATE_TITLE } from './utils';
import { useModelsPanelData } from './hooks/useModelsPanelData';
import { useCreateModelForm } from './hooks/useCreateModelForm';
import { useAddModelForm } from './hooks/useAddModelForm';
import { useHuaweiMaasAccessForm } from './hooks/useHuaweiMaasAccessForm';
import { ModelsToolbar } from './components/ModelsToolbar';
import { ModelGroupSection } from './components/ModelGroupSection';
import { CreateModelModal } from './components/CreateModelModal';
import { CreateModelRiskModal } from './components/CreateModelRiskModal';
import { AddModelModal } from './components/AddModelModal';
import { HuaweiMaasAccessModal } from './components/HuaweiMaasAccessModal';
import type { ModelCardData } from './types/models-panel';

function parseModelConfigCardId(cardId: string): { sourceId: string; modelName: string } | null {
  const prefix = 'model_config:';
  if (!cardId.startsWith(prefix)) return null;
  const rest = cardId.slice(prefix.length);
  const separatorIndex = rest.indexOf(':');
  if (separatorIndex <= 0) return null;
  const sourceId = rest.slice(0, separatorIndex).trim();
  const modelName = rest.slice(separatorIndex + 1).trim();
  return sourceId && modelName ? { sourceId, modelName } : null;
}

export function ModelsPanel() {
  const confirm = useConfirm();
  const currentProjectPath = useChatStore((s) => s.currentProjectPath);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [showHuaweiMaasAccessModal, setShowHuaweiMaasAccessModal] = useState(false);

  const modelsData = useModelsPanelData();
  const fetchModels = modelsData.fetchModels;
  const createForm = useCreateModelForm(modelsData.resolvedProjectPath, fetchModels);
  const closeHuaweiMaasAccessModal = useCallback(() => {
    setShowHuaweiMaasAccessModal(false);
  }, []);
  const huaweiMaasAccessForm = useHuaweiMaasAccessForm(
    showHuaweiMaasAccessModal,
    closeHuaweiMaasAccessModal,
    fetchModels,
  );

  const addModelForm = useAddModelForm(
    currentProjectPath && currentProjectPath !== 'default' ? currentProjectPath : null,
    async () => {
      await fetchModels();
      setShowAddModelModal(false);
    },
    () => {}, // error handled internally by form
  );

  const handleDeleteModel = useCallback(
    async (cardId: string, cardName: string) => {
      if (deletingModelId) return;
      const ok = await confirm({
        title: '删除模型',
        message: `确认删除模型"${cardName || cardId}"？此操作不可恢复。`,
        confirmLabel: '删除',
        cancelLabel: '取消',
        variant: 'default',
      });
      if (!ok) return;
      setDeletingModelId(cardId);
      try {
        let sourceId = cardId;
        const modelConfigCard = parseModelConfigCardId(cardId);
        if (modelConfigCard) sourceId = modelConfigCard.sourceId;
        const query = new URLSearchParams();
        if (currentProjectPath && currentProjectPath !== 'default') {
          query.set('projectPath', currentProjectPath);
        }
        const queryText = query.toString();
        let res: Response;
        if (modelConfigCard) {
          const profilesUrl = `/api/model-config-profiles${queryText ? `?${queryText}` : ''}`;
          const profilesRes = await apiFetch(profilesUrl);
          if (!profilesRes.ok) {
            const body = (await profilesRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `读取模型配置失败 (${profilesRes.status})`);
          }
          const profilesBody = (await profilesRes.json().catch(() => ({}))) as {
            providers?: Array<{ id: string; models?: string[] }>;
          };
          const sourceProfile = profilesBody.providers?.find((profile) => profile.id === sourceId);
          if (!sourceProfile) {
            throw new Error(`模型源 "${sourceId}" 不存在`);
          }
          const sourceModels = sourceProfile.models?.map((model) => model.trim()).filter(Boolean) ?? [];
          if (!sourceModels.includes(modelConfigCard.modelName)) {
            throw new Error(`模型 "${modelConfigCard.modelName}" 不存在`);
          }
          const remainingModels = sourceModels.filter((model) => model !== modelConfigCard.modelName);
          if (sourceModels.length > 1 && remainingModels.length > 0) {
            res = await apiFetch(`/api/model-config-profiles/${encodeURIComponent(sourceId)}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...(currentProjectPath && currentProjectPath !== 'default' ? { projectPath: currentProjectPath } : {}),
                models: remainingModels,
              }),
            });
          } else {
            const url = `/api/model-config-profiles/${encodeURIComponent(sourceId)}${queryText ? `?${queryText}` : ''}`;
            res = await apiFetch(url, { method: 'DELETE' });
          }
        } else {
          const url = `/api/model-config-profiles/${encodeURIComponent(sourceId)}${queryText ? `?${queryText}` : ''}`;
          res = await apiFetch(url, { method: 'DELETE' });
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `删除失败 (${res.status})`);
        }
        await fetchModels();
      } catch (error) {
        console.error('Delete model failed:', error);
      } finally {
        setDeletingModelId(null);
      }
    },
    [confirm, deletingModelId, currentProjectPath, fetchModels],
  );

  const handleOpenCreateModelRiskGuard = useCallback(() => {
    if (hasCreateModelRiskAgreed()) {
      createForm.openModal('default');
      return;
    }
    createForm.openRiskModal();
  }, [createForm]);

  useEscapeKey({
    enabled: createForm.showModal || createForm.showRiskModal || showHuaweiMaasAccessModal,
    onEscape: () => {
      if (showHuaweiMaasAccessModal) {
        closeHuaweiMaasAccessModal();
        return;
      }
      if (createForm.showRiskModal) {
        createForm.closeRiskModal();
        return;
      }
      createForm.closeModal();
    },
  });

  return (
    <div className="ui-page-shell overflow-hidden">
      <ModelsToolbar
        loading={modelsData.loading}
        isSkipAuth={modelsData.isSkipAuth}
        canCreateModel={modelsData.canCreateModel}
        searchQuery={modelsData.searchQuery}
        onSearchChange={modelsData.setSearchQuery}
        onRefresh={() => void modelsData.fetchModels()}
        onOpenCreateModel={handleOpenCreateModelRiskGuard}
        onOpenHuaweiMaasAccess={() => setShowHuaweiMaasAccessModal(true)}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pb-2" data-testid="models-scroll-region">
        <div className="flex flex-col gap-4 h-full">
          {modelsData.loading && (
            <div className="flex flex-1 min-h-0 items-center justify-center py-10" data-testid="models-loading-state">
              <CenteredLoadingState />
            </div>
          )}

          {modelsData.showEmptyData && (
            <div className="flex flex-1 min-h-0 items-center justify-center py-10" data-testid="models-empty-state">
              <EmptyDataState title={EMPTY_STATE_TITLE} />
            </div>
          )}

          {modelsData.showNoResults && (
            <div className="flex flex-1 min-h-0 items-center justify-center py-10" data-testid="models-no-results-state">
              <NoSearchResultsState onClear={() => modelsData.setSearchQuery('')} />
            </div>
          )}

          {modelsData.showGroups &&
            modelsData.groupedCards.map((group) => (
              <ModelGroupSection
                key={group.key}
                group={group}
                deletingModelId={deletingModelId}
                editModelBusy={createForm.editModelBusy}
                onEdit={(card: ModelCardData) => void createForm.handleOpenEditModelModal(card)}
                onDelete={handleDeleteModel}
              />
            ))}
        </div>
      </div>

      <CreateModelRiskModal
        show={createForm.showRiskModal}
        onClose={createForm.closeRiskModal}
        onAgree={() => {
          markCreateModelRiskAgreed();
          createForm.handleAgreeRisk();
        }}
      />

      <CreateModelModal
        show={createForm.showModal}
        onClose={createForm.closeModal}
        modalMode={createForm.modalMode}
        isEditMode={createForm.isEditMode}
        modelNameInput={createForm.modelNameInput}
        onModelNameChange={createForm.setModelNameInput}
        modelDescriptionInput={createForm.modelDescriptionInput}
        onModelDescriptionChange={createForm.setModelDescriptionInput}
        modelIconInput={createForm.modelIconInput}
        onModelIconChange={createForm.setModelIconInput}
        modelDisplayNameInput={createForm.modelDisplayNameInput}
        onModelDisplayNameChange={createForm.setModelDisplayNameInput}
        modelUrlInput={createForm.modelUrlInput}
        onModelUrlChange={createForm.setModelUrlInput}
        modelApiKeyInput={createForm.modelApiKeyInput}
        onModelApiKeyChange={createForm.setModelApiKeyInput}
        headerRows={createForm.headerRows}
        headerRowErrors={createForm.headerRowErrors}
        headerErrorRowIndex={createForm.headerErrorRowIndex}
        onAddHeaderRow={createForm.handleAddHeaderRow}
        onHeaderRowChange={createForm.handleHeaderRowChange}
        onRemoveHeaderRow={createForm.handleRemoveHeaderRow}
        isModelNameValid={createForm.isModelNameValid}
        showModelNameValidationError={createForm.showModelNameValidationError}
        canConfirm={createForm.canConfirm}
        createError={createForm.createError}
        saveModelBusy={createForm.saveModelBusy}
        testingConnection={createForm.saveModelBusy}
        editModelBusy={createForm.editModelBusy}
        onCreate={() => void createForm.handleCreateModel()}
        onTestConnection={() => void createForm.handleTestConnection()}
      />

      <AddModelModal
        show={showAddModelModal}
        onClose={() => {
          addModelForm.reset();
          setShowAddModelModal(false);
        }}
        form={addModelForm}
      />

      <HuaweiMaasAccessModal
        show={showHuaweiMaasAccessModal}
        activeServiceType={huaweiMaasAccessForm.activeServiceType}
        apiKey={huaweiMaasAccessForm.apiKey}
        loading={huaweiMaasAccessForm.loading}
        saving={huaweiMaasAccessForm.saving}
        canConfirm={huaweiMaasAccessForm.canConfirm}
        activeHasApiKey={huaweiMaasAccessForm.activeHasApiKey}
        updatingApiKey={huaweiMaasAccessForm.updatingApiKey}
        apiKeyUrl={huaweiMaasAccessForm.apiKeyUrl}
        onServiceTypeChange={huaweiMaasAccessForm.setActiveServiceType}
        onApiKeyChange={huaweiMaasAccessForm.setApiKey}
        onUpdateApiKey={huaweiMaasAccessForm.startApiKeyUpdate}
        onClose={closeHuaweiMaasAccessModal}
        onConfirm={() => void huaweiMaasAccessForm.handleConfirm()}
      />
    </div>
  );
}
