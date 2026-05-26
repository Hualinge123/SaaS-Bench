/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { AppModal } from '../AppModal';
import { Button } from '../shared/Button';
import type { SupportLogArchive } from './useSupportLogCollector';

interface SupportLogCollectionModalProps {
  open: boolean;
  status: 'idle' | 'collecting' | 'ready' | 'error';
  archive: SupportLogArchive | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function SupportLogCollectionModal({
  open,
  status,
  archive,
  error,
  onClose,
  onRetry,
}: SupportLogCollectionModalProps) {
  const isCollecting = status === 'collecting';

  return (
    <AppModal
      open={open}
      onClose={isCollecting ? () => {} : onClose}
      title="收集日志"
      panelClassName="w-[420px]"
      panelTestId="support-log-collection-modal"
      disableBackdropClose={isCollecting}
    >
      <div className="space-y-5 text-[14px] leading-[22px] text-[var(--text-primary)]">
        {isCollecting ? (
          <div className="flex items-center gap-3 py-2">
            <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--panel-divider)] border-t-[var(--switch-on-bg)]" />
            <span>正在收集近三天日志并压缩，请稍候...</span>
          </div>
        ) : null}

        {status === 'ready' && archive ? (
          <div className="space-y-2">
            <p>日志收集完成。</p>
            <p className="text-[12px] leading-[20px] text-[var(--text-secondary)]">
              {archive.fileName}
              {archive.fileCount !== null ? `，包含 ${archive.fileCount} 个日志文件` : ''}
            </p>
          </div>
        ) : null}

        {status === 'error' ? (
          <p className="text-[var(--danger-text,#d92d20)]">{error || '日志收集失败，请稍后重试。'}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          {status === 'ready' && archive ? (
            <a href={archive.objectUrl} download={archive.fileName} target="_blank" rel="noreferrer">
              <Button variant="major" className="h-8 px-4 text-[13px]">
                查看日志包
              </Button>
            </a>
          ) : null}
          {status === 'error' ? (
            <Button variant="major" className="h-8 px-4 text-[13px]" onClick={onRetry}>
              重新收集
            </Button>
          ) : null}
          <Button variant="default" className="h-8 px-4 text-[13px]" onClick={onClose} disabled={isCollecting}>
            {status === 'ready' ? '关闭' : '取消'}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
