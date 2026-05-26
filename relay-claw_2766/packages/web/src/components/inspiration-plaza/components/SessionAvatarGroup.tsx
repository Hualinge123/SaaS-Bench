/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { AgentData } from '@/hooks/useAgentData';
import type { ExpertCatalogItem } from '@/hooks/useExpertCatalog';
import { API_URL } from '@/utils/api-client';

interface SessionAvatarGroupProps {
  participants: string[];
  getAgentById: (id: string) => AgentData | null | undefined;
  getExpertById?: (id: string) => ExpertCatalogItem | null | undefined;
  size?: number;
}

interface AvatarData {
  avatarSrc: string;
  color: string;
  displayName: string;
}

function getAvatarInitial(name?: string): string {
  const normalized = (name ?? '').replace(/^@/, '').trim();
  const first = normalized.slice(0, 1);
  return (first || '智').toUpperCase();
}

function isImageAvatar(avatar: string): boolean {
  return /^(https?:\/\/|\/|data:image)/.test(avatar);
}

function getAvatarSrc(avatar: string): string {
  if (!avatar) return '';
  return avatar.startsWith('/uploads/') ? `${API_URL}${avatar}` : avatar;
}

function AvatarCircle({ avatar, size }: { avatar: AvatarData; size: number }) {
  if (isImageAvatar(avatar.avatarSrc)) {
    return (
      <div className="overflow-hidden rounded-full" style={{ width: size, height: size }}>
        <img src={avatar.avatarSrc} alt={avatar.displayName} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center justify-center rounded-full font-semibold text-[var(--thread-avatar-initial-text)]"
      style={{ width: size, height: size, backgroundColor: avatar.color, fontSize: size <= 16 ? 10 : 12 }}
    >
      {getAvatarInitial(avatar.displayName)}
    </div>
  );
}

function scaleAvatarMetric(value: number, size: number): number {
  return value * (size / 32);
}

function getThreadHistoryAvatarLayout(count: number, index: number, size: number) {
  if (count === 2) {
    const positions = [
      { left: 1, top: 6, zIndex: 10 },
      { left: 11, top: 6, zIndex: 0 },
    ];
    const position = positions[index] ?? positions[0]!;
    return {
      left: scaleAvatarMetric(position.left, size),
      top: scaleAvatarMetric(position.top, size),
      avatarSize: scaleAvatarMetric(20, size),
      zIndex: position.zIndex,
    };
  }

  if (count === 3) {
    const positions = [
      { left: 8, top: 0 },
      { left: 0, top: 16 },
      { left: 16, top: 16 },
    ];
    const position = positions[index] ?? positions[0]!;
    return {
      left: scaleAvatarMetric(position.left, size),
      top: scaleAvatarMetric(position.top, size),
      avatarSize: scaleAvatarMetric(16, size),
    };
  }

  const positions = [
    { left: 0, top: 0 },
    { left: 16, top: 0 },
    { left: 0, top: 16 },
    { left: 16, top: 16 },
  ];
  const position = positions[index] ?? positions[0]!;
  return {
    left: scaleAvatarMetric(position.left, size),
    top: scaleAvatarMetric(position.top, size),
    avatarSize: scaleAvatarMetric(16, size),
  };
}

export function SessionAvatarGroup({ participants, getAgentById, getExpertById, size = 32 }: SessionAvatarGroupProps) {
  const avatars = participants.slice(0, 4).map((participantId) => {
    const agent = getAgentById(participantId);
    const expert = agent ? null : getExpertById?.(participantId);
    if (!agent && !expert) {
      return { avatarSrc: '', color: 'var(--accent-primary)', displayName: participantId };
    }
    return {
      avatarSrc: getAvatarSrc((agent ?? expert)?.avatar?.trim() ?? ''),
      color: agent?.color?.primary ?? expert?.color?.primary ?? 'var(--accent-primary)',
      displayName: agent?.displayName ?? expert?.displayName ?? participantId,
    };
  });

  if (avatars.length === 0) {
    return (
      <div className="ui-avatar-fallback-shell shrink-0" style={{ width: size, height: size }}>
        <span className="inline-flex h-full w-full items-center justify-center rounded-full bg-[var(--accent-primary)] text-xs font-semibold text-[var(--thread-avatar-initial-text)]">
          智
        </span>
      </div>
    );
  }

  if (avatars.length === 1) {
    return (
      <div className="shrink-0">
        <AvatarCircle avatar={avatars[0]!} size={size} />
      </div>
    );
  }

  if (avatars.length === 2) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        {avatars.map((avatar, index) => {
          const layout = getThreadHistoryAvatarLayout(avatars.length, index, size);
          return (
            <div
              key={avatar.displayName}
              className="absolute"
              style={{ left: layout.left, top: layout.top, zIndex: layout.zIndex }}
            >
              <AvatarCircle avatar={avatar} size={layout.avatarSize} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatars.map((avatar, index) => {
        const layout = getThreadHistoryAvatarLayout(avatars.length, index, size);
        return (
          <div
            key={`${avatar.displayName}-${index}`}
            className="absolute overflow-hidden rounded-full"
            style={{
              width: layout.avatarSize,
              height: layout.avatarSize,
              left: layout.left,
              top: layout.top,
            }}
          >
            <AvatarCircle avatar={avatar} size={layout.avatarSize} />
          </div>
        );
      })}
    </div>
  );
}
