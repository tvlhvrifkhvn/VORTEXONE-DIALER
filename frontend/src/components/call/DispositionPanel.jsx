import { useEffect, useRef, useState } from 'react';
import NotesField from './NotesField';
import DispositionButtons from './DispositionButtons';
import StatusBadge from '../leads/StatusBadge';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import ActionButton from '../ui/ActionButton';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';
import { useUserSettings } from '../../hooks/useUserSettings';

const DEFAULT_PITCH_SCRIPT = (repName) =>
  `Hi, I'm ${repName} from Vortexone Agency. We offer virtual assistant services for real ` +
  'estate agents — lead follow-up, appointment setting, and admin support. Do you currently ' +
  'have VA support on your team?';

/** The rep's own script from Settings (a per-user server setting, F-48), or the default. */
function PitchScriptText({ repName }) {
  const { settings } = useUserSettings();
  return <>{settings?.pitch_script || DEFAULT_PITCH_SCRIPT(repName)}</>;
}

/** Collapsible sidebar section — arrow toggle, collapsed by default. */
function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <NeuCard className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-text-primary"
      >
        <span>{title}</span>
        <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </NeuCard>
  );
}

/**
 * Everything previously noted about this lead, newest first: logged calls
 * (outcome + the note typed with it) and the standalone notes added with
 * "Add note" during a call. Both come from the lead timeline
 * (GET /api/leads/:id/timeline); the call in progress is left out.
 */
function PreviousNotes({ leadId, currentCallId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return undefined;
    let cancelled = false;
    setLoading(true);
    api
      .getLeadTimeline(leadId)
      .then(({ timeline }) => {
        if (cancelled) return;
        setEntries(
          (timeline || []).filter(
            (e) => (e.type === 'call' && e.disposition && e.id !== currentCallId) || (e.type === 'note' && e.body)
          )
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, currentCallId]);

  if (loading) return <p className="text-xs text-text-secondary">Loading…</p>;
  if (entries.length === 0) return <p className="text-xs text-text-secondary">No previous calls or notes.</p>;

  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={`${e.type}-${e.id}`} className="border-b border-shadow/20 pb-2 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">
              <span className="mr-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-neu-sm">
                {e.type === 'call' ? 'Call' : 'Note'}
              </span>
              {formatDateTime(e.timestamp)}
            </span>
            {e.type === 'call' && <StatusBadge status={e.disposition} />}
          </div>
          {e.type === 'call' && e.note && <p className="mt-1 text-xs text-text-primary">{e.note}</p>}
          {e.type === 'note' && <p className="mt-1 text-xs text-text-primary">{e.body}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The pitch script panel on its own, for layouts (the call screen) that
 * place it in a sidebar rather than inline under the disposition buttons. */
export function ScriptPanel() {
  const { user } = useAuth();
  return (
    <CollapsibleSection title="Pitch script">
      <p className="text-xs leading-relaxed text-text-primary"><PitchScriptText repName={user?.name || 'the rep'} /></p>
    </CollapsibleSection>
  );
}

/**
 * The notes field, ✨ Expand, pitch script, previous-notes history and the six
 * disposition buttons — shared so the single-line call screen and an
 * answered multi-line card present exactly the same UI.
 *
 * The parent owns how a disposition is actually submitted (useCall on the
 * call screen, a direct API call in the multi-line panel) and receives it via
 * onDispositionSubmit({ disposition, note }).
 */
export default function DispositionPanel({
  lead,
  callId,
  onDispositionSubmit,
  disabled = false,
  showScript = true,
}) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [showDncConfirm, setShowDncConfirm] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const dispositionRef = useRef(null);

  const locked = disabled || submitting;

  // A multi-line slot reuses this panel for the next lead it answers — clear
  // the previous call's note so it can't be attached to the wrong lead.
  useEffect(() => {
    setNote('');
    setError(null);
  }, [callId]);

  const submitOutcome = async (disposition) => {
    setSubmitting(true);
    setError(null);
    setRetrying(null);
    // A 429 or a dropped connection is retried automatically (lib/retry.js);
    // the panel stays open and says so until it is saved or gives up.
    const onRetrying = (attempt, max) => setRetrying(`Not saved yet — retrying (${attempt + 1} of ${max})…`);
    try {
      await onDispositionSubmit({ disposition, note, onRetrying });
    } catch (err) {
      setError(`Couldn't save this outcome: ${err.message} Click it again to retry.`);
    } finally {
      setRetrying(null);
      setSubmitting(false);
    }
  };

  // DNC is permanent — confirm before it actually fires. Every other
  // disposition button submits immediately.
  const handleSelect = (disposition) => {
    if (disposition === 'dnc') {
      setShowDncConfirm(true);
      return;
    }
    submitOutcome(disposition);
  };

  const handleExpandNote = async () => {
    if (!note.trim() || expanding) return;
    setExpanding(true);
    setError(null);
    try {
      const { note: expanded } = await api.expandNote(note);
      setNote(expanded);
    } catch (err) {
      setError(err.message);
    } finally {
      setExpanding(false);
    }
  };

  // V / N / D shortcuts live here now that this component owns the
  // disposition buttons; CallScreen keeps M (mute) and Esc (hang up).
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (locked) return;

      if (e.key === 'v' || e.key === 'V') handleSelect('voicemail');
      else if (e.key === 'n' || e.key === 'N') handleSelect('no_answer');
      else if (e.key === 'd' || e.key === 'D') {
        dispositionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlight(true);
        setTimeout(() => setHighlight(false), 800);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, note]);

  return (
    <div className="space-y-4">
      <NeuCard className="space-y-4 p-5">
        <div className="relative">
          {/* NotesField renders its own "Notes" label, so this row only
              carries the Expand action, positioned to sit beside it. */}
          <button
            type="button"
            onClick={handleExpandNote}
            disabled={!note.trim() || expanding}
            className="absolute right-0 top-0 text-xs font-medium text-action-call disabled:cursor-not-allowed disabled:opacity-50"
          >
            {expanding ? 'Expanding…' : '✨ Expand'}
          </button>
          <NotesField value={note} onChange={setNote} />
        </div>

        <div ref={dispositionRef} className={highlight ? 'animate-pulse-call rounded-input' : ''}>
          <DispositionButtons onSelect={handleSelect} disabled={locked} />
        </div>

        {retrying && <p className="text-sm font-medium text-action-warn">{retrying}</p>}
        {error && <p className="text-sm text-action-hangup">{error}</p>}

        <CollapsibleSection title="Previous Notes">
          <PreviousNotes leadId={lead?.id} currentCallId={callId} />
        </CollapsibleSection>
      </NeuCard>

      {showScript && (
        <CollapsibleSection title="Pitch script">
          <p className="text-xs leading-relaxed text-text-primary"><PitchScriptText repName={user?.name || 'the rep'} /></p>
        </CollapsibleSection>
      )}

      {showDncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <NeuCard className="w-full max-w-sm space-y-4 p-6">
            <p className="text-sm font-medium text-text-primary">
              Permanently block {lead?.name}'s number from all future dialing? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <ActionButton
                variant="dnc"
                className="flex-1 text-sm"
                onClick={() => {
                  setShowDncConfirm(false);
                  submitOutcome('dnc');
                }}
              >
                Confirm
              </ActionButton>
              <NeuButton className="flex-1 text-sm" onClick={() => setShowDncConfirm(false)}>
                Cancel
              </NeuButton>
            </div>
          </NeuCard>
        </div>
      )}

    </div>
  );
}
