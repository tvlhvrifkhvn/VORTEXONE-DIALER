import { useEffect, useRef, useState } from 'react';
import { Delete, Phone } from 'lucide-react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import ActionButton from '../ui/ActionButton';
import { formatDuration, formatPhone } from '../../lib/format';
import { US_STATES } from '../../lib/usStates';
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
        <label htmlFor="save-lead-name" className="label mb-2 block">
          Name
        </label>
        <Field
          id="save-lead-name"
          value={fields.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className="w-full"
          required
          autoFocus
        />
      </div>
      <div>
        <label htmlFor="save-lead-state" className="label mb-2 block">
          State
        </label>
        <Field
          id="save-lead-state"
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
        </Field>
      </div>
      <div>
        <label htmlFor="save-lead-brokerage" className="label mb-2 block">
          Brokerage (optional)
        </label>
        <Field
          id="save-lead-brokerage"
          value={fields.brokerage}
          onChange={(e) => handleChange('brokerage', e.target.value)}
          className="w-full"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-signal">
          <span className="label mr-2 text-signal">Error</span>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Save lead'}
        </Button>
        <Button type="button" className="flex-1" onClick={onSkip} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Dial pad panel for the /call/manual page — places an ad-hoc call to a
 * typed-in number via the same telephony adapter as lead dialing, but
 * entirely outside the lead lifecycle (see callSession.js's
 * startManual/endManualCall). `callInFlight` is reported to the page so it
 * can block navigation away from a live call, which used to be handled by
 * refusing to close the modal this was.
 */
export default function DialPad({ onDone, onCallStateChange }) {
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

  // A full page (unlike the old modal) can sensibly host back-to-back calls.
  const handleDialAnother = () => {
    setDialedNumber('');
    setCall(null);
    setTelephonyState(null);
    setDuration(0);
    setError(null);
    setShowSaveForm(false);
    setSavedLead(null);
    setPhase('entry');
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

  useEffect(() => {
    onCallStateChange?.(callInFlight);
  }, [callInFlight, onCallStateChange]);

  return (
    <div className="mx-auto w-full max-w-sm">
      <Panel className="w-full space-y-4 p-6">
        <h2 className="label">Dial pad</h2>

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
                className="min-h-14 w-full border border-strong bg-background px-3 text-center font-mono text-2xl tabular-nums text-foreground placeholder:font-sans placeholder:text-base placeholder:text-muted-foreground"
              />
              {showHelper && <p className="mt-2 text-center text-sm text-muted-foreground">Enter a 10-digit number</p>}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((key) => (
                <Button
                  key={key}
                  onClick={() => handleKey(key)}
                  className="min-h-14 w-full text-xl tabular-nums"
                >
                  {key}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleBackspace}
                disabled={!dialedNumber}
                className="flex-1"
              >
                <Delete size={16} strokeWidth={1.5} aria-hidden="true" /> Backspace
              </Button>
              <button
                type="button"
                onClick={handleClear}
                disabled={!dialedNumber}
                className="min-h-10 px-3 font-mono text-sm font-medium uppercase tracking-button text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            {error && (
              <p role="alert" className="text-sm text-signal">
                <span className="label mr-2 text-signal">Error</span>
                {error}
              </p>
            )}

            <ActionButton
              variant="call"
              className="flex min-h-12 w-full items-center justify-center gap-2"
              onClick={handleCall}
              disabled={!canDial || starting}
            >
              <Phone size={20} strokeWidth={1.5} aria-hidden="true" />
              {starting ? 'Calling…' : 'Call'}
            </ActionButton>
          </>
        )}

        {phase === 'calling' && (
          <div className="space-y-4 py-4 text-center">
            {telephonyState !== 'answered' && (
              <span
                aria-hidden="true"
                className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
              />
            )}
            <p className="font-mono text-sm font-medium uppercase tabular-nums text-foreground">
              {telephonyState === 'answered'
                ? `Connected — ${formatDuration(duration)}`
                : `${TELEPHONY_LABELS[telephonyState] || 'Calling'} ${formatDialed(dialedNumber)}...`}
            </p>
            <ActionButton variant="hangup" className="min-h-12 w-full" onClick={handleHangup}>
              Hang up
            </ActionButton>
          </div>
        )}

        {phase === 'ended' && (
          <div className="space-y-4 py-2 text-center">
            <p className="font-mono text-2xl tabular-nums text-foreground">{formatDialed(dialedNumber)}</p>
            <p className="font-mono text-sm uppercase tabular-nums text-muted-foreground">
              Call ended — {formatDuration(call?.duration_seconds ?? duration)}
            </p>

            {savedLead ? (
              <p className="text-sm text-foreground">✓ Saved as a lead.</p>
            ) : showSaveForm ? (
              <SaveAsLeadForm
                phone={dialedNumber.replace(/[^0-9]/g, '')}
                onSaved={setSavedLead}
                onSkip={() => setShowSaveForm(false)}
              />
            ) : (
              <Button className="w-full" onClick={() => setShowSaveForm(true)}>
                Save as lead
              </Button>
            )}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleDialAnother}>
                Dial another
              </Button>
              <Button className="flex-1" onClick={onDone}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
