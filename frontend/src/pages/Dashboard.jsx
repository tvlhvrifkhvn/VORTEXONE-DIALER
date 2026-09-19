import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import StateSidebar from '../components/layout/StateSidebar';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import MultilinePanel from '../components/call/MultilinePanel';
import StatCard from '../components/stats/StatCard';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import { useMultiline } from '../hooks/useMultiline';
import {
  DIAL_MODE_KEY,
  PENDING_SUMMARY_KEY,
  endDialingSession,
  getActiveSessionId,
  isSessionPaused,
  setSessionPaused,
  startDialingSession,
} from '../hooks/useCall';
import * as api from '../lib/api';

const EMPTY_FILTERS = { search: '', status: '', dateFrom: '', dateTo: '', state: null };
const GOAL_KEY = 'vortex_dialer_daily_goal';
const DEFAULT_GOAL = 100;
// Default simultaneous lines, set under Settings → Dialing defaults. The
// dashboard selector starts here and can be changed per session.
export const DEFAULT_LINES_KEY = 'vortex_dialer_default_lines';
const DEFAULT_LINES = 3;

function readDefaultLines() {
  const stored = Number(localStorage.getItem(DEFAULT_LINES_KEY));
  return [1, 2, 3].includes(stored) ? stored : DEFAULT_LINES;
}

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

/** Shown when the rep clicks Stop Dialing — summarizes the session just
 * ended, using the stats POST /api/sessions/end returns. */
function SessionSummaryModal({ stats, abandonedCount = 0, onClose }) {
  if (!stats) return null;
  const elapsed = formatMinutes(new Date(stats.ended_at).getTime() - new Date(stats.started_at).getTime());

  const rows = [
    ['Dials made', stats.total_dials],
    ['Contacts', stats.total_contacts],
    ['Voicemails', stats.total_voicemails],
    ['No answers', stats.total_no_answers],
    ['Callbacks set', stats.total_callbacks],
    ['DNC', stats.total_dnc],
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
        {abandonedCount > 0 && (
          <p className="text-xs text-text-secondary">
            {abandonedCount} call{abandonedCount === 1 ? ' was' : 's were'} abandoned when a live contact was found.
          </p>
        )}
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
  const { leads, total, page, pageSize, setPage, loading, refresh } = useLeads(filters);
  const { counts, refresh: refreshCounts } = useStateCounts();
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [lineCount, setLineCount] = useState(readDefaultLines);
  const [exporting, setExporting] = useState(false);
  const [sessionActive, setSessionActive] = useState(() => !!getActiveSessionId());
  const [paused, setPaused] = useState(() => isSessionPaused());
  const [summaryStats, setSummaryStats] = useState(null);
  const [abandonedCount, setAbandonedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [multilineActive, setMultilineActive] = useState(false);
  const multiline = useMultiline({ enabled: multilineActive });

  useEffect(() => {
    const load = () => api.getTodayStats().then(setStats).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // A selected-leads Power Dial session that ran to completion ends itself
  // and stashes its stats here (see useCall.js) so the summary modal still
  // shows up automatically once we land back on the dashboard.
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_SUMMARY_KEY);
    if (!raw) return;
    localStorage.removeItem(PENDING_SUMMARY_KEY);
    try {
      setSummaryStats(JSON.parse(raw));
    } catch {
      // ignore malformed leftovers
    }
    setSessionActive(false);
    setPaused(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(DIAL_MODE_KEY, 'multiline');
  }, []);

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

  // One continuous dialing mode: always the multi-line engine, with the
  // number of simultaneous lines chosen beside the button. A single line
  // behaves like the old power dial, just without the separate toggle.
  const handleStartDialing = async () => {
    await startDialingSession('multiline');
    setSessionActive(true);
    setPaused(false);
    setAbandonedCount(0);
    setMultilineActive(true);
    await multiline.start(lineCount);
  };

  const toggleLead = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectPage = () => {
    setSelectedIds((prev) => new Set([...prev, ...leads.map((l) => l.id)]));
  };

  const clearPage = () => {
    const pageIds = new Set(leads.map((l) => l.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !pageIds.has(id))));
  };

  const selectAllFiltered = async () => {
    if (total === 0) return;
    const { leads: allLeads } = await api.listLeads({ ...filters, page: 1, limit: total });
    setSelectedIds(new Set(allLeads.map((l) => l.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleStartPowerDialOnSelection = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await startDialingSession('power', ids);
    setSessionActive(true);
    setPaused(false);
    setSelectedIds(new Set());
    navigate('/call/next');
  };

  // A disposition submitted on an answered line: record it, free that slot
  // (promoting any held live caller), and refresh the lead list behind the
  // panel so counts stay honest.
  const handleMultilineDisposition = async (line, payload) => {
    await multiline.submitDispositionFor(line, payload);
    refresh();
    refreshCounts();
  };

  const handleStopDialing = async () => {
    let abandoned = 0;
    if (multilineActive) {
      const result = await multiline.stopSession();
      abandoned = result?.abandonedCount || 0;
      setMultilineActive(false);
    }
    const stats = await endDialingSession();
    setSessionActive(false);
    setPaused(false);
    setAbandonedCount(abandoned);
    setSummaryStats(stats);
    refresh();
    refreshCounts();
  };

  const handleTogglePause = () => {
    const next = !paused;
    setSessionPaused(next);
    setPaused(next);
  };

  const handleCloseSummary = () => {
    setSummaryStats(null);
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
              <>
                {paused ? (
                  <ActionButton variant="call" onClick={handleStartDialing}>
                    Resume
                  </ActionButton>
                ) : (
                  <NeuButton onClick={handleTogglePause}>Pause</NeuButton>
                )}
                <ActionButton variant="hangup" onClick={handleStopDialing}>
                  Stop Dialing
                </ActionButton>
              </>
            ) : (
              <ActionButton variant="call" className="btn-glow" onClick={handleStartDialing}>
                Start Dialing
              </ActionButton>
            )}
            <NeuButton onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-primary"
                  />
                  Exporting…
                </span>
              ) : (
                'Export PDF'
              )}
            </NeuButton>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">Lines</span>
            <div className="flex items-center gap-1 rounded-input bg-surface p-1 shadow-neu-inset">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLineCount(n)}
                  title={`Dial ${n} line${n === 1 ? '' : 's'} at a time`}
                  className={`rounded-input px-3 py-1.5 text-xs font-medium transition-shadow ${
                    lineCount === n ? 'shadow-neu-sm text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <StateSidebar
            counts={counts}
            selectedState={filters.state}
            onSelectState={(state) => setFilters((f) => ({ ...f, state }))}
          />

          <div className="flex-1 space-y-3">
            {multilineActive ? (
              <MultilinePanel
                lines={multiline.lines.slice(0, lineCount)}
                connected={multiline.connected}
                starting={multiline.starting}
                error={multiline.error}
                onDrop={multiline.dropLine}
                onStop={handleStopDialing}
                onDispositionSubmit={handleMultilineDisposition}
              />
            ) : (
              <>
            <NeuCard className="p-3">
              <LeadFilters filters={filters} onChange={setFilters} />
            </NeuCard>
            <div className="text-xs text-text-secondary">{total} lead{total === 1 ? '' : 's'}</div>

            {selectedIds.size > 0 && (
              <NeuCard className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="text-sm font-medium text-text-primary">
                  {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'} selected
                </span>
                <div className="flex items-center gap-3">
                  <ActionButton variant="call" onClick={handleStartPowerDialOnSelection}>
                    Start Power Dial
                  </ActionButton>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-sm font-medium text-text-secondary hover:text-text-primary"
                  >
                    Clear selection
                  </button>
                </div>
              </NeuCard>
            )}

            <LeadTable
              leads={leads}
              loading={loading}
              onSnooze={handleSnooze}
              selectedState={filters.state}
              hasAnyLeads={counts.reduce((sum, c) => sum + c.total, 0) > 0}
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              selectedIds={selectedIds}
              onToggleLead={toggleLead}
              onSelectPage={selectPage}
              onClearPage={clearPage}
              onSelectAllFiltered={selectAllFiltered}
            />
              </>
            )}
          </div>
        </div>
      </div>

      <SessionSummaryModal stats={summaryStats} abandonedCount={abandonedCount} onClose={handleCloseSummary} />
    </AppShell>
  );
}
