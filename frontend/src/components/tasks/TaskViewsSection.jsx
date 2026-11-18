// Today's TASKS section (C6A): OVERDUE | TODAY | UPCOMING, with RESCHEDULE on
// each task (a date and time picker; saved with the existing task update).
// Upcoming is grouped by date and can be narrowed with from/to.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import Segmented from '../ui/Segmented';
import SectionLabel from '../ui/SectionLabel';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

const VIEWS = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
];

/** A Date → the value a datetime-local field takes (local time). */
function toLocalInput(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TaskRow({ task, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(task.due_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateTask(task.id, { dueAt: new Date(when).toISOString() });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const id = `reschedule-${task.id}`;
  return (
    <li className="space-y-2 border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(task.due_at)}</span>
        {task.overdue && <Badge tone="signal">Overdue</Badge>}
        <span className="text-sm text-foreground">{task.title}</span>
        <span className="label">{task.type}</span>
        {task.lead_id && (
          <Link to={`/leads/${task.lead_id}`} className="text-sm text-foreground underline underline-offset-4 hover:bg-muted">
            {task.lead_name}
          </Link>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          Reschedule
        </Button>
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={id} className="label mb-1 block">
              New due time
            </label>
            <Field id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="text-sm" />
          </div>
          <Button variant="primary" onClick={save} disabled={busy || !when}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </li>
  );
}

export default function TaskViewsSection({ index = '02' }) {
  const [view, setView] = useState('overdue');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getTaskView(view, view === 'upcoming' ? range : {}));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [view, range]);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.view === view ? data.items : [];
  const groups = view === 'upcoming' && data?.view === 'upcoming' ? data.groups : [{ date: null, items }];
  return (
    <section className="space-y-2" data-testid="task-views">
      <SectionLabel index={index} title="Tasks" meta={data?.view === view ? `${data.total} ${view}` : undefined} />
      <div className="flex flex-wrap items-end gap-4">
        <Segmented label="Tasks to show" options={VIEWS} value={view} onChange={setView} />
        {view === 'upcoming' && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="tasks-from" className="label mb-1 block">From</label>
              <Field id="tasks-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="text-sm" />
            </div>
            <div>
              <label htmlFor="tasks-to" className="label mb-1 block">To</label>
              <Field id="tasks-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="text-sm" />
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      <Panel className="px-4">
        {!data ? (
          <p className="label py-4">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {view === 'overdue' ? 'Nothing overdue.' : view === 'today' ? 'No tasks due today.' : 'No upcoming tasks.'}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.date || 'all'}>
              {g.date && <p className="label border-b pb-1 pt-3">{new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</p>}
              <ul>
                {g.items.map((t) => (
                  <TaskRow key={`${t.id}-${t.due_at}`} task={t} onChanged={load} />
                ))}
              </ul>
            </div>
          ))
        )}
      </Panel>
    </section>
  );
}
