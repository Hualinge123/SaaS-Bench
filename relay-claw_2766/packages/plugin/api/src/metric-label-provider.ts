/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * Metric Label Provider Plugin API — contract for dynamic metric labels.
 *
 * Provider resolves HTTP request into metric labels (key-value pairs).
 * The platform merges these labels into metric attributes during recording.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Metric Label Provider contract.
 *
 * Extension point for dynamic HTTP request metric labels.
 */
export interface MetricLabelProvider {
  /** Unique provider identifier (runtime string, never hardcoded in platform). */
  readonly id: string;
  /** Human-readable name shown in logs and admin UI. */
  readonly displayName?: string;

  /**
   * Called once at startup. Use for provider-level initialization
   * (e.g., validate config, warm up connections).
   */
  bootstrap?(): Promise<void>;

  /**
   * Resolve metric labels from HTTP request.
   * Return null to skip adding labels.
   * Return object to merge into metric attributes.
   */
  resolveLabels(request: FastifyRequest): Promise<Record<string, string | number | boolean> | null>;

  /**
   * Called on shutdown. Use for cleanup.
   */
  shutdown?(): Promise<void>;
}
