// / (C3B): the home page. 01 — DUE TODAY (callbacks, replies, tasks and
// quiet leads, with CALL / REPLY / OPEN and a filter), 02 — PIPELINE (stage
// counts, linking to the board), 03 — NUMBERS (dials today in display size,
// contacts, connect rate, the goal Meter). START DIALING SESSION is the only
// primary button. All for the active file.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import FileTag from '../components/ui/FileTag';
import Meter from '../components/ui/Meter';
import Segmented from '../components/ui/Segmented';
import SectionLabel from '../components/ui/SectionLabel';
import ActionButton from '../components/ui/ActionButton';
import StatCard from '../components/stats/StatCard';
import BriefPanel from '../components/assistant/BriefPanel';
import TaskViewsSection from '../components/tasks/TaskViewsSection';
import { useCampaign } from '../hooks/useCampaign';
import { useUserSettings } from '../hooks/useUserSettings';
import { startDialingSession, DIAL_MODE_KEY } from '../hooks/useCall';
import { formatDateTime, formatRelativeToNow } from '../lib/format';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';
import { useToday } from '../hooks/useToday';

const POLL_MS = 30000;
const DEFAULT_GOAL = 100;
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'callback', label: 'Callbacks' },
  { value: 'reply', label: 'Replies' },
  { value: 'task', label: 'Tasks' },
  { value: 'quiet', label: 'Gone quiet' },
];

/** The four Today lists as one list of rows, overdue first then by time. */
function rowsFrom(today) {
  if (!today) return [];
  const rows = [
    ...today.callbacks.items.map((c) => ({ kind: 'callback', key: `c${c.id}`, leadId: c.id, name: c.name, detail: 'Callback', at: c.due_at, overdue: c.overdue })),
    ...today.unreadTexts.items.map((t) => ({ kind: 'reply', key: `r${t.id}`, leadId: t.id, name: t.name, detail: `${t.unread} unread text${t.unread === 1 ? '' : 's'}`, at: t.last_at, overdue: false })),
    ...today.tasks.items.map((t) => ({ kind: 'task', key: `t${t.id}`, leadId: t.lead_id, name: t.lead_name || 'No lead', detail: t.title, at: t.due_at, overdue: t.overdue })),
    ...today.stale.items.map((s) => ({ kind: 'quiet', key: `s${s.id}`, leadId: s.id, name: s.name, detail: `${s.stage_name} · quiet since ${formatRelativeToNow(s.activity_at)}`, at: null, overdue: false })),
  ];
  const rank = (r) => (r.overdue ? 0 : r.kind === 'quiet' ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || new Date(a.at || 0) - new Date(b.at || 0));
}

const KIND_LABEL = { callback: 'Callback', reply: 'Reply', task: 'Task', quiet: 'Quiet' };

function DueRow({ row }) {
  const navigate = useNavigate();
  const action =
    row.kind === 'callback'
      ? { label: 'Call', to: `/call/${row.leadId}` }
      : row.kind === 'reply'
        ? { label: 'Reply', to: `/leads/${row.leadId}?reply=1` }
        : row.leadId
          ? { label: 'Open', to: `/leads/${row.leadId}` }
          : null;
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-2 border-b py-2">
      <Badge tone="outline">{KIND_LABEL[row.kind]}</Badge>
      <span className="min-w-[10rem] font-medium text-foreground">{row.name}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={row.detail}>{row.detail}</span>
      {row.overdue && <Badge tone="solid">Overdue</Badge>}
      {row.at && <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(row.at)}</span>}
      {action && (
        <Button onClick={() => navigate(action.to)} aria-label={`${action.label} ${row.name}`}>
          {action.label} →
        </Button>
      )}
    </li>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const { active } = useCampaign();
  const { settings } = useUserSettings();
  const today = useToday(); // C7A: the shared Today poll (AppShell's badge uses the same one)
  const [stages, setStages] = useState([]);
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [filter, setFilter] = useState('all');
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

  useEffect(() => {
    load();
    return pollWhileVisible(load, POLL_MS);
  }, [load]);

  const rows = rowsFrom(today).filter((r) => filter === 'all' || r.kind === filter);
  const goal = Number(active?.daily_goal) > 0 ? Number(active.daily_goal) : DEFAULT_GOAL;
  const lineCount = [1, 2, 3].includes(Number(settings?.default_lines)) ? Number(settings.default_lines) : 3;
  const capped = today && [today.callbacks, today.unreadTexts, today.tasks, today.stale].some((l) => l.total > l.items.length);

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

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-[1440px] space-y-6">
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

        <section className="space-y-2">
          <SectionLabel
            index="01"
            title="Due today"
            meta={today ? `${today.callbacks.total + today.tasks.total} due · ${today.callbacks.overdue + today.tasks.overdue} overdue` : undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} />
            {capped && <span className="label">Showing the first 50 of each list</span>}
          </div>
          <Panel className="px-4">
            {!today ? (
              <p className="label py-4">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Nothing due here. Good time to start a dialing session.</p>
            ) : (
              <ul>
                {rows.map((r) => (
                  <DueRow key={r.key} row={r} />
                ))}
              </ul>
            )}
          </Panel>
        </section>

        {/* C6A: OVERDUE | TODAY | UPCOMING with RESCHEDULE. */}
        <TaskViewsSection index="02" />

        <section className="space-y-2">
          <SectionLabel index="03" title="Pipeline" meta={<Link to="/pipeline" className="underline underline-offset-4 hover:bg-muted">Open the board →</Link>} />
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <Link
                key={s.id}
                to="/pipeline"
                className="min-w-[8rem] flex-1 border bg-card p-4 transition-colors duration-150 hover:bg-muted"
                aria-label={`${s.name}: ${s.lead_count} leads. Open the board`}
              >
                <div className="label truncate">{s.name}</div>
                <div className="mt-2 font-mono text-2xl font-medium tabular-nums text-foreground">{s.lead_count}</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <SectionLabel index="04" title="Numbers" />
          <div className="flex flex-wrap gap-4">
            <StatCard label="Dials today" value={stats.dials} size="display" />
            <StatCard label="Contacts" value={stats.contacts} />
            <StatCard label="Connect rate" value={`${stats.connectRate}%`} />
          </div>
          <Panel className="p-4">
            <Meter label="Daily goal · dials" value={stats.dials} max={goal} tone="goal" />
          </Panel>
        </section>

        {/* C5C: the AI brief, on request only. */}
        <BriefPanel index="05" />
      </div>
    </AppShell>
  );
}
