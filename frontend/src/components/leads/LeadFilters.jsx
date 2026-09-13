import NeuInput from '../ui/NeuInput';
import { STATUS_LABELS } from '../../styles/theme';

export default function LeadFilters({ filters, onChange }) {
  const update = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <NeuInput
        placeholder="Search name, phone, brokerage…"
        value={filters.search || ''}
        onChange={(e) => update({ search: e.target.value })}
        className="w-64"
      />
      <NeuInput
        as="select"
        value={filters.status || ''}
        onChange={(e) => update({ status: e.target.value || undefined })}
        className="w-48"
      >
        <option value="">All statuses</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NeuInput>
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span>Added</span>
        <NeuInput
          type="date"
          value={filters.dateFrom || ''}
          onChange={(e) => update({ dateFrom: e.target.value || undefined })}
          className="w-36"
        />
        <span>–</span>
        <NeuInput
          type="date"
          value={filters.dateTo || ''}
          onChange={(e) => update({ dateTo: e.target.value || undefined })}
          className="w-36"
        />
      </div>
    </div>
  );
}
