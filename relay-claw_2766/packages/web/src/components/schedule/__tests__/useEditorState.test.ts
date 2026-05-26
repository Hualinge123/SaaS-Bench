/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { describe, expect, it } from 'vitest';
import type { ScheduleTaskDraft } from '../schedule-template-types';
import type { ScheduleIntervalUnit } from '../schedule-template-types';
import {
  createEditorState,
  buildNormalizedDraft,
  useFormValidation,
} from '../hooks/useEditorState';
import {
  normalizeTimeValue,
  trimSeconds,
  sortWeekdays,
  parsePositiveInteger,
  joinTimeValue,
  toDateValue,
  splitTimeValue,
  addPresetRange,
  buildEffectiveTimeFromPreset,
  ALL_WEEKDAYS,
} from '../utils/editor';
import { intervalValueToMs } from '../utils';

// =============================================================================
// normalizeTimeValue Tests
// =============================================================================

describe('normalizeTimeValue', () => {
  it('空字符串返回默认 00:00:00', () => {
    expect(normalizeTimeValue('')).toBe('00:00:00');
  });

  it('5位格式补秒', () => {
    expect(normalizeTimeValue('09:30')).toBe('09:30:00');
  });

  it('8位格式保持不变', () => {
    expect(normalizeTimeValue('09:30:45')).toBe('09:30:45');
  });

  it('其他值保持不变', () => {
    expect(normalizeTimeValue('abc')).toBe('abc');
  });
});

// =============================================================================
// trimSeconds Tests
// =============================================================================

describe('trimSeconds', () => {
  it('8位格式截取前5位', () => {
    expect(trimSeconds('09:30:45')).toBe('09:30');
  });

  it('5位格式保持不变', () => {
    expect(trimSeconds('09:30')).toBe('09:30');
  });

  it('短于5位返回原值', () => {
    expect(trimSeconds('9:3')).toBe('9:3');
    expect(trimSeconds('')).toBe('');
  });
});

// =============================================================================
// sortWeekdays Tests
// =============================================================================

describe('sortWeekdays', () => {
  it('按数字排序', () => {
    expect(sortWeekdays(['7', '1', '3'])).toEqual(['1', '3', '7']);
    expect(sortWeekdays(['5', '2', '6', '1'])).toEqual(['1', '2', '5', '6']);
  });

  it('不改变已排序数组', () => {
    expect(sortWeekdays(['1', '2', '3'])).toEqual(['1', '2', '3']);
  });

  it('返回新数组不修改原数组', () => {
    const original = ['7', '1'];
    const sorted = sortWeekdays(original);
    expect(original).toEqual(['7', '1']);
    expect(sorted).not.toBe(original);
  });
});

// =============================================================================
// parsePositiveInteger Tests
// =============================================================================

describe('parsePositiveInteger', () => {
  it('解析有效正整数', () => {
    expect(parsePositiveInteger('1')).toBe(1);
    expect(parsePositiveInteger('100')).toBe(100);
    expect(parsePositiveInteger('999')).toBe(999);
  });

  it('忽略前后空白', () => {
    expect(parsePositiveInteger('  5  ')).toBe(5);
  });

  // 边界值测试
  it('空字符串返回 null', () => {
    expect(parsePositiveInteger('')).toBeNull();
  });

  it('零返回 null', () => {
    expect(parsePositiveInteger('0')).toBeNull();
  });

  it('负数返回 null', () => {
    expect(parsePositiveInteger('-1')).toBeNull();
  });

  it('小数返回 null', () => {
    expect(parsePositiveInteger('1.5')).toBeNull();
    expect(parsePositiveInteger('0.1')).toBeNull();
  });

  it('非数字字符串返回 null', () => {
    expect(parsePositiveInteger('abc')).toBeNull();
    expect(parsePositiveInteger('12a')).toBeNull();
    expect(parsePositiveInteger('')).toBeNull();
  });

  it('带空格的数字字符串返回 null', () => {
    expect(parsePositiveInteger('  ')).toBeNull();
  });
});

// =============================================================================
// joinTimeValue Tests
// =============================================================================

describe('joinTimeValue', () => {
  it('正确拼接时分', () => {
    expect(joinTimeValue('09', '30')).toBe('09:30');
    expect(joinTimeValue('00', '00')).toBe('00:00');
    expect(joinTimeValue('23', '59')).toBe('23:59');
  });
});

// =============================================================================
// splitTimeValue Tests
// =============================================================================

describe('splitTimeValue', () => {
  it('正确拆分时间字符串', () => {
    expect(splitTimeValue('09:30')).toEqual({ hour: '09', minute: '30' });
    expect(splitTimeValue('00:00')).toEqual({ hour: '00', minute: '00' });
  });

  it('处理带秒的时间', () => {
    expect(splitTimeValue('09:30:45')).toEqual({ hour: '09', minute: '30' });
  });

  it('空值默认返回 00:00', () => {
    expect(splitTimeValue('')).toEqual({ hour: '00', minute: '00' });
  });
});

// =============================================================================
// toDateValue Tests
// =============================================================================

describe('toDateValue', () => {
  it('正确格式化日期', () => {
    const date = new Date(2026, 0, 15); // 2026年1月15日
    expect(toDateValue(date)).toBe('2026-01-15');
  });

  it('补零处理', () => {
    const date = new Date(2026, 0, 5); // 1月5日
    expect(toDateValue(date)).toBe('2026-01-05');
  });
});

// =============================================================================
// addPresetRange Tests
// =============================================================================

describe('addPresetRange', () => {
  it('week 增加7天', () => {
    const base = new Date(2026, 0, 15);
    const result = addPresetRange(base, 'week');
    expect(result.getDate()).toBe(22);
  });

  it('month 增加1个月', () => {
    const base = new Date(2026, 0, 15);
    const result = addPresetRange(base, 'month');
    expect(result.getMonth()).toBe(1);
  });

  it('quarter 增加3个月', () => {
    const base = new Date(2026, 0, 15);
    const result = addPresetRange(base, 'quarter');
    expect(result.getMonth()).toBe(3);
  });

  it('year 增加1年', () => {
    const base = new Date(2026, 0, 15);
    const result = addPresetRange(base, 'year');
    expect(result.getFullYear()).toBe(2027);
  });

  it('空 preset 不改变日期', () => {
    const base = new Date(2026, 0, 15);
    const result = addPresetRange(base, '');
    expect(result.getTime()).toBe(base.getTime());
  });
});

// =============================================================================
// buildEffectiveTimeFromPreset Tests
// =============================================================================

describe('buildEffectiveTimeFromPreset', () => {
  it('空 preset 返回 undefined', () => {
    expect(buildEffectiveTimeFromPreset('')).toBeUndefined();
  });

  it('week preset 返回有效时间范围', () => {
    const result = buildEffectiveTimeFromPreset('week');
    expect(result).toBeDefined();
    expect(result!.startTime).toBeDefined();
    expect(result!.endTime).toBeDefined();
  });

  it('时间范围 endTime 在 startTime 之后', () => {
    const result = buildEffectiveTimeFromPreset('month');
    expect(new Date(result!.endTime).getTime()).toBeGreaterThan(
      new Date(result!.startTime).getTime()
    );
  });
});

// =============================================================================
// createEditorState Tests
// =============================================================================

describe('createEditorState', () => {
  it('null draft 返回默认状态', () => {
    const state = createEditorState(null);

    expect(state.source).toBe('custom');
    expect(state.taskName).toBe('');
    expect(state.prompt).toBe('');
    expect(state.frequencyMode).toBe('daily');
    expect(state.time).toBe('');
    expect(state.intervalValue).toBe('1');
    expect(state.intervalUnit).toBe('minute');
    expect(state.onceDate).toBe('');
    expect(state.onceTime).toBe('');
    expect(state.weekdays).toEqual([...ALL_WEEKDAYS]);
    expect(state.enabled).toBe(true);
    expect(state.sessionMode).toBe('existing');
  });

  it('non-once draft 不注入默认的 onceTime', () => {
    const draft: ScheduleTaskDraft = {
      source: 'template',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'daily', time: '09:00:00' },
      enabled: true,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.onceTime).toBe('');
  });

  it('daily 类型 draft 正确转换', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'daily', time: '09:30:00' },
      enabled: true,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.frequencyMode).toBe('daily');
    expect(state.time).toBe('09:30');
    expect(state.weekdays).toEqual([...ALL_WEEKDAYS]);
  });

  it('weekday 类型 draft 正确转换', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'weekday', time: '10:00:00', weekdays: ['1', '3', '5'] },
      enabled: true,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.frequencyMode).toBe('daily');
    expect(state.time).toBe('10:00');
    expect(state.weekdays).toEqual(['1', '3', '5']);
  });

  it('interval 类型 draft 正确转换', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'interval', interval: 30, unit: 'minute' as ScheduleIntervalUnit },
      enabled: true,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.frequencyMode).toBe('interval');
    expect(state.intervalValue).toBe('30');
    expect(state.intervalUnit).toBe('minute');
  });

  it('once 类型 draft 正确转换', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'once', executeTime: '2026-05-20 14:30:00' },
      enabled: true,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.frequencyMode).toBe('once');
    expect(state.onceDate).toBe('2026-05-20');
    expect(state.onceTime).toBe('14:30');
  });

  it('sessionId 以 mock-new-session 开头时 sessionMode 为 new', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'daily', time: '09:00:00' },
      enabled: true,
      sessionId: 'mock-new-session-xxx',
    };

    const state = createEditorState(draft);

    expect(state.sessionMode).toBe('new');
  });

  it('template draft 保留 templateId', () => {
    const draft: ScheduleTaskDraft = {
      source: 'template',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'daily', time: '09:00:00' },
      enabled: true,
      templateId: 'template-123',
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.templateId).toBe('template-123');
  });

  // 边界值测试
  it('draft 的 sessionId 为 null 时 sessionMode 为 existing', () => {
    const draft: ScheduleTaskDraft = {
      source: 'custom',
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequency: { type: 'daily', time: '09:00:00' },
      enabled: false,
      sessionId: null,
    };

    const state = createEditorState(draft);

    expect(state.sessionMode).toBe('existing');
    expect(state.sessionId).toBe('');
  });
});

// =============================================================================
// buildNormalizedDraft Tests
// =============================================================================

describe('buildNormalizedDraft', () => {
  it('interval 类型正确构建', () => {
    const state = {
      source: 'custom' as const,
      taskName: '  Test Task  ',
      prompt: '  Test prompt  ',
      frequencyMode: 'interval' as const,
      time: '09:00',
      intervalValue: '30',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1', '2', '3'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.frequency.type).toBe('interval');
    expect(draft.frequency.interval).toBe(30);
    expect(draft.frequency.unit).toBe('minute');
    expect(draft.taskName).toBe('Test Task');
    expect(draft.prompt).toBe('Test prompt');
  });

  it('once 类型正确构建', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Test Task',
      prompt: 'Test prompt',
      frequencyMode: 'once' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'hour' as ScheduleIntervalUnit,
      onceDate: '2026-05-20',
      onceTime: '14:30',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-123',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.frequency.type).toBe('once');
    expect(draft.frequency.executeTime).toBe('2026-05-20 14:30:00');
  });

  it('daily 类型（全周）正确构建', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Daily Task',
      prompt: 'Daily prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [...ALL_WEEKDAYS],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.frequency.type).toBe('daily');
    expect(draft.frequency.time).toBe('09:00:00');
  });

  it('weekday 类型（部分周）正确构建', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Weekday Task',
      prompt: 'Weekday prompt',
      frequencyMode: 'daily' as const,
      time: '10:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '10:00',
      weekdays: ['1', '3', '5'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: false,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.frequency.type).toBe('weekday');
    expect(draft.frequency.time).toBe('10:00:00');
    expect(draft.frequency.weekdays).toEqual(['1', '3', '5']);
  });

  it('带 templateId 时包含该字段', () => {
    const state = {
      source: 'template' as const,
      templateId: 'template-abc',
      taskName: 'Template Task',
      prompt: 'Template prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [...ALL_WEEKDAYS],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.templateId).toBe('template-abc');
  });

  it('effectivePreset 设为 week 时包含 effectiveTime', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Task',
      prompt: 'Prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [...ALL_WEEKDAYS],
      effectivePreset: 'week' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.effectiveTime).toBeDefined();
    expect(draft.effectiveTime!.startTime).toBeDefined();
    expect(draft.effectiveTime!.endTime).toBeDefined();
  });

  // 边界值测试
  it('taskName 和 prompt 的空白被正确 trim', () => {
    const state = {
      source: 'custom' as const,
      taskName: '  Trimmed Task  ',
      prompt: '  Trimmed Prompt  ',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [...ALL_WEEKDAYS],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const draft = buildNormalizedDraft(state);

    expect(draft.taskName).toBe('Trimmed Task');
    expect(draft.prompt).toBe('Trimmed Prompt');
  });
});

// =============================================================================
// useFormValidation Tests
// =============================================================================

describe('useFormValidation', () => {
  it('taskName 为空时有 taskName 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: '',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.taskName).toBe('请输入任务名称');
  });

  it('prompt 为空时有 prompt 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: '',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.prompt).toBe('请输入提示词');
  });

  it('sessionId 为空时有 sessionId 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.sessionId).toBe('请选择会话');
  });

  it('daily 类型 weekdays 为空时有 weekdays 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.weekdays).toBe('请选择至少一个执行日期');
  });

  it('daily 类型 time 为空时有 time 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.time).toBe('请选择执行时间');
  });

  it('daily 类型条件都满足返回空错误对象', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('interval 类型间隔小于10秒时有 intervalValue 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '5', // 5秒
      intervalUnit: 'second' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('interval 类型间隔大于等于10秒返回空错误对象', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '10', // 10秒
      intervalUnit: 'second' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('interval 类型 invalid interval value 有 intervalValue 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: 'abc',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('once 类型 onceDate 为空时有 onceDate 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '14:30',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.onceDate).toBe('请选择执行日期');
  });

  it('once 类型 onceTime 为空时有 onceTime 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '2026-05-20',
      onceTime: '',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.onceTime).toBe('请选择执行时间');
  });

  it('once 类型日期在今天之前时有 onceDate 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '2020-01-01', // 过去的日期
      onceTime: '14:30',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    expect(errors.onceDate).toBe('执行时间不能早于当前时间');
  });

  it('once 类型日期在今天或之后且时间有效返回空错误对象', () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: todayStr,
      onceTime: '23:59',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

// =============================================================================
// useFormValidation field-level error Tests
// =============================================================================

describe('useFormValidation field-level errors', () => {
  it('AC1: taskName 为空时返回 taskName 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: '',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.taskName).toBe('请输入任务名称');
  });

  it('AC1: taskName 有值时无 taskName 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.taskName).toBeUndefined();
  });

  it('AC2: prompt 为空时返回 prompt 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: '',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.prompt).toBe('请输入提示词');
  });

  it('AC2: prompt 有值时无 prompt 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.prompt).toBeUndefined();
  });

  it('AC3: daily 模式 weekdays 为空时返回 weekdays 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.weekdays).toBe('请选择至少一个执行日期');
  });

  it('AC4: daily 模式 time 为空时返回 time 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.time).toBe('请选择执行时间');
  });

  it('AC5: interval 模式间隔小于10秒时返回 intervalValue 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '5',
      intervalUnit: 'second' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('AC5: interval 模式间隔值为0时返回错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '0',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('AC5: interval 模式间隔值为负数时返回错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '-1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('AC5: interval 模式间隔值为非数字时返回错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: 'abc',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.intervalValue).toBe('间隔时间至少10秒');
  });

  it('AC5: interval 模式间隔大于等于10秒时无 intervalValue 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'interval' as const,
      time: '',
      intervalValue: '10',
      intervalUnit: 'second' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.intervalValue).toBeUndefined();
  });

  it('AC6: once 模式 onceDate 为空时返回 onceDate 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '14:30',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.onceDate).toBe('请选择执行日期');
  });

  it('AC6: once 模式 onceTime 为空时返回 onceTime 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '2026-05-25',
      onceTime: '',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.onceTime).toBe('请选择执行时间');
  });

  it('AC7: once 模式日期在今天之前时返回 onceDate 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'once' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '2020-01-01',
      onceTime: '14:30',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.onceDate).toBe('执行时间不能早于当前时间');
  });

  it('AC8: existing 模式 sessionId 为空时返回 sessionId 错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.sessionId).toBe('请选择会话');
  });

  it('AC8: new 模式 sessionId 为空时无 sessionId 错误（新建会话不需要选）', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'new' as const,
      sessionId: '',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.sessionId).toBeUndefined();
  });

  it('所有字段都有效时返回空对象', () => {
    const state = {
      source: 'custom' as const,
      taskName: 'Valid Name',
      prompt: 'Valid prompt',
      frequencyMode: 'daily' as const,
      time: '09:00',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: ['1'],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: 'session-1',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('多个字段无效时返回多个错误', () => {
    const state = {
      source: 'custom' as const,
      taskName: '',
      prompt: '',
      frequencyMode: 'daily' as const,
      time: '',
      intervalValue: '1',
      intervalUnit: 'minute' as ScheduleIntervalUnit,
      onceDate: '',
      onceTime: '09:00',
      weekdays: [],
      effectivePreset: '' as const,
      sessionMode: 'existing' as const,
      sessionId: '',
      enabled: true,
    };

    const errors = useFormValidation(state);
    expect(errors.taskName).toBe('请输入任务名称');
    expect(errors.prompt).toBe('请输入提示词');
    expect(errors.weekdays).toBe('请选择至少一个执行日期');
    expect(errors.time).toBe('请选择执行时间');
    expect(errors.sessionId).toBe('请选择会话');
  });
});
