// Today's "01 — TO DO" (C7C): the old DUE TODAY and TASKS sections in one
// list with two controls.
//   WHEN  OVERDUE (overdue callbacks and tasks, plus replies and gone-quiet
//         leads, which are waiting on you) · TODAY (everything due by the end
//         of today: the old DUE TODAY) · UPCOMING (tasks and callbacks after today)
//   TYPE  ALL · CALLBACKS · TASKS · REPLIES · GONE QUIET
// Each row has its action: CALL, REPLY, OPEN, and DONE / RESCHEDULE on tasks.
// Data: the shared Today poll (useToday) and `upcoming` (tasks and callbacks
// after today) from the page.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Field from '../ui/Field';
import Segmented from '../ui/Segmented';
import SectionLabel from '../ui/SectionLabel';
import { refreshToday } from '../../hooks/useToday';
import { formatDateTime, formatRelativeToNow } from '../../lib/format';
import * as api from '../../lib/api';

const WHEN = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
];
const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'callback', label: 'Callbacks' },
  { value: 'task', label: 'Tasks' },
  { value: 'reply', label: 'Replies' },
  { value: 'quiet', label: 'Gone quiet' },
];
const KIND_LABEL = { callback: 'Callback', reply: 'Reply', task: 'Task', quiet: 'Quiet' };

/** Every row the TO DO list can show, tagged with which WHEN views it belongs to. */
export function todoRows(today, upcoming) {
  if (!today) return [];
  const rows = [
    ...today.callbacks.items.map((c) => ({ kind: 'callback', key: `c${c.id}`, leadId: c.id, name: c.name, detail: 'Callback', at: c.due_at, overdue: c.overdue, when: c.overdue ? ['overdue', 'today'] : ['today'] })),
    ...today.unreadTexts.items.map((t) => ({ kind: 'reply', key: `r${t.id}`, leadId: t.id, name: t.name, detail: `${t.unread} unread text${t.unread === 1 ? '' : 's'}`, at: t.last_at, overdue: false, when: ['overdue', 'today'] })),
    ...today.tasks.items.map((t) => ({ kind: 'task', key: `t${t.id}`, taskId: t.id, leadId: t.lead_id, name: t.lead_name || 'No lead', detail: t.title, type: t.type, at: t.due_at, overdue: t.overdue, when: t.overdue ? ['overdue', 'today'] : ['today'] })),
    ...today.stale.items.map((s) => ({ kind: 'quiet', key: `s${s.id}`, leadId: s.id, name: s.name, detail: `${s.stage_name} · quiet since ${formatRelativeToNow(s.activity_at)}`, at: null, overdue: false, when: ['overdue', 'today'] })),
    ...(upcoming?.tasks || []).map((t) => ({ kind: 'task', key: `u${t.id}`, taskId: t.id, leadId: t.lead_id, name: t.lead_name || 'No lead', detail: t.title, type: t.type, at: t.due_at, overdue: false, when: ['upcoming'] })),
    ...(upcoming?.callbacks || []).map((c) => ({ kind: 'callback', key: `uc${c.id}`, leadId: c.id, name: c.name, detail: 'Callback', at: c.next_action_at, overdue: false, when: ['upcoming'] })),
  ];
  const rank = (r) => (r.overdue ? 0 : r.kind === 'quiet' ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || new Date(a.at || 0) - new Date(b.at || 0));
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
    <li className="space-y-2 border-b py-2 last:border-b-0">
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        <Badge tone="outline">{KIND_LABEL[row.kind]}</Badge>
        <span className="min-w-[10rem] font-medium text-foreground">{row.name}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={row.detail}>
          {row.detail}
        </span>
        {row.overdue && <Badge tone="solid">Overdue</Badge>}
        {row.at && row.kind !== 'reply' && <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(row.at)}</span>}
        <span className="flex flex-wrap gap-1">
          {row.kind === 'callback' && (
            <Button variant="primary" className="px-3" onClick={() => go(`/call/${row.leadId}`)} aria-label={`Call ${row.name}`}>
              Call
            </Button>
          )}
          {row.kind === 'reply' && (
            <Button className="px-3" onClick={() => go(`/leads/${row.leadId}?reply=1`)} aria-label={`Reply to ${row.name}`}>
              Reply
            </Button>
          )}
          {row.kind === 'task' && (
            <>
              <Button className="px-3" disabled={busy} onClick={() => run(() => api.completeTask(row.taskId))} aria-label={`Mark "${row.detail}" done`}>
                Done
              </Button>
              <Button variant="ghost" className="px-3" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                Reschedule
              </Button>
            </>
          )}
          {row.leadId && row.kind !== 'reply' && (
            <Button variant="ghost" className="px-3" onClick={() => go(`/leads/${row.leadId}`)} aria-label={`Open ${row.name}`}>
              Open
            </Button>
          )}
        </span>
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`todo-due-${row.key}`} className="label mb-1 block">
              New due time
            </label>
            <Field id={`todo-due-${row.key}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="text-sm" />
          </div>
          <Button variant="primary" disabled={busy || !when} onClick={() => run(() => api.updateTask(row.taskId, { dueAt: new Date(when).toISOString() }))}>
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

export default function TodoList({ today, upcoming, onChanged }) {
  const [when, setWhen] = useState('today');
  const [type, setType] = useState('all');
  const all = todoRows(today, upcoming);
  const rows = all.filter((r) => r.when.includes(when) && (type === 'all' || r.kind === type));
  const dueCount = today ? today.callbacks.total + today.tasks.total : 0;
  const overdueCount = today ? today.callbacks.overdue + today.tasks.overdue : 0;
  const capped = today && [today.callbacks, today.unreadTexts, today.tasks, today.stale].some((l) => l.total > l.items.length);
  const changed = () => {
    refreshToday();
    onChanged?.();
  };

  return (
    <section className="space-y-2" data-testid="todo">
      <SectionLabel index="01" title="To do" meta={today ? `${dueCount} due · ${overdueCount} overdue` : undefined} />
      <div className="flex flex-wrap items-start gap-4">
        <Segmented label="When" options={WHEN} value={when} onChange={setWhen} />
        <div className="space-y-1">
          <Segmented label="Type" options={TYPES} value={type} onChange={setType} />
          <p className="text-xs text-muted-foreground">Gone quiet = leads past Contacted with no activity for 7 days and no open task.</p>
        </div>
        {capped && <span className="label">Showing the first 50 of each list</span>}
      </div>
      <Panel className="px-4">
        {!today ? (
          <p className="label py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {when === 'upcoming' ? 'Nothing scheduled after today.' : 'Nothing due here. Good time to start a dialing session.'}
          </p>
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
