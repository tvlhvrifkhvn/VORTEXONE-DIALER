import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';

const POLL_MS = 600;
export const DIAL_MODE_KEY = 'vortex_dialer_dial_mode';
export const SESSION_ID_KEY = 'vortex_dialer_session_id';
export const SESSION_STARTED_AT_KEY = 'vortex_dialer_session_started_at';
export const SESSION_PAUSED_KEY = 'vortex_dialer_session_paused';
export const BETWEEN_CALL_DELAY_KEY = 'vortex_dialer_between_call_delay';
const DEFAULT_BETWEEN_CALL_DELAY_SECONDS = 5;

/** Backend-tracked dialing session id, or null if none is active. */
export function getActiveSessionId() {
  const id = localStorage.getItem(SESSION_ID_KEY);
  return id ? Number(id) : null;
}

export function isSessionPaused() {
  return localStorage.getItem(SESSION_PAUSED_KEY) === 'true';
}

export function setSessionPaused(paused) {
  if (paused) localStorage.setItem(SESSION_PAUSED_KEY, 'true');
  else localStorage.removeItem(SESSION_PAUSED_KEY);
}

function getBetweenCallDelaySeconds() {
  const stored = Number(localStorage.getItem(BETWEEN_CALL_DELAY_KEY));
  return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_BETWEEN_CALL_DELAY_SECONDS;
}

/** Starts a backend dialing session (Dashboard's Start Dialing button). */
export async function startDialingSession(mode = 'power') {
  const { sessionId } = await api.startSession(mode);
  localStorage.setItem(SESSION_ID_KEY, String(sessionId));
  localStorage.setItem(SESSION_STARTED_AT_KEY, String(Date.now()));
  setSessionPaused(false);
  return sessionId;
}

/** Ends the active dialing session and returns its final stats (Dashboard's
 * Stop Dialing button uses these to populate the session summary modal). */
export async function endDialingSession() {
  const sessionId = getActiveSessionId();
  if (!sessionId) return null;
  const { stats } = await api.endSession(sessionId);
  localStorage.removeItem(SESSION_ID_KEY);
  localStorage.removeItem(SESSION_STARTED_AT_KEY);
  setSessionPaused(false);
  return stats;
}

/**
 * Drives one call screen visit: starts the call (locks the lead + places it
 * via the configured telephony adapter), polls for live progress, and wraps
 * hangup/disposition/undo/redial. See telephony/index.js on the backend for
 * what "live progress" means — this hook just reflects call_history as
 * polled.
 */
export function useCall(leadId) {
  const navigate = useNavigate();
  const [call, setCall] = useState(null);
  const [lead, setLead] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [undoInfo, setUndoInfo] = useState(null); // { callId, expiresAt }
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(null); // null = no countdown running
  const pollRef = useRef(null);
  const undoTimeoutRef = useRef(null);
  const autoAdvanceIntervalRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollCall = useCallback(
    (callId) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const { call: latest } = await api.getCall(callId);
          setCall(latest);
          if (latest.telephony_state === 'ended') stopPolling();
        } catch {
          stopPolling();
        }
      }, POLL_MS);
    },
    [stopPolling]
  );

  const startCallFor = useCallback(
    (id) => {
      setStarting(true);
      setError(null);
      setUndoInfo(null);
      return api
        .startCall(id, getActiveSessionId())
        .then(({ call: newCall, lead: newLead }) => {
          setCall(newCall);
          setLead(newLead);
          pollCall(newCall.id);
        })
        .catch((err) => {
          setError(err.message);
        })
        .finally(() => {
          setStarting(false);
        });
    },
    [pollCall]
  );

  useEffect(() => {
    let cancelled = false;
    startCallFor(leadId).then(() => {
      if (cancelled) stopPolling();
    });

    return () => {
      cancelled = true;
      stopPolling();
      clearTimeout(undoTimeoutRef.current);
      clearInterval(autoAdvanceIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const hangup = useCallback(async () => {
    if (!call) return;
    stopPolling();
    await api.hangupCall(call.id);
  }, [call, stopPolling]);

  /** Redials the same lead immediately, before any disposition has been
   * submitted on the previous attempt (backend allows re-locking a lead
   * that's already in_progress and locked to this same user). */
  const redial = useCallback(() => {
    if (!lead) return Promise.resolve();
    return startCallFor(lead.id);
  }, [lead, startCallFor]);

  const cancelAutoAdvance = useCallback(() => {
    clearInterval(autoAdvanceIntervalRef.current);
    setAutoAdvanceSeconds(null);
  }, []);

  const submitDisposition = useCallback(
    async ({ disposition, note, scheduledAt }) => {
      if (!call) return null;
      stopPolling();
      const result = await api.submitDisposition({ callId: call.id, disposition, note, scheduledAt });
      setLead(result.lead);

      const callId = call.id;
      const expiresAt = result.undoExpiresAt;
      setUndoInfo({ callId, expiresAt });
      clearTimeout(undoTimeoutRef.current);
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      undoTimeoutRef.current = setTimeout(() => {
        setUndoInfo((current) => (current && current.callId === callId ? null : current));
      }, Math.max(0, remainingMs));

      // Power Dial mode: count down, then jump straight to the next in_queue
      // lead's call screen instead of waiting on the dashboard/"Next Lead"
      // click — unless the session is paused, in which case just stop here.
      if (localStorage.getItem(DIAL_MODE_KEY) === 'power' && !isSessionPaused()) {
        const delay = getBetweenCallDelaySeconds();
        clearInterval(autoAdvanceIntervalRef.current);
        if (delay <= 0) {
          navigate('/call/next');
        } else {
          setAutoAdvanceSeconds(delay);
          autoAdvanceIntervalRef.current = setInterval(() => {
            setAutoAdvanceSeconds((secs) => {
              if (secs <= 1) {
                clearInterval(autoAdvanceIntervalRef.current);
                navigate('/call/next');
                return null;
              }
              return secs - 1;
            });
          }, 1000);
        }
      }

      return result;
    },
    [call, stopPolling, navigate]
  );

  const undo = useCallback(async () => {
    if (!undoInfo) return;
    clearTimeout(undoTimeoutRef.current);
    const { lead: restoredLead } = await api.undoDisposition(undoInfo.callId);
    setLead(restoredLead);
    setUndoInfo(null);
  }, [undoInfo]);

  return {
    call,
    lead,
    error,
    starting,
    undoInfo,
    hangup,
    submitDisposition,
    undo,
    redial,
    autoAdvanceSeconds,
    cancelAutoAdvance,
  };
}
