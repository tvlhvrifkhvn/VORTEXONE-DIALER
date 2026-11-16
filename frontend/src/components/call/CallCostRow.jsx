// The call screen's cost row (C4B): this call's estimated cost and, during a
// dial session, the session time and its dial count. Read-only: it uses the
// call useCall already polls, the shared spend rates, the session start time
// useCall stores, and GET /api/sessions/:id — no hook logic changes.
import { useEffect, useState } from 'react';
import { useSpend } from '../../hooks/useSpend';
import { getActiveSessionId, SESSION_STARTED_AT_KEY } from '../../hooks/useCall';
import { formatCents, formatDuration } from '../../lib/format';
import * as api from '../../lib/api';

const CONNECTED = ['answered', 'voicemail_detected'];
const SESSION_POLL_MS = 5000;

/** The stored estimate once the call is costed; before that the same rule the server uses. */
function estimateCents(call, spend, now) {
  if (!call) return null;
  if (call.cost_est_cents !== null && call.cost_est_cents !== undefined) return Number(call.cost_est_cents);
  if (!spend?.ratesSet || call.telephony_state === 'failed') return null;
  const r = spend.rates;
  const connected = CONNECTED.includes(call.telephony_state) || Number(call.billed_seconds) > 0;
  const seconds = call.duration_seconds ?? Math.max(0, (now - new Date(call.started_at).getTime()) / 1000);
  const billed = call.billed_seconds ?? (connected ? Math.ceil(seconds / 60) * 60 : 0);
  return (r.perCall || 0) + (billed / 60) * ((r.outbound || 0) + (r.recording || 0));
}

export default function CallCostRow({ call }) {
  const spend = useSpend();
  const [now, setNow] = useState(() => Date.now());
  const [sessionStats, setSessionStats] = useState(null);
  const sessionId = getActiveSessionId();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    const load = () =>
      api
        .getSessionStats(sessionId)
        .then(({ session }) => !cancelled && setSessionStats(session))
        .catch(() => {});
    load();
    const id = setInterval(load, SESSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, call?.id]);

  const cost = estimateCents(call, spend, now);
  let startedAt = null;
  try {
    startedAt = Number(localStorage.getItem(SESSION_STARTED_AT_KEY)) || null;
  } catch {
    /* storage unavailable: no session time */
  }

  return (
    <p className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs uppercase tabular-nums text-muted-foreground" data-testid="call-cost-row">
      <span>
        Est. cost{' '}
        <span className="text-foreground">
          {spend && !spend.ratesSet ? 'rates not set' : cost === null ? '—' : formatCents(cost, { precise: true })}
        </span>
      </span>
      {sessionId && startedAt && (
        <span>
          Session <span className="text-foreground">{formatDuration(Math.max(0, Math.floor((now - startedAt) / 1000)))}</span>
        </span>
      )}
      {sessionId && sessionStats && (
        <span>
          Dials <span className="text-foreground">{sessionStats.total_dials}</span>
        </span>
      )}
    </p>
  );
}
