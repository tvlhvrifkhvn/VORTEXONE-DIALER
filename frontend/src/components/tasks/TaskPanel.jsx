// The lead page's tasks (C3A). C8C: the WORK rail's NEXT: a list only (the
// add form is the composer's TASK tab): the scheduled callback, then the open
// tasks (overdue marked) with DONE and ⋯ → Delete. Done tasks show in the
// timeline. `refreshKey` reloads after the composer adds one.
import { useCallback, useEffect, useState } from 'react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import SectionLabel from '../ui/SectionLabel';
import Menu from '../ui/Menu';
import { TASK_TYPES } from './TaskForm';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

// onLeadChange: CLEAR on the scheduled callback sends the lead back to the queue.
export default function TaskPanel({ lead, refreshKey = 0, onLeadChange }) {
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setTasks((await api.listLeadTasks(lead.id)).tasks || []);
    } catch (err) {
      setError(err.message);
    }
  }, [lead.id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = tasks.filter((t) => !t.done_at);
  const now = Date.now();

  const callbackAt = lead.status === 'callback_scheduled' && lead.next_action_at ? lead.next_action_at : null;
  const count = open.length + (callbackAt ? 1 : 0);

  return (
    <section className="space-y-2" data-testid="lead-next">
      <SectionLabel title="Next" meta={`${count} open`} />
      <ul className="border">
        {count === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing scheduled.</li>}
        {callbackAt && (
          <li className="flex min-h-12 items-center gap-2 border-b px-3 py-2 last:border-b-0">
            <Badge tone={new Date(callbackAt).getTime() < now ? 'solid' : 'outline'}>Callback</Badge>
            <span className="min-w-0 flex-1 font-mono text-xs tabular-nums text-foreground">{formatDateTime(callbackAt)}</span>
            <Button
              size="sm"
              disabled={busy}
              title="Clear the callback: the lead goes back to the queue"
              onClick={() => window.confirm('Clear this callback? The lead goes back to the queue.') && run(async () => onLeadChange?.((await api.clearCallback(lead.id)).lead))}
            >
              Clear
            </Button>
          </li>
        )}
        {open.map((t) => {
          const overdue = new Date(t.due_at).getTime() < now;
          return (
            <li key={t.id} className="flex min-h-12 items-center gap-2 border-b px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground" title={t.title}>
                  {t.title}
                </p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {TASK_TYPES.find((x) => x.value === t.type)?.label || t.type} · {overdue ? 'overdue · ' : ''}
                  {formatDateTime(t.due_at)}
                </p>
              </div>
              <Button size="sm" onClick={() => run(() => api.completeTask(t.id))} disabled={busy} aria-label={`Complete ${t.title}`}>
                Done
              </Button>
              <Menu
                size="sm"
                ariaLabel={`More for ${t.title}`}
                items={[{ label: 'Delete task', onSelect: () => window.confirm(`Delete the task "${t.title}"?`) && run(() => api.deleteTask(t.id)) }]}
              />
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </section>
  );
}
