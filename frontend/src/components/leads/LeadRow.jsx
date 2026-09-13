import { useNavigate } from 'react-router-dom';
import ActionButton from '../ui/ActionButton';
import NeuButton from '../ui/NeuButton';
import StatusBadge from './StatusBadge';
import AttemptBadge from './AttemptBadge';
import { formatPhone, formatDateTime } from '../../lib/format';

const DIALABLE = ['new', 'in_queue', 'voicemail', 'no_answer', 'callback_scheduled'];

export default function LeadRow({ lead, onSnooze }) {
  const navigate = useNavigate();
  const dialable = DIALABLE.includes(lead.status);
  const notDueYet = lead.next_action_at && new Date(lead.next_action_at) > new Date();

  return (
    <tr className={`border-b border-shadow/20 last:border-0 ${lead.isUpNext ? 'bg-action-call/5' : ''}`}>
      <td className="px-3 py-3">
        <div className="font-medium text-text-primary">{lead.name}</div>
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
            <ActionButton
              variant="call"
              className="px-3 py-1.5 text-xs"
              disabled={notDueYet}
              onClick={() => navigate(`/call/${lead.id}`)}
            >
              Call
            </ActionButton>
          ) : (
            <span className="text-xs text-text-secondary">—</span>
          )}
          {dialable && !notDueYet && (
            <NeuButton className="px-2 py-1.5 text-xs" onClick={() => onSnooze(lead.id)}>
              Not now
            </NeuButton>
          )}
        </div>
      </td>
    </tr>
  );
}
