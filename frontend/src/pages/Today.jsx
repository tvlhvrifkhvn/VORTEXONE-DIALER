// / (C3B, C7C, C8B): "what to do now". Main column: the header row (Today
// and the date; START DIALING SESSION, the page's one primary button), four
// number tiles (DIALS with the goal and its EDIT, CONTACTS, CONNECT RATE,
// DUE), then TO DO. Right rail: PIPELINE (stage counts → the board), then
// AI BRIEF. No left rail (lists and states live on the Leads page). All for
// the active file.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import PageFrame from '../components/layout/PageFrame';
import Button from '../components/ui/Button';
import SectionLabel from '../components/ui/SectionLabel';
import BriefPanel from '../components/assistant/BriefPanel';
import TodoList from '../components/today/TodoList';
import NumberTiles from '../components/today/NumberTiles';
import { useUserSettings } from '../hooks/useUserSettings';
import { startDialingSession, DIAL_MODE_KEY } from '../hooks/useCall';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';
import { useToday } from '../hooks/useToday';

const POLL_MS = 30000;
const UPCOMING_POLL_MS = 60000;

export default function Today() {
  const navigate = useNavigate();
  const { settings } = useUserSettings();
  const today = useToday(); // C7A: the shared Today poll (AppShell's badge uses the same one)
  const [stages, setStages] = useState([]);
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [upcoming, setUpcoming] = useState({ tasks: [], callbacks: [] });
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([api.getPipelineStages(), api.getTodayStats()]);
      setStages(s.stages || []);
      setStats(st);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // C7C: what comes after today, for TO DO's UPCOMING.
  const loadUpcoming = useCallback(async () => {
    try {
      const [tasks, callbacks] = await Promise.all([
        api.getTaskView('upcoming'),
        api.listLeads({ status: 'callback_scheduled', limit: 100 }),
      ]);
      const end = today?.endOfDay ? new Date(today.endOfDay).getTime() : Date.now();
      setUpcoming({
        tasks: tasks.items || [],
        callbacks: (callbacks.leads || []).filter((l) => l.next_action_at && new Date(l.next_action_at).getTime() >= end),
      });
    } catch {
      /* TO DO keeps today's lists */
    }
  }, [today?.endOfDay]);

  useEffect(() => {
    load();
    return pollWhileVisible(load, POLL_MS);
  }, [load]);
  useEffect(() => {
    loadUpcoming();
    return pollWhileVisible(loadUpcoming, UPCOMING_POLL_MS);
  }, [loadUpcoming]);

  const lineCount = [1, 2, 3].includes(Number(settings?.default_lines)) ? Number(settings.default_lines) : 3;

  const startSession = async () => {
    setStarting(true);
    try {
      localStorage.setItem(DIAL_MODE_KEY, 'multiline');
      await startDialingSession('multiline');
      navigate('/dialer', { state: { lineCount, leadIds: [] } });
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  };

  const overdue = today ? today.callbacks.overdue + today.tasks.overdue : 0;
  const due = today ? today.callbacks.total + today.tasks.total : 0;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const right = (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionLabel
          index={null}
          title="Pipeline"
          meta={
            <Link to="/pipeline" className="underline-offset-4 hover:underline">
              Open board →
            </Link>
          }
        />
        <ul className="border" data-testid="pipeline-row">
          {stages.map((s) => (
            <li key={s.id} className="border-b last:border-b-0">
              <Link
                to="/pipeline"
                className="flex min-h-10 items-center justify-between gap-2 px-3 transition-colors duration-150 hover:bg-muted"
                aria-label={`${s.name}: ${s.lead_count} leads. Open the board`}
              >
                <span className="truncate text-sm text-foreground">{s.name}</span>
                <span className="font-mono text-sm font-medium tabular-nums text-foreground">{s.lead_count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <BriefPanel index={null} />
    </div>
  );

  return (
    <AppShell framed>
      <PageFrame id="today" right={right} rightLabel="Pipeline and brief">
        <div className="mx-auto mt-6 max-w-[1100px] space-y-6">
          {/* Header row: the title and the date; the page's one primary button. */}
          <div className="flex min-h-11 items-center justify-between gap-4">
            <h1 className="flex items-baseline gap-4">
              <span className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Today</span>
              <span className="font-mono text-sm text-muted-foreground">{date}</span>
            </h1>
            <Button variant="primary" size="lg" onClick={startSession} disabled={starting}>
              Start dialing session →
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {error}
            </p>
          )}
          <NumberTiles stats={stats} due={due} overdue={overdue} />
          <TodoList today={today} upcoming={upcoming} onChanged={loadUpcoming} />
        </div>
      </PageFrame>
    </AppShell>
  );
}
