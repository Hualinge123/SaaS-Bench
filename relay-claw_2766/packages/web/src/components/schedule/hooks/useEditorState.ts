import { useState, useCallback } from 'react';
import type { ScheduleTaskDraft } from '../schedule-template-types';
import type { ScheduleIntervalUnit } from '../schedule-template-types';
import {
  ALL_WEEKDAYS,
  normalizeTimeValue,
  trimSeconds,
  sortWeekdays,
  getDefaultSessionId,
  buildEffectiveTimeFromPreset,
  parsePositiveInteger,
  joinTimeValue,
  toDateValue,
  EffectivePreset,
  splitTimeValue,
} from '../utils/editor';
import { intervalValueToMs } from '../utils';

type EditorFrequencyMode = 'daily' | 'interval' | 'once';
type SessionMode = 'existing' | 'new';

export interface EditorState {
  source: ScheduleTaskDraft['source'];
  templateId?: string;
  taskName: string;
  prompt: string;
  frequencyMode: EditorFrequencyMode;
  time: string;
  intervalValue: string;
  intervalUnit: ScheduleIntervalUnit;
  onceDate: string;
  onceTime: string;
  weekdays: string[];
  effectivePreset: EffectivePreset;
  sessionMode: SessionMode;
  sessionId: string;
  enabled: boolean;
}

export function createEditorState(draft: ScheduleTaskDraft | null): EditorState {
  if (!draft) {
    return {
      source: 'custom',
      taskName: '',
      prompt: '',
      frequencyMode: 'daily',
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute',
      onceDate: '',
      onceTime: '',
      weekdays: [...ALL_WEEKDAYS],
      effectivePreset: '',
      sessionMode: 'existing',
      sessionId: getDefaultSessionId('existing'),
      enabled: true,
    };
  }

  const baseState: EditorState = {
    source: draft.source,
    templateId: draft.templateId,
    taskName: draft.taskName,
    prompt: draft.prompt,
    frequencyMode: 'daily',
    time: '',
    intervalValue: '1',
    intervalUnit: 'minute',
    onceDate: '',
    onceTime: '',
    weekdays: [...ALL_WEEKDAYS],
    effectivePreset: '',
    sessionMode: 'existing',
    sessionId: draft.sessionId ?? '',
    enabled: draft.enabled,
  };

  if ((draft.sessionId ?? '').startsWith('mock-new-session')) {
    baseState.sessionMode = 'new';
  }

  if (draft.frequency.type === 'daily') {
    baseState.frequencyMode = 'daily';
    baseState.time = trimSeconds(draft.frequency.time);
    baseState.weekdays = [...ALL_WEEKDAYS];
  }

  if (draft.frequency.type === 'weekday') {
    baseState.frequencyMode = 'daily';
    baseState.time = trimSeconds(draft.frequency.time);
    baseState.weekdays = sortWeekdays(draft.frequency.weekdays);
  }

  if (draft.frequency.type === 'interval') {
    baseState.frequencyMode = 'interval';
    baseState.intervalValue = `${draft.frequency.interval}`;
    baseState.intervalUnit = draft.frequency.unit;
  }

  if (draft.frequency.type === 'once') {
    const [date = '', time = ''] = draft.frequency.executeTime.split(' ');
    baseState.frequencyMode = 'once';
    baseState.onceDate = date;
    baseState.onceTime = trimSeconds(time);
  }

  return baseState;
}

export function buildNormalizedDraft(state: EditorState): ScheduleTaskDraft {
  const normalizedTime = normalizeTimeValue(state.time);
  const effectiveTime = state.frequencyMode === 'once' ? undefined : buildEffectiveTimeFromPreset(state.effectivePreset);

  if (state.frequencyMode === 'interval') {
    return {
      source: state.source,
      ...(state.templateId ? { templateId: state.templateId } : {}),
      taskName: state.taskName.trim(),
      prompt: state.prompt.trim(),
      frequency: {
        type: 'interval',
        interval: Number(state.intervalValue),
        unit: state.intervalUnit,
      },
      enabled: state.enabled,
      ...(effectiveTime ? { effectiveTime } : {}),
      sessionId: state.sessionId,
    };
  }

  if (state.frequencyMode === 'once') {
    return {
      source: state.source,
      ...(state.templateId ? { templateId: state.templateId } : {}),
      taskName: state.taskName.trim(),
      prompt: state.prompt.trim(),
      frequency: {
        type: 'once',
        executeTime: `${state.onceDate} ${normalizeTimeValue(state.onceTime)}`,
      },
      enabled: state.enabled,
      sessionId: state.sessionId,
    };
  }

  const sortedWeekdays = sortWeekdays(state.weekdays);
  const frequency =
    sortedWeekdays.length === ALL_WEEKDAYS.length
      ? { type: 'daily' as const, time: normalizedTime }
      : { type: 'weekday' as const, time: normalizedTime, weekdays: sortedWeekdays };

  return {
    source: state.source,
    ...(state.templateId ? { templateId: state.templateId } : {}),
    taskName: state.taskName.trim(),
    prompt: state.prompt.trim(),
    frequency,
    enabled: state.enabled,
    ...(effectiveTime ? { effectiveTime } : {}),
    sessionId: state.sessionId,
  };
}

export function useEditorState(initialDraft: ScheduleTaskDraft | null) {
  const [editorState, setEditorState] = useState<EditorState>(() => createEditorState(initialDraft));
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const resetEditorState = useCallback((draft: ScheduleTaskDraft | null) => {
    setEditorState(createEditorState(draft));
    setTouchedFields(new Set());
  }, []);

  const markFieldTouched = useCallback((field: string) => {
    setTouchedFields((current) => new Set(current).add(field));
  }, []);

  const markFieldsTouched = useCallback((fields: string[]) => {
    setTouchedFields((current) => {
      const next = new Set(current);
      for (const field of fields) {
        next.add(field);
      }
      return next;
    });
  }, []);

  const handleWeekdayToggle = useCallback((weekday: string) => {
    setEditorState((current) => {
      const exists = current.weekdays.includes(weekday);
      if (exists && current.weekdays.length === 1) return current;
      return {
        ...current,
        weekdays: exists ? current.weekdays.filter((item) => item !== weekday) : sortWeekdays([...current.weekdays, weekday]),
      };
    });
    markFieldTouched('weekdays');
  }, [markFieldTouched]);

  const handleFrequencyModeChange = useCallback((mode: EditorFrequencyMode) => {
    setEditorState((current) => {
      if (mode === 'daily') {
        return {
          ...current,
          frequencyMode: 'daily',
          weekdays: current.weekdays.length > 0 ? current.weekdays : [...ALL_WEEKDAYS],
        };
      }
      return { ...current, frequencyMode: mode };
    });
  }, []);

  const handleSessionModeChange = useCallback((sessionMode: SessionMode) => {
    setEditorState((current) => ({
      ...current,
      sessionMode,
      sessionId: getDefaultSessionId(sessionMode),
    }));
  }, []);

  return {
    editorState,
    setEditorState,
    resetEditorState,
    handleWeekdayToggle,
    handleFrequencyModeChange,
    handleSessionModeChange,
    markFieldTouched,
    markFieldsTouched,
    touchedFields,
  };
}

export type ValidationErrors = Partial<Record<string, string>>;

export function useFormValidation(
  editorState: EditorState,
  touchedFields?: Set<string>,
  forceValidate: boolean = false,
): ValidationErrors {
  const errors: ValidationErrors = {};
  const validateAllByDefault = typeof touchedFields === 'undefined';
  const isFieldTouched = (field: string) => forceValidate || validateAllByDefault || touchedFields.has(field);

  if (isFieldTouched('taskName') && !editorState.taskName.trim()) {
    errors.taskName = '请输入任务名称';
  }
  if (isFieldTouched('prompt') && !editorState.prompt.trim()) {
    errors.prompt = '请输入提示词';
  }
  if (isFieldTouched('sessionId') && editorState.sessionMode === 'existing' && !editorState.sessionId) {
    errors.sessionId = '请选择会话';
  }

  if (editorState.frequencyMode === 'daily') {
    if (isFieldTouched('weekdays') && editorState.weekdays.length === 0) {
      errors.weekdays = '请选择至少一个执行日期';
    }
    if (isFieldTouched('time') && !editorState.time) {
      errors.time = '请选择执行时间';
    }
  }

  if (editorState.frequencyMode === 'interval') {
    const intervalValue = parsePositiveInteger(editorState.intervalValue);
    if (isFieldTouched('intervalValue') && (intervalValue === null || intervalValueToMs(intervalValue, editorState.intervalUnit) < 10_000)) {
      errors.intervalValue = '间隔时间至少10秒';
    }
  }

  if (editorState.frequencyMode === 'once') {
    if (isFieldTouched('onceDate') && !editorState.onceDate) {
      errors.onceDate = '请选择执行日期';
    } else {
      const now = new Date();
      const todayValue = toDateValue(now);
      if (isFieldTouched('onceDate') && editorState.onceDate < todayValue) {
        errors.onceDate = '执行时间不能早于当前时间';
      }
    }
    if (isFieldTouched('onceTime') && !editorState.onceTime) {
      errors.onceTime = '请选择执行时间';
    } else if (isFieldTouched('onceTime') && editorState.onceDate === toDateValue(new Date())) {
      const { hour, minute } = splitTimeValue(editorState.onceTime);
      const now = new Date();
      const currentHour = `${now.getHours()}`.padStart(2, '0');
      const currentMinute = `${now.getMinutes()}`.padStart(2, '0');
      if (hour < currentHour || (hour === currentHour && minute < currentMinute)) {
        errors.onceTime = '执行时间不能早于当前时间';
      }
    }
  }

  return errors;
}
