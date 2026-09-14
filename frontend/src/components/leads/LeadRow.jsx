import { useNavigate } from 'react-router-dom';
import { Clock, Phone } from 'lucide-react';
import StatusBadge from './StatusBadge';
import AttemptBadge from './AttemptBadge';
import { formatPhone, formatDateTime } from '../../lib/format';

const DIALABLE = ['new', 'in_queue', 'voicemail', 'no_answer', 'callback_scheduled'];
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_STATUSES = ['new', 'in_queue'];

function isStale(lead) {
  return STALE_STATUSES.includes(lead.status) && Date.now() - new Date(lead.updated_at).getTime() > STALE_MS;
}

export default function LeadRow({ lead, onSnooze, index = 0, callbackDueSoon = false }) {
  const navigate = useNavigate();
  const dialable = DIALABLE.includes(lead.status);
  const notDueYet = lead.next_action_at && new Date(lead.next_action_at) > new Date();

  return (
    <tr
      className={`animate-fade-in-row border-b border-shadow/20 last:border-0 ${lead.isUpNext ? 'bg-action-call/5' : ''} ${
        callbackDueSoon ? 'border-l-4 border-l-action-warn' : ''
      }`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-primary">{lead.name}</span>
          {isStale(lead) && (
            <span title="Not contacted in 7+ days" aria-label="Not contacted in 7+ days" className="text-action-warn">
              <Clock size={12} />
            </span>
          )}
        </div>
        <div className="text-xs text-text-secondary">{lead.brokerage || '—'}</div>
      </td>
      <td className="px-3 py-3 text-text-primary">{formatPhone(lead.phone)}</td>
      <td className="px-3 py-3 text-text-primary">{lead.state}</td>
      <td className="px-3 py-3">
        <AttemptBadge attempts={lead.attempts} maxAttempts={lead.max_attempts} />
      </td>
      <td className="px-3 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="px-3 py-3 text-xs text-text-secondary">{formatDateTime(lead.created_at)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {lead.isUpNext && <span className="text-xs font-semibold text-action-call">Up next</span>}
          {dialable ? (
            <button
              type="button"
              disabled={notDueYet}
              onClick={() => navigate(`/call/${lead.id}`)}
              title="Call"
              aria-label={`Call ${lead.name}`}
              className={`ripple flex h-9 w-9 items-center justify-center rounded-full bg-action-call text-white shadow-md transition-colors duration-200 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${
                notDueYet ? '' : 'animate-pulse-call'
              }`}
            >
              <Phone size={16} />
            </button>
          ) : (
            <span className="text-xs text-text-secondary">—</span>
          )}
          {dialable && !notDueYet && (
            <button
              type="button"
              onClick={() => onSnooze(lead.id)}
              title="Snooze"
              aria-label="Not now"
              className="ripple flex h-8 w-8 items-center justify-center rounded-input text-text-secondary shadow-neu-sm transition-all duration-200 hover:shadow-neu hover:text-action-call"
            >
              <Clock size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
