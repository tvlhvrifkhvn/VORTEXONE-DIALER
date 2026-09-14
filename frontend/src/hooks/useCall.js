import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';

const POLL_MS = 600;
const AUTO_ADVANCE_DELAY_MS = 900; // lets the rep see the "logged as X" confirmation flash first
export const DIAL_MODE_KEY = 'vortex_dialer_dial_mode';
export const SESSION_START_KEY = 'vortex_dialer_session_start';
export const SESSION_STATS_KEY = 'vortex_dialer_session_stats';

const EMPTY_SESSION_STATS = { dials: 0, contacts: 0, voicemails: 0, noAnswers: 0, callbacks: 0 };

/** Reads the in-progress dialing session's stats, or null if none is active. */
export function getActiveSession() {
  const startedAt = localStorage.getItem(SESSION_START_KEY);
  if (!startedAt) return null;
  let stats = EMPTY_SESSION_STATS;
  try {
    stats = { ...EMPTY_SESSION_STATS, ...JSON.parse(localStorage.getItem(SESSION_STATS_KEY) || '{}') };
  } catch {
    // ignore malformed localStorage, fall back to zeros
  }
  return { startedAt: Number(startedAt), stats };
}

/** Starts (or restarts) a dialing session, used by the Dashboard's Start Dialing button. */
export function startSession() {
  localStorage.setItem(SESSION_START_KEY, String(Date.now()));
  localStorage.setItem(SESSION_STATS_KEY, JSON.stringify(EMPTY_SESSION_STATS));
}

/** Ends the current dialing session, clearing its tracked stats. */
export function endSession() {
  localStorage.removeItem(SESSION_START_KEY);
  localStorage.removeItem(SESSION_STATS_KEY);
}

function bumpSessionStat(disposition) {
  if (!localStorage.getItem(SESSION_START_KEY)) return;
  let stats = EMPTY_SESSION_STATS;
  try {
    stats = { ...EMPTY_SESSION_STATS, ...JSON.parse(localStorage.getItem(SESSION_STATS_KEY) || '{}') };
  } catch {
    // ignore malformed localStorage, fall back to zeros
  }
  stats.dials += 1;
  if (disposition === 'contacted') stats.contacts += 1;
  else if (disposition === 'voicemail') stats.voicemails += 1;
  else if (disposition === 'no_answer') stats.noAnswers += 1;
  else if (disposition === 'callback_scheduled') stats.callbacks += 1;
  localStorage.setItem(SESSION_STATS_KEY, JSON.stringify(stats));
}

/**
 * Drives one call screen visit: starts the call (locks the lead + places it
 * via the configured telephony adapter), polls for live progress, and wraps
 * hangup/disposition/undo. See telephony/index.js on the backend for what
 * "live progress" means — this hook just reflects call_history as polled.
 */
export function useCall(leadId) {
  const navigate = useNavigate();
  const [call, setCall] = useState(null);
  const [lead, setLead] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [undoInfo, setUndoInfo] = useState(null); // { callId, expiresAt }
  const pollRef = useRef(null);
  const undoTimeoutRef = useRef(null);
  const autoAdvanceTimeoutRef = useRef(null);

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

  useEffect(() => {
    let cancelled = false;
    setStarting(true);
    setError(null);
    setUndoInfo(null);

    api
      .startCall(leadId)
      .then(({ call: newCall, lead: newLead }) => {
        if (cancelled) return;
        setCall(newCall);
        setLead(newLead);
        pollCall(newCall.id);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });

    return () => {
      cancelled = true;
      stopPolling();
      clearTimeout(undoTimeoutRef.current);
      clearTimeout(autoAdvanceTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const hangup = useCallback(async () => {
    if (!call) return;
    stopPolling();
    await api.hangupCall(call.id);
  }, [call, stopPolling]);

  const submitDisposition = useCallback(
    async ({ disposition, note, scheduledAt }) => {
      if (!call) return null;
      stopPolling();
      const result = await api.submitDisposition({ callId: call.id, disposition, note, scheduledAt });
      setLead(result.lead);
      bumpSessionStat(disposition);

      const callId = call.id;
      const expiresAt = result.undoExpiresAt;
      setUndoInfo({ callId, expiresAt });
      clearTimeout(undoTimeoutRef.current);
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      undoTimeoutRef.current = setTimeout(() => {
        setUndoInfo((current) => (current && current.callId === callId ? null : current));
      }, Math.max(0, remainingMs));

      // Power Dial mode: jump straight to the next in_queue lead's call
      // screen instead of waiting on the dashboard/"Next Lead" click.
      if (localStorage.getItem(DIAL_MODE_KEY) === 'power') {
        clearTimeout(autoAdvanceTimeoutRef.current);
        autoAdvanceTimeoutRef.current = setTimeout(() => {
          navigate('/call/next');
        }, AUTO_ADVANCE_DELAY_MS);
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

  return { call, lead, error, starting, undoInfo, hangup, submitDisposition, undo };
}
