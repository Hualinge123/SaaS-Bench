/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { useState } from 'react';
import { Button } from '@/components/shared/Button';
import { getNewSessionDisabledReasonForTemplate, useCreateSameFlow } from '../hooks/useCreateSameFlow';
import type { InspirationTemplateDetail } from '../types';
import { AgentCardList } from './AgentCard';
import { CreateSessionDialog } from './CreateSessionDialog';
import { InspirationTag } from './InspirationTag';
import { SkillCardList } from './SkillCard';

interface InspirationInfoProps {
  template: InspirationTemplateDetail;
}

export function InspirationInfo({ template }: InspirationInfoProps) {
  const [showDialog, setShowDialog] = useState(false);
  const createSame = useCreateSameFlow(template);
  const newSessionDisabledReason = getNewSessionDisabledReasonForTemplate(template);

  const handleDoSame = () => {
    setShowDialog(true);
  };

  const handleCreateNew = () => {
    void createSame({ kind: 'new' });
  };

  const handleSelectExisting = (threadId: string) => {
    void createSame({ kind: 'existing', threadId });
  };

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-card)]">
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div data-testid="inspiration-info-title" className="truncate text-xl font-medium text-[var(--text-primary)]" title={template.name}>
            {template.name}
          </div>

          <div data-testid="inspiration-info-tag-row" className="mt-2 flex flex-wrap gap-1">
            {template.tags.map((tag, index) => (
              <InspirationTag key={tag} label={tag} testId={index === 0 ? 'inspiration-card-tag' : undefined} />
            ))}
          </div>

          <div className="mt-6">
            <Button variant="major" size="lg" block onClick={handleDoSame}>
              创建同款
            </Button>
          </div>

          {template.skills.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">使用的技能</h3>
              <SkillCardList skills={template.skills} />
            </div>
          )}

          {template.agents.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">使用的智能体</h3>
              <AgentCardList agents={template.agents} />
            </div>
          )}

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-[var(--text-primary)]">详细介绍</h3>
            <p data-testid="inspiration-info-description" className="whitespace-pre-wrap text-sm leading-relaxed text-[#191919]">
              {template.description}
            </p>
          </div>
        </div>
      </div>

      <CreateSessionDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onCreateNew={handleCreateNew}
        onSelectExisting={handleSelectExisting}
        newSessionDisabledReason={newSessionDisabledReason}
      />
    </>
  );
}
