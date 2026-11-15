import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Shield } from 'lucide-react';
import Badge from '../ui/Badge';
import StatusBadge from './StatusBadge';
import AttemptBadge from './AttemptBadge';
import { formatPhone, formatDateTime } from '../../lib/format';
import { DIAL_MODE_KEY } from '../../hooks/useCall';
import LeadLocalTime from './LeadLocalTime';

const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_STATUSES = ['new', 'in_queue'];

function isStale(lead) {
  return STALE_STATUSES.includes(lead.status) && Date.now() - new Date(lead.updated_at).getTime() > STALE_MS;
}

export default function LeadRow({
  lead: leadProp,
  index = 0,
  callbackDueSoon = false,
  selected = false,
  onToggleSelect = () => {},
}) {
  const navigate = useNavigate();
  const [lead, setLead] = useState(leadProp);
  const rowRef = useRef(null);

  useEffect(() => setLead(leadProp), [leadProp]);

  // Power dial: keep the lead currently being called visible as the table
  // (and everything else on the page) shifts around it.
  useEffect(() => {
    if (lead.status === 'in_progress' && localStorage.getItem(DIAL_MODE_KEY) === 'power') {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [lead.status]);

  // Every per-row action moved to the lead page, so the whole row is one
  // target. The checkbox stops propagation so selecting never navigates.
  const openLead = () => navigate(`/leads/${lead.id}`);

  return (
    <tr
      ref={rowRef}
      onClick={openLead}
      title={`Open ${lead.name}`}
      className={`h-12 cursor-pointer border-b border-l-[3px] transition-colors duration-150 last:border-b-0 hover:bg-muted ${
        selected ? 'border-l-primary bg-muted' : callbackDueSoon ? 'border-l-strong' : 'border-l-transparent'
      }`}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Select ${lead.name}`}
          className="h-4 w-4 cursor-pointer accent-primary"
        />
      </td>
      <td className="max-w-[18rem] px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* F-54: long names and brokerages are cut with "…"; the full text is in the tooltip. */}
          <span className="truncate font-medium text-foreground" title={lead.name}>{lead.name}</span>
          {lead.isUpNext && <Badge tone="solid">Up next</Badge>}
          {callbackDueSoon && <Badge>Due soon</Badge>}
          {isStale(lead) && (
            <span title="Not contacted in 7+ days" aria-label="Not contacted in 7+ days" className="text-muted-foreground">
              <Clock size={16} strokeWidth={1.5} />
            </span>
          )}
        </div>
        <div className="truncate text-sm text-muted-foreground" title={lead.brokerage || ''}>{lead.brokerage || '—'}</div>
      </td>
      <td className="px-3 py-3 text-foreground">
        <div className="flex items-center gap-2 font-mono tabular-nums">
          {lead.missing_phone ? (
            <span className="font-sans text-sm italic text-muted-foreground">
              {lead.original_phone ? `Number unreadable: ${lead.original_phone}` : 'No number'}
            </span>
          ) : (
            <>
              {formatPhone(lead.phone)}
              {lead.extension && <span className="text-xs text-muted-foreground">ext. {lead.extension}</span>}
            </>
          )}
          {lead.is_dnc_flagged && (
            <span title="On the DNC list" aria-label="On the DNC list" className="text-foreground">
              <Shield size={16} strokeWidth={1.5} />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-foreground">
        <div className="font-mono">{lead.state}</div>
        <LeadLocalTime lead={lead} />
      </td>
      <td className="px-3 py-3">
        <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(lead.created_at)}</td>
    </tr>
  );
}
