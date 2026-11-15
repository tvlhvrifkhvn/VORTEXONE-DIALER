import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import StateSidebar from '../components/layout/StateSidebar';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import BulkSmsModal from '../components/leads/BulkSmsModal';
import StatCard from '../components/stats/StatCard';
import QueueHoursCards from '../components/stats/QueueHoursCards';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import ActionButton from '../components/ui/ActionButton';
import Meter from '../components/ui/Meter';
import Segmented from '../components/ui/Segmented';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import { DIAL_MODE_KEY, startDialingSession } from '../hooks/useCall';
import * as api from '../lib/api';
import { useUserSettings } from '../hooks/useUserSettings';

const EMPTY_FILTERS = { search: '', status: '', dateFrom: '', dateTo: '', state: null };
const DEFAULT_GOAL = 100;
// Default simultaneous lines, set under Settings → Dialing defaults (a
// per-user server setting, F-48). The dashboard selector starts here and can
// be changed per session.
const DEFAULT_LINES = 3;

const goalFrom = (settings) => {
  const n = Number(settings?.daily_goal);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GOAL;
};
const linesFrom = (settings) => {
  const n = Number(settings?.default_lines);
  return [1, 2, 3].includes(n) ? n : DEFAULT_LINES;
};

/** Below the stat cards — a goal Meter toward the daily dial goal. */
function DailyGoalTracker({ dials }) {
  const { settings, save } = useUserSettings();
  const goal = goalFrom(settings);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));

  const saveGoal = () => {
    const next = Number(draft);
    if (Number.isInteger(next) && next > 0) save('daily_goal', next).catch(() => {});
    setEditing(false);
  };

  return (
    <Panel className="space-y-2 p-4">
      <Meter label="Daily goal · dials" value={dials} max={goal} tone="goal" />
      <div className="flex justify-end">
        {editing ? (
          <div className="flex items-center gap-2">
            <label htmlFor="daily-goal" className="label">
              Goal
            </label>
            <Field
              id="daily-goal"
              type="number"
              min="1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-24 font-mono tabular-nums"
              autoFocus
            />
            <Button onClick={saveGoal}>Save</Button>
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
            className="min-h-10 px-2 font-mono text-sm font-medium uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
          >
            Edit
          </button>
        )}
      </div>
    </Panel>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { leads, total, page, pageSize, setPage, loading, refresh } = useLeads(filters);
  const { counts, refresh: refreshCounts } = useStateCounts();
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const { settings: userSettings } = useUserSettings();
  const [lineCount, setLineCount] = useState(() => linesFrom(userSettings));
  // Start from the saved default once it has loaded (the selector can still change per session).
  const linesTouched = useRef(false);
  useEffect(() => {
    if (userSettings && !linesTouched.current) setLineCount(linesFrom(userSettings));
  }, [userSettings]);
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
      <div className="mx-auto mt-6 flex max-w-[1440px] flex-col gap-6">
        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials today" value={stats.dials} size="display" />
          <StatCard label="Contacts today" value={stats.contacts} />
          <StatCard label="Connect rate" value={`${stats.connectRate}%`} />
          <QueueHoursCards counts={counts} />
        </div>

        <DailyGoalTracker dials={stats.dials} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ActionButton variant="call" className="min-h-10 py-2" onClick={handleStartDialingSession}>
              Start dialing session →
            </ActionButton>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                  />
                  Exporting…
                </span>
              ) : (
                'Export PDF ↓'
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="label">Lines</span>
            <Segmented
              label="Lines to dial at a time"
              options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))}
              value={lineCount}
              onChange={(n) => {
                linesTouched.current = true;
                setLineCount(n);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          <StateSidebar
            counts={counts}
            selectedState={filters.state}
            onSelectState={(state) => setFilters((f) => ({ ...f, state }))}
          />

          <div className="min-w-0 flex-1 space-y-4">
            <Panel className="p-4">
              <LeadFilters filters={filters} onChange={setFilters} />
            </Panel>
            <div className="label tabular-nums">
              {total} lead{total === 1 ? '' : 's'}
            </div>

            {selectedIds.size > 0 && (
              <Panel className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-4 border-strong border-l-[3px] border-l-primary p-4">
                <span className="text-sm text-foreground">
                  <span className="font-mono font-medium tabular-nums">{selectedIds.size}</span> lead
                  {selectedIds.size === 1 ? '' : 's'} selected — use "Start dialing session" above to dial them
                </span>
                <div className="flex items-center gap-2">
                  <Button onClick={handleOpenBulkSms}>Send bulk SMS</Button>
                  <Button variant="ghost" onClick={clearSelection}>
                    Clear selection
                  </Button>
                </div>
              </Panel>
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
