// Today's AI BRIEF (C5C; C8B: the right rail, compact): the day at a glance, the 3 to 5 leads to call
// first with a one-line reason, and yesterday against the daily goal. Never
// runs on page load: GENERATE, then REFRESH. The server keeps it for the
// rest of the reporting day (per user and file), so GENERATE after a reload
// returns the same brief at no cost.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';
import { NotConfiguredText } from './AssistantPanel';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

export default function BriefPanel({ index = '04' }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);

  const run = async (refresh) => {
    setLoading(true);
    setProblem(null);
    try {
      setBrief(await api.getBrief({ refresh }));
    } catch (err) {
      setProblem({
        notConfigured: err.status === 503 && err.code === 'assistant_not_configured',
        message: err.status === 429 ? 'Too many assistant requests this minute. Try again shortly.' : err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const y = brief?.yesterday;
  return (
    <section className="space-y-2" data-testid="brief">
      {/* C8B: "AI BRIEF" in the Today rail; no description line, the Groq note is the button's tooltip. */}
      <SectionLabel index={index} title="AI brief" meta={brief ? `Generated ${formatDateTime(brief.generatedAt)}` : null} />
      <Panel className="space-y-4 p-4">
        {brief ? (
          <>
            {brief.note && <p className="text-base text-foreground">{brief.note}</p>}
            <div>
              <p className="label mb-2">Call first</p>
              {brief.callFirst.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one to call right now.</p>
              ) : (
                <ol className="divide-y border">
                  {brief.callFirst.map((c, i) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                      <Link to={`/leads/${c.id}`} className="font-medium text-foreground underline underline-offset-4 hover:bg-muted">
                        {c.name}
                      </Link>
                      <span className="text-sm text-muted-foreground">{c.reason}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="label mb-1">Due today</p>
                <p className="font-mono text-sm tabular-nums text-foreground">
                  {brief.due.callbacks} callbacks ({brief.due.overdue_callbacks} overdue) · {brief.due.tasks} tasks ({brief.due.overdue_tasks} overdue) ·{' '}
                  {brief.due.unread_texts} unread texts
                </p>
              </div>
              <div>
                <p className="label mb-1">Yesterday</p>
                <p className="font-mono text-sm tabular-nums text-foreground">
                  {y.dials} dials of {y.goal} goal{y.goalPct !== null ? ` (${y.goalPct}%)` : ''} · {y.contacts} contacts · {y.connectRate}% connect
                </p>
              </div>
            </div>
          </>
        ) : null}
        {problem && (
          <p role="alert" className={`border-l-[3px] bg-muted px-4 py-2 text-sm text-foreground ${problem.notConfigured ? 'border-strong' : 'border-l-primary'}`}>
            {problem.notConfigured ? <NotConfiguredText message={problem.message} /> : problem.message}
          </p>
        )}
        <Button size="sm" onClick={() => run(Boolean(brief))} disabled={loading} title="Who to call first today and how yesterday went. Made by Groq from your CRM data; check before acting.">
          {loading ? 'Working…' : brief ? 'Refresh brief' : 'Generate brief'}
        </Button>
      </Panel>
    </section>
  );
}
