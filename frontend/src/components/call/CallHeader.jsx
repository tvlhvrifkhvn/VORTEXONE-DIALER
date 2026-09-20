import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../lib/format';

const STATE_LABELS = {
  ringing: 'Ringing…',
  answered: 'Connected',
  voicemail_detected: 'Voicemail',
  ended: 'Call ended',
};

const STATE_DOT = {
  ringing: 'bg-action-warn animate-pulse',
  answered: 'bg-action-contacted animate-pulse',
  voicemail_detected: 'bg-action-neutral',
  ended: 'bg-text-secondary',
};

export default function CallHeader({ call, ended = false }) {
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
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${STATE_DOT[state] || 'bg-text-secondary'}`} />
        <span className="text-sm font-medium text-text-primary">{STATE_LABELS[state] || state}</span>
      </div>
      <div className="flex items-center gap-3">
        {state === 'answered' && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: '#EF4444' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-danger, #EF4444)' }}>
              Recording
            </span>
          </span>
        )}
        <span className="text-2xl font-semibold tabular-nums text-text-primary">{formatDuration(elapsed)}</span>
      </div>
    </div>
  );
}
