import Panel from '../ui/Panel';
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
    // Status and timer sit beside the name, not under it, so the outcome
    // buttons stay as high on the screen as possible.
    <Panel className="flex flex-wrap items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
        <p className="mt-1 truncate text-base text-muted-foreground">{lead.brokerage || 'No brokerage on file'}</p>
        <p className="mt-2 font-mono text-lg font-medium tabular-nums text-foreground">
          {formatPhone(lead.phone)}
          {lead.extension && <span className="ml-2 text-muted-foreground">ext. {lead.extension}</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge>{lead.state}</Badge>
          <span className="label ml-2">Attempt</span>
          <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
          <LeadLocalTime lead={lead} className="ml-2" />
        </div>
      </div>

      <div className="shrink-0">
        <CallHeader call={call} ended={ended} />
      </div>
    </Panel>
  );
}
