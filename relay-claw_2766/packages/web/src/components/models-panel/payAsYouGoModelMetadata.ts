/*
 * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 */

import type { ModelCardData } from './types/models-panel';

type PayAsYouGoModelMetadata = Pick<ModelCardData, 'name' | 'description' | 'labels' | 'developer' | 'icon'>;

const PAY_AS_YOU_GO_MODEL_METADATA: Record<string, PayAsYouGoModelMetadata> = {
  'deepseek-r1-250528': {
    name: 'DeepSeek-R1-0528',
    description: 'DeepSeek-R1是一款高效智能体模型，具备强大的长文本处理能力和卓越的成本效益，助力企业实现更智能化的应用。',
    labels: ['文本生成', 'Function Call', '深度思考', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'DeepSeek-V3': {
    name: 'DeepSeek-V3',
    description: 'DeepSeek-V3 是一款高性能的 AI 语言模型，专为复杂任务设计，具备强大的文本理解和生成能力。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v3.1-terminus': {
    name: 'DeepSeek-V3.1-128K',
    description: 'DeepSeek-V3.1 是在 DeepSeek-V3.1-Base 的基础上进行后训练得到的。',
    labels: ['文本生成', 'Function Call', '深度思考', '128K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v3.2': {
    name: 'DeepSeek-V3.2',
    description: 'DeepSeek-V3.2 是一款在计算效率与出色推理及代理能力之间实现出色平衡的模型，整体性能达到了 GPT-5 的水平。',
    labels: ['文本生成', 'Function Call', '深度思考', '160K'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v4-flash': {
    name: 'DeepSeek-V4-Flash',
    description: 'DeepSeek-V4-Flash 是 DeepSeek 当前主打的高性价比 V4 模型，推理能力接近 V4-Pro，支持思考/非思考双模式与 Tool Calls，并默认提供 1M 上下文。',
    labels: ['文本生成', 'Function Call', '深度思考', '1M'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'deepseek-v4-pro': {
    name: 'DeepSeek-V4-Pro',
    description: 'DeepSeek-V4-Pro 是 DeepSeek 的高端 V4 模型，强化了 Agent 编码、数理推理与通识能力，支持思考/非思考双模式、Tool Calls，并默认提供 1M 上下文。',
    labels: ['文本生成', 'Function Call', '深度思考', '1M'],
    developer: 'DeepSeek',
    icon: '/images/deepseek.svg',
  },
  'glm-5': {
    name: 'GLM-5',
    description: 'GLM-5 在各类学术基准测试中实现了显著提升，并在全球所有开源模型中，在推理、编程和智能体任务方面达到顶尖水平。',
    labels: ['文本生成', 'Function Call', '深度思考', '198K'],
    developer: '智谱.AI',
    icon: '/images/zhipu.svg',
  },
  'glm-5.1': {
    name: 'GLM-5.1',
    description: 'GLM-5.1 是智谱最新旗舰模型，代码能力大大增强，长程任务显著提升，能够在单次任务中持续、自主地工作长达 8 小时。',
    labels: ['文本生成', 'Function Call', '深度思考', '198K'],
    developer: '智谱.AI',
    icon: '/images/zhipu.svg',
  },
  'Kimi-K2': {
    name: 'Kimi-K2',
    description: 'Kimi K2 是一款先进的混合专家（MoE）语言模型，拥有 320 亿激活参数和 1 万亿总参数。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: 'Kimi',
    icon: '/images/kimi.svg',
  },
  'kimi-k2.6': {
    name: 'Kimi-K2.6',
    description: 'Kimi K2.6 是 Moonshot AI 当前最新的开源旗舰模型，原生支持多模态输入，强化了长程编码稳定性与 Agent 自主执行能力，适合复杂多步任务。',
    labels: ['文本生成', 'Function Call', '多模态', '256K'],
    developer: 'Kimi',
    icon: '/images/kimi.svg',
  },
  'longcat-flash-chat': {
    name: 'LongCat-Flash-Chat',
    description: '美团 LongCat-Flash-Chat 采用高效 MoE 架构，总参数 560B，激活仅需 18.6B-31.3B，推理效率更高，适配复杂智能体应用。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: '美团龙猫',
    icon: '/avatars/assistant.svg',
  },
  'qwen3-235b-a22b': {
    name: 'Qwen3-235B-A22B',
    description: 'Qwen3-235B-A22B 是一款因果语言模型，拥有总计 2350 亿参数，其中激活 220 亿参数，非嵌入参数达 2340 亿。',
    labels: ['文本生成', '深度思考', 'Function Call', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-32b': {
    name: 'Qwen3-32B',
    description: 'Qwen3-32B 是一款因果语言模型，拥有 328 亿参数，其中非嵌入参数为 312 亿，采用 GQA 架构。',
    labels: ['文本生成', '深度思考', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-coder-480b-a35b-instruct': {
    name: 'Qwen3-Coder-480B-A35B-Instruct',
    description: 'Qwen3-Coder 在 Agent 编码、Agent 浏览器使用和其他基础编码任务中表现出色，成绩可媲美 Claude Sonnet。',
    labels: ['文本生成', 'Function Call', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
  'qwen3-30b-a3b': {
    name: 'Qwen3-30B-A3B-128K',
    description: 'Qwen3-30B-A3B 是一款因果语言模型，拥有总共 305 亿参数，其中激活 33 亿参数，非嵌入参数为 299 亿。',
    labels: ['文本生成', '深度思考', '128K'],
    developer: '通义千问',
    icon: '/images/qwen.svg',
  },
};

const payAsYouGoModelMetadataIndex = new Map<string, PayAsYouGoModelMetadata>();

for (const [modelId, metadata] of Object.entries(PAY_AS_YOU_GO_MODEL_METADATA)) {
  payAsYouGoModelMetadataIndex.set(modelId.trim().toLowerCase(), metadata);
  payAsYouGoModelMetadataIndex.set(metadata.name.trim().toLowerCase(), metadata);
}

function buildMatchKeys(card: ModelCardData): string[] {
  const suffix = card.id.startsWith('model_config:') ? card.id.split(':').at(-1) : undefined;
  return [card.name, suffix]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

export function enrichPayAsYouGoModelCard(card: ModelCardData): ModelCardData {
  if (card.serviceType !== 'maas') return card;

  for (const key of buildMatchKeys(card)) {
    const metadata = payAsYouGoModelMetadataIndex.get(key);
    if (!metadata) continue;
    return {
      ...card,
      ...metadata,
      labels: [...metadata.labels],
    };
  }

  return card;
}
