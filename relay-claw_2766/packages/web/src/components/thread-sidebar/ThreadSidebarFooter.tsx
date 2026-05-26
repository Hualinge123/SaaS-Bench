/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import React from 'react';
import { UserProfile } from '../UserProfile';
import { WechatGroupInvite } from './WechatGroupInvite';

interface ThreadSidebarFooterProps {
  isSidebarCollapsedLayout: boolean;
  sidebarContentRevealClassName: string;
}

export function ThreadSidebarFooter({
  isSidebarCollapsedLayout,
  sidebarContentRevealClassName,
}: ThreadSidebarFooterProps) {
  return (
    <>
      {!isSidebarCollapsedLayout && (
        <div className={`transition-[opacity,transform] duration-150 ease-out ${sidebarContentRevealClassName}`}>
          <WechatGroupInvite />
        </div>
      )}

      {!isSidebarCollapsedLayout && <div className="mx-4 border-t border-[var(--border-default)]" />}

      <UserProfile collapsed={isSidebarCollapsedLayout} />
    </>
  );
}
