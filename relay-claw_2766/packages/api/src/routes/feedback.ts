/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { IFeedbackStore, FeedbackRecord, FeedbackVote } from '../domains/agents/services/stores/ports/FeedbackStore.js';
import type { IMessageStore, StoredMessage } from '../domains/agents/services/stores/ports/MessageStore.js';
import { startApiTrace } from '../infrastructure/tracing/apm-tracing.js';
import { resolveUserId } from '../utils/request-identity.js';

export interface FeedbackRoutesOptions {
  feedbackStore: IFeedbackStore;
  messageStore: IMessageStore;
}

const submitFeedbackSchema = z
  .object({
    messageId: z.string().min(1).max(160),
    vote: z.union([z.literal(1), z.literal(-1)]),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildFeedbackRecord(message: StoredMessage, userId: string, vote: FeedbackVote, reason?: string): FeedbackRecord {
  const extra = message.extra as
    | {
        stream?: { invocationId?: string };
        trajectory?: FeedbackRecord['trajectory'];
        apmConversationReported?: boolean;
      }
    | undefined;
  const metadata = message.metadata as
    | (StoredMessage['metadata'] & {
        invocationId?: string;
        originalTraceId?: string;
        originalSpanId?: string;
        traceId?: string;
        spanId?: string;
        catId?: string;
        trajectory?: FeedbackRecord['trajectory'];
        apmConversationReported?: boolean;
      })
    | undefined;

  return {
    threadId: message.threadId,
    messageId: message.id,
    userId,
    vote,
    timestamp: Date.now(),
    invocationId: getString(metadata?.invocationId) ?? getString(extra?.stream?.invocationId),
    originalTraceId: getString(metadata?.originalTraceId) ?? getString(metadata?.traceId),
    originalSpanId: getString(metadata?.originalSpanId) ?? getString(metadata?.spanId),
    apmConversationReported: metadata?.apmConversationReported ?? extra?.apmConversationReported,
    trajectory: metadata?.trajectory ?? extra?.trajectory,
    model: getString(metadata?.model),
    provider: getString(metadata?.provider),
    catId: getString(metadata?.catId) ?? message.agentId ?? undefined,
    reason: vote === -1 ? (reason ?? null) : null,
  };
}

function toResponseRecord(record: FeedbackRecord, previousVote?: FeedbackVote | null) {
  return {
    vote: record.vote,
    ...(previousVote !== undefined ? { previousVote } : {}),
    timestamp: record.timestamp,
    model: record.model,
    provider: record.provider,
    reason: record.reason,
  };
}

function buildFeedbackTraceRequestBody(record: FeedbackRecord): string {
  return JSON.stringify({
    messageId: record.messageId,
    vote: record.vote,
    ...(record.reason ? { reason: record.reason } : {}),
  });
}

function parseFeedbackReason(reason: string | null | undefined): { values?: string; labels?: string; detail?: string } {
  if (!reason) return {};
  const parsed: { values?: string; labels?: string; detail?: string } = {};
  for (const segment of reason.split(';')) {
    const index = segment.indexOf('=');
    if (index <= 0) continue;
    const key = segment.slice(0, index);
    const value = segment.slice(index + 1);
    if (key === 'values' && value) parsed.values = value;
    if (key === 'labels' && value) parsed.labels = value;
    if (key === 'detail' && value) parsed.detail = value;
  }
  if (!parsed.values && !parsed.labels && !parsed.detail) {
    parsed.detail = reason;
  }
  return parsed;
}

export const feedbackRoutes: FastifyPluginAsync<FeedbackRoutesOptions> = async (app, opts) => {
  app.post('/api/feedback', async (request, reply) => {
    const parsed = submitFeedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parsed.error.issues };
    }

    const userId = resolveUserId(request, {});
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }

    const message = await opts.messageStore.getById(parsed.data.messageId);
    if (!message || message.deletedAt || message._tombstone) {
      reply.status(404);
      return { error: 'Message not found', code: 'MESSAGE_NOT_FOUND' };
    }
    if (message.userId !== userId) {
      reply.status(403);
      return { error: 'Access denied', code: 'UNAUTHORIZED' };
    }
    if (message.agentId === null) {
      reply.status(400);
      return { error: 'Only assistant messages can receive feedback', code: 'INVALID_MESSAGE_TYPE' };
    }

    const existing = await opts.feedbackStore.get(message.threadId, message.id, userId);

    const record = buildFeedbackRecord(message, userId, parsed.data.vote, parsed.data.reason);
    const feedbackTraceRequestBody = buildFeedbackTraceRequestBody(record);
    const feedbackReason = parseFeedbackReason(record.reason);
    const feedbackApiTrace = startApiTrace({
      spanName: 'POST /api/feedback',
      route: '/api/feedback',
      actualRoute: '/api/feedback',
      method: 'POST',
      threadId: record.threadId,
      messageId: record.messageId,
      userId: record.userId,
      invocationId: record.invocationId,
      parentTraceId: record.originalTraceId,
      parentSpanId: record.originalSpanId,
      attributes: {
        'http.request.body': feedbackTraceRequestBody,
        'http.request.body.content': feedbackTraceRequestBody,
        'request.body': feedbackTraceRequestBody,
        'jiuwen_claw.feedback.vote': record.vote === 1 ? 'like' : 'dislike',
        'jiuwen_claw.feedback.vote_value': record.vote,
        'jiuwen_claw.feedback.previous_vote':
          existing?.vote === 1 ? 'like' : existing?.vote === -1 ? 'dislike' : undefined,
        'jiuwen_claw.feedback.reason': record.reason ?? undefined,
        'jiuwen_claw.feedback.reason_values': feedbackReason.values,
        'jiuwen_claw.feedback.reason_labels': feedbackReason.labels,
        'jiuwen_claw.feedback.reason_detail': feedbackReason.detail,
        'jiuwen_claw.feedback.timestamp_ms': record.timestamp,
        'jiuwen_claw.api.route_alias': '/apifeedback',
        'jiuwen_claw.original_trace.id': record.originalTraceId,
        'jiuwen_claw.original_span.id': record.originalSpanId,
        'jiuwen_claw.agent.id': record.catId,
        'llm.request.model': record.model,
        'llm.provider': record.provider,
        'trajectory.id': record.trajectory?.trajectoryId,
        'trajectory.run.id': record.trajectory?.trajectoryRunId,
        'trajectory.step.id': record.trajectory?.trajectoryStepId,
        'trajectory.event.ids': record.trajectory?.trajectoryEventIds?.join(','),
        'trajectory.event.names': record.trajectory?.trajectoryEventNames?.join(','),
      },
    });
    try {
      await opts.feedbackStore.set(record);
      feedbackApiTrace?.addEvent('conversation.feedback', {
        'http.request.body': feedbackTraceRequestBody,
        'jiuwen_claw.feedback.vote': record.vote === 1 ? 'like' : 'dislike',
        'jiuwen_claw.feedback.vote_value': record.vote,
        'jiuwen_claw.feedback.reason': record.reason ?? undefined,
        'jiuwen_claw.feedback.reason_values': feedbackReason.values,
        'jiuwen_claw.feedback.reason_labels': feedbackReason.labels,
        'jiuwen_claw.feedback.reason_detail': feedbackReason.detail,
      });
      feedbackApiTrace?.endOk();
    } catch (err) {
      feedbackApiTrace?.endError(err);
      throw err;
    }

    reply.status(existing ? 200 : 201);
    return toResponseRecord(record, existing?.vote ?? null);
  });

  app.get<{ Params: { threadId: string } }>('/api/feedback/by-thread/:threadId', async (request, reply) => {
    const userId = resolveUserId(request, {});
    if (!userId) {
      reply.status(401);
      return { error: 'Identity required' };
    }

    const records = await opts.feedbackStore.getByThread(request.params.threadId, userId);
    const response: Record<string, { vote: FeedbackVote; reason: string | null; timestamp: number }> = {};
    for (const [messageId, record] of Object.entries(records)) {
      response[messageId] = {
        vote: record.vote,
        reason: record.reason,
        timestamp: record.timestamp,
      };
    }
    return response;
  });
};
