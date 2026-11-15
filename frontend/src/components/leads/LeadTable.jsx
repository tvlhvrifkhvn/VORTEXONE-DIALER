import { useNavigate } from 'react-router-dom';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import LeadRow from './LeadRow';

// No Actions column — calling, snoozing and scheduling all moved to the lead
// page, which a row click opens.
const COLUMNS = ['Lead', 'Phone', 'State', 'Attempts', 'Status', 'Added'];
const CALLBACK_DUE_SOON_MS = 2 * 60 * 60 * 1000;

function isCallbackDueSoon(lead) {
  if (lead.status !== 'callback_scheduled' || !lead.next_action_at) return false;
  const diffMs = new Date(lead.next_action_at).getTime() - Date.now();
  return diffMs >= 0 && diffMs <= CALLBACK_DUE_SOON_MS;
}

function EmptyState({ hasAnyLeads, selectedState }) {
  const navigate = useNavigate();
  const message = !hasAnyLeads
    ? 'Import your first lead list to get started.'
    : selectedState
      ? `No leads in ${selectedState} yet.`
      : 'No leads match these filters.';
  const showImportButton = !hasAnyLeads || !!selectedState;

  // Empty state: a mono label, one plain sentence, one action.
  return (
    <div className="space-y-4 px-4 py-8">
      <p className="label">{hasAnyLeads ? 'No results' : 'No leads yet'}</p>
      <p className="text-base text-foreground">{message}</p>
      {showImportButton && <NeuButton onClick={() => navigate('/import')}>Import leads →</NeuButton>}
    </div>
  );
}

export default function LeadTable({
  leads,
  loading,
  selectedState = null,
  hasAnyLeads = true,
  total = 0,
  page = 1,
  pageSize = 50,
  onPageChange = () => {},
  selectedIds = new Set(),
  onToggleLead = () => {},
  onSelectPage = () => {},
  onClearPage = () => {},
  onSelectAllFiltered = () => {},
}) {
  // Leads with a callback due within the next 2 hours float to the top
  // (stable sort keeps everything else in its existing order).
  const orderedLeads = [...leads].sort((a, b) => Number(isCallbackDueSoon(b)) - Number(isCallbackDueSoon(a)));

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  const pageFullySelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));

  return (
    <NeuCard className="overflow-x-auto p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm text-muted-foreground">
        <span className="tabular-nums">
          Showing {leads.length} of {total} lead{total === 1 ? '' : 's'}
          {selectedState ? ` in ${selectedState}` : ''}
        </span>
        {total > 0 && (
          <button
            type="button"
            onClick={onSelectAllFiltered}
            className="min-h-10 font-medium text-foreground underline underline-offset-4 hover:bg-muted"
          >
            Select all {total} lead{total === 1 ? '' : 's'}
            {selectedState ? ` in ${selectedState}` : ''}
          </button>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b text-left">
            <th className="label px-3 py-3 font-medium">
              <input
                type="checkbox"
                checked={pageFullySelected}
                onChange={() => (pageFullySelected ? onClearPage() : onSelectPage())}
                aria-label="Select page"
                title="Select page"
                className="h-4 w-4 cursor-pointer accent-primary"
              />
            </th>
            {COLUMNS.map((col) => (
              <th key={col} className="label px-3 py-3 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedLeads.map((lead, index) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              index={index}
              callbackDueSoon={isCallbackDueSoon(lead)}
              selected={selectedIds.has(lead.id)}
              onToggleSelect={onToggleLead}
            />
          ))}
        </tbody>
      </table>
      {!loading && leads.length === 0 && <EmptyState hasAnyLeads={hasAnyLeads} selectedState={selectedState} />}
      {loading && leads.length === 0 && (
        <div className="label px-4 py-8">Loading…</div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs tabular-nums">
            Showing {rangeStart}–{rangeEnd} of {total} leads
          </span>
          <div className="flex gap-2">
            <NeuButton onClick={() => onPageChange(page - 1)} disabled={!hasPrev}>
              Previous
            </NeuButton>
            <NeuButton onClick={() => onPageChange(page + 1)} disabled={!hasNext}>
              Next
            </NeuButton>
          </div>
        </div>
      )}
    </NeuCard>
  );
}
