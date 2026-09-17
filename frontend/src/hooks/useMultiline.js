import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { getActiveSessionId } from './useCall';

const SLOT_COUNT = 3;

function emptySlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    slotNumber: i + 1,
    lead: null,
    status: 'idle',
    duration: 0,
    message: null,
  }));
}

/**
 * Drives the 3-line panel: opens the server-sent events stream, folds each
 * event into per-slot state, and ticks the timer on whichever line is live.
 * Unlike single-line dialing (useCall.js, which polls one call), all three
 * lines here are pushed from the backend over one connection.
 */
export function useMultiline({ enabled = true } = {}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState(emptySlots);
  const [connected, setConnected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const source = api.openCallStream();
    if (!source) {
      setError('Not signed in — cannot open the live call stream.');
      return undefined;
    }
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      let payload;
      try {
        payload = JSON.parse(e.data);
      } catch {
        return;
      }

      setLines((prev) =>
        prev.map((line) => {
          if (line.slotNumber !== payload.slotNumber) return line;
          return {
            slotNumber: payload.slotNumber,
            lead: payload.leadId
              ? {
                  id: payload.leadId,
                  name: payload.leadName,
                  brokerage: payload.brokerage,
                  phone: payload.phone,
                  state: payload.state,
                }
              : null,
            status: payload.status,
            // Only an answered line carries a running timer; everything else
            // resets it so a refilled slot doesn't inherit the last call's.
            duration: payload.status === 'answered' ? payload.duration || 0 : 0,
            message: payload.message || null,
          };
        })
      );
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [enabled]);

  // Live timer for whichever line is connected.
  useEffect(() => {
    const hasAnswered = lines.some((l) => l.status === 'answered');
    if (!hasAnswered) return undefined;

    const id = setInterval(() => {
      setLines((prev) =>
        prev.map((l) => (l.status === 'answered' ? { ...l, duration: l.duration + 1 } : l))
      );
    }, 1000);
    return () => clearInterval(id);
  }, [lines]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      setLines(emptySlots());
      await api.startMultiline(getActiveSessionId());
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }, []);

  const dropLine = useCallback(async (slotNumber) => {
    try {
      await api.dropMultilineSlot(slotNumber);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  /** Hand the live line off to the existing single-line call screen. */
  const takeCall = useCallback(
    async (slotNumber) => {
      try {
        const { leadId } = await api.takeMultilineCall(slotNumber);
        navigate(`/call/${leadId}`);
      } catch (err) {
        setError(err.message);
      }
    },
    [navigate]
  );

  const stopSession = useCallback(async () => {
    try {
      const result = await api.stopMultiline();
      setLines(emptySlots());
      return result;
    } catch (err) {
      setError(err.message);
      return { abandonedCount: 0 };
    }
  }, []);

  return { lines, connected, starting, error, start, takeCall, dropLine, stopSession };
}
