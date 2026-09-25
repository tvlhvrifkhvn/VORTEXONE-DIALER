import { useEffect, useState } from 'react';
import * as api from '../lib/api';

/**
 * Loads a lead's pre-call brief in two steps: the instant line first (no AI,
 * paints straight away), then the AI line, which may arrive up to ~3s later
 * or never. A lead change discards responses still in flight for the old one.
 */
export function useBrief(leadId) {
  const [brief, setBrief] = useState({ instant: null, ai: null });

  useEffect(() => {
    setBrief({ instant: null, ai: null });
    if (!leadId) return undefined;
    let cancelled = false;

    api
      .getLeadBrief(leadId, { withAi: false })
      .then((b) => !cancelled && setBrief((prev) => ({ instant: b.instant, ai: prev.ai || b.ai })))
      .catch(() => {});
    api
      .getLeadBrief(leadId)
      .then((b) => !cancelled && setBrief({ instant: b.instant, ai: b.ai }))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return brief;
}
