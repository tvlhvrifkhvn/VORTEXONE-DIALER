import NeuCard from '../ui/NeuCard';
import Badge from '../ui/Badge';
import AttemptBadge from '../leads/AttemptBadge';
import CallHeader from './CallHeader';
import LeadLocalTime from '../leads/LeadLocalTime';
import { formatPhone } from '../../lib/format';

/** Who you're talking to plus the live call state, in one block at the top of
 * the call page. CallHeader owns the status dot and the running timer. */
export default function CallContactHeader({ lead, call, ended = false }) {
  if (!lead) return null;

  return (
    <NeuCard className="space-y-6 p-6">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
        <p className="mt-1 truncate text-base text-muted-foreground">{lead.brokerage || 'No brokerage on file'}</p>
        <p className="mt-2 font-mono text-lg font-medium tabular-nums text-foreground">
          {formatPhone(lead.phone)}
          {lead.extension && <span className="ml-2 text-muted-foreground">ext. {lead.extension}</span>}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge>{lead.state}</Badge>
          <span className="label ml-2">Attempt</span>
          <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
          <LeadLocalTime lead={lead} className="ml-2" />
        </div>
      </div>

      <div className="border-t pt-4">
        <CallHeader call={call} ended={ended} />
      </div>
    </NeuCard>
  );
}
