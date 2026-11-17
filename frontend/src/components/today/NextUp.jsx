// Today's right rail, under the brief (C7C): NEXT UP — the next 5 callbacks
// and tasks by time, from now on (overdue ones live in TO DO).
import { Link } from 'react-router-dom';
import SectionLabel from '../ui/SectionLabel';
import { todoRows } from './TodoList';
import { formatDateTime } from '../../lib/format';

export default function NextUp({ today, upcoming }) {
  const now = Date.now();
  const next = todoRows(today, upcoming)
    .filter((r) => (r.kind === 'callback' || r.kind === 'task') && r.at && new Date(r.at).getTime() >= now)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(0, 5);
  return (
    <section className="space-y-2" data-testid="next-up">
      <SectionLabel title="Next up" />
      {next.length === 0 ? (
        <p className="text-sm text-muted-foreground">No callbacks or tasks coming up.</p>
      ) : (
        <ol className="divide-y border">
          {next.map((r) => (
            <li key={r.key} className="space-y-1 px-3 py-2">
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDateTime(r.at)} · {r.kind === 'callback' ? 'Callback' : 'Task'}
              </p>
              {r.leadId ? (
                <Link to={r.kind === 'callback' ? `/call/${r.leadId}` : `/leads/${r.leadId}`} className="block text-sm font-medium text-foreground underline underline-offset-4 hover:bg-muted">
                  {r.name}
                </Link>
              ) : (
                <p className="text-sm font-medium text-foreground">{r.name}</p>
              )}
              {r.kind === 'task' && <p className="truncate text-xs text-muted-foreground">{r.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
