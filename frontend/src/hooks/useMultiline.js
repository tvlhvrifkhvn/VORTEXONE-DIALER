import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { getActiveSessionId } from './useCall';

const SLOT_COUNT = 3;

function emptySlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({
    slotNumber: i + 1,
    callId: null,
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
  // Pre-call briefs keyed by callId, fetched the moment a line starts
  // dialing so whichever line answers already has its brief loaded.
  const [briefs, setBriefs] = useState({});
  const briefRequestedRef = useRef(new Set());

  const prefetchBrief = useCallback((payload) => {
    const { callId, leadId, status } = payload;
    if (!callId || !leadId || briefRequestedRef.current.has(callId)) return;
    if (!['dialing', 'ringing', 'answered', 'held'].includes(status)) return;
    briefRequestedRef.current.add(callId);
    // Instant line first, then the (possibly slower) AI version.
    const store = (b) => setBriefs((prev) => ({ ...prev, [callId]: { instant: b.instant, ai: b.ai || prev[callId]?.ai || null } }));
    api.getLeadBrief(leadId, { withAi: false }).then(store).catch(() => {});
    api.getLeadBrief(leadId).then(store).catch(() => {});
  }, []);

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

      prefetchBrief(payload);

      setLines((prev) =>
        prev.map((line) => {
          if (line.slotNumber !== payload.slotNumber) return line;
          const timed = payload.status === 'answered' || payload.status === 'held';
          return {
            slotNumber: payload.slotNumber,
            callId: payload.callId ?? null,
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
            // An answered or held line carries a running timer; everything
            // else resets it so a refilled slot doesn't inherit the last
            // call's.
            duration: timed ? payload.duration || 0 : 0,
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
  }, [enabled, prefetchBrief]);

  // Live timer for any connected line — including one on hold, where the
  // caller is genuinely waiting and the rep should see how long for.
  useEffect(() => {
    const TIMED = ['answered', 'held'];
    const hasLive = lines.some((l) => TIMED.includes(l.status));
    if (!hasLive) return undefined;

    const id = setInterval(() => {
      setLines((prev) =>
        prev.map((l) => (TIMED.includes(l.status) ? { ...l, duration: l.duration + 1 } : l))
      );
    }, 1000);
    return () => clearInterval(id);
  }, [lines]);

  const start = useCallback(async (lineCount, leadIds) => {
    setStarting(true);
    setError(null);
    try {
      setLines(emptySlots());
      await api.startMultiline(getActiveSessionId(), lineCount, leadIds);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }, []);

  /**
   * Submits the disposition for the line the rep is on, then tells the
   * backend to free that slot — which promotes any held live call to be
   * handled next before dialing a new lead in.
   */
  const submitDispositionFor = useCallback(async (line, { disposition, note }) => {
    if (!line?.callId) throw new Error('That line is no longer active.');
    await api.submitDisposition({ callId: line.callId, disposition, note });
    await api.releaseMultilineSlot(line.slotNumber);
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

  const linesWithBriefs = lines.map((line) => ({ ...line, brief: (line.callId && briefs[line.callId]) || null }));

  return { lines: linesWithBriefs, connected, starting, error, start, takeCall, dropLine, stopSession, submitDispositionFor };
}
