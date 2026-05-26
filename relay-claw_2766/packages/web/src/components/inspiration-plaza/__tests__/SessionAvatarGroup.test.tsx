/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionAvatarGroup } from '../components/SessionAvatarGroup';
import type { AgentData } from '@/hooks/useAgentData';

const makeAgent = (id: string): AgentData => ({
  id,
  displayName: id,
  avatar: `/avatars/${id}.png`,
  color: { primary: '#1476FF', secondary: '#DCEBFF' },
  mentionPatterns: [`@${id}`],
  roleDescription: id,
  personality: id,
  provider: 'openai',
  defaultModel: '',
  source: 'seed',
  roster: null,
});

describe('SessionAvatarGroup', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  function renderGroup(participants: string[]) {
    const agents = new Map(participants.map((id) => [id, makeAgent(id)]));
    act(() => {
      root.render(
        React.createElement(SessionAvatarGroup, {
          participants,
          getAgentById: (id: string) => agents.get(id),
          size: 32,
        }),
      );
    });
    return container.firstElementChild as HTMLDivElement;
  }

  it('uses the thread-history overlap layout for two avatars', () => {
    const group = renderGroup(['alpha', 'beta']);
    const items = Array.from(group.children) as HTMLDivElement[];

    expect(items.map((item) => [item.style.left, item.style.top, item.style.zIndex])).toEqual([
      ['1px', '6px', '10'],
      ['11px', '6px', '0'],
    ]);
    expect((items[0]?.firstElementChild as HTMLDivElement | null)?.style.width).toBe('20px');
    expect((items[1]?.firstElementChild as HTMLDivElement | null)?.style.width).toBe('20px');
  });

  it('uses the thread-history triangle layout for three avatars', () => {
    const group = renderGroup(['alpha', 'beta', 'gamma']);
    const items = Array.from(group.children) as HTMLDivElement[];

    expect(items.map((item) => [item.style.left, item.style.top])).toEqual([
      ['8px', '0px'],
      ['0px', '16px'],
      ['16px', '16px'],
    ]);
    expect(items.map((item) => item.style.width)).toEqual(['16px', '16px', '16px']);
  });
});
