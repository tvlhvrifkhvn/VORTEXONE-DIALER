import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import CallContactHeader from '../components/call/CallContactHeader';
import CallActionGrid from '../components/call/CallActionGrid';
import BriefCard from '../components/call/BriefCard';
import ColleagueCard from '../components/leads/ColleagueCard';
import CallControls from '../components/call/CallControls';
import DispositionPanel, { ScriptPanel } from '../components/call/DispositionPanel';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import ActionButton from '../components/ui/ActionButton';
import Dialog from '../components/ui/Dialog';
import Keycap from '../components/ui/Keycap';
import SectionLabel from '../components/ui/SectionLabel';
import { useCall } from '../hooks/useCall';
import { useBrief } from '../hooks/useBrief';

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
  { key: 'D', label: 'Jump to outcome' },
  { key: 'M', label: 'Mute' },
  { key: 'Esc', label: 'Hang up' },
];

function ShortcutHintBar() {
  return (
    <div className="flex flex-wrap items-center gap-6 border-t py-4 font-mono text-xs uppercase text-muted-foreground">
      <span className="label">Hotkeys</span>
      {SHORTCUT_HINTS.map((s) => (
        <span key={s.key} className="flex items-center gap-2">
          <Keycap>{s.key}</Keycap>
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
    lead: dialedLead,
    error,
    starting,
    undoInfo,
    hangup,
    submitDisposition,
    undo,
    redial,
  } = useCall(leadId);
  // Adding a tag mid-call returns an updated lead; useCall's copy is the one
  // it dialed and doesn't refetch, so the newer row is layered over it.
  const [leadOverride, setLeadOverride] = useState(null);
  const lead = leadOverride && leadOverride.id === dialedLead?.id ? leadOverride : dialedLead;
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [lastDisposition, setLastDisposition] = useState(null);
  const [hungUp, setHungUp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);
  const [redialing, setRedialing] = useState(false);
  // A known leadId starts the brief fetch in parallel with placing the call;
  // /call/next only learns its lead once the call has started.
  const brief = useBrief(leadId || dialedLead?.id);

  const isFinalized = !!lastDisposition;
  const ended = isFinalized || call?.telephony_state === 'ended';
  const canAct = !submitting && !isFinalized && !!call;
  // Full brief while dialing/ringing; one line once the call has connected.
  const briefCollapsed = ended || (!!call && !['dialing', 'ringing'].includes(call.telephony_state));

  // Submission path handed to the shared DispositionPanel — the panel owns
  // the note text and the DNC confirmation, this owns how it's sent.
  const handlePanelDisposition = async ({ disposition, note: panelNote, onRetrying, stageId, task }) => {
    setActionError(null);
    await submitDisposition({ disposition, note: panelNote, onRetrying, stageId, task });
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
      await submitDisposition({
        disposition: 'callback_scheduled',
        scheduledAt,
        onRetrying: (attempt, max) => setActionError(`Not saved yet — retrying (${attempt + 1} of ${max})…`),
      });
      setActionError(null);
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
      await hangup({ onRetrying: (attempt, max) => setActionError(`Hang-up not sent yet — retrying (${attempt + 1} of ${max})…`) });
      setActionError(null);
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
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return; // C2B: the outcome's stage picker

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
      <Panel className="mt-6 max-w-md space-y-4 p-6">
        <p className="label">Call not started</p>
        <p className="text-base font-medium text-foreground">Couldn't start this call</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => navigate('/leads')}>Back to leads →</Button>
      </Panel>
    );
  }

  if (starting || !lead) {
    return <p className="label mt-12">Connecting…</p>;
  }

  return (
    <div className="mx-auto mt-6 max-w-[1440px] space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <section>
            <SectionLabel index="01" title="Brief" className="mb-2" />
            <BriefCard brief={brief} collapsed={briefCollapsed} />
          </section>

          <section>
            <SectionLabel index="02" title="Active call" className="mb-2" />
            <CallContactHeader lead={lead} call={call} ended={ended} />
          </section>

          <ColleagueCard leadId={lead.id} index="03" />

          <section className="space-y-2">
            <SectionLabel index="04" title="Actions" />
            <CallActionGrid
              lead={lead}
              callId={call?.id}
              onLeadUpdated={setLeadOverride}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
            />

            <ActionButton
              variant="hangup"
              className="flex min-h-12 w-full items-center justify-center gap-2"
              onClick={() => setShowHangupConfirm(true)}
              disabled={submitting || isFinalized || hungUp}
            >
              {!hungUp && <Keycap>Esc</Keycap>}
              {hungUp ? 'Call ended' : 'End call'}
            </ActionButton>
          </section>

          {/* Notes, Expand note, the six disposition buttons and Previous Notes
              live in the shared DispositionPanel, so this screen and an
              answered multi-line card show identical UI. */}
          <DispositionPanel
            lead={lead}
            callId={call?.id}
            onDispositionSubmit={handlePanelDisposition}
            disabled={submitting || isFinalized}
            showScript={false}
            sections={{ notes: '05', outcome: '06' }}
          />

          {actionError && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {actionError}
            </p>
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <ScriptPanel />

          <CallControls onScheduleCallback={handleScheduleCallback} disabled={submitting || isFinalized} />

          {hungUp && !isFinalized && (
            <Panel className="border-l-[3px] border-l-primary p-4 text-sm text-foreground">
              Call ended without a disposition — this lead returns to the queue in 30s unless you log an
              outcome now.
            </Panel>
          )}

          {ended && !isFinalized && (
            <Button className="w-full" onClick={handleRedial} disabled={redialing}>
              {redialing ? 'Redialing…' : 'Redial'}
            </Button>
          )}

          {isFinalized && (
            <Panel className="space-y-4 p-4">
              <p className="text-sm text-foreground">
                ✓ Logged as <strong>{DISPOSITION_LABELS[lastDisposition] || lastDisposition}</strong>.
              </p>
              {undoInfo && (
                <Button className="w-full" onClick={handleUndo}>
                  Undo
                </Button>
              )}
              <Button variant="primary" className="w-full" onClick={() => navigate('/call/next')}>
                Next lead →
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate('/leads')}>
                Back to leads
              </Button>
            </Panel>
          )}
        </div>
      </div>

      <ShortcutHintBar />

      {showHangupConfirm && (
        <Dialog title="Hang up this call?" onClose={() => setShowHangupConfirm(false)} className="max-w-sm">
          <div className="flex gap-4">
            <ActionButton
              variant="hangup"
              className="flex-1"
              onClick={async () => {
                setShowHangupConfirm(false);
                await handleHangup();
              }}
            >
              Hang up
            </ActionButton>
            <Button className="flex-1" onClick={() => setShowHangupConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
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
