/*
 * *
 *  * Copyright (C) Huawei Technologies Co., Ltd. 2026. All rights reserved.
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import type { AgentRef, InspirationTemplateDetail, SkillRef } from '../types';

interface UseInspirationDetailResult {
  template: InspirationTemplateDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

interface SkillDetailLookup {
  id?: unknown;
  name?: unknown;
  icon?: unknown;
  iconUrl?: unknown;
  avatar?: unknown;
}

interface AgentLookup {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  breedId?: unknown;
  avatar?: unknown;
  icon?: unknown;
}

interface ExpertLookup {
  expertId?: unknown;
  displayName?: unknown;
  nickname?: unknown;
  avatar?: unknown;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function mergeSkillRef(original: SkillRef, lookup: SkillDetailLookup | null): SkillRef {
  if (!lookup) return original;
  const id = pickString(lookup.id) ?? original.id;
  const name = pickString(lookup.name) ?? original.name;
  const icon = pickString(lookup.iconUrl, lookup.icon, lookup.avatar, original.icon);
  return { ...original, id, name, ...(icon ? { icon } : {}) };
}

async function resolveSkillRef(skill: SkillRef): Promise<SkillRef> {
  try {
    const res = await apiFetch(`/api/skills/detail?name=${encodeURIComponent(skill.id)}`);
    if (!res.ok) return skill;
    const lookup = (await res.json()) as SkillDetailLookup;
    return mergeSkillRef(skill, lookup);
  } catch {
    return skill;
  }
}

function mergeAgentRef(original: AgentRef, lookup: AgentLookup | undefined): AgentRef {
  if (!lookup) return original;
  const id = pickString(lookup.id) ?? original.id;
  const name = pickString(lookup.displayName, lookup.name) ?? original.name;
  const catId = pickString(lookup.breedId, lookup.id) ?? original.catId;
  const icon = pickString(lookup.avatar, lookup.icon, original.icon);
  return { ...original, id, name, catId, ...(icon ? { icon } : {}) };
}

function mergeExpertAgentRef(original: AgentRef, lookup: ExpertLookup | undefined): AgentRef {
  if (!lookup) return original;
  const expertId = pickString(lookup.expertId) ?? original.id;
  const name = pickString(lookup.displayName, lookup.nickname) ?? original.name;
  const icon = pickString(lookup.avatar, original.icon);
  return { ...original, id: expertId, name, catId: expertId, ...(icon ? { icon } : {}) };
}

function isExpertAgentRef(agent: AgentRef): boolean {
  return agent.id.startsWith('expert-') || agent.catId.startsWith('expert-');
}

async function fetchAgentRows(): Promise<AgentLookup[]> {
  try {
    const res = await apiFetch('/api/agents');
    if (!res.ok) return [];
    const data = (await res.json()) as { agents?: AgentLookup[]; cats?: AgentLookup[] };
    return Array.isArray(data.agents) ? data.agents : Array.isArray(data.cats) ? data.cats : [];
  } catch {
    return [];
  }
}

async function fetchExpertRows(shouldFetch: boolean): Promise<ExpertLookup[]> {
  if (!shouldFetch) return [];
  try {
    const res = await apiFetch('/api/experts');
    if (!res.ok) return [];
    const data = (await res.json()) as { experts?: ExpertLookup[] };
    return Array.isArray(data.experts) ? data.experts : [];
  } catch {
    return [];
  }
}

async function resolveAgentRefs(agents: AgentRef[]): Promise<AgentRef[]> {
  if (agents.length === 0) return agents;

  const [agentRows, expertRows] = await Promise.all([
    fetchAgentRows(),
    fetchExpertRows(agents.some(isExpertAgentRef)),
  ]);
  const agentsById = new Map<string, AgentLookup>();
  for (const row of agentRows) {
    const id = pickString(row.id);
    if (id) agentsById.set(id, row);
  }
  const expertsById = new Map<string, ExpertLookup>();
  for (const row of expertRows) {
    const id = pickString(row.expertId);
    if (id) expertsById.set(id, row);
  }
  return agents.map((agent) => {
    const expert = expertsById.get(agent.id) ?? expertsById.get(agent.catId);
    if (expert) return mergeExpertAgentRef(agent, expert);
    return mergeAgentRef(agent, agentsById.get(agent.id) ?? agentsById.get(agent.catId));
  });
}

async function enrichTemplateDetail(template: InspirationTemplateDetail): Promise<InspirationTemplateDetail> {
  const [skills, agents] = await Promise.all([
    Promise.all(template.skills.map(resolveSkillRef)),
    resolveAgentRefs(template.agents),
  ]);
  return { ...template, skills, agents };
}

export function useInspirationDetail(templateId: string | null): UseInspirationDetailResult {
  const [template, setTemplate] = useState<InspirationTemplateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    apiFetch(`/api/inspiration/templates/${templateId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch template: ${res.status}`);
        return res.json();
      })
      .then((data) => (data.data ? enrichTemplateDetail(data.data as InspirationTemplateDetail) : null))
      .then((nextTemplate) => {
        if (!cancelled) {
          setTemplate(nextTemplate);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [templateId, refreshKey]);

  return { template, isLoading, error, refetch };
}
