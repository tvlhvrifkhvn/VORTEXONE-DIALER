import NeuInput from '../ui/NeuInput';
import { STATUS_LABELS } from '../../styles/theme';

export default function LeadFilters({ filters, onChange }) {
  const update = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="filter-search" className="label mb-2 block">
          Search
        </label>
        <NeuInput
          id="filter-search"
          placeholder="Name, phone, brokerage…"
          value={filters.search || ''}
          onChange={(e) => update({ search: e.target.value })}
          className="w-64"
        />
      </div>
      <div>
        <label htmlFor="filter-status" className="label mb-2 block">
          Status
        </label>
        <NeuInput
          as="select"
          id="filter-status"
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
      </div>
      <fieldset>
        <legend className="label mb-2">Added</legend>
        <div className="flex items-center gap-2">
          <NeuInput
            type="date"
            aria-label="Added from"
            value={filters.dateFrom || ''}
            onChange={(e) => update({ dateFrom: e.target.value || undefined })}
            className="w-40 font-mono text-sm"
          />
          <span className="text-muted-foreground">–</span>
          <NeuInput
            type="date"
            aria-label="Added to"
            value={filters.dateTo || ''}
            onChange={(e) => update({ dateTo: e.target.value || undefined })}
            className="w-40 font-mono text-sm"
          />
        </div>
      </fieldset>
    </div>
  );
}
