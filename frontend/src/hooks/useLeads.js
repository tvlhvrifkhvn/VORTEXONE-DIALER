import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';

const POLL_MS = 5000;

/** Lead table data for the Dashboard — polls so locks/requeues stay fresh. */
export function useLeads(filters) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listLeads(JSON.parse(filtersKey));
      setLeads(data.leads);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  useEffect(() => {
    setLoading(true);
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { leads, total, loading, error, refresh };
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
