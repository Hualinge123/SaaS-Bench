/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import type { HuaweiMaasAccessModeType, HuaweiMaasServiceType, HUAWEI_MAAS_ACCESS_MODAL_MODE } from '../utils';

export interface MassModelResponseItem {
  id?: string | number;
  object?: string;
  name?: string;
  description?: string;
  protocol?: string;
  labels?: string[];
  developer?: string;
  icon?: string;
  baseUrl?: string;
  accessMode?: string;
  serviceType?: string;
  updatedAt?: string | number;
  updated_at?: string | number;
  updateTime?: string | number;
  update_time?: string | number;
  [key: string]: unknown;
}

export interface ModelCardData {
  id: string;
  object: string;
  name: string;
  description: string;
  labels: string[];
  developer: string;
  icon?: string;
  protocol: string;
  baseUrl?: string;
  accessMode?: HuaweiMaasAccessModeType;
  serviceType?: HuaweiMaasServiceType;
  updatedAt?: string | number;
  [key: string]: unknown;
}

export interface ModelCardGroup {
  key: string;
  label: string;
  items: ModelCardData[];
}

export interface ModelConfigProviderItem {
  id: string;
  displayName?: string;
  description?: string;
  icon?: string;
  baseUrl?: string;
  modelBaseUrls?: Record<string, string>;
  modelDescriptions?: Record<string, string>;
  modelIcons?: Record<string, string>;
  apiKey?: string;
  hasApiKey?: boolean;
  serviceType?: HuaweiMaasServiceType;
  headers?: Record<string, string>;
  models?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface HeaderInputRow {
  id: string;
  key: string;
  value: string;
}

export type CreateModelModalMode = 'default' | typeof HUAWEI_MAAS_ACCESS_MODAL_MODE;
