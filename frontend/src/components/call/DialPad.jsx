import { useEffect, useRef, useState } from 'react';
import { Delete, Phone, X } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import ActionButton from '../ui/ActionButton';
import { formatDuration, formatPhone } from '../../lib/format';
import * as api from '../../lib/api';

const POLL_MS = 600;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const MIN_DIGITS = 10;

function digitCount(str) {
  return (str.match(/[0-9]/g) || []).length;
}

/** Keeps *,# but drops any digit past the 10-digit cap (letters don't count
 * toward the cap, per the spec, so they're never the reason input stops). */
function capDigits(str, max) {
  let seen = 0;
  let out = '';
  for (const ch of str) {
    if (/[0-9]/.test(ch)) {
      if (seen >= max) continue;
      seen += 1;
    }
    out += ch;
  }
  return out;
}

/** Display-only formatting for a raw 10-digit (or partial) dialed number. */
function formatDialed(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return formatPhone(`+1${digits}`);
  return value;
}

// Local copy matching LeadRow.jsx's — the manual dial pad's optional "Save
// as lead" form needs the same state list, and this codebase keeps it
// inlined per-component rather than as a shared import (see LeadRow.jsx).
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

const TELEPHONY_LABELS = {
  ringing: 'Ringing…',
  answered: 'Connected',
  voicemail_detected: 'Voicemail detected',
  busy: 'Busy',
  ended: 'Call ended',
};

/** Minimal add-lead form shown after a manual call ends — entirely
 * optional, pre-filled with the number just dialed. */
function SaveAsLeadForm({ phone, onSaved, onSkip }) {
  const [fields, setFields] = useState({ name: '', state: '', brokerage: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => setFields((f) => ({ ...f, [field]: value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { lead } = await api.createLead({ ...fields, phone });
      onSaved(lead);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="w-full space-y-3 text-left">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
        <NeuInput
          value={fields.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className="w-full"
          required
          autoFocus
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">State</label>
        <NeuInput
          as="select"
          value={fields.state}
          onChange={(e) => handleChange('state', e.target.value)}
          className="w-full"
          required
        >
          <option value="" disabled>
            Select a state…
          </option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NeuInput>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Brokerage (optional)</label>
        <NeuInput
          value={fields.brokerage}
          onChange={(e) => handleChange('brokerage', e.target.value)}
          className="w-full"
        />
      </div>
      {error && <p className="text-sm text-action-hangup">{error}</p>}
      <div className="flex gap-2">
        <NeuButton type="submit" className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Save lead'}
        </NeuButton>
        <NeuButton type="button" className="flex-1" onClick={onSkip} disabled={saving}>
          Cancel
        </NeuButton>
      </div>
    </form>
  );
}

/**
 * Navbar dial pad — places an ad-hoc call to a typed-in number via the same
 * telephony adapter as lead dialing, but entirely outside the lead
 * lifecycle (see callSession.js's startManual/endManualCall). Closing is
 * blocked while a call is actually in flight so a live call can't be
 * orphaned with no UI left to hang it up from.
 */
export default function DialPad({ onClose }) {
  // Single source of truth for typing, pasting, and every keypad press.
  const [dialedNumber, setDialedNumber] = useState('');
  const [phase, setPhase] = useState('entry'); // entry | calling | ended
  const [call, setCall] = useState(null);
  const [telephonyState, setTelephonyState] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [savedLead, setSavedLead] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  // Live timer while actually connected, same pattern as useMultiline.js.
  useEffect(() => {
    if (telephonyState !== 'answered') return undefined;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [telephonyState]);

  const pollCall = (callId) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { call: latest } = await api.getCall(callId);
        setTelephonyState(latest.telephony_state);
        setCall(latest);
        if (latest.telephony_state === 'ended') {
          stopPolling();
          setPhase('ended');
        }
      } catch {
        stopPolling();
      }
    }, POLL_MS);
  };

  const handleKey = (key) => {
    if (phase !== 'entry') return;
    setDialedNumber((prev) => capDigits(prev + key, MIN_DIGITS));
  };

  const handleBackspace = () => {
    if (phase !== 'entry') return;
    setDialedNumber((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (phase !== 'entry') return;
    setDialedNumber('');
  };

  // Typing directly into the field: allow only 0-9,*,# and cap at 10 digits.
  const handleInputChange = (e) => {
    const cleaned = e.target.value.replace(/[^0-9*#]/g, '');
    setDialedNumber(capDigits(cleaned, MIN_DIGITS));
  };

  // "+1 (305) 555-0138" -> 3055550138; an 11-digit paste starting with 1
  // drops the leading country code so the field shows a clean 10-digit number.
  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    let onlyDigits = pasted.replace(/\D/g, '');
    if (onlyDigits.length === 11 && onlyDigits.startsWith('1')) {
      onlyDigits = onlyDigits.slice(1);
    }
    setDialedNumber(onlyDigits.slice(0, MIN_DIGITS));
  };

  const handleCall = async () => {
    setStarting(true);
    setError(null);
    try {
      // *,# are for display only — never sent to the telephony API.
      const toNumber = dialedNumber.replace(/[^0-9]/g, '');
      const { call: newCall } = await api.startManualCall(toNumber);
      setCall(newCall);
      setTelephonyState(newCall.telephony_state);
      setDuration(0);
      setPhase('calling');
      pollCall(newCall.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleHangup = async () => {
    stopPolling();
    if (call) {
      try {
        await api.hangupCall(call.id);
      } catch (err) {
        setError(err.message);
      }
    }
    setPhase('ended');
  };

  const canDial = digitCount(dialedNumber) >= MIN_DIGITS;
  const showHelper = dialedNumber.length > 0 && !canDial;
  const callInFlight = phase === 'calling';

  const handleBackdropClick = () => {
    if (!callInFlight) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={handleBackdropClick}
    >
      <NeuCard className="w-full max-w-xs space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Dial pad</h2>
          {!callInFlight && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ripple flex h-8 w-8 items-center justify-center rounded-input text-text-secondary shadow-neu-sm hover:shadow-neu"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {phase === 'entry' && (
          <>
            <div>
              <input
                type="tel"
                value={dialedNumber}
                onChange={handleInputChange}
                onPaste={handlePaste}
                placeholder="Enter a number"
                aria-label="Phone number"
                className="w-full rounded-input bg-surface p-3 text-center font-mono text-xl tracking-wider text-text-primary shadow-neu-inset outline-none placeholder:text-text-secondary placeholder:text-base"
              />
              {showHelper && <p className="mt-1 text-center text-xs text-text-secondary">Enter a 10-digit number</p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {KEYS.map((key) => (
                <NeuButton
                  key={key}
                  onClick={() => handleKey(key)}
                  className="!rounded-full aspect-square w-full text-lg"
                >
                  {key}
                </NeuButton>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <NeuButton
                onClick={handleBackspace}
                disabled={!dialedNumber}
                className="flex-1 flex items-center justify-center gap-2"
              >
                <Delete size={14} /> Backspace
              </NeuButton>
              <button
                type="button"
                onClick={handleClear}
                disabled={!dialedNumber}
                className="text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                Clear
              </button>
            </div>

            {error && <p className="text-sm text-action-hangup">{error}</p>}

            <ActionButton
              variant="call"
              className="flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed"
              onClick={handleCall}
              disabled={!canDial || starting}
            >
              <Phone size={16} />
              {starting ? 'Calling…' : 'Call'}
            </ActionButton>
          </>
        )}

        {phase === 'calling' && (
          <div className="space-y-4 py-4 text-center">
            {telephonyState !== 'answered' && (
              <span
                aria-hidden="true"
                className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-primary"
              />
            )}
            <p className="text-sm font-medium text-action-call">
              {telephonyState === 'answered'
                ? `Connected — ${formatDuration(duration)}`
                : `${TELEPHONY_LABELS[telephonyState] || 'Calling'} ${formatDialed(dialedNumber)}...`}
            </p>
            <ActionButton variant="hangup" className="w-full" onClick={handleHangup}>
              Hang up
            </ActionButton>
          </div>
        )}

        {phase === 'ended' && (
          <div className="space-y-4 py-2 text-center">
            <p className="font-mono text-lg text-text-primary">{formatDialed(dialedNumber)}</p>
            <p className="text-sm text-text-secondary">
              Call ended — {formatDuration(call?.duration_seconds ?? duration)}
            </p>

            {savedLead ? (
              <p className="text-sm text-action-contacted">Saved as a lead.</p>
            ) : showSaveForm ? (
              <SaveAsLeadForm
                phone={dialedNumber.replace(/[^0-9]/g, '')}
                onSaved={setSavedLead}
                onSkip={() => setShowSaveForm(false)}
              />
            ) : (
              <NeuButton className="w-full" onClick={() => setShowSaveForm(true)}>
                Save as lead
              </NeuButton>
            )}

            <NeuButton className="w-full" onClick={onClose}>
              Close
            </NeuButton>
          </div>
        )}
      </NeuCard>
    </div>
  );
}
