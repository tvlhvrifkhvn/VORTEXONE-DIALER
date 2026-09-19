import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ContactCard from '../components/call/ContactCard';
import CallHeader from '../components/call/CallHeader';
import CallControls from '../components/call/CallControls';
import DispositionPanel, { ScriptPanel } from '../components/call/DispositionPanel';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import { useCall } from '../hooks/useCall';

const DISPOSITION_LABELS = {
  contacted: 'Spoke / Interested',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  no_contact_number: 'No Contact — Number',
  no_contact_person: 'No Contact — Person',
  dnc: 'DNC',
  callback_scheduled: 'Callback Scheduled',
};

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
  const {
    call,
    lead,
    error,
    starting,
    undoInfo,
    hangup,
    submitDisposition,
    undo,
    redial,
  } = useCall(leadId);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [lastDisposition, setLastDisposition] = useState(null);
  const [hungUp, setHungUp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);
  const [redialing, setRedialing] = useState(false);

  const isFinalized = !!lastDisposition;
  const ended = isFinalized || call?.telephony_state === 'ended';
  const canAct = !submitting && !isFinalized && !!call;

  // Submission path handed to the shared DispositionPanel — the panel owns
  // the note text and the DNC confirmation, this owns how it's sent.
  const handlePanelDisposition = async ({ disposition, note: panelNote }) => {
    setActionError(null);
    await submitDisposition({ disposition, note: panelNote });
    setLastDisposition(disposition);
  };

  const handleRedial = async () => {
    setRedialing(true);
    setActionError(null);
    setHungUp(false);
    setLastDisposition(null);
    try {
      await redial();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setRedialing(false);
    }
  };

  const handleScheduleCallback = async (scheduledAt) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitDisposition({ disposition: 'callback_scheduled', scheduledAt });
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

  // Esc (hang up) and M (mute) stay here since this screen owns those
  // controls; V / N / D moved into DispositionPanel with the buttons.
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Escape') {
        if (!hungUp && !isFinalized) setShowHangupConfirm(true);
        return;
      }
      if (!canAct) return;

      if (e.key === 'm' || e.key === 'M') setMuted((m) => !m);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, hungUp, isFinalized]);

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

          {/* Notes, ✨ Expand, the six disposition buttons and Previous Notes
              now live in the shared DispositionPanel, so this screen and an
              answered multi-line card show identical UI. */}
          <DispositionPanel
            lead={lead}
            callId={call?.id}
            onDispositionSubmit={handlePanelDisposition}
            disabled={submitting || isFinalized}
            showScript={false}
          />

          {actionError && <p className="text-sm text-action-hangup">{actionError}</p>}
        </div>

        <div className="space-y-4">
          <ScriptPanel />

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

          {ended && !isFinalized && (
            <NeuButton className="w-full text-sm" onClick={handleRedial} disabled={redialing}>
              {redialing ? 'Redialing…' : 'Redial'}
            </NeuButton>
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
