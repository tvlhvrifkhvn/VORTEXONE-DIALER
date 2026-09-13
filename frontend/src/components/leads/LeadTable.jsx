import NeuCard from '../ui/NeuCard';
import LeadRow from './LeadRow';

const COLUMNS = ['Lead', 'Phone', 'State', 'Attempts', 'Status', 'Added', 'Actions'];

export default function LeadTable({ leads, loading, onSnooze }) {
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
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onSnooze={onSnooze} />
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
