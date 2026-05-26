import { useEffect, useLayoutEffect } from 'react';

interface UseMentionMenuPositioningParams {
  showMentions: boolean;
  input: string;
  mentionFilter: string;
  updateMentionMenuPosition: () => void;
}

export function useMentionMenuPositioning({
  showMentions,
  input,
  mentionFilter,
  updateMentionMenuPosition,
}: UseMentionMenuPositioningParams) {
  useLayoutEffect(() => {
    if (!showMentions) return;
    updateMentionMenuPosition();
  }, [input, mentionFilter, showMentions, updateMentionMenuPosition]);

  useEffect(() => {
    if (!showMentions) return;
    const onWindowChange = () => updateMentionMenuPosition();
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    return () => {
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [showMentions, updateMentionMenuPosition]);
}

