/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { trace } from '@opentelemetry/api';

test('POST /api/feedback keeps like submission successful when APM span creation fails', async () => {
  const { feedbackRoutes } = await import('../dist/routes/feedback.js');
  const { FeedbackStore } = await import('../dist/domains/agents/services/stores/ports/FeedbackStore.js');
  const { MessageStore } = await import('../dist/domains/agents/services/stores/ports/MessageStore.js');
  const { initApmTracingFromEnv, shutdownApmTracing } = await import('../dist/infrastructure/tracing/apm-tracing.js');

  const warnings = [];
  const log = {
    warn(obj, msg) {
      warnings.push({ obj, msg });
    },
  };
  initApmTracingFromEnv({ APM_TRACING_ENABLED: 'true' }, log);

  const originalGetTracer = trace.getTracer;
  trace.getTracer = () => ({
    startSpan() {
      throw new Error('apm start failed');
    },
  });

  const app = Fastify();
  try {
    const messageStore = new MessageStore();
    const feedbackStore = new FeedbackStore();
    const message = messageStore.append({
      threadId: 'thread-1',
      userId: 'user-1',
      content: 'assistant answer',
      agentId: 'opus',
      mentions: [],
      timestamp: Date.now(),
      metadata: {
        originalTraceId: '1'.repeat(32),
        originalSpanId: '2'.repeat(16),
      },
    });

    await app.register(feedbackRoutes, { feedbackStore, messageStore });

    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { 'x-office-claw-user': 'user-1' },
      payload: { messageId: message.id, vote: 1 },
    });

    assert.equal(response.statusCode, 201);
    const payload = JSON.parse(response.payload);
    assert.equal(payload.vote, 1);
    assert.equal(payload.previousVote, null);
    assert.equal(payload.reason, null);
    assert.equal(typeof payload.timestamp, 'number');
    assert.equal((await feedbackStore.get('thread-1', message.id, 'user-1'))?.vote, 1);
    assert.ok(warnings.some((entry) => typeof entry.msg === 'string' && entry.msg.includes('api span start failed')));
  } finally {
    trace.getTracer = originalGetTracer;
    await app.close();
    await shutdownApmTracing();
  }
});
