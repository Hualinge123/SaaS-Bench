'use client';

import {
  type DesktopCloseAction,
  useDesktopCloseActionSetting,
} from '@/hooks/useDesktopCloseActionSetting';
import { Select } from '@/components/shared/Select';

const CLOSE_ACTION_OPTIONS: Array<{ value: DesktopCloseAction; label: string }> = [
  { value: 'ask', label: '每次询问' },
  { value: 'minimize', label: '最小化到托盘' },
  { value: 'exit', label: '直接退出' },
];

export function DesktopCloseActionSetting({ enabled }: { enabled: boolean }) {
  const { closeAction, setCloseAction } = useDesktopCloseActionSetting(enabled);

  return (
    <section>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <h4 className='text-[14px] font-medium leading-[22px] text-[var(--text-primary)]'>关闭窗口行为设置</h4>
        </div>
        <Select
          value={closeAction}
          options={CLOSE_ACTION_OPTIONS}
          onChange={(value) => setCloseAction(value)}
          aria-label='选择关闭窗口行为'
          data-testid='user-settings-desktop-close-action-select'
          className='w-[200px]'
        />
      </div>
    </section>
  );
}