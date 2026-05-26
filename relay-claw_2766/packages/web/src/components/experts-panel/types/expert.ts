export type ExpertCategory = 'all' | 'insight' | 'finance' | 'product' | 'business' | 'office';

export const EXPERT_CATEGORY_LABELS: Record<Exclude<ExpertCategory, 'all'>, string> = {
  insight: '洞察研究',
  finance: '金融服务',
  product: '产品研发',
  business: '商务销售',
  office: '通用办公',
};

export interface Expert {
  expertId: string;
  displayName: string;
  nickname: string;
  avatar: string;
  category: 'insight' | 'finance' | 'product' | 'business' | 'office';
  mentionPatterns: string[];
  roleDescription: string;
  personality: string;
  strengths: string[];
  skills?: string[];
  visibility: 'public' | 'private';
  defaultModel: string;
  providerProfileId: string;
}

export interface InvitedExpert {
  expertId: string;
  displayName: string;
  nickname: string;
  avatar: string;
  category: 'insight' | 'finance' | 'product' | 'business' | 'office';
  mentionPatterns: string[];
  roleDescription: string;
  invitedAt: number;
}

export interface InvitedExpertsResponse {
  threadId: string;
  invitedExperts: InvitedExpert[];
  total: number;
}

export interface DuplicateResponse {
  ok: boolean;
  agent: {
    expertId: string;
    displayName: string;
  };
}

export const EXPERT_CATEGORIES: Array<{ id: ExpertCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'insight', label: '洞察研究' },
  { id: 'finance', label: '金融服务' },
  { id: 'product', label: '产品研发' },
  { id: 'business', label: '商务销售' },
  { id: 'office', label: '通用办公' },
];