import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';

const POLL_MS = 600;

/**
 * Drives one call screen visit: starts the call (locks the lead + places it
 * via the configured telephony adapter), polls for live progress, and wraps
 * hangup/disposition/undo. See telephony/index.js on the backend for what
 * "live progress" means — this hook just reflects call_history as polled.
 */
export function useCall(leadId) {
  const [call, setCall] = useState(null);
  const [lead, setLead] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);
  const [undoInfo, setUndoInfo] = useState(null); // { callId, expiresAt }
  const pollRef = useRef(null);
  const undoTimeoutRef = useRef(null);

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

      const callId = call.id;
      const expiresAt = result.undoExpiresAt;
      setUndoInfo({ callId, expiresAt });
      clearTimeout(undoTimeoutRef.current);
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      undoTimeoutRef.current = setTimeout(() => {
        setUndoInfo((current) => (current && current.callId === callId ? null : current));
      }, Math.max(0, remainingMs));

      return result;
    },
    [call, stopPolling]
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
