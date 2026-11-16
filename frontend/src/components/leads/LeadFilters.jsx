import Field from '../ui/Field';
import { STATUS_LABELS } from '../../styles/theme';
import { useCampaign } from '../../hooks/useCampaign';
import { useStages } from '../../hooks/useStages';

export default function LeadFilters({ filters, onChange }) {
  const update = (patch) => onChange({ ...filters, ...patch });
  const companyWord = (useCampaign().active?.company_label || 'Brokerage').toLowerCase(); // C1E
  const { stages } = useStages(); // C2B

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="filter-search" className="label mb-2 block">
          Search
        </label>
        <Field
          id="filter-search"
          placeholder={`Name, phone, ${companyWord}…`}
          value={filters.search || ''}
          onChange={(e) => update({ search: e.target.value })}
          className="w-64"
        />
      </div>
      <div>
        <label htmlFor="filter-status" className="label mb-2 block">
          Status
        </label>
        <Field
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
        </Field>
      </div>
      <div>
        <label htmlFor="filter-stage" className="label mb-2 block">
          Stage
        </label>
        <Field
          as="select"
          id="filter-stage"
          value={filters.stageId || ''}
          onChange={(e) => update({ stageId: e.target.value || undefined })}
          className="w-48"
        >
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Field>
      </div>
      <fieldset>
        <legend className="label mb-2">Added</legend>
        <div className="flex items-center gap-2">
          <Field
            type="date"
            aria-label="Added from"
            value={filters.dateFrom || ''}
            onChange={(e) => update({ dateFrom: e.target.value || undefined })}
            className="w-40 font-mono text-sm"
          />
          <span className="text-muted-foreground">–</span>
          <Field
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
