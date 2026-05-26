/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/** User/assistant bubble toolbar time — current year omits year prefix. */
export function formatUserMessageSentTime(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const clock = `${hours}:${minutes}`;
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${month}/${day} ${clock}`;
  }
  return `${d.getFullYear()}/${month}/${day} ${clock}`;
}

type AssistantStreamTimeFields = {
  durationMs?: number;
  completedAt?: number;
};

/** Persist/display: answer completion instant for an assistant bubble. */
export function computeAssistantStreamCompletedAt(
  timestamp: number,
  stream?: AssistantStreamTimeFields,
  fallbackNow = Date.now(),
): number {
  if (typeof stream?.completedAt === 'number' && Number.isFinite(stream.completedAt)) {
    return stream.completedAt;
  }
  const durationMs = stream?.durationMs;
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
    return timestamp + durationMs;
  }
  return fallbackNow;
}

export function getAssistantMessageCompletedTimestamp(msg: {
  timestamp: number;
  extra?: { stream?: AssistantStreamTimeFields };
}): number {
  return computeAssistantStreamCompletedAt(msg.timestamp, msg.extra?.stream, msg.timestamp);
}

const DELIVERED_AT_GAP_THRESHOLD = 5000;

export function formatDualTime(timestamp: number, deliveredAt?: number): string {
  if (!deliveredAt || deliveredAt - timestamp <= DELIVERED_AT_GAP_THRESHOLD) {
    return formatTime(timestamp);
  }
  return `发送 ${formatTime(timestamp)} · 收到 ${formatTime(deliveredAt)}`;
}
