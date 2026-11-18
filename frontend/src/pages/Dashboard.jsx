// /leads (C8B): "find people". Left rail: ALL LEADS · SMART LISTS · LISTS ·
// STATES. Main column: the header row (Leads and the count; DIAL split button,
// the page primary: the selection, or the queue; its arrow holds LINES and
// the dialable-now line · IMPORT · ⋯ Export CSV, Daily report PDF, Find
// duplicates, Save filters as a smart list), a toolbar (search, "50 of 626",
// FILTERS (n) opening the filter fields; active filters as chips with ×) that
// a selection strip replaces while rows are selected, then the table.
// Duplicates open from ⋯ as a full view with BACK TO LEADS.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import BulkSmsModal from '../components/leads/BulkSmsModal';
import { normalizeFilters } from '../components/leads/SavedViewsBar';
import AddToList from '../components/leads/AddToList';
import PageFrame from '../components/layout/PageFrame';
import LeftRail from '../components/layout/LeftRail';
import BulkActions from '../components/leads/BulkActions';
import DuplicatesView from '../components/leads/DuplicatesView';
import { queueHours } from '../components/stats/QueueHoursCards';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Menu, { Popover } from '../components/ui/Menu';
import Segmented from '../components/ui/Segmented';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import { useStages } from '../hooks/useStages';
import { DIAL_MODE_KEY, startDialingSession } from '../hooks/useCall';
import * as api from '../lib/api';
import { useUserSettings } from '../hooks/useUserSettings';
import { showToast } from '../hooks/useCampaign';
import { STATUS_LABELS } from '../styles/theme';

const EMPTY_FILTERS = { search: '', status: '', dateFrom: '', dateTo: '', state: null };
// Default simultaneous lines, set under Settings → Dialing defaults (a
// per-user server setting, F-48). The dashboard selector starts here and can
// be changed per session.
const DEFAULT_LINES = 3;

const linesFrom = (settings) => {
  const n = Number(settings?.default_lines);
  return [1, 2, 3].includes(n) ? n : DEFAULT_LINES;
};

/** The active filters as removable chips (search is the toolbar's own field). */
function filterChips(filters, stages) {
  const date = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const chips = [];
  if (filters.state) chips.push({ key: 'state', label: `State · ${filters.state}` });
  if (filters.status) chips.push({ key: 'status', label: `Status · ${STATUS_LABELS[filters.status] || filters.status}` });
  if (filters.stageId) chips.push({ key: 'stageId', label: `Stage · ${stages.find((st) => String(st.id) === String(filters.stageId))?.name || filters.stageId}` });
  if (filters.tag) chips.push({ key: 'tag', label: String(filters.tag).startsWith('list:') ? `List · ${String(filters.tag).slice(5)}` : `Tag · ${filters.tag}` });
  if (filters.minAttempts) chips.push({ key: 'minAttempts', label: `Attempts ≥ ${filters.minAttempts}` });
  if (filters.noActivityDays) chips.push({ key: 'noActivityDays', label: `Quiet ${filters.noActivityDays}+ days` });
  if (String(filters.callbackOverdue) === 'true') chips.push({ key: 'callbackOverdue', label: 'Callback overdue' });
  if (filters.dateFrom) chips.push({ key: 'dateFrom', label: `Added from ${date(filters.dateFrom)}` });
  if (filters.dateTo) chips.push({ key: 'dateTo', label: `Added to ${date(filters.dateTo)}` });
  return chips;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { leads, total, page, pageSize, setPage, loading, refresh } = useLeads(filters);
  // C7C: the left rail opens this page with ?view=<smart list> or ?tag=<list tag>.
  const [params] = useSearchParams();
  const [railKey, setRailKey] = useState(0);
  const viewParam = params.get('view');
  const tagParam = params.get('tag');
  useEffect(() => {
    if (viewParam) {
      api
        .listViews()
        .then(({ views }) => {
          const v = (views || []).find((x) => String(x.id) === viewParam);
          if (v) setFilters({ ...EMPTY_FILTERS, ...v.filters });
        })
        .catch(() => {});
    } else if (tagParam) {
      setFilters({ ...EMPTY_FILTERS, tag: tagParam });
    }
  }, [viewParam, tagParam]);
  const { counts, refresh: refreshCounts } = useStateCounts();
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
    localStorage.setItem(DIAL_MODE_KEY, 'multiline');
  }, []);

  const [exportingCsv, setExportingCsv] = useState(false);
  const [view, setView] = useState('leads'); // C6B: the leads table, or (C8B: from ⋯) the duplicates
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nameSmartList, setNameSmartList] = useState(0); // ⋯ → opens the rail's name form
  const [message, setMessage] = useState(null); // the last bulk action's result
  const { stages } = useStages();
  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await api.downloadLeadsCsv(filters);
    } catch (err) {
      showToast(err.message);
    } finally {
      setExportingCsv(false);
    }
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

  // C7C: the rail's "+ NEW SMART LIST" saves these filters; "+ NEW LIST" adds the selection.
  const saveSmartList = (name) => api.createView(name, normalizeFilters(filters));
  const newList = async (name) => {
    if (selectedIds.size === 0) return false;
    await api.addToList([...selectedIds], name);
    refresh();
    return true;
  };
  const hasFilters = Object.keys(normalizeFilters(filters)).length > 0;
  const allCount = counts.reduce((sum, c) => sum + c.total, 0);
  const hours = queueHours(counts);
  const queueCount = hours ? hours.dialable + hours.waiting : null;
  const chips = filterChips(filters, stages);
  const selected = selectedIds.size;
  const dialLabel = selected > 0 ? `Dial ${selected} selected` : queueCount !== null ? `Dial ${queueCount}` : 'Dial';

  const rail = (
    <LeftRail
      activeViewId={viewParam ? Number(viewParam) : null}
      activeTag={filters.tag && String(filters.tag).startsWith('list:') ? filters.tag : null}
      allCount={allCount}
      allActive={!hasFilters && !viewParam}
      onAll={() => {
        setFilters(EMPTY_FILTERS);
        setView('leads');
        navigate('/leads');
      }}
      onSaveSmartList={saveSmartList}
      canSaveSmartList={hasFilters}
      nameSmartList={nameSmartList}
      onNewList={newList}
      refreshKey={railKey}
      states={counts}
      selectedState={filters.state}
      onSelectState={(state) => setFilters((f) => ({ ...f, state }))}
    />
  );

  const moreItems = [
    { label: exportingCsv ? 'Exporting CSV…' : 'Export CSV', onSelect: handleExportCsv, disabled: exportingCsv },
    { label: exporting ? 'Exporting PDF…' : 'Daily report PDF', onSelect: handleExport, disabled: exporting },
    { label: 'Find duplicates', onSelect: () => setView('duplicates') },
    { label: 'Save filters as a smart list', onSelect: () => setNameSmartList((n) => n + 1), disabled: !hasFilters },
  ];

  return (
    <AppShell framed>
      <PageFrame id="leads" left={rail} leftLabel="Lists and states">
      <div className="mx-auto mt-6 flex max-w-[1440px] flex-col gap-4">
        {view === 'duplicates' ? (
          <>
            <div className="flex min-h-11 items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Duplicates</h1>
              <Button size="lg" onClick={() => setView('leads')}>
                ← Back to leads
              </Button>
            </div>
            <DuplicatesView
              onMerged={() => {
                refresh();
                refreshCounts();
              }}
            />
          </>
        ) : (
          <>
        {/* Header row: title and count; DIAL (primary, split) · IMPORT · ⋯, all 44px. */}
        <div className="flex min-h-11 items-center justify-between gap-4">
          <h1 className="flex items-baseline gap-4">
            <span className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Leads</span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">{total}</span>
          </h1>
          <div className="flex items-center gap-2">
            <div className="flex">
              <Button variant="primary" size="lg" onClick={handleStartDialingSession} className="border-r-0" data-testid="dial-button">
                {dialLabel}
              </Button>
              <Popover
                label="▾"
                ariaLabel="Dialing options"
                variant="primary"
                size="lg"
                className="px-3"
                panelClassName="w-80 space-y-3 p-4"
              >
                <div className="flex items-center justify-between gap-4">
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
                {hours && (
                  <p className="font-mono text-xs tabular-nums text-muted-foreground" title={hours.hint || undefined}>
                    {hours.dialable} dialable now · {hours.waiting} waiting for their hours
                  </p>
                )}
              </Popover>
            </div>
            <Button size="lg" className="w-[7.5rem]" onClick={() => navigate('/import')}>
              Import
            </Button>
            <Menu ariaLabel="More lead actions" size="lg" className="w-11 px-0" items={moreItems} />
          </div>
        </div>

        {/* Toolbar, or the selection strip in its place (same height, same edges). */}
        {selected === 0 ? (
          <div className="flex min-h-10 items-center gap-4">
            <Field
              value={filters.search || ''}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Search name, phone, company or tag"
              aria-label="Search leads"
              className="min-w-0 flex-1"
            />
            <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted-foreground">
              {leads.length} of {total}
            </span>
            <Button className="w-[172px]" active={filtersOpen} aria-expanded={filtersOpen} aria-controls="lead-filters" onClick={() => setFiltersOpen((o) => !o)}>
              Filters{chips.length > 0 ? ` (${chips.length})` : ''}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-4 border border-strong border-l-[3px] border-l-primary bg-card px-3 py-1" data-testid="selection-strip">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 font-mono text-sm font-medium uppercase tabular-nums text-foreground">{selected} selected</span>
              <Button size="sm" onClick={handleOpenBulkSms}>
                SMS
              </Button>
              <AddToList
                selectedIds={selectedIds}
                onMessage={setMessage}
                onDone={() => {
                  refresh();
                  setRailKey((k) => k + 1);
                }}
              />
              {/* C2E: stage, tag and file actions on the selection. */}
              <BulkActions selectedIds={selectedIds} onMessage={setMessage} onDone={() => refresh()} />
            </div>
            <div className="flex items-center gap-2">
              {total > selected && (
                <Button size="sm" variant="ghost" onClick={selectAllFiltered}>
                  Select all {total}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
        )}
        {message && (
          <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
            {message.text}
          </p>
        )}
        {filtersOpen && selected === 0 && (
          <Panel id="lead-filters" className="p-4">
            <LeadFilters filters={filters} onChange={setFilters} />
          </Panel>
        )}
        {chips.length > 0 && selected === 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Active filters">
            {chips.map((c) => (
              <li key={c.key}>
                <span className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap border border-strong pl-2 font-mono text-xs font-medium uppercase text-foreground">
                  {c.label}
                  <button
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, [c.key]: c.key === 'state' ? null : undefined }))}
                    aria-label={`Remove filter ${c.label}`}
                    className="inline-flex min-h-8 min-w-8 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
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
              hasAnyLeads={allCount > 0}
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
      </PageFrame>
    </AppShell>
  );
}
