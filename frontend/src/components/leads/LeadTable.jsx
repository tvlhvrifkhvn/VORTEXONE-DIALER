import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import LeadRow from './LeadRow';

const COLUMNS = ['Lead', 'Phone', 'State', 'Attempts', 'Status', 'Added', 'Actions'];
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

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <Inbox size={28} className="text-text-secondary" />
      <p className="text-sm text-text-secondary">{message}</p>
      {showImportButton && <NeuButton onClick={() => navigate('/import')}>Import leads</NeuButton>}
    </div>
  );
}

export default function LeadTable({
  leads,
  loading,
  onSnooze,
  selectedState = null,
  hasAnyLeads = true,
  total = 0,
  page = 1,
  pageSize = 50,
  onPageChange = () => {},
}) {
  // Leads with a callback due within the next 2 hours float to the top
  // (stable sort keeps everything else in its existing order).
  const orderedLeads = [...leads].sort((a, b) => Number(isCallbackDueSoon(b)) - Number(isCallbackDueSoon(a)));

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  return (
    <NeuCard className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-text-secondary">
            {COLUMNS.map((col) => (
              <th key={col} className="px-3 py-3 font-medium">
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
              onSnooze={onSnooze}
              index={index}
              callbackDueSoon={isCallbackDueSoon(lead)}
            />
          ))}
        </tbody>
      </table>
      {!loading && leads.length === 0 && <EmptyState hasAnyLeads={hasAnyLeads} selectedState={selectedState} />}
      {loading && leads.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-secondary">Loading…</div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-shadow/20 px-4 py-3 text-xs text-text-secondary">
          <span>
            Showing {rangeStart}-{rangeEnd} of {total} leads
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={!hasPrev}
              className="rounded-input px-3 py-1 shadow-neu-sm transition-shadow hover:shadow-neu disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={!hasNext}
              className="rounded-input px-3 py-1 shadow-neu-sm transition-shadow hover:shadow-neu disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </NeuCard>
  );
}
