// Settings → ACTIVITY (C6C, supervisor only): every change made through the
// app, newest first, with user and date filters. Rows hold the action and
// the record it touched, never what was typed. Kept for 180 days.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import SectionLabel from '../ui/SectionLabel';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

export default function ActivitySection({ index = '08' }) {
  const [filters, setFilters] = useState({ userId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getActivity({ ...filters, page }));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (e) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Panel className="space-y-4 p-6" id="activity" data-testid="activity">
      <SectionLabel index={index} title="Activity" meta={data ? `${data.total} change${data.total === 1 ? '' : 's'}` : undefined} />
      <p className="text-sm text-muted-foreground">
        Every change made in the app: who, what and when. Only the action and the record it touched are kept, never what was typed. Kept for 180 days.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="activity-user" className="label mb-1 block">User</label>
          <Field as="select" id="activity-user" value={filters.userId} onChange={set('userId')} className="text-sm">
            <option value="">Everyone</option>
            {(data?.users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Field>
        </div>
        <div>
          <label htmlFor="activity-from" className="label mb-1 block">From</label>
          <Field id="activity-from" type="date" value={filters.from} onChange={set('from')} className="text-sm" />
        </div>
        <div>
          <label htmlFor="activity-to" className="label mb-1 block">To</label>
          <Field id="activity-to" type="date" value={filters.to} onChange={set('to')} className="text-sm" />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {!data ? (
        <p className="label">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes for these filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="label py-2 pr-2 font-medium">When</th>
              <th className="label py-2 pr-2 font-medium">User</th>
              <th className="label py-2 pr-2 font-medium">Change</th>
              <th className="label py-2 font-medium">Record</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <tr key={a.id} className="border-b last:border-b-0 align-top">
                <td className="whitespace-nowrap py-2 pr-2 font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(a.created_at)}</td>
                <td className="py-2 pr-2 text-foreground">{a.user_name || '—'}</td>
                <td className="py-2 pr-2 text-foreground">
                  {a.summary}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {a.method} {a.route}
                  </span>
                </td>
                <td className="py-2 text-foreground">
                  {a.entity_type === 'lead' && a.entity_id ? (
                    <Link to={`/leads/${a.entity_id}`} className="underline underline-offset-4 hover:bg-muted">
                      Lead #{a.entity_id}
                    </Link>
                  ) : a.entity_id ? (
                    `${a.entity_type} #${a.entity_id}`
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            ← Newer
          </Button>
          <span className="label tabular-nums">
            Page {page} of {pages}
          </span>
          <Button variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
            Older →
          </Button>
        </div>
      )}
    </Panel>
  );
}
