import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import StateSidebar from '../components/layout/StateSidebar';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import StatCard from '../components/stats/StatCard';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import { DIAL_MODE_KEY, endSession, getActiveSession, startSession } from '../hooks/useCall';
import * as api from '../lib/api';

const EMPTY_FILTERS = { search: '', status: '', dateFrom: '', dateTo: '', state: null };
const GOAL_KEY = 'vortex_dialer_daily_goal';
const DEFAULT_GOAL = 100;

function readGoal() {
  const stored = Number(localStorage.getItem(GOAL_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_GOAL;
}

/** Below the stat cards — a neumorphic progress bar toward the daily dial goal. */
function DailyGoalTracker({ dials }) {
  const [goal, setGoal] = useState(readGoal);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));

  const pct = Math.min(100, Math.round((dials / goal) * 100));

  const saveGoal = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0) {
      setGoal(next);
      localStorage.setItem(GOAL_KEY, String(next));
    }
    setEditing(false);
  };

  return (
    <NeuCard className="p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-text-secondary">
        <span>Daily goal</span>
        {editing ? (
          <div className="flex items-center gap-2">
            <NeuInput
              type="number"
              min="1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-20 py-1 text-xs"
              autoFocus
            />
            <button type="button" onClick={saveGoal} className="text-action-call">
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(goal));
              setEditing(true);
            }}
            title="Edit daily goal"
            aria-label="Edit daily goal"
            className="text-text-secondary hover:text-action-call"
          >
            ✏️
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-shadow/20 shadow-neu-inset">
          <div
            className="h-full rounded-full bg-action-call transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-sm font-semibold text-text-primary">
          {dials} / {goal} dials today
        </span>
      </div>
    </NeuCard>
  );
}

function formatMinutes(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Shown when the rep clicks Stop Dialing — summarizes the session just ended. */
function SessionSummaryModal({ session, onClose }) {
  if (!session) return null;
  const { stats, startedAt } = session;
  const elapsed = formatMinutes(Date.now() - startedAt);

  const rows = [
    ['Dials made', stats.dials],
    ['Contacts', stats.contacts],
    ['Voicemails', stats.voicemails],
    ['No answers', stats.noAnswers],
    ['Callbacks set', stats.callbacks],
    ['Time spent', elapsed],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <NeuCard className="w-full max-w-sm space-y-4 p-6">
        <h2 className="text-lg font-semibold text-text-primary">Session summary</h2>
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="font-medium text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        <NeuButton className="w-full" onClick={onClose}>
          Close
        </NeuButton>
      </NeuCard>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { leads, total, loading, refresh } = useLeads(filters);
  const { counts, refresh: refreshCounts } = useStateCounts();
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [dialMode, setDialMode] = useState(() => localStorage.getItem(DIAL_MODE_KEY) || 'power');
  const [exporting, setExporting] = useState(false);
  const [sessionActive, setSessionActive] = useState(() => !!getActiveSession());
  const [summarySession, setSummarySession] = useState(null);

  useEffect(() => {
    const load = () => api.getTodayStats().then(setStats).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(DIAL_MODE_KEY, dialMode);
  }, [dialMode]);

  const handleSnooze = async (id) => {
    await api.snoozeLead(id);
    refresh();
    refreshCounts();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.downloadDailyPdf();
    } catch (err) {
      window.alert(`Couldn't export PDF: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleStartDialing = () => {
    startSession();
    setSessionActive(true);
    navigate('/call/next');
  };

  const handleStopDialing = () => {
    setSummarySession(getActiveSession());
  };

  const handleCloseSummary = () => {
    endSession();
    setSessionActive(false);
    setSummarySession(null);
  };

  return (
    <AppShell>
      <div className="mx-auto mt-4 flex max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials today" value={stats.dials} />
          <StatCard label="Contacts today" value={stats.contacts} />
          <StatCard label="Connect rate" value={`${stats.connectRate}%`} />
        </div>

        <DailyGoalTracker dials={stats.dials} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {sessionActive ? (
              <ActionButton variant="hangup" onClick={handleStopDialing}>
                Stop Dialing
              </ActionButton>
            ) : (
              <ActionButton variant="call" className="btn-glow" onClick={handleStartDialing}>
                Start Dialing
              </ActionButton>
            )}
            <NeuButton onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export PDF'}
            </NeuButton>
          </div>

          <div className="flex items-center gap-1 rounded-input bg-surface p-1 shadow-neu-inset">
            <button
              type="button"
              onClick={() => setDialMode('power')}
              className={`rounded-input px-3 py-1.5 text-xs font-medium transition-shadow ${
                dialMode === 'power' ? 'shadow-neu-sm text-text-primary' : 'text-text-secondary'
              }`}
            >
              Power dial
            </button>
            <button
              type="button"
              disabled
              title="Coming in Phase 2"
              className="cursor-not-allowed rounded-input px-3 py-1.5 text-xs font-medium text-text-secondary/50"
            >
              Multi-line
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <StateSidebar
            counts={counts}
            selectedState={filters.state}
            onSelectState={(state) => setFilters((f) => ({ ...f, state }))}
          />

          <div className="flex-1 space-y-3">
            <NeuCard className="p-3">
              <LeadFilters filters={filters} onChange={setFilters} />
            </NeuCard>
            <div className="text-xs text-text-secondary">{total} lead{total === 1 ? '' : 's'}</div>
            <LeadTable leads={leads} loading={loading} onSnooze={handleSnooze} />
          </div>
        </div>
      </div>

      <SessionSummaryModal session={summarySession} onClose={handleCloseSummary} />
    </AppShell>
  );
}
