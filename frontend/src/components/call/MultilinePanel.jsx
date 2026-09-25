import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import ActionButton from '../ui/ActionButton';
import DispositionPanel from './DispositionPanel';
import { formatPhone } from '../../lib/format';

// One accent per line so a rep can tell them apart at a glance while several
// are ringing at once.
const SLOT_ACCENTS = {
  1: { avatar: 'bg-action-call', ring: 'border-action-call' },
  2: { avatar: 'bg-action-contacted', ring: 'border-action-contacted' },
  3: { avatar: 'bg-action-warn', ring: 'border-action-warn' },
};

const STATUS_DISPLAY = {
  idle: { label: 'Waiting', dot: 'bg-text-secondary/40', pulse: false },
  loading: { label: 'Loading next lead…', dot: 'bg-text-secondary/40', pulse: true },
  dialing: { label: 'Dialing…', dot: 'bg-text-secondary', pulse: true },
  ringing: { label: 'Ringing…', dot: 'bg-action-call', pulse: true },
  answered: { label: 'Connected', dot: 'bg-action-contacted', pulse: false },
  active_disposition: { label: 'Connected', dot: 'bg-action-contacted', pulse: false },
  held: { label: 'Waiting — rep busy', dot: 'bg-action-warn', pulse: true },
  voicemail: { label: 'Voicemail detected', dot: 'bg-action-warn', pulse: false },
  busy: { label: 'Busy', dot: 'bg-action-warn', pulse: false },
  no_answer: { label: 'No answer', dot: 'bg-text-secondary', pulse: false },
  dropped: { label: 'Dropped', dot: 'bg-action-hangup', pulse: false },
};

const LIVE_STATUSES = ['answered', 'active_disposition'];

function initialsOf(name) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '—';
  return letters.toUpperCase();
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function StatusBadge({ status, duration }) {
  const display = STATUS_DISPLAY[status] || STATUS_DISPLAY.idle;
  const showTimer = LIVE_STATUSES.includes(status) || status === 'held';
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
      <span className={`h-2 w-2 rounded-full ${display.dot} ${display.pulse ? 'animate-pulse' : ''}`} />
      <span className={LIVE_STATUSES.includes(status) ? 'text-action-contacted' : ''}>
        {showTimer ? `${display.label} — ${formatDuration(duration)}` : display.label}
      </span>
    </div>
  );
}

function LeadIdentity({ line, compact = false }) {
  const accent = SLOT_ACCENTS[line.slotNumber] || SLOT_ACCENTS[1];
  if (!line.lead) {
    return <p className="py-2 text-xs text-text-secondary">{line.message || 'No lead on this line.'}</p>;
  }
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex ${compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'} shrink-0 items-center justify-center rounded-full ${accent.avatar} font-semibold text-white`}
      >
        {initialsOf(line.lead.name)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-text-primary">{line.lead.name}</p>
        <p className="truncate text-xs text-text-secondary">{line.lead.brokerage || '—'}</p>
        <p className="mt-0.5 text-xs text-text-primary">{formatPhone(line.lead.phone)}</p>
        {!compact && <p className="text-xs text-text-secondary">{line.lead.state}</p>}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-2/3 animate-pulse rounded bg-shadow/30" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-shadow/20" />
    </div>
  );
}

/** Compact card for a line the rep isn't currently talking on. */
function CompactLineCard({ line, onDrop }) {
  const isFinished = ['no_answer', 'voicemail', 'busy', 'dropped'].includes(line.status);
  const isHeld = line.status === 'held';

  return (
    <NeuCard
      className={`space-y-2 border-2 p-3 transition-all duration-300 ${
        isHeld ? 'border-action-warn' : 'border-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
          Line {line.slotNumber}
        </span>
        <StatusBadge status={line.status} duration={line.duration} />
      </div>

      {line.status === 'loading' ? <LoadingSkeleton /> : <LeadIdentity line={line} compact />}

      {isHeld && (
        <p className="rounded-input bg-action-warn/10 px-2 py-1 text-[11px] font-medium text-action-warn">
          Live caller holding — up next when you finish
        </p>
      )}

      {!isHeld && !isFinished && line.lead && (
        <NeuButton className="w-full text-xs" onClick={() => onDrop(line.slotNumber)}>
          Drop line
        </NeuButton>
      )}
    </NeuCard>
  );
}

/**
 * Continuous dialing: every line dials at once, voicemail/busy/no-answer
 * resolve themselves and redial in the background, and the line that a real
 * person answers expands in place with the same disposition UI the single
 * call screen uses. A second person who answers while the rep is busy is
 * held, never dropped.
 */
export default function MultilinePanel({
  lines,
  connected,
  starting,
  error,
  onDrop,
  onStop,
  onDispositionSubmit,
}) {
  const activeLine = lines.find((l) => LIVE_STATUSES.includes(l.status));
  const heldLines = lines.filter((l) => l.status === 'held');
  const otherLines = lines.filter((l) => l.slotNumber !== activeLine?.slotNumber);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Dialing session</h2>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-action-contacted' : 'bg-action-warn animate-pulse'}`}
            />
            {connected ? 'Live' : 'Connecting…'}
          </span>
        </div>
        <ActionButton variant="hangup" onClick={onStop}>
          End session
        </ActionButton>
      </div>

      {error && <NeuCard className="p-3 text-sm text-action-hangup">{error}</NeuCard>}
      {starting && <p className="text-xs text-text-secondary">Opening lines…</p>}

      {heldLines.length > 0 && (
        <NeuCard className="border-2 border-action-warn p-3 text-sm font-medium text-action-warn">
          {heldLines.length === 1 ? 'Another lead answered' : `${heldLines.length} more leads answered`} and{' '}
          {heldLines.length === 1 ? 'is' : 'are'} holding — you'll be handed{' '}
          {heldLines.length === 1 ? 'them' : 'the first'} as soon as you log this call.
        </NeuCard>
      )}

      {activeLine ? (
        // Someone picked up: their card takes over in place, with the other
        // lines continuing beside it.
        <div className="flex flex-col gap-3 lg:flex-row">
          <NeuCard className={`flex-1 space-y-3 border-2 ${SLOT_ACCENTS[activeLine.slotNumber]?.ring} p-4`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Line {activeLine.slotNumber} · on the call
              </span>
              <StatusBadge status={activeLine.status} duration={activeLine.duration} />
            </div>

            <LeadIdentity line={activeLine} />

            <DispositionPanel
              lead={activeLine.lead}
              callId={activeLine.callId}
              onDispositionSubmit={(payload) => onDispositionSubmit(activeLine, payload)}
            />
          </NeuCard>

          <div className="w-full space-y-3 lg:w-64">
            {otherLines.map((line) => (
              <CompactLineCard key={line.slotNumber} line={line} onDrop={onDrop} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:flex-row">
          {lines.map((line) => (
            <div key={line.slotNumber} className="flex-1">
              <CompactLineCard line={line} onDrop={onDrop} />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-secondary">
        Lines dial continuously — voicemail, busy and no-answer resolve themselves and move to the next lead.
        Log the call you're on and the next live caller comes straight to you.
      </p>
    </div>
  );
}
