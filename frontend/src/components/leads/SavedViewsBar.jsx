// Saved views (C2E) are the left rail's SMART LISTS since C8B (the bar above
// the leads table repeated the rail and is gone). What stays: the filters as
// the server stores them.
const KEYS = ['search', 'status', 'dateFrom', 'dateTo', 'state', 'stageId', 'tag', 'minAttempts', 'noActivityDays', 'callbackOverdue'];

/** The filters as the server stores them: set keys only, as strings. */
export function normalizeFilters(filters) {
  const out = {};
  for (const k of KEYS) {
    const v = filters?.[k];
    if (v === undefined || v === null || v === '' || v === false) continue;
    out[k] = String(v);
  }
  return out;
}
