/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { SkillAvatar } from '@/components/skills-panel/components/SkillAvatar';
import type { SkillRef } from '../types';

interface SkillCardProps {
  skill: SkillRef;
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <div
      data-testid={`inspiration-skill-card-${skill.id}`}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 bg-[var(--color-bg-container-3)]"
      style={{ backgroundColor: '#FAFAFA' }}
    >
      <SkillAvatar
        avatarName={skill.id}
        avatarUrl={skill.icon}
        dataTestId={`inspiration-skill-card-${skill.id}-icon`}
        className="h-8 w-8 rounded-[8px]"
      />
      <div className="min-w-0 flex-1">
        <div data-testid="inspiration-skill-card-name" className="truncate text-sm text-[var(--text-primary)]" title={skill.name}>
          {skill.name}
        </div>
        <div className="truncate text-xs text-[var(--text-secondary)]" title={skill.id}>
          {skill.id}
        </div>
      </div>
    </div>
  );
}

interface SkillCardListProps {
  skills: SkillRef[];
}

export function SkillCardList({ skills }: SkillCardListProps) {
  if (skills.length === 0) {
    return null;
  }

  return (
    <div data-testid="inspiration-skill-card-list" className="flex flex-col overflow-hidden rounded-[8px]">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  );
}
