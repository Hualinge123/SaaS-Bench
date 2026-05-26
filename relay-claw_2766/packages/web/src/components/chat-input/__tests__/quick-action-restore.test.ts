import { describe, expect, it } from 'vitest';
import { getQuickActionToken, restoreQuickActionTokensFromSendText } from '../utils/helpers';

describe('restoreQuickActionTokensFromSendText', () => {
  it('restores a leading quick action label into its rich input token', () => {
    expect(restoreQuickActionTokensFromSendText('定时任务 每日 10:00 提醒我喝水')).toBe(
      `${getQuickActionToken('定时任务')} 每日 10:00 提醒我喝水`,
    );
  });

  it('does not restore labels embedded in ordinary words', () => {
    expect(restoreQuickActionTokensFromSendText('数据分析报告帮我整理一下')).toBe('数据分析报告帮我整理一下');
  });

  it('leaves existing quick action tokens unchanged', () => {
    const tokenized = `${getQuickActionToken('幻灯片')} 帮我做一页发布会 PPT`;
    expect(restoreQuickActionTokensFromSendText(tokenized)).toBe(tokenized);
  });
});
