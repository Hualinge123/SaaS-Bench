import { useLayoutEffect } from 'react';

export function useDraftSync(params: {
  threadId?: string;
  input: string;
  threadDrafts: Map<string, string>;
}) {
  const { threadId, input, threadDrafts } = params;

  useLayoutEffect(() => {
    if (!threadId) return;
    if (input) threadDrafts.set(threadId, input);
    else threadDrafts.delete(threadId);
  }, [input, threadDrafts, threadId]);
}

