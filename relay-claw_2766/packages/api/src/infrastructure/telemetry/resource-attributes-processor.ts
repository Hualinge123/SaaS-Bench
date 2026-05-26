/*
 * * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

/**
 * AttributesProcessor that injects resource attributes into metric attributes.
 * Resource attributes are added as base labels for all metrics.
 */

import type { Attributes, Context } from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { IAttributesProcessor } from '@opentelemetry/sdk-metrics';

/**
 * AttributesProcessor that injects resource attributes into metric attributes.
 * Resource attributes are added as base labels for all metrics.
 * Implements IAttributesProcessor interface for OpenTelemetry SDK 2.0+.
 */
export class ResourceAttributesProcessor implements IAttributesProcessor {
  private resourceAttributes: Attributes;

  constructor(resource: Resource) {
    this.resourceAttributes = resource.attributes;
  }

  /**
   * Process attributes by merging resource attributes.
   * Existing attributes take precedence (no overwrite).
   *
   * @param incoming The metric instrument attributes.
   * @param context The active context when the instrument is synchronous (optional).
   */
  process(incoming: Attributes, context?: Context): Attributes {
    return {
      ...this.resourceAttributes, // Resource attributes as base
      ...incoming, // Existing attributes override (priority)
    };
  }
}
