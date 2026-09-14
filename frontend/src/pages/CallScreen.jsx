import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ContactCard from '../components/call/ContactCard';
import CallHeader from '../components/call/CallHeader';
import NotesField from '../components/call/NotesField';
import DispositionButtons from '../components/call/DispositionButtons';
import CallControls from '../components/call/CallControls';
import StatusBadge from '../components/leads/StatusBadge';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import { useAuth } from '../hooks/useAuth';
import { useCall } from '../hooks/useCall';
import { formatDateTime } from '../lib/format';
import * as api from '../lib/api';

const DISPOSITION_LABELS = {
  contacted: 'Spoke / Interested',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  no_contact_number: 'No Contact — Number',
  no_contact_person: 'No Contact — Person',
  dnc: 'DNC',
  callback_scheduled: 'Callback Scheduled',
};

const PITCH_SCRIPT = (repName) =>
  `Hi, I'm ${repName} from Vortexone Agency. We offer virtual assistant services for real ` +
  'estate agents — lead follow-up, appointment setting, and admin support. Do you currently ' +
  'have VA support on your team?';

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

function PreviousNotes({ leadId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    api
      .getLeadHistory(leadId)
      .then(({ history: rows }) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (loading) return <p className="text-xs text-text-secondary">Loading…</p>;
  if (history.length === 0) return <p className="text-xs text-text-secondary">No previous calls logged.</p>;

  return (
    <ul className="space-y-3">
      {history.map((call) => (
        <li key={call.id} className="border-b border-shadow/20 pb-2 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">{formatDateTime(call.started_at)}</span>
            <StatusBadge status={call.disposition} />
          </div>
          {call.note && <p className="mt-1 text-xs text-text-primary">{call.note}</p>}
        </li>
      ))}
    </ul>
  );
}

const SHORTCUT_HINTS = [
  { key: 'V', label: 'Voicemail' },
  { key: 'N', label: 'No answer' },
  { key: 'D', label: 'Disposition' },
  { key: 'M', label: 'Mute' },
  { key: 'Esc', label: 'Hang up' },
];

function ShortcutHintBar() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 rounded-input bg-surface px-4 py-2 text-xs text-text-secondary shadow-neu-inset">
      {SHORTCUT_HINTS.map((s) => (
        <span key={s.key} className="flex items-center gap-1">
          <kbd className="rounded border border-shadow/40 px-1.5 py-0.5 font-mono text-[10px] text-text-primary">
            {s.key}
          </kbd>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function CallScreenInner({ leadId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { call, lead, error, starting, undoInfo, hangup, submitDisposition, undo } = useCall(leadId);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [lastDisposition, setLastDisposition] = useState(null);
  const [hungUp, setHungUp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const dispositionRef = useRef(null);
  const [dispositionHighlight, setDispositionHighlight] = useState(false);

  const isFinalized = !!lastDisposition;
  const ended = isFinalized || call?.telephony_state === 'ended';
  const canAct = !submitting && !isFinalized && !!call;

  const handleSelect = async (disposition) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitDisposition({ disposition, note });
      setLastDisposition(disposition);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScheduleCallback = async (scheduledAt) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitDisposition({ disposition: 'callback_scheduled', note, scheduledAt });
      setLastDisposition('callback_scheduled');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleHangup = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await hangup();
      setHungUp(true);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async () => {
    try {
      await undo();
      setLastDisposition(null);
      setHungUp(false);
    } catch (err) {
      setActionError(err.message);
    }
  };

  const handleExpandNote = async () => {
    if (!note.trim() || expanding) return;
    setExpanding(true);
    setActionError(null);
    try {
      const { note: expanded } = await api.expandNote(note);
      setNote(expanded);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setExpanding(false);
    }
  };

  // Keyboard shortcuts — ignored while typing in the notes field, and only
  // active once the call has actually started.
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Escape') {
        if (!hungUp && !isFinalized) setShowHangupConfirm(true);
        return;
      }
      if (!canAct) return;

      if (e.key === 'v' || e.key === 'V') handleSelect('voicemail');
      else if (e.key === 'n' || e.key === 'N') handleSelect('no_answer');
      else if (e.key === 'm' || e.key === 'M') setMuted((m) => !m);
      else if (e.key === 'd' || e.key === 'D') {
        dispositionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setDispositionHighlight(true);
        setTimeout(() => setDispositionHighlight(false), 800);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, hungUp, isFinalized, note]);

  if (error) {
    return (
      <NeuCard className="mx-auto mt-12 max-w-md p-6 text-center">
        <p className="font-medium text-text-primary">Couldn't start this call</p>
        <p className="mt-2 text-sm text-text-secondary">{error}</p>
        <NeuButton className="mt-4" onClick={() => navigate('/')}>
          Back to Dashboard
        </NeuButton>
      </NeuCard>
    );
  }

  if (starting || !lead) {
    return <p className="mt-12 text-center text-text-secondary">Connecting…</p>;
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-6">
          <NeuCard className="p-5">
            <CallHeader call={call} ended={ended} />
            {muted && <p className="mt-2 text-xs font-semibold text-action-warn">Muted</p>}
          </NeuCard>

          <ContactCard lead={lead} />

          <NeuCard className="space-y-4 p-5">
            <div>
              <div className="flex items-center justify-between">
                <label className="mb-1 block text-xs font-medium text-text-secondary">Notes</label>
                <button
                  type="button"
                  onClick={handleExpandNote}
                  disabled={!note.trim() || expanding}
                  className="text-xs font-medium text-action-call disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {expanding ? 'Expanding…' : '✨ Expand'}
                </button>
              </div>
              <NotesField value={note} onChange={setNote} />
            </div>

            <div ref={dispositionRef} className={dispositionHighlight ? 'animate-pulse-call rounded-input' : ''}>
              <DispositionButtons onSelect={handleSelect} disabled={submitting || isFinalized} />
            </div>

            {actionError && <p className="text-sm text-action-hangup">{actionError}</p>}

            <CollapsibleSection title="Previous Notes">
              <PreviousNotes leadId={lead.id} />
            </CollapsibleSection>
          </NeuCard>
        </div>

        <div className="space-y-4">
          <CollapsibleSection title="Pitch script">
            <p className="text-xs leading-relaxed text-text-primary">{PITCH_SCRIPT(user?.name || 'the rep')}</p>
          </CollapsibleSection>

          <CallControls
            onHangup={() => setShowHangupConfirm(true)}
            onScheduleCallback={handleScheduleCallback}
            disabled={submitting || isFinalized}
            hangupDisabled={submitting || isFinalized || hungUp}
          />

          {hungUp && !isFinalized && (
            <NeuCard className="p-4 text-sm text-text-secondary">
              Call ended without a disposition — this lead returns to the queue in 30s unless you log an
              outcome now.
            </NeuCard>
          )}

          {isFinalized && (
            <NeuCard className="space-y-3 p-4">
              <p className="text-sm text-text-primary">
                Logged as <strong>{DISPOSITION_LABELS[lastDisposition] || lastDisposition}</strong>.
              </p>
              {undoInfo && (
                <NeuButton className="w-full text-sm" onClick={handleUndo}>
                  Undo
                </NeuButton>
              )}
              <NeuButton className="w-full text-sm" onClick={() => navigate('/call/next')}>
                Next Lead
              </NeuButton>
              <NeuButton className="w-full text-sm" onClick={() => navigate('/')}>
                Back to Dashboard
              </NeuButton>
            </NeuCard>
          )}
        </div>
      </div>

      <ShortcutHintBar />

      {showHangupConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <NeuCard className="w-full max-w-sm space-y-4 p-6">
            <p className="text-sm font-medium text-text-primary">Hang up this call?</p>
            <div className="flex gap-3">
              <NeuButton
                className="flex-1 text-sm"
                onClick={async () => {
                  setShowHangupConfirm(false);
                  await handleHangup();
                }}
              >
                Hang up
              </NeuButton>
              <NeuButton className="flex-1 text-sm" onClick={() => setShowHangupConfirm(false)}>
                Cancel
              </NeuButton>
            </div>
          </NeuCard>
        </div>
      )}
    </div>
  );
}

export default function CallScreen() {
  const { leadId: leadIdParam } = useParams();
  const location = useLocation();
  const leadId = leadIdParam === 'next' ? undefined : leadIdParam;

  return (
    <AppShell>
      {/* location.key forces a remount for repeated "Next Lead" visits to /call/next */}
      <CallScreenInner key={location.key} leadId={leadId} />
    </AppShell>
  );
}
