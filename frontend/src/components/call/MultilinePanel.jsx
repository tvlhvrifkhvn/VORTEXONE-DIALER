import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import ActionButton from '../ui/ActionButton';
import { formatPhone } from '../../lib/format';

// One accent per line so a rep can tell them apart at a glance while three
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
  voicemail: { label: 'Voicemail detected', dot: 'bg-action-warn', pulse: false },
  no_answer: { label: 'No answer', dot: 'bg-text-secondary', pulse: false },
  dropped: { label: 'Dropped', dot: 'bg-action-hangup', pulse: false },
};

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
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
      <span className={`h-2 w-2 rounded-full ${display.dot} ${display.pulse ? 'animate-pulse' : ''}`} />
      <span className={status === 'answered' ? 'text-action-contacted' : ''}>
        {status === 'answered' ? `${display.label} — ${formatDuration(duration)}` : display.label}
      </span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-2/3 animate-pulse rounded bg-shadow/30" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-shadow/20" />
      <div className="h-3 w-1/3 animate-pulse rounded bg-shadow/20" />
    </div>
  );
}

function LineCard({ line, someoneAnswered, onTake, onDrop }) {
  const accent = SLOT_ACCENTS[line.slotNumber] || SLOT_ACCENTS[1];
  const isAnswered = line.status === 'answered';
  const isLoading = line.status === 'loading';
  const isFinished = ['no_answer', 'voicemail', 'dropped'].includes(line.status);
  // Once a human picks up, every other card visibly steps back.
  const fading = someoneAnswered && !isAnswered;

  return (
    <NeuCard
      className={`flex-1 space-y-3 border-2 p-4 transition-all duration-300 ${
        isAnswered ? `${accent.ring} shadow-neu` : 'border-transparent'
      } ${fading ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
          Line {line.slotNumber}
        </span>
        <StatusBadge status={line.status} duration={line.duration} />
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : line.lead ? (
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accent.avatar} text-sm font-semibold text-white`}
          >
            {initialsOf(line.lead.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{line.lead.name}</p>
            <p className="truncate text-xs text-text-secondary">{line.lead.brokerage || '—'}</p>
            <p className="mt-1 text-xs text-text-primary">{formatPhone(line.lead.phone)}</p>
            <p className="text-xs text-text-secondary">{line.lead.state}</p>
          </div>
        </div>
      ) : (
        <p className="py-3 text-xs text-text-secondary">{line.message || 'No lead on this line.'}</p>
      )}

      {isAnswered && (
        <ActionButton variant="contacted" className="w-full text-sm" onClick={() => onTake(line.slotNumber)}>
          Take this call
        </ActionButton>
      )}

      {fading && !isFinished && <p className="text-center text-xs text-text-secondary">Dropping…</p>}

      {!isAnswered && !fading && line.lead && !isFinished && (
        <NeuButton className="w-full text-xs" onClick={() => onDrop(line.slotNumber)}>
          Drop line
        </NeuButton>
      )}
    </NeuCard>
  );
}

/**
 * Three lines dialed at once — the rep talks to whoever picks up first and
 * the rest are dropped automatically. Live status is pushed from the backend
 * (see hooks/useMultiline.js); this component only renders it.
 */
export default function MultilinePanel({ lines, connected, starting, error, onTake, onDrop, onStop }) {
  const someoneAnswered = lines.some((l) => l.status === 'answered');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Multi-line dialing</h2>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-action-contacted' : 'bg-action-warn animate-pulse'}`}
            />
            {connected ? 'Live' : 'Connecting…'}
          </span>
        </div>
        <ActionButton variant="hangup" onClick={onStop}>
          Stop session
        </ActionButton>
      </div>

      {error && <NeuCard className="p-3 text-sm text-action-hangup">{error}</NeuCard>}

      {starting && <p className="text-xs text-text-secondary">Opening three lines…</p>}

      <div className="flex flex-col gap-3 md:flex-row">
        {lines.map((line) => (
          <LineCard
            key={line.slotNumber}
            line={line}
            someoneAnswered={someoneAnswered}
            onTake={onTake}
            onDrop={onDrop}
          />
        ))}
      </div>

      <p className="text-xs text-text-secondary">
        Whoever answers first keeps the call — the other two lines drop automatically and those leads go back in the
        queue.
      </p>
    </div>
  );
}
