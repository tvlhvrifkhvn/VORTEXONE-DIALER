import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';

// The active file's pipeline stages (C2B), in order. Pages remount when the
// file changes (useCampaign), so one fetch per mount is enough; `refresh`
// reloads after an edit.
export function useStages() {
  const [stages, setStages] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { stages: list } = await api.getPipelineStages();
      setStages(list || []);
    } catch {
      /* keep the last list; the pages say when a move fails */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stages, loaded, refresh };
}

/** The Tag tone for a stage kind (DESIGN.md section 6 style): won solid, lost muted, open outline. */
export function stageTone(kind) {
  if (kind === 'won') return 'solid';
  if (kind === 'lost') return 'muted';
  return 'outline';
}
