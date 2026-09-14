import NeuCard from '../ui/NeuCard';
import LeadRow from './LeadRow';

const COLUMNS = ['Lead', 'Phone', 'State', 'Attempts', 'Status', 'Added', 'Actions'];
const CALLBACK_DUE_SOON_MS = 2 * 60 * 60 * 1000;

function isCallbackDueSoon(lead) {
  if (lead.status !== 'callback_scheduled' || !lead.next_action_at) return false;
  const diffMs = new Date(lead.next_action_at).getTime() - Date.now();
  return diffMs >= 0 && diffMs <= CALLBACK_DUE_SOON_MS;
}

export default function LeadTable({ leads, loading, onSnooze }) {
  // Leads with a callback due within the next 2 hours float to the top
  // (stable sort keeps everything else in its existing order).
  const orderedLeads = [...leads].sort((a, b) => Number(isCallbackDueSoon(b)) - Number(isCallbackDueSoon(a)));

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
      {!loading && leads.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-secondary">No leads match these filters.</div>
      )}
      {loading && leads.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-secondary">Loading…</div>
      )}
    </NeuCard>
  );
}
