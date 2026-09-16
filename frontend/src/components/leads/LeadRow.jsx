import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Clock, Info, Phone, Shield, X } from 'lucide-react';
import StatusBadge from './StatusBadge';
import AttemptBadge from './AttemptBadge';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import ActionButton from '../ui/ActionButton';
import { formatPhone, formatDateTime } from '../../lib/format';
import { DIAL_MODE_KEY } from '../../hooks/useCall';
import * as api from '../../lib/api';

// Subtle post-disposition background tint — CSS-transitioned via the
// `transition-colors` class on the row, so the color change is smooth.
const STATUS_TINT = {
  contacted: 'rgba(16,185,129,0.08)',
  dnc: 'rgba(239,68,68,0.08)',
  callback_scheduled: 'rgba(245,158,11,0.08)',
};

const DIALABLE = ['new', 'in_queue', 'voicemail', 'no_answer', 'callback_scheduled'];
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_STATUSES = ['new', 'in_queue'];
const EDITABLE_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

function isStale(lead) {
  return STALE_STATUSES.includes(lead.status) && Date.now() - new Date(lead.updated_at).getTime() > STALE_MS;
}

/** Slide-in panel for viewing/editing a lead's plain contact fields, and
 * soft-deleting it — rendered via a portal so it isn't nested inside the
 * lead table's <tr>/<tbody> structure. */
export function LeadDetailPanel({ lead, onClose, onSaved, onDeleted }) {
  const [fields, setFields] = useState(() =>
    EDITABLE_FIELDS.reduce((acc, f) => ({ ...acc, [f]: lead[f] || '' }), {})
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => setFields((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await api.updateLead(lead.id, fields);
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteLead(lead.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="h-full w-full max-w-sm animate-fade-in-row overflow-y-auto">
        <NeuCard className="h-full space-y-4 rounded-none p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Lead details</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ripple flex h-8 w-8 items-center justify-center rounded-input text-text-secondary shadow-neu-sm hover:shadow-neu"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
              <NeuInput value={fields.name} onChange={(e) => handleChange('name', e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Phone</label>
              <NeuInput value={fields.phone} onChange={(e) => handleChange('phone', e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
              <NeuInput value={fields.email} onChange={(e) => handleChange('email', e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Address</label>
              <NeuInput value={fields.address} onChange={(e) => handleChange('address', e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Brokerage</label>
              <NeuInput
                value={fields.brokerage}
                onChange={(e) => handleChange('brokerage', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">State</label>
              <NeuInput
                as="select"
                value={fields.state}
                onChange={(e) => handleChange('state', e.target.value)}
                className="w-full"
              >
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NeuInput>
            </div>
          </div>

          {error && <p className="text-sm text-action-hangup">{error}</p>}

          <NeuButton className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </NeuButton>

          <div className="border-t border-shadow/20 pt-4">
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-sm font-medium text-action-hangup hover:underline"
              >
                Delete lead
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  This removes the lead from every list. This can't be undone from here.
                </p>
                <div className="flex gap-2">
                  <ActionButton variant="hangup" className="flex-1 text-sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </ActionButton>
                  <NeuButton className="flex-1 text-sm" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </NeuButton>
                </div>
              </div>
            )}
          </div>
        </NeuCard>
      </div>
    </div>,
    document.body
  );
}

export default function LeadRow({
  lead: leadProp,
  onSnooze,
  index = 0,
  callbackDueSoon = false,
  selected = false,
  onToggleSelect = () => {},
}) {
  const navigate = useNavigate();
  const [lead, setLead] = useState(leadProp);
  const [deleted, setDeleted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => setLead(leadProp), [leadProp]);

  // Power dial: keep the lead currently being called visible as the table
  // (and everything else on the page) shifts around it.
  useEffect(() => {
    if (lead.status === 'in_progress' && localStorage.getItem(DIAL_MODE_KEY) === 'power') {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [lead.status]);

  if (deleted) return null;

  const dialable = DIALABLE.includes(lead.status);
  const notDueYet = lead.next_action_at && new Date(lead.next_action_at) > new Date();
  const statusTint = STATUS_TINT[lead.status];

  return (
    <tr
      ref={rowRef}
      className={`animate-fade-in-row border-b border-shadow/20 last:border-0 transition-colors duration-500 ${
        lead.isUpNext ? 'bg-action-call/5' : ''
      } ${callbackDueSoon ? 'border-l-4 border-l-action-warn' : ''}`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms`, backgroundColor: statusTint }}
    >
      <td className="px-3 py-3">
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
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            title="View / edit lead details"
            aria-label={`View details for ${lead.name}`}
            className="text-text-secondary hover:text-action-call"
          >
            <Info size={13} />
          </button>
          <span className="font-medium text-text-primary">{lead.name}</span>
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
          {formatPhone(lead.phone)}
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

      {panelOpen && (
        <LeadDetailPanel
          lead={lead}
          onClose={() => setPanelOpen(false)}
          onSaved={(updated) => {
            setLead(updated);
            setPanelOpen(false);
          }}
          onDeleted={() => {
            setPanelOpen(false);
            setDeleted(true);
          }}
        />
      )}
    </tr>
  );
}
