import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';

// C7A: GET /api/today for the active file, fetched by ONE shared poll (30 s,
// paused while the tab is hidden) for the header's TODAY badge and the Today
// page, instead of one poll each. Same pattern as useSpend: one cache, every
// user of the hook re-renders on a refresh; pages remount on a file switch.
const POLL_MS = 30000;
let cache = null;
let stop = null;
const listeners = new Set();

async function load() {
  try {
    cache = await api.getToday();
  } catch {
    /* keep the last value */
  }
  listeners.forEach((fn) => fn(cache));
}

/** Reload now (after a change on the Today page). */
export function refreshToday() {
  return load();
}

export function useToday() {
  const [today, setToday] = useState(cache);
  useEffect(() => {
    listeners.add(setToday);
    if (!stop) {
      load();
      stop = pollWhileVisible(load, POLL_MS);
    }
    return () => {
      listeners.delete(setToday);
      if (listeners.size === 0) {
        stop();
        stop = null;
        cache = null;
      }
    };
  }, []);
  return today;
}
