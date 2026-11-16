// Saved views (C2E): a row above the leads table. "All leads" clears the
// filters; each view applies its stored filters and shows its live count;
// "+ SAVE CURRENT FILTERS" names the current filters as a new view. Views are
// yours, per file. Counts refresh every 30 s and after a save.
import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import * as api from '../../lib/api';

const COUNT_POLL_MS = 30000;
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

const same = (a, b) => JSON.stringify(normalizeFilters(a)) === JSON.stringify(normalizeFilters(b));

export default function SavedViewsBar({ filters, emptyFilters, onApply }) {
  const [views, setViews] = useState([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setViews((await api.listViews({ counts: true })).views || []);
    } catch {
      /* the bar stays as it was */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, COUNT_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const hasFilters = Object.keys(normalizeFilters(filters)).length > 0;

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createView(name.trim(), normalizeFilters(filters));
      setName('');
      setNaming(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (view) => {
    if (!window.confirm(`Delete the view "${view.name}"?`)) return;
    try {
      await api.deleteView(view.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saved views">
        <Button active={!hasFilters} aria-pressed={!hasFilters} onClick={() => onApply({ ...emptyFilters })}>
          All leads
        </Button>
        {views.map((v) => {
          const on = same(filters, v.filters);
          return (
            <span key={v.id} className="inline-flex">
              <Button active={on} aria-pressed={on} onClick={() => onApply({ ...emptyFilters, ...v.filters })}>
                {v.name}
                <span className="tabular-nums">{v.count ?? '—'}</span>
              </Button>
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Delete view ${v.name}`}
                className="min-h-10 border border-l-0 border-strong px-2 font-mono text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            </span>
          );
        })}
        {naming ? (
          <form onSubmit={save} className="flex items-center gap-2">
            <Field value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="View name" aria-label="New view name" className="w-48 text-sm" autoFocus />
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="ghost" onClick={() => setNaming(true)} disabled={!hasFilters} title={hasFilters ? undefined : 'Set some filters first'}>
            + Save current filters
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </div>
  );
}
