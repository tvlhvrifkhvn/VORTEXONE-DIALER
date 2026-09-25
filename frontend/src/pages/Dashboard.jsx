import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import StateSidebar from '../components/layout/StateSidebar';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import BulkSmsModal from '../components/leads/BulkSmsModal';
import StatCard from '../components/stats/StatCard';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import { DIAL_MODE_KEY, startDialingSession } from '../hooks/useCall';
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { leads, total, page, pageSize, setPage, loading, refresh } = useLeads(filters);
  const { counts, refresh: refreshCounts } = useStateCounts();
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [lineCount, setLineCount] = useState(readDefaultLines);
  const [exporting, setExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkSmsLeads, setBulkSmsLeads] = useState(null);

  useEffect(() => {
    const load = () => api.getTodayStats().then(setStats).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(DIAL_MODE_KEY, 'multiline');
  }, []);

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

  const handleOpenBulkSms = async () => {
    const { leads: selectedLeads } = await api.batchQueueLeads(Array.from(selectedIds));
    setBulkSmsLeads(selectedLeads);
  };

  // Exactly one way to start dialing: whatever's currently checked (if
  // anything) plus the chosen line count travel to /dialer, which owns the
  // multi-line engine entirely from here (see DialerSession.jsx). An empty
  // selection dials the general queue, same as the old plain "Start Dialing".
  const handleStartDialingSession = async () => {
    const leadIds = Array.from(selectedIds);
    await startDialingSession('multiline');
    setSelectedIds(new Set());
    navigate('/dialer', { state: { lineCount, leadIds } });
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
            <ActionButton variant="call" className="btn-glow" onClick={handleStartDialingSession}>
              Start dialing session
            </ActionButton>
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
            <NeuCard className="p-3">
              <LeadFilters filters={filters} onChange={setFilters} />
            </NeuCard>
            <div className="text-xs text-text-secondary">{total} lead{total === 1 ? '' : 's'}</div>

            {selectedIds.size > 0 && (
              <NeuCard className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="text-sm font-medium text-text-primary">
                  {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'} selected — use "Start dialing session"
                  above to dial them
                </span>
                <div className="flex items-center gap-3">
                  <NeuButton className="text-sm" onClick={handleOpenBulkSms}>
                    Send bulk SMS
                  </NeuButton>
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

            {bulkSmsLeads && (
              <BulkSmsModal
                leads={bulkSmsLeads}
                onClose={() => setBulkSmsLeads(null)}
                onSent={() => {
                  clearSelection();
                }}
              />
            )}

            <LeadTable
              leads={leads}
              loading={loading}
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
          </div>
        </div>
      </div>
    </AppShell>
  );
}
