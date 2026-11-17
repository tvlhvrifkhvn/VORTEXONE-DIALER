import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';

// The active file's spend (C4B: GET /api/spend), shared by the header meter
// and the call screen: one poll every 30 s, one cache; every user of the hook
// re-renders on a refresh. Pages remount on a file switch (useCampaign), which
// restarts the poll for the new file.
const POLL_MS = 30000;
let cache = null;
let timer = null;
const listeners = new Set();

async function load() {
  try {
    cache = await api.getSpend();
  } catch {
    /* keep the last value; the meter shows what it has */
  }
  listeners.forEach((fn) => fn(cache));
}

/** Reload now (after a rate or budget change). */
export function refreshSpend() {
  return load();
}

export function useSpend() {
  const [spend, setSpend] = useState(cache);
  useEffect(() => {
    listeners.add(setSpend);
    if (!timer) {
      load();
      timer = pollWhileVisible(load, POLL_MS);
    }
    return () => {
      listeners.delete(setSpend);
      if (listeners.size === 0) {
        timer();
        timer = null;
        cache = null;
      }
    };
  }, []);
  return spend;
}

/** The budget the header shows: whichever of the file's and the global one is closer to its limit (or null). */
export function shownBudget(spend) {
  if (!spend) return null;
  const { campaign, global } = spend.budgets || {};
  const set = [campaign && { ...campaign, scope: 'file' }, global && { ...global, scope: 'all files' }].filter(
    (b) => b && b.budget !== null && b.budget !== undefined
  );
  if (set.length === 0) return null;
  return set.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
}
