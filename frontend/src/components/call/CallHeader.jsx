import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/format';
import Badge from '../ui/Badge';
import StatusDot from '../ui/StatusDot';

const STATE_LABELS = {
  ringing: 'Ringing',
  answered: 'Connected',
  voicemail_detected: 'Voicemail',
  ended: 'Call ended',
};

// DESIGN.md: ringing = signal dot, connected = live dot, ended = text only.
function StateMark({ state }) {
  const label = STATE_LABELS[state] || state;
  if (state === 'ringing') return <StatusDot tone="signal" className="text-sm">{label}</StatusDot>;
  if (state === 'answered') return <StatusDot tone="live" className="text-sm">{label}</StatusDot>;
  if (state === 'voicemail_detected') return <Badge>{label}</Badge>;
  return <span className="font-mono text-sm font-medium uppercase text-muted-foreground">{label}</span>;
}

// C8E: one row: the state (dot and RINGING, CONNECTED or ON HOLD) on the left,
// the timer (display size) on the right. The cosmetic REC mark is gone:
// nothing is recorded until the real provider.
export default function CallHeader({ call, ended = false, onHold = false }) {
  const [elapsed, setElapsed] = useState(0);
  // Set once the call leaves 'ringing' — the timer must count from the
  // moment the call connects (answered/voicemail), not from started_at
  // (which is stamped when the call row is created, i.e. page load).
  const connectedAtRef = useRef(null);

  useEffect(() => {
    const state = call?.telephony_state;
    const isConnected = !!state && state !== 'ringing';

    if (!isConnected) {
      connectedAtRef.current = null;
      setElapsed(0);
      return undefined;
    }
    if (connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
    }
    const start = connectedAtRef.current;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    if (ended) return undefined; // freeze the timer once the rep has hung up or dispositioned
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call?.telephony_state, ended]);

  const state = ended ? 'ended' : call?.telephony_state || 'ringing';

  return (
    <div className="flex items-center justify-between gap-4" data-testid="call-status">
      {onHold && state === 'answered' ? (
        <span className="font-mono text-sm font-medium uppercase text-foreground">On hold</span>
      ) : (
        <StateMark state={state} />
      )}
      <span className="font-mono text-display font-medium tabular-nums text-foreground">{formatDuration(elapsed)}</span>
    </div>
  );
}
