// Today's TO DO (C7C, C8B): the old DUE TODAY and TASKS sections in one
// list with two controls.
//   WHEN  OVERDUE (overdue callbacks and tasks, plus replies and gone-quiet
//         leads, which are waiting on you) · TODAY (everything due by the end
//         of today: the old DUE TODAY) · UPCOMING (tasks and callbacks after today),
//         each with its count
//   TYPE  a select: All types · Callbacks · Tasks · Replies · Gone quiet
// Rows: time · type · name and company (a link to the lead) · one-line detail ·
// CALL, REPLY or DONE, and on tasks ⋯ with RESCHEDULE.
// Data: the shared Today poll (useToday) and `upcoming` (tasks and callbacks
// after today) from the page.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Field from '../ui/Field';
import Menu from '../ui/Menu';
import Segmented from '../ui/Segmented';
import SectionLabel from '../ui/SectionLabel';
import { refreshToday } from '../../hooks/useToday';
import { formatRelativeToNow } from '../../lib/format';
import * as api from '../../lib/api';

const WHEN = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
];
const TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'callback', label: 'Callbacks' },
  { value: 'task', label: 'Tasks' },
  { value: 'reply', label: 'Replies' },
  { value: 'quiet', label: 'Gone quiet (no activity 7+ days)' },
];
const KIND_LABEL = { callback: 'Callback', reply: 'Reply', task: 'Task', quiet: 'Quiet' };

/** Every row the TO DO list can show, tagged with which WHEN views it belongs to. */
export function todoRows(today, upcoming) {
  if (!today) return [];
  const rows = [
    ...today.callbacks.items.map((c) => ({ kind: 'callback', key: `c${c.id}`, leadId: c.id, name: c.name, company: c.company, detail: 'Callback', at: c.due_at, overdue: c.overdue, when: c.overdue ? ['overdue', 'today'] : ['today'] })),
    ...today.unreadTexts.items.map((t) => ({ kind: 'reply', key: `r${t.id}`, leadId: t.id, name: t.name, company: t.company, detail: `${t.unread} unread text${t.unread === 1 ? '' : 's'}`, at: t.last_at, overdue: false, when: ['overdue', 'today'] })),
    ...today.tasks.items.map((t) => ({ kind: 'task', key: `t${t.id}`, taskId: t.id, leadId: t.lead_id, name: t.lead_name || 'No lead', company: t.lead_company, detail: t.title, type: t.type, at: t.due_at, overdue: t.overdue, when: t.overdue ? ['overdue', 'today'] : ['today'] })),
    ...today.stale.items.map((s) => ({ kind: 'quiet', key: `s${s.id}`, leadId: s.id, name: s.name, company: s.company, detail: `${s.stage_name} · quiet since ${formatRelativeToNow(s.activity_at)}`, at: null, overdue: false, when: ['overdue', 'today'] })),
    ...(upcoming?.tasks || []).map((t) => ({ kind: 'task', key: `u${t.id}`, taskId: t.id, leadId: t.lead_id, name: t.lead_name || 'No lead', company: t.lead_company, detail: t.title, type: t.type, at: t.due_at, overdue: false, when: ['upcoming'] })),
    ...(upcoming?.callbacks || []).map((c) => ({ kind: 'callback', key: `uc${c.id}`, leadId: c.id, name: c.name, company: c.brokerage, detail: 'Callback', at: c.next_action_at, overdue: false, when: ['upcoming'] })),
  ];
  const rank = (r) => (r.overdue ? 0 : r.kind === 'quiet' ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || new Date(a.at || 0) - new Date(b.at || 0));
}

/** "4:30 PM" today, "Nov 17 · 5:23 PM" on another day, "—" without a time. */
function whenText(at) {
  if (!at) return '—';
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`;
}
function toLocalInput(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TodoRow({ row, onChanged }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => (row.at ? toLocalInput(row.at) : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const go = (path) => navigate(path);
  return (
    <li className="border-b last:border-b-0">
      <div className="grid min-h-12 grid-cols-[9rem_5.5rem_minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-1">
        <span className={`whitespace-nowrap font-mono text-xs tabular-nums ${row.overdue ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{whenText(row.at)}</span>
        <span>
          <Badge tone={row.overdue ? 'solid' : 'outline'}>{KIND_LABEL[row.kind]}</Badge>
          {row.overdue && <span className="sr-only"> (overdue)</span>}
        </span>
        <span className="min-w-0 truncate" title={row.company ? `${row.name} · ${row.company}` : row.name}>
          {row.leadId ? (
            <Link to={`/leads/${row.leadId}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {row.name}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{row.name}</span>
          )}
          {row.company && <span className="text-sm text-muted-foreground"> · {row.company}</span>}
        </span>
        <span className="min-w-0 truncate text-sm text-muted-foreground" title={row.detail}>
          {row.detail}
        </span>
        <span className="flex w-[8.5rem] items-center justify-end gap-2">
          {(row.kind === 'callback' || row.kind === 'quiet') && row.leadId && (
            <Button size="sm" onClick={() => go(`/call/${row.leadId}`)} aria-label={`Call ${row.name}`}>
              Call
            </Button>
          )}
          {row.kind === 'reply' && (
            <Button size="sm" onClick={() => go(`/leads/${row.leadId}?reply=1`)} aria-label={`Reply to ${row.name}`}>
              Reply
            </Button>
          )}
          {row.kind === 'task' && (
            <>
              <Button size="sm" disabled={busy} onClick={() => run(() => api.completeTask(row.taskId))} aria-label={`Mark "${row.detail}" done`}>
                Done
              </Button>
              <Menu size="sm" ariaLabel={`More for "${row.detail}"`} items={[{ label: 'Reschedule', onSelect: () => setEditing(true) }]} />
            </>
          )}
        </span>
      </div>
      {editing && (
        <form
          className="flex flex-wrap items-end gap-2 px-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.updateTask(row.taskId, { dueAt: new Date(when).toISOString() }));
          }}
        >
          <div>
            <label htmlFor={`todo-due-${row.key}`} className="label mb-1 block">
              New due time
            </label>
            <Field id={`todo-due-${row.key}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="text-sm" autoFocus />
          </div>
          <Button type="submit" variant="solid" disabled={busy || !when}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
        </form>
      )}
      {error && <p role="alert" className="px-4 pb-2 text-sm text-signal">{error}</p>}
    </li>
  );
}

export default function TodoList({ today, upcoming, onChanged }) {
  const [when, setWhen] = useState('today');
  const [type, setType] = useState('all');
  const every = todoRows(today, upcoming);
  const all = every.filter((r) => type === 'all' || r.kind === type);
  const rows = all.filter((r) => r.when.includes(when));
  const count = (w) => all.filter((r) => r.when.includes(w)).length;
  // The header counts match the WHEN buttons (all types).
  const todayCount = every.filter((r) => r.when.includes('today')).length;
  const overdueCount = every.filter((r) => r.when.includes('overdue')).length;
  const capped = today && [today.callbacks, today.unreadTexts, today.tasks, today.stale].some((l) => l.total > l.items.length);
  const changed = () => {
    refreshToday();
    onChanged?.();
  };

  return (
    <section className="space-y-2" data-testid="todo">
      <SectionLabel index={null} title="To do" meta={today ? `${todayCount} today · ${overdueCount} overdue${capped ? ' · first 50 of each' : ''}` : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented label="When" options={WHEN.map((w) => ({ ...w, label: `${w.label} ${count(w.value)}` }))} value={when} onChange={setWhen} />
        <Field as="select" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-[17rem] text-sm">
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Field>
      </div>
      <Panel>
        {!today ? (
          <p className="label px-4 py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul>
            {rows.map((r) => (
              <TodoRow key={r.key} row={r} onChanged={changed} />
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
