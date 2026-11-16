// The lead page's tasks (C3A): open tasks first (overdue marked), then done
// ones; complete, reopen, delete; and the add form.
import { useCallback, useEffect, useState } from 'react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import SectionLabel from '../ui/SectionLabel';
import TaskForm, { TASK_TYPES } from './TaskForm';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

export default function TaskPanel({ lead }) {
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
  }, [load]);

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

  return (
    <Panel className="space-y-4 p-6">
      <SectionLabel title="Tasks" meta={`${open.length} open`} />
      <ul className="border-t">
        {tasks.length === 0 && <li className="py-2 text-sm text-muted-foreground">No tasks yet.</li>}
        {tasks.map((t) => {
          const overdue = !t.done_at && new Date(t.due_at).getTime() < now;
          return (
            <li key={t.id} className={`flex min-h-12 flex-wrap items-center gap-2 border-b py-2 ${t.done_at ? 'text-muted-foreground' : ''}`}>
              <Badge tone={t.done_at ? 'muted' : 'outline'}>{TASK_TYPES.find((x) => x.value === t.type)?.label || t.type}</Badge>
              <span className={`min-w-0 flex-1 break-words text-sm ${t.done_at ? 'line-through' : 'text-foreground'}`}>{t.title}</span>
              {overdue && <Badge tone="solid">Overdue</Badge>}
              {t.source === 'disposition' && <span className="label">From outcome</span>}
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {t.done_at ? `Done ${formatDateTime(t.done_at)}` : `Due ${formatDateTime(t.due_at)}`}
              </span>
              {t.done_at ? (
                <Button variant="ghost" onClick={() => run(() => api.reopenTask(t.id))} disabled={busy} aria-label={`Reopen ${t.title}`}>
                  Reopen
                </Button>
              ) : (
                <Button onClick={() => run(() => api.completeTask(t.id))} disabled={busy} aria-label={`Complete ${t.title}`}>
                  ✓ Done
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => window.confirm(`Delete the task "${t.title}"?`) && run(() => api.deleteTask(t.id))}
                disabled={busy}
                aria-label={`Delete ${t.title}`}
              >
                ⊘
              </Button>
            </li>
          );
        })}
      </ul>
      <TaskForm busy={busy} onSubmit={(task) => run(() => api.createTask({ ...task, leadId: lead.id }))} />
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </Panel>
  );
}
