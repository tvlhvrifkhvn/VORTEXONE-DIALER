import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';
import { useCampaign } from './useCampaign';

// The active file's custom fields (C2D), in order. Pages remount when the
// file changes, so one fetch per mount is enough.
export function useCustomFields() {
  const { activeId } = useCampaign();
  const [fields, setFields] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const { fields: list } = await api.getCampaignFields(activeId);
      setFields(list || []);
    } catch {
      /* no fields shown; the lead page still works */
    }
  }, [activeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { fields, refresh };
}

/** A stored custom value as text: Yes/No, numbers with separators, dates as given. */
export function formatCustomValue(field, value) {
  if (value === undefined || value === null || value === '') return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'number') return Number(value).toLocaleString('en-US');
  return String(value);
}
