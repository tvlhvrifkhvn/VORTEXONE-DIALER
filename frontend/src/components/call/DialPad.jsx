import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete, MicOff, PauseCircle, Phone } from 'lucide-react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import ActionButton from '../ui/ActionButton';
import Dialog from '../ui/Dialog';
import SectionLabel from '../ui/SectionLabel';
import StatusDot from '../ui/StatusDot';
import { formatDateTime, formatDuration, formatPhone } from '../../lib/format';
import { US_STATES } from '../../lib/usStates';
import * as api from '../../lib/api';
import { useCampaign } from '../../hooks/useCampaign';

const POLL_MS = 600;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const LETTERS = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' };
const NOTES_DEBOUNCE_MS = 800;
const RECORD_ACK_KEY = 'vortex.recordConsentAck';
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
  ringing: 'Ringing',
  answered: 'Connected',
  voicemail_detected: 'Voicemail',
  busy: 'Busy',
  ended: 'Call ended',
};

/** Minimal add-lead form shown after a manual call ends — entirely
 * optional, pre-filled with the number just dialed. */
function SaveAsLeadForm({ phone, onSaved, onSkip }) {
  const companyLabel = useCampaign().active?.company_label || 'Brokerage'; // C1E
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
          {companyLabel} (optional)
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
        <Button type="submit" variant="solid" className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Save lead'}
        </Button>
        <Button type="button" className="flex-1" onClick={onSkip} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A 52px keypad key: the digit, with its letters under it. */
function Key({ value, onPress }) {
  return (
    <button
      type="button"
      onClick={() => onPress(value)}
      aria-label={LETTERS[value] ? `${value} ${LETTERS[value]}` : value === '*' ? 'Star' : value === '#' ? 'Pound' : value}
      className="flex h-[52px] flex-col items-center justify-center border border-strong text-foreground transition-colors duration-150 hover:bg-muted"
    >
      <span className="font-mono text-xl leading-none tabular-nums">{value}</span>
      <span className="h-4 font-mono text-xs leading-4 tracking-button text-muted-foreground">{LETTERS[value] || ''}</span>
    </button>
  );
}

/** A 48px call control (MUTE, HOLD, RECORD): solid while on (aria-pressed). */
function Toggle({ icon: Icon, label, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex min-h-12 items-center justify-center gap-1 border px-1 font-mono text-xs font-medium uppercase tracking-button transition-colors duration-150 ${
        on ? 'border-foreground bg-foreground text-background' : 'border-strong text-foreground hover:bg-muted'
      }`}
    >
      {Icon ? <Icon size={16} strokeWidth={1.5} aria-hidden="true" /> : <span aria-hidden="true" className={`h-2 w-2 rounded-full ${on ? 'bg-primary' : 'bg-muted-foreground'}`} />}
      {label}
    </button>
  );
}

/**
 * The /call/manual dial pad (C8F): one 480px column. The DIAL PAD panel holds
 * the number (type or paste), the status row during and after a call, the
 * 3×4 keypad (tones during a call, via POST /calls/:id/digits) and, in one
 * place, CALL → MUTE · HOLD · RECORD · HANG UP → NEW CALL. Under it: RECENT
 * before a call; the matched lead and NOTES (saved as you type) during it;
 * after it, the summary or SAVE AS LEAD. A manual call never changes a lead's
 * status (callSession.startManual); its notes reach the matched lead once.
 * `onCallStateChange(inFlight)` lets the page guard a reload mid-call.
 */
export default function DialPad({ onCallStateChange }) {
  const [dialedNumber, setDialedNumber] = useState('');
  const [phase, setPhase] = useState('entry'); // entry | calling | ended
  const [call, setCall] = useState(null);
  const [telephonyState, setTelephonyState] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [recent, setRecent] = useState(null);
  const [lead, setLead] = useState(undefined); // undefined = not looked up yet, null = no lead
  const [muted, setMuted] = useState(false); // screen-only until the real provider, as on the call screen
  const [onHold, setOnHold] = useState(false);
  const [recording, setRecording] = useState(false);
  const [askRecord, setAskRecord] = useState(false);
  const [sent, setSent] = useState('');
  const [notes, setNotes] = useState('');
  const [notesState, setNotesState] = useState(null); // null | 'saving' | 'saved' | error text
  const [savedLead, setSavedLead] = useState(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const pollRef = useRef(null);
  const notesTimer = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const loadRecent = useCallback(() => {
    api.getRecentManualCalls().then(({ calls }) => setRecent(calls)).catch(() => setRecent([]));
  }, []);
  useEffect(() => {
    if (phase === 'entry') loadRecent();
  }, [phase, loadRecent]);

  // Live timer while connected (and not on hold, screen-wise it keeps counting like a real call).
  useEffect(() => {
    if (telephonyState !== 'answered' || phase !== 'calling') return undefined;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [telephonyState, phase]);

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

  const flushNotes = async (callId, text) => {
    clearTimeout(notesTimer.current);
    setNotesState('saving');
    try {
      await api.saveCallNotes(callId, text);
      setNotesState('saved');
    } catch (err) {
      setNotesState(err.message);
    }
  };

  const changeNotes = (text) => {
    setNotes(text);
    setNotesState(null);
    clearTimeout(notesTimer.current);
    if (!call) return;
    notesTimer.current = setTimeout(() => flushNotes(call.id, text), NOTES_DEBOUNCE_MS);
  };
  useEffect(() => () => clearTimeout(notesTimer.current), []);

  const handleKey = async (key) => {
    if (phase === 'entry') {
      setDialedNumber((prev) => capDigits(prev + key, MIN_DIGITS));
      return;
    }
    if (phase !== 'calling' || !call) return;
    setSent((s) => (s + key).slice(-32));
    try {
      await api.sendCallDigits(call.id, key);
    } catch (err) {
      setError(err.message);
    }
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
      setSent('');
      setNotes('');
      setNotesState(null);
      setLead(undefined);
      setPhase('calling');
      pollCall(newCall.id);
      api.getCallLead(newCall.id).then(({ lead: found }) => setLead(found)).catch(() => setLead(null));
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleNewCall = () => {
    setDialedNumber('');
    setCall(null);
    setTelephonyState(null);
    setDuration(0);
    setError(null);
    setShowSaveForm(false);
    setSavedLead(null);
    setMuted(false);
    setOnHold(false);
    setRecording(false);
    setSent('');
    setNotes('');
    setNotesState(null);
    setLead(undefined);
    setPhase('entry');
  };

  const handleHangup = async () => {
    stopPolling();
    if (call) {
      // Notes typed in the last moment are saved first, so they're copied to the lead on hang-up.
      if (notesTimer.current) await flushNotes(call.id, notes);
      try {
        const { call: ended } = await api.hangupCall(call.id).then((r) => (r.call ? r : { call: r }));
        if (ended?.duration_seconds !== undefined) setCall(ended);
      } catch (err) {
        setError(err.message);
      }
    }
    setPhase('ended');
  };

  const applyRecording = async (on) => {
    try {
      const res = await api.setCallRecording(call.id, on);
      setRecording(Boolean(res.recording));
    } catch (err) {
      setError(err.message);
    }
  };
  const handleRecord = () => {
    if (recording) return applyRecording(false);
    let acked = false;
    try {
      acked = localStorage.getItem(RECORD_ACK_KEY) === 'true';
    } catch {
      /* storage unavailable: ask every time */
    }
    if (acked) return applyRecording(true);
    setAskRecord(true);
    return undefined;
  };

  const handleLeadSaved = async (newLead) => {
    setSavedLead(newLead);
    setShowSaveForm(false);
    // The call's notes go to the new lead once, in the same note format.
    if (call && notes.trim()) await flushNotes(call.id, notes);
  };

  const canDial = digitCount(dialedNumber) >= MIN_DIGITS;
  const showHelper = dialedNumber.length > 0 && !canDial;
  const callInFlight = phase === 'calling';
  const shownSeconds = phase === 'ended' ? call?.duration_seconds ?? duration : duration;
  const stateLabel = phase === 'ended' ? 'Call ended' : onHold && telephonyState === 'answered' ? 'On hold' : TELEPHONY_LABELS[telephonyState] || 'Calling';

  useEffect(() => {
    onCallStateChange?.(callInFlight);
  }, [callInFlight, onCallStateChange]);

  const notesHint = notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : notesState ? notesState : null;

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-4" data-testid="dial-pad">
      <Panel className="space-y-4 p-6">
        <h2 className="label">Dial pad</h2>

        <div className="relative">
          <input
            type="tel"
            value={phase === 'entry' ? dialedNumber : formatDialed(dialedNumber)}
            onChange={handleInputChange}
            onPaste={handlePaste}
            readOnly={phase !== 'entry'}
            placeholder="Enter a number"
            aria-label="Phone number"
            className="min-h-14 w-full border border-strong bg-background px-12 text-center font-mono text-2xl tabular-nums text-foreground placeholder:font-sans placeholder:text-base placeholder:text-muted-foreground"
          />
          {phase === 'entry' && dialedNumber && (
            <button
              type="button"
              onClick={() => setDialedNumber((prev) => prev.slice(0, -1))}
              aria-label="Delete the last digit"
              className="absolute right-1 top-1/2 inline-flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              <Delete size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
          {showHelper && phase === 'entry' && <p className="mt-2 text-center text-sm text-muted-foreground">Enter a 10-digit number</p>}
        </div>

        {phase !== 'entry' && (
          <div className="flex items-center justify-between gap-4" data-testid="dial-status">
            <span className="flex items-center gap-4">
              {phase === 'calling' && telephonyState === 'answered' && !onHold ? (
                <StatusDot tone="live" className="text-sm">{stateLabel}</StatusDot>
              ) : phase === 'calling' && telephonyState === 'ringing' ? (
                <StatusDot tone="signal" className="text-sm">{stateLabel}</StatusDot>
              ) : (
                <span className="font-mono text-sm font-medium uppercase text-foreground">{stateLabel}</span>
              )}
              {recording && phase === 'calling' && (
                <StatusDot tone="signal" className="text-sm">
                  REC<span className="sr-only"> (recording)</span>
                </StatusDot>
              )}
            </span>
            <span className="font-mono text-2xl font-medium tabular-nums text-foreground">{formatDuration(shownSeconds)}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <Key key={key} value={key} onPress={handleKey} />
          ))}
        </div>
        {phase === 'calling' && sent && (
          <p className="font-mono text-xs uppercase tabular-nums text-muted-foreground">
            Tones sent <span className="text-foreground">{sent}</span>
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-signal">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}

        {/* One place for the call's main action: CALL → the controls and HANG UP → NEW CALL. */}
        {phase === 'entry' && (
          <ActionButton variant="call" className="flex min-h-12 w-full items-center justify-center gap-2" onClick={handleCall} disabled={!canDial || starting}>
            <Phone size={20} strokeWidth={1.5} aria-hidden="true" />
            {starting ? 'Calling…' : 'Call'}
          </ActionButton>
        )}
        {phase === 'calling' && (
          <div className="grid grid-cols-4 gap-2" data-testid="dial-controls">
            <Toggle icon={MicOff} label={muted ? 'Unmute' : 'Mute'} on={muted} onClick={() => setMuted((m) => !m)} />
            <Toggle icon={PauseCircle} label={onHold ? 'Resume' : 'Hold'} on={onHold} onClick={() => setOnHold((h) => !h)} />
            <Toggle label="Record" on={recording} onClick={handleRecord} />
            <ActionButton variant="hangup" className="min-h-12 px-1" onClick={handleHangup}>
              Hang up
            </ActionButton>
          </div>
        )}
        {phase === 'ended' && (
          <Button variant="primary" className="min-h-12 w-full" onClick={handleNewCall}>
            New call
          </Button>
        )}
      </Panel>

      {phase === 'entry' && (
        <section className="space-y-2" data-testid="dial-recent">
          <SectionLabel title="Recent" />
          {recent === null ? (
            <p className="label">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No manual calls yet.</p>
          ) : (
            <ul className="border">
              {recent.map((c) => (
                <li key={c.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setDialedNumber(String(c.number).replace(/^\+1/, ''))}
                    title="Put this number in the pad"
                    className="flex min-h-10 w-full items-center gap-2 px-3 text-left transition-colors duration-150 hover:bg-muted"
                  >
                    <span className="font-mono text-sm tabular-nums text-foreground">{formatPhone(c.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{c.lead ? c.lead.name : ''}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(c.startedAt)} · {formatDuration(c.durationSeconds ?? 0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {phase !== 'entry' && (
        <>
          <section className="space-y-2" data-testid="dial-lead">
            <SectionLabel title="Lead" />
            {lead === undefined ? (
              <p className="label">Looking up the number…</p>
            ) : lead ? (
              <div className="flex items-center justify-between gap-4 border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{lead.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{[lead.brokerage, lead.state].filter(Boolean).join(' · ')}</p>
                </div>
                <a
                  href={`/leads/${lead.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the lead in a new tab (leaving this page would end the call)"
                  className="inline-flex min-h-8 items-center px-2 font-mono text-xs font-medium uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
                >
                  Open lead ↗
                </a>
              </div>
            ) : savedLead ? (
              <p className="text-sm text-foreground">✓ Saved as a lead: {savedLead.name}.</p>
            ) : (
              <p className="text-sm text-muted-foreground">No lead with this number.</p>
            )}
          </section>

          <section className="space-y-2" data-testid="dial-notes">
            <SectionLabel title="Notes" meta={notesHint} />
            <Field
              as="textarea"
              rows={4}
              value={notes}
              onChange={(e) => changeNotes(e.target.value)}
              maxLength={5000}
              aria-label="Call notes"
              placeholder="Notes save on their own"
              className="w-full resize-none"
            />
          </section>

          {phase === 'ended' && (
            <section className="space-y-2">
              {lead ? (
                <p className="text-sm text-foreground">
                  {notes.trim() ? `Notes added to ${lead.name}'s activity.` : `Nothing added to ${lead.name}: no notes.`}
                </p>
              ) : savedLead ? (
                <p className="text-sm text-foreground">{notes.trim() ? 'Notes added to the new lead.' : 'Saved without notes.'}</p>
              ) : showSaveForm ? (
                <SaveAsLeadForm phone={dialedNumber.replace(/[^0-9]/g, '')} onSaved={handleLeadSaved} onSkip={() => setShowSaveForm(false)} />
              ) : (
                <Button className="w-full" onClick={() => setShowSaveForm(true)}>
                  Save as lead
                </Button>
              )}
            </section>
          )}
        </>
      )}

      {askRecord && (
        <Dialog title="Record this call?" className="max-w-sm">
          <p className="text-sm text-foreground">Recording laws differ by state. In all-party-consent states, tell the other person before you record.</p>
          <div className="mt-6 flex gap-4">
            <Button
              variant="solid"
              className="flex-1"
              onClick={() => {
                try {
                  localStorage.setItem(RECORD_ACK_KEY, 'true');
                } catch {
                  /* asked again next time */
                }
                setAskRecord(false);
                applyRecording(true);
              }}
            >
              OK
            </Button>
            <Button className="flex-1" onClick={() => setAskRecord(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
