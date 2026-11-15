import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import ActionButton from '../ui/ActionButton';
import Badge from '../ui/Badge';
import StatusDot from '../ui/StatusDot';
import DispositionPanel from './DispositionPanel';
import BriefCard from './BriefCard';
import { formatPhone } from '../../lib/format';

// Lines are told apart by their "LINE 01/02/03" labels, not by color
// (docs/DESIGN.md section 6). `look` picks how each state is shown:
// a signal or live dot, muted text, or an outline / dashed tag.
const STATUS_DISPLAY = {
  idle: { label: 'Waiting', look: 'muted' },
  loading: { label: 'Loading next lead…', look: 'muted' },
  dialing: { label: 'Dialing…', look: 'muted' },
  ringing: { label: 'Ringing', look: 'signal' },
  answered: { label: 'Connected', look: 'live' },
  active_disposition: { label: 'Connected', look: 'live' },
  held: { label: 'Waiting — rep busy', look: 'outline' },
  voicemail: { label: 'Voicemail detected', look: 'outline' },
  busy: { label: 'Busy', look: 'outline' },
  no_answer: { label: 'No answer', look: 'outline' },
  dropped: { label: 'Dropped', look: 'dashed' },
};

const lineLabel = (slotNumber) => `Line ${String(slotNumber).padStart(2, '0')}`;

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
  const timer = showTimer && <span className="font-mono text-xs tabular-nums text-foreground">{formatDuration(duration)}</span>;
  let mark;
  if (display.look === 'signal' || display.look === 'live') {
    mark = <StatusDot tone={display.look}>{display.label}</StatusDot>;
  } else if (display.look === 'outline' || display.look === 'dashed') {
    mark = <Badge tone={display.look}>{display.label}</Badge>;
  } else {
    mark = <span className="font-mono text-xs uppercase text-muted-foreground">{display.label}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      {mark}
      {timer}
    </div>
  );
}

function LeadIdentity({ line, compact = false }) {
  if (!line.lead) {
    return <p className="py-2 text-sm text-muted-foreground">{line.message || 'No lead on this line.'}</p>;
  }
  return (
    <div className="flex items-start gap-4">
      <div
        aria-hidden="true"
        className={`flex ${compact ? 'h-8 w-8' : 'h-10 w-10'} shrink-0 items-center justify-center border border-strong font-mono text-xs font-medium text-foreground`}
      >
        {initialsOf(line.lead.name)}
      </div>
      <div className="min-w-0">
        <p className={`truncate font-semibold text-foreground ${compact ? 'text-base' : 'text-lg'}`}>{line.lead.name}</p>
        <p className="truncate text-sm text-muted-foreground">{line.lead.brokerage || '—'}</p>
        <p className="mt-1 font-mono text-sm tabular-nums text-foreground">
          {formatPhone(line.lead.phone)}
          {line.lead.extension && <span className="ml-1 text-muted-foreground">ext. {line.lead.extension}</span>}
        </p>
        {!compact && <p className="font-mono text-xs text-muted-foreground">{line.lead.state}</p>}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-2/3 bg-muted" />
      <div className="h-3 w-1/2 bg-muted" />
    </div>
  );
}

/** Compact card for a line the rep isn't currently talking on. */
function CompactLineCard({ line, onDrop }) {
  const isFinished = ['no_answer', 'voicemail', 'busy', 'dropped'].includes(line.status);
  const isHeld = line.status === 'held';

  return (
    <NeuCard className={`space-y-4 p-4 ${isHeld ? 'border-strong' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="label tabular-nums">{lineLabel(line.slotNumber)}</span>
        <StatusBadge status={line.status} duration={line.duration} />
      </div>

      {line.status === 'loading' ? <LoadingSkeleton /> : <LeadIdentity line={line} compact />}

      {line.lead && line.brief && !isFinished && <BriefCard brief={line.brief} collapsed className="!p-2" />}

      {isHeld && (
        <p className="border border-strong bg-muted px-2 py-1 text-sm text-foreground">
          Live caller holding — up next when you finish
        </p>
      )}

      {!isHeld && !isFinished && line.lead && (
        <NeuButton className="w-full" onClick={() => onDrop(line.slotNumber)}>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold text-foreground">Dialing session</h2>
          {connected ? (
            <StatusDot tone="live">Live</StatusDot>
          ) : (
            <StatusDot tone="muted">Connecting…</StatusDot>
          )}
        </div>
        {onStop && (
          <ActionButton variant="hangup" onClick={onStop}>
            End session
          </ActionButton>
        )}
      </div>

      {error && (
        <NeuCard role="alert" className="p-4 text-sm text-signal">
          <span className="label mr-2 text-signal">Error</span>
          {error}
        </NeuCard>
      )}
      {starting && <p className="font-mono text-xs uppercase text-muted-foreground">Opening lines…</p>}

      {heldLines.length > 0 && (
        <NeuCard className="border-strong p-4 text-sm font-medium text-foreground">
          {heldLines.length === 1 ? 'Another lead answered' : `${heldLines.length} more leads answered`} and{' '}
          {heldLines.length === 1 ? 'is' : 'are'} holding — you'll be handed{' '}
          {heldLines.length === 1 ? 'them' : 'the first'} as soon as you log this call.
        </NeuCard>
      )}

      {activeLine ? (
        // Someone picked up: their card takes over in place, with the other
        // lines continuing beside it.
        <div className="flex flex-col gap-4 lg:flex-row">
          <NeuCard className="flex-1 space-y-4 border-strong border-l-[3px] border-l-primary p-6">
            <div className="flex items-center justify-between">
              <span className="label tabular-nums">{lineLabel(activeLine.slotNumber)} · on the call</span>
              <StatusBadge status={activeLine.status} duration={activeLine.duration} />
            </div>

            <LeadIdentity line={activeLine} />

            {/* Prefetched while this line was dialing, so it's ready on answer. */}
            {activeLine.brief && <BriefCard brief={activeLine.brief} collapsed />}

            <DispositionPanel
              lead={activeLine.lead}
              callId={activeLine.callId}
              onDispositionSubmit={(payload) => onDispositionSubmit(activeLine, payload)}
            />
          </NeuCard>

          <div className="w-full space-y-4 lg:w-72">
            {otherLines.map((line) => (
              <CompactLineCard key={line.slotNumber} line={line} onDrop={onDrop} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row">
          {lines.map((line) => (
            <div key={line.slotNumber} className="flex-1">
              <CompactLineCard line={line} onDrop={onDrop} />
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Lines dial continuously — voicemail, busy and no-answer resolve themselves and move to the next lead.
        Log the call you're on and the next live caller comes straight to you.
      </p>
    </div>
  );
}
