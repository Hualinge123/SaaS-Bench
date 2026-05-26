'use client';

import { type ThemeType } from '@/hooks/useTheme';
import { DesktopCloseActionSetting } from './DesktopCloseActionSetting';
import { UserThemePicker } from './UserThemePicker';
import { ToggleSwitch } from './shared/ToggleSwitch';

interface GeneralSettingsTabProps {
  keepAwakeEnabled: boolean;
  isKeepAwakeLoading: boolean;
  isKeepAwakeSaving: boolean;
  onToggleKeepAwake: (checked: boolean) => void;
  theme: ThemeType;
  onSelectTheme: (theme: ThemeType) => void;
  active: boolean;
}

export function GeneralSettingsTab({
  keepAwakeEnabled,
  isKeepAwakeLoading,
  isKeepAwakeSaving,
  onToggleKeepAwake,
  theme,
  onSelectTheme,
  active,
}: GeneralSettingsTabProps) {
  return (
    <>
      <section>
        <div className='flex items-center justify-between gap-3'>
          <h4 className='min-w-0 flex-1 text-[14px] font-medium leading-[22px] text-[var(--text-primary)]'>防休眠</h4>
          <ToggleSwitch
            checked={keepAwakeEnabled}
            onToggle={onToggleKeepAwake}
            ariaLabel='切换防休眠'
            disabled={isKeepAwakeLoading || isKeepAwakeSaving}
            testId='user-settings-keep-awake-switch'
          />
        </div>
        <p className='mt-1 text-[12px] leading-[20px] text-[var(--text-secondary)]'>
          开启后电脑不会进入休眠模式，方便远程操控以及自动化任务持续执行。
        </p>
      </section>
      <section>
        <h4 className='text-[14px] font-medium leading-[22px] text-[var(--text-primary)]'>主题模式</h4>
        <div className='mt-2'>
          <UserThemePicker theme={theme} onSelectTheme={onSelectTheme} />
        </div>
      </section>
      <DesktopCloseActionSetting enabled={active} />
    </>
  );
}
