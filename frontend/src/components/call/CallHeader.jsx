import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!call?.started_at) return undefined;
    const start = new Date(call.started_at).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    if (ended) return undefined; // freeze the timer once the rep has hung up or dispositioned
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call?.started_at, ended]);

  const state = ended ? 'ended' : call?.telephony_state || 'ringing';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${STATE_DOT[state] || 'bg-text-secondary'}`} />
        <span className="text-sm font-medium text-text-primary">{STATE_LABELS[state] || state}</span>
      </div>
      <span className="text-2xl font-semibold tabular-nums text-text-primary">{formatDuration(elapsed)}</span>
    </div>
  );
}
