import Badge from '../ui/Badge';
import AttemptBadge from '../leads/AttemptBadge';
import LeadLocalTime from '../leads/LeadLocalTime';
import { formatPhone } from '../../lib/format';

/** Who you're talking to, at the top of the call screen's LEAD column (C8E):
 * name, company, phone, then state · attempt · local time. The live state and
 * the timer are the CALL column's (CallHeader). */
export default function CallContactHeader({ lead }) {
  if (!lead) return null;

  return (
    <div className="space-y-1" data-testid="call-contact">
      <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
      <p className="truncate text-sm text-muted-foreground">{lead.brokerage || 'No brokerage on file'}</p>
      <p className="font-mono text-lg font-medium tabular-nums text-foreground">
        {formatPhone(lead.phone)}
        {lead.extension && <span className="ml-2 text-muted-foreground">ext. {lead.extension}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Badge>{lead.state}</Badge>
        <span className="flex items-center gap-1">
          <span className="label">Attempt</span>
          <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
        </span>
        <LeadLocalTime lead={lead} />
      </div>
    </div>
  );
}
