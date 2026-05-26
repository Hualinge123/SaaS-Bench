/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * OpenTelemetry semantic attribute constants.
 * Matches jiuwenclaw/telemetry/attributes.py pattern.
 */

// --- GenAI Semantic Conventions (OpenTelemetry standard) ---
export const GEN_AI_SYSTEM = 'gen_ai.system';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
export const GEN_AI_CONVERSATION_ID = 'gen_ai.conversation.id';
export const GEN_AI_SPAN_TYPE = 'gen_ai.span.type';

// --- Token usage (OpenTelemetry standard) ---
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
export const GEN_AI_USAGE_CACHE_READ_TOKENS = 'gen_ai.usage.cache_read_input_tokens';
export const GEN_AI_USAGE_CACHE_WRITE_TOKENS = 'gen_ai.usage.cache_write_input_tokens';

// --- HTTP Semantic Conventions ---
export const HTTP_METHOD = 'http.method';
export const HTTP_URL = 'http.url';
export const HTTP_STATUS_CODE = 'http.status_code';
export const HTTP_ROUTE = 'http.route';
export const HTTP_TARGET = 'http.target';

// --- OfficeClaw custom attributes ---
export const OFFICECLAW_CLAW_ID = 'officeclaw.claw.id';
export const OFFICECLAW_CHANNEL_ID = 'officeclaw.channel.id';
export const OFFICECLAW_SESSION_ID = 'officeclaw.session.id';
export const OFFICECLAW_THREAD_ID = 'officeclaw.thread.id';
export const OFFICECLAW_REQUEST_ID = 'officeclaw.request_id';
export const OFFICECLAW_AGENT_ID = 'officeclaw.agent.id';