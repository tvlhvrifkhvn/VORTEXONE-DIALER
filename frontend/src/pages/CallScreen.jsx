// /call/:leadId (C8E): three columns, every region scrolling on its own.
//   LEAD (320px): who, BRIEF (always open), OFFICE, RECENT, VIEW LEAD ↗
//   CALL (≤760px): state and timer, EST. COST, MUTE · HOLD · END CALL (48px),
//                  NOTES, OUTCOME (the six outcomes 3×2), then what's next
//   HELP (340px): PITCH SCRIPT, OBJECTIONS, QUICK ACTIONS; below 1280px it
//                  becomes tabs (SCRIPT · OBJECTIONS · ACTIONS) under CALL.
// Only placement changed: the hotkeys (M, Esc here; V, N, D in
// DispositionPanel), handlers, timers, confirms and outcome logic are as before.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { MicOff, PauseCircle } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import CallContactHeader from '../components/call/CallContactHeader';
import CallHeader from '../components/call/CallHeader';
import CallQuickActions from '../components/call/CallQuickActions';
import ObjectionPanel from '../components/call/ObjectionPanel';
import BriefCard from '../components/call/BriefCard';
import ColleagueCard from '../components/leads/ColleagueCard';
import CallCostRow from '../components/call/CallCostRow';
import DispositionPanel, { ScriptPanel, PreviousNotes } from '../components/call/DispositionPanel';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import ActionButton from '../components/ui/ActionButton';
import Dialog from '../components/ui/Dialog';
import Keycap from '../components/ui/Keycap';
import SectionLabel from '../components/ui/SectionLabel';
import Segmented from '../components/ui/Segmented';
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

/** true from 1280px wide: HELP is a column; below, it's tabs under CALL. */
function useWide() {
  const query = '(min-width: 1280px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

const HELP_TABS = [
  { value: 'script', label: 'Script' },
  { value: 'objections', label: 'Objections' },
  { value: 'actions', label: 'Actions' },
];

/** A 48px call control: square, mono, solid while toggled on (aria-pressed). */
function ControlButton({ icon: Icon, hotkey, label, active, onClick, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={`flex min-h-12 items-center justify-center gap-2 border px-2 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-foreground bg-foreground text-background' : 'border-strong text-foreground hover:bg-muted'
      }`}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      {hotkey && <Keycap>{hotkey}</Keycap>}
      {label}
    </button>
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
  // Mute and Hold are screen state only until the real provider (as before).
  const [onHold, setOnHold] = useState(false);
  const [helpTab, setHelpTab] = useState('script');
  const wide = useWide();
  const [showHangupConfirm, setShowHangupConfirm] = useState(false);
  const [redialing, setRedialing] = useState(false);
  // A known leadId starts the brief fetch in parallel with placing the call;
  // /call/next only learns its lead once the call has started.
  const brief = useBrief(leadId || dialedLead?.id);

  const isFinalized = !!lastDisposition;
  const ended = isFinalized || call?.telephony_state === 'ended';
  const canAct = !submitting && !isFinalized && !!call;
  // Full brief while dialing/ringing; one line once the call has connected.

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
      <Panel className="m-6 max-w-md space-y-4 p-6">
        <p className="label">Call not started</p>
        <p className="text-base font-medium text-foreground">Couldn't start this call</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button onClick={() => navigate('/leads')}>Back to leads →</Button>
      </Panel>
    );
  }

  if (starting || !lead) {
    return <p className="label m-6">Connecting…</p>;
  }

  const scriptPart = (
    <section className="space-y-2">
      <ScriptPanel defaultOpen />
    </section>
  );
  const objectionsPart = (
    <section className="space-y-2">
      <SectionLabel title="Objections" />
      <ObjectionPanel callId={call?.id} />
    </section>
  );
  const actionsPart = (
    <section className="space-y-2">
      <SectionLabel title="Quick actions" />
      <CallQuickActions lead={lead} onLeadUpdated={setLeadOverride} onScheduleCallback={handleScheduleCallback} callbackDisabled={submitting || isFinalized} />
    </section>
  );

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0 lg:flex-row" data-testid="call-screen">
      {/* LEAD */}
      <aside aria-label="Lead" className="order-2 space-y-6 border-t px-4 py-6 lg:order-1 lg:min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-t-0">
        <CallContactHeader lead={lead} />
        <section className="space-y-2">
          <SectionLabel title="Brief" />
          <BriefCard brief={brief} alwaysOpen />
        </section>
        <ColleagueCard leadId={lead.id} twoByTwo />
        <section className="space-y-2">
          <SectionLabel title="Recent" />
          <PreviousNotes leadId={lead.id} currentCallId={call?.id} limit={5} compact />
        </section>
        <a
          href={`/leads/${lead.id}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this lead in a new tab (leaving this screen would end the call)"
          className="inline-flex min-h-10 items-center font-mono text-sm font-medium uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
        >
          View lead ↗
        </a>
      </aside>

      {/* CALL */}
      <main className="order-1 min-w-0 flex-1 px-6 py-6 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
        <div className="mx-auto max-w-[760px] space-y-4">
          <div className="space-y-1">
            <CallHeader call={call} ended={ended} onHold={onHold} />
            {/* C4B: this call's estimated cost (only once rates are set); session time and dials during a session. */}
            <CallCostRow call={call} />
          </div>

          <div className="grid grid-cols-4 gap-2" data-testid="call-controls">
            <ControlButton
              icon={MicOff}
              hotkey="M"
              label={muted ? 'Unmute' : 'Mute'}
              active={muted}
              onClick={() => setMuted((m) => !m)}
              title="Mute (audio muting arrives with the phone provider)"
            />
            <ControlButton
              icon={PauseCircle}
              label={onHold ? 'Resume' : 'Hold'}
              active={onHold}
              onClick={() => setOnHold((h) => !h)}
              title="Hold (real hold arrives with the phone provider)"
            />
            <ActionButton
              variant="hangup"
              className="col-span-2 flex min-h-12 items-center justify-center gap-2"
              onClick={() => setShowHangupConfirm(true)}
              disabled={submitting || isFinalized || hungUp}
            >
              {!hungUp && <Keycap>Esc</Keycap>}
              {hungUp ? 'Call ended' : 'End call'}
            </ActionButton>
          </div>

          {/* What's next once the call is over: the 30 s note, REDIAL, or the logged outcome with UNDO and NEXT LEAD. */}
          {hungUp && !isFinalized && (
            <Panel className="border-l-[3px] border-l-primary p-4 text-sm text-foreground">
              Call ended without a disposition — this lead returns to the queue in 30s unless you log an outcome now.
            </Panel>
          )}
          {ended && !isFinalized && (
            <Button className="w-full" onClick={handleRedial} disabled={redialing}>
              {redialing ? 'Redialing…' : 'Redial'}
            </Button>
          )}
          {isFinalized && (
            <Panel className="flex flex-wrap items-center gap-4 p-4">
              <p className="min-w-0 flex-1 text-sm text-foreground">
                ✓ Logged as <strong>{DISPOSITION_LABELS[lastDisposition] || lastDisposition}</strong>.
              </p>
              {undoInfo && <Button onClick={handleUndo}>Undo</Button>}
              <Button variant="ghost" onClick={() => navigate('/leads')}>
                Back to leads
              </Button>
              <Button variant="primary" onClick={() => navigate('/call/next')}>
                Next lead →
              </Button>
            </Panel>
          )}

          {/* Notes, Expand note and the six outcomes live in the shared
              DispositionPanel (also an answered multi-line card). */}
          <DispositionPanel
            lead={lead}
            callId={call?.id}
            onDispositionSubmit={handlePanelDisposition}
            disabled={submitting || isFinalized}
            showScript={false}
            compact
          />

          {actionError && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {actionError}
            </p>
          )}

          {!wide && (
            <section className="space-y-4 border-t pt-4" data-testid="help-tabs">
              <Segmented label="Help" options={HELP_TABS} value={helpTab} onChange={setHelpTab} />
              {helpTab === 'script' && scriptPart}
              {helpTab === 'objections' && objectionsPart}
              {helpTab === 'actions' && actionsPart}
            </section>
          )}
        </div>
      </main>

      {/* HELP */}
      {wide && (
        <aside aria-label="Help" className="order-3 space-y-6 border-l px-4 py-6 lg:min-h-0 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto" data-testid="help-column">
          {scriptPart}
          {objectionsPart}
          {actionsPart}
        </aside>
      )}

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
    <AppShell framed>
      {/* location.key forces a remount for repeated "Next Lead" visits to /call/next */}
      <CallScreenInner key={location.key} leadId={leadId} />
    </AppShell>
  );
}
