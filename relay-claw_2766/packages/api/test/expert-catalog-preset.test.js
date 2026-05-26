/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('experts preset loads successfully into the expert catalog', async () => {
  const catalogPath = resolve(process.cwd(), '..', '..', 'experts-preset.json');
  const { getExpertCatalog, initExpertCatalog } = await import('../dist/domains/agents/services/experts/ExpertCatalog.js');
  const builtinSkills = new Set([
    'minimax-pdf',
    'minimax-xlsx',
    'official-doc-formatter',
    'pptx-craft',
    'ppt-template-generate',
    'meeting-autopilot-pro',
    'email-manager',
    'daily-briefing',
    'knowledge-organizer-xiaping',
    'lidan-writing-framework',
    'canned-responses-review',
    'openai-whisper-cn',
    'skill-creator',
    'skill-vetter',
  ]);

  initExpertCatalog(catalogPath);

  const catalog = getExpertCatalog();
  assert.equal(catalog.isInitialized, true);
  const experts = catalog.getAllExperts();
  assert.ok(experts.length > 0);
  for (const expert of experts) {
    assert.equal(expert.defaultModel, 'glm-5.1');
    assert.equal(expert.nickname, expert.displayName);
    for (const skill of expert.skills ?? []) {
      assert.equal(builtinSkills.has(skill), true, `skill ${skill} must be builtin`);
    }
  }
});
