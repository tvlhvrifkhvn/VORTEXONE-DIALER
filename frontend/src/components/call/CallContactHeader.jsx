import NeuCard from '../ui/NeuCard';
import CallHeader from './CallHeader';
import { formatPhone } from '../../lib/format';

function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Who you're talking to plus the live call state, in one block at the top of
 * the call page. CallHeader owns the status dot and the running timer. */
export default function CallContactHeader({ lead, call, ended = false }) {
  if (!lead) return null;

  return (
    <NeuCard className="space-y-4 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-semibold text-text-primary shadow-neu-inset">
          {initials(lead.name) || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-text-primary">{lead.name}</h1>
          <p className="truncate text-sm text-text-secondary">
            {lead.brokerage || 'No brokerage on file'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium tabular-nums text-text-primary">{formatPhone(lead.phone)}</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary shadow-neu-sm">
              {lead.state}
            </span>
            <span className="text-xs text-text-secondary">
              Attempt {lead.attempts} / {lead.max_attempts}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-shadow/20 pt-3">
        <CallHeader call={call} ended={ended} />
      </div>
    </NeuCard>
  );
}
