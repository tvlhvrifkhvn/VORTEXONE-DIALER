// / (C3B, C7C): the home page, most important first. Main column: the header
// row with START DIALING SESSION (the only primary button), a compact numbers
// strip (dials today, contacts, connect rate, the daily-goal meter), 01 — TO DO
// (the old DUE TODAY and TASKS in one list: WHEN × TYPE, each row with its
// action) and 02 — PIPELINE (stage counts in one row, linking to the board).
// Left rail: smart lists, lists, files. Right rail: BRIEF, then NEXT UP.
// All for the active file.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import PageFrame from '../components/layout/PageFrame';
import LeftRail from '../components/layout/LeftRail';
import Panel from '../components/ui/Panel';
import FileTag from '../components/ui/FileTag';
import Meter from '../components/ui/Meter';
import SectionLabel from '../components/ui/SectionLabel';
import ActionButton from '../components/ui/ActionButton';
import BriefPanel from '../components/assistant/BriefPanel';
import TodoList from '../components/today/TodoList';
import NextUp from '../components/today/NextUp';
import { useCampaign } from '../hooks/useCampaign';
import { useUserSettings } from '../hooks/useUserSettings';
import { startDialingSession, DIAL_MODE_KEY } from '../hooks/useCall';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';
import { useToday } from '../hooks/useToday';

const POLL_MS = 30000;
const UPCOMING_POLL_MS = 60000;
const DEFAULT_GOAL = 100;

function Stat({ label, value, display = false }) {
  return (
    <div className="min-w-[7rem]">
      <p className="label">{label}</p>
      <p className={`font-mono font-medium tabular-nums text-foreground ${display ? 'text-4xl' : 'text-2xl'}`}>{value}</p>
    </div>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const { active } = useCampaign();
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

  // C7C: what comes after today, for TO DO's UPCOMING and NEXT UP.
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

  const goal = Number(active?.daily_goal) > 0 ? Number(active.daily_goal) : DEFAULT_GOAL;
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

  const right = (
    <div className="space-y-6 pt-2">
      <BriefPanel index={null} />
      <NextUp today={today} upcoming={upcoming} />
    </div>
  );

  return (
    <AppShell framed>
      <PageFrame id="today" left={<LeftRail />} leftLabel="Lists and files" right={right} rightLabel="Brief and next up">
        <div className="mx-auto mt-6 max-w-[1100px] space-y-6">
          {/* 1. Header row. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Today</h1>
              {active && <FileTag number={active.file_number} name={active.name} />}
            </div>
            <ActionButton variant="call" className="min-h-10 py-2" onClick={startSession} disabled={starting}>
              Start dialing session →
            </ActionButton>
          </div>
          {error && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {error}
            </p>
          )}

          {/* 2. Numbers strip. */}
          <Panel className="flex flex-wrap items-end gap-x-8 gap-y-4 p-4" data-testid="numbers-strip">
            <Stat label="Dials today" value={stats.dials} display />
            <Stat label="Contacts" value={stats.contacts} />
            <Stat label="Connect rate" value={`${stats.connectRate}%`} />
            <Meter label="Daily goal · dials" value={stats.dials} max={goal} tone="goal" className="min-w-[14rem] flex-1" />
          </Panel>

          {/* 3. TO DO. */}
          <TodoList today={today} upcoming={upcoming} onChanged={loadUpcoming} />

          {/* 4. Pipeline: one compact row. */}
          <section className="space-y-2">
            <SectionLabel index="02" title="Pipeline" meta={<Link to="/pipeline" className="underline underline-offset-4 hover:bg-muted">Open the board →</Link>} />
            <div className="flex flex-wrap border" data-testid="pipeline-row">
              {stages.map((s) => (
                <Link
                  key={s.id}
                  to="/pipeline"
                  className="flex min-h-10 min-w-[7rem] flex-1 items-baseline justify-between gap-2 border-r px-3 py-2 transition-colors duration-150 last:border-r-0 hover:bg-muted"
                  aria-label={`${s.name}: ${s.lead_count} leads. Open the board`}
                >
                  <span className="label truncate">{s.name}</span>
                  <span className="font-mono text-sm font-medium tabular-nums text-foreground">{s.lead_count}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </PageFrame>
    </AppShell>
  );
}
