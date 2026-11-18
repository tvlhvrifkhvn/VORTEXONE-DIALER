import Field from '../ui/Field';
import { STATUS_LABELS } from '../../styles/theme';
import { useStages } from '../../hooks/useStages';

// C8B: the FILTERS panel under the Leads toolbar (the search field is the
// toolbar's own, so it is not repeated here).
export default function LeadFilters({ filters, onChange }) {
  const update = (patch) => onChange({ ...filters, ...patch });
  const { stages } = useStages(); // C2B

  return (
    <div className="flex flex-wrap items-end gap-4">
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
      {/* C2E: tag, attempts, quiet leads, overdue callbacks. */}
      <div>
        <label htmlFor="filter-tag" className="label mb-2 block">Tag</label>
        <Field id="filter-tag" value={filters.tag || ''} onChange={(e) => update({ tag: e.target.value || undefined })} placeholder="e.g. hot" className="w-32" />
      </div>
      <div>
        <label htmlFor="filter-min-attempts" className="label mb-2 block">Attempts ≥</label>
        <Field id="filter-min-attempts" type="number" min="0" max="100" value={filters.minAttempts || ''} onChange={(e) => update({ minAttempts: e.target.value || undefined })} className="w-24 font-mono tabular-nums" />
      </div>
      <div>
        <label htmlFor="filter-quiet" className="label mb-2 block">No activity · days</label>
        <Field id="filter-quiet" type="number" min="1" max="3650" value={filters.noActivityDays || ''} onChange={(e) => update({ noActivityDays: e.target.value || undefined })} className="w-24 font-mono tabular-nums" />
      </div>
      <label className="flex min-h-10 items-center gap-2 self-end text-sm text-foreground">
        <input
          type="checkbox"
          checked={String(filters.callbackOverdue) === 'true'}
          onChange={(e) => update({ callbackOverdue: e.target.checked ? 'true' : undefined })}
          className="h-4 w-4 accent-primary"
        />
        Callback overdue
      </label>
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
