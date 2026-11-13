import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';

const POLL_MS = 5000;
const CALLBACK_CHECK_MS = 5 * 60 * 1000;
const CALLBACK_WINDOW_MS = 15 * 60 * 1000;
const NOTIFIED_KEY = 'vortex_dialer_notified_callbacks';

function readNotifiedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function markNotified(id) {
  const ids = readNotifiedIds();
  ids.add(id);
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]));
}

/** Checks for callbacks due within the next 15 minutes and fires a one-time
 * browser notification for each (keyed by call id, so it never repeats). */
async function checkDueCallbacks() {
  if (typeof Notification === 'undefined') return;

  let result;
  try {
    result = await api.listLeads({ status: 'callback_scheduled', pageSize: 200 });
  } catch {
    return;
  }

  const now = Date.now();
  const due = result.leads.filter((lead) => {
    if (!lead.next_action_at) return false;
    const dueAt = new Date(lead.next_action_at).getTime();
    return dueAt >= now && dueAt - now <= CALLBACK_WINDOW_MS;
  });
  if (due.length === 0) return;

  // Keyed by lead id + the specific callback time, so rescheduling the same
  // lead's callback later can still notify once for the new time.
  const callbackKey = (lead) => `${lead.id}:${lead.next_action_at}`;
  const notified = readNotifiedIds();
  const unnotified = due.filter((lead) => !notified.has(callbackKey(lead)));
  if (unnotified.length === 0) return;

  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return;

  unnotified.forEach((lead) => {
    const minutes = Math.max(0, Math.round((new Date(lead.next_action_at).getTime() - now) / 60000));
    new Notification(`Callback due: ${lead.name} in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
    markNotified(callbackKey(lead));
  });
}

const PAGE_SIZE = 50;

/** Lead table data for the Dashboard — polls so locks/requeues stay fresh.
 * Paginated: only the current page is ever fetched from the API. */
export function useLeads(filters) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filtersKey = JSON.stringify(filters);

  // A filter change invalidates the current page — start back at page 1.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listLeads({ ...JSON.parse(filtersKey), page, limit: PAGE_SIZE });
      setLeads(data.leads);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Browser notifications for callbacks due soon — independent of the
  // current filters, checked on an interval regardless of what's displayed.
  useEffect(() => {
    checkDueCallbacks();
    const id = setInterval(checkDueCallbacks, CALLBACK_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  return { leads, total, page, pageSize: PAGE_SIZE, setPage, loading, error, refresh };
}

/** Per-state lead counts for the sidebar. */
export function useStateCounts() {
  const [counts, setCounts] = useState([]);

  const refresh = useCallback(async () => {
    const data = await api.getStateCounts();
    setCounts(data.counts);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { counts, refresh };
}
