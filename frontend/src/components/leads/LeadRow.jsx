import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Shield } from 'lucide-react';
import StatusBadge from './StatusBadge';
import AttemptBadge from './AttemptBadge';
import { formatPhone, formatDateTime } from '../../lib/format';
import { DIAL_MODE_KEY } from '../../hooks/useCall';

// Subtle post-disposition background tint — CSS-transitioned via the
// `transition-colors` class on the row, so the color change is smooth.
const STATUS_TINT = {
  contacted: 'rgba(16,185,129,0.08)',
  dnc: 'rgba(239,68,68,0.08)',
  callback_scheduled: 'rgba(245,158,11,0.08)',
};

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

  const statusTint = STATUS_TINT[lead.status];

  // Every per-row action moved to the lead page, so the whole row is one
  // target. The checkbox stops propagation so selecting never navigates.
  const openLead = () => navigate(`/leads/${lead.id}`);

  return (
    <tr
      ref={rowRef}
      onClick={openLead}
      title={`Open ${lead.name}`}
      className={`animate-fade-in-row cursor-pointer border-b border-shadow/20 transition-colors duration-500 last:border-0 hover:bg-action-call/5 ${
        lead.isUpNext ? 'bg-action-call/5' : ''
      } ${callbackDueSoon ? 'border-l-4 border-l-action-warn' : ''}`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms`, backgroundColor: statusTint }}
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Select ${lead.name}`}
          className="h-4 w-4 cursor-pointer accent-action-call"
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-primary">{lead.name}</span>
          {lead.isUpNext && <span className="text-xs font-semibold text-action-call">Up next</span>}
          {isStale(lead) && (
            <span title="Not contacted in 7+ days" aria-label="Not contacted in 7+ days" className="text-action-warn">
              <Clock size={12} />
            </span>
          )}
        </div>
        <div className="text-xs text-text-secondary">{lead.brokerage || '—'}</div>
      </td>
      <td className="px-3 py-3 text-text-primary">
        <div className="flex items-center gap-1.5">
          {lead.missing_phone ? (
            <span className="text-xs italic text-text-secondary">No number</span>
          ) : (
            formatPhone(lead.phone)
          )}
          {lead.is_dnc_flagged && (
            <span title="On the DNC list" aria-label="On the DNC list" className="text-action-dnc">
              <Shield size={12} />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-text-primary">{lead.state}</td>
      <td className="px-3 py-3">
        <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="px-3 py-3 text-xs text-text-secondary">{formatDateTime(lead.created_at)}</td>
    </tr>
  );
}
