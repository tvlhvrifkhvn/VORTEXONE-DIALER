const { EventEmitter } = require('events');
const db = require('../db');
const telephony = require('../telephony');
const leadQueue = require('./leadQueue');
const leadLifecycle = require('./leadLifecycle');
const callLifecycle = require('./callLifecycle');
const dialingSession = require('./dialingSession');
const dncCheck = require('./dncCheck');
const { ApiError } = require('../middleware/errorHandler');
const { normalizePhone } = require('../utils/phoneNormalize');

// Reserved-for-fiction NANP range (555-0100 through 555-0199) — safe
// placeholder until phone_numbers is populated with real numbers in phase 2.
const MOCK_FROM_NUMBER = '+15555550100';

const MULTILINE_SLOTS = 3;

// What the rep sees when the telephony provider refuses a dial.
const DIAL_FAILED_MESSAGE =
  "The call couldn't be placed — the phone service returned an error. No attempt was counted and the lead is free again.";
// Multi-line: after this many refused dials in a row the session stops
// dialing (instead of locking and releasing the whole queue one by one).
const MAX_CONSECUTIVE_DIAL_FAILURES = 3;

/** Sets a call's telephony_state from an adapter event, unless the dial was marked failed. */
function recordState(callId, state) {
  return db.query(`UPDATE call_history SET telephony_state = $2 WHERE id = $1 AND telephony_state <> 'failed'`, [callId, state]);
}

/**
 * The adapter's placeCall threw (or rejected): the dial never happened.
 * Close the call row as 'failed' and, for a lead, take back the attempt and
 * release the lock to the lead's previous status (leadLifecycle).
 */
async function cleanUpFailedDial({ call, lead = null, userId, err }) {
  console.warn(`Dial failed for call ${call.id}${lead ? ` (lead ${lead.id})` : ''}: ${err.message}`);
  await callLifecycle.markFailed(call.id);
  if (lead) {
    await leadLifecycle.releaseAfterFailedDial({ leadId: lead.id, userId, previousStatus: lead.previous_status || 'in_progress' });
  }
}

/**
 * Live call status feed for multi-line dialing. routes/calls.js's SSE
 * endpoint subscribes to this and forwards each event to the browser, which
 * is how three lines can show real-time progress without three pollers.
 * Single-line dialing still polls GET /api/calls/:id and is unaffected.
 *
 * Event payload: { userId, slotNumber, leadId, leadName, brokerage, phone,
 * state, status, duration }.
 */
const callEvents = new EventEmitter();
// One listener per open SSE connection; a rep with several tabs open is
// normal, so don't warn at Node's default cap of 10.
callEvents.setMaxListeners(0);

/**
 * Starts a telephony call for an already-locked lead and records it. All
 * live progress (ringing/answered/voicemail_detected/ended) is persisted to
 * the call_history row as it arrives so the call screen can just poll
 * GET /api/calls/:id — no in-memory state, nothing lost on a restart.
 */
async function start({ lead, userId, sessionId = null }) {
  const fromNumber = MOCK_FROM_NUMBER;

  const { rows } = await db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state, session_id)
     VALUES ($1, $2, $3, true, 'ringing', $4)
     RETURNING *`,
    [lead.id, userId, fromNumber, sessionId]
  );
  const call = rows[0];

  await db.query('UPDATE leads SET attempts = attempts + 1, updated_at = now() WHERE id = $1', [lead.id]);

  let telephonyCallId;
  try {
    telephonyCallId = await telephony.placeCall(fromNumber, lead.phone, (event) => {
      const nextState = event.type; // 'ringing' | 'answered' | 'voicemail_detected' | 'ended'
      const write = nextState === 'ended' ? callLifecycle.markEnded(call.id, event.duration) : recordState(call.id, nextState);
      write.catch((err) => {
        console.error(`Failed to record telephony event "${event.type}" for call ${call.id}:`, err.message);
      });
    });
  } catch (err) {
    await cleanUpFailedDial({ call, lead, userId, err });
    throw new ApiError(502, DIAL_FAILED_MESSAGE);
  }

  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);

  return { ...call, telephony_call_id: telephonyCallId, attempts: lead.attempts + 1 };
}

async function get(callHistoryId) {
  const { rows } = await db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Manual dial pad — an ad-hoc call to a typed-in number, not tied to any
// lead. Deliberately separate from start() above (same reasoning as
// placeSlotCall below): no lead to lock, no attempts to increment, no
// disposition workflow — just place the call and record it.
// ---------------------------------------------------------------------------

/**
 * Places a manual call. Rejects a number that doesn't resolve to a valid US
 * NANP number, and — same as multi-line dialing (see reserveSlot) — a number
 * already on the DNC list, so the dial pad can't be used to route around
 * that protection.
 */
async function startManual({ userId, toNumberRaw }) {
  const toNumber = normalizePhone(toNumberRaw);
  if (!toNumber) throw new ApiError(400, 'Enter a valid 10-digit US phone number');

  if (await dncCheck.isOnDncList(toNumber)) {
    throw new ApiError(409, 'This number is on the DNC list and cannot be dialed');
  }

  const fromNumber = MOCK_FROM_NUMBER;

  const { rows } = await db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, to_number, is_manual, was_mock, telephony_state)
     VALUES (NULL, $1, $2, $3, true, true, 'ringing')
     RETURNING *`,
    [userId, fromNumber, toNumber]
  );
  const call = rows[0];

  let telephonyCallId;
  try {
    telephonyCallId = await telephony.placeCall(fromNumber, toNumber, (event) => {
      const write = event.type === 'ended' ? callLifecycle.markEnded(call.id, event.duration) : recordState(call.id, event.type);
      write.catch((err) => {
        console.error(`Failed to record telephony event "${event.type}" for manual call ${call.id}:`, err.message);
      });
    });
  } catch (err) {
    await cleanUpFailedDial({ call, userId, err });
    throw new ApiError(502, "The call couldn't be placed — the phone service returned an error.");
  }

  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);

  return { ...call, telephony_call_id: telephonyCallId };
}

/** Ends a manual call — no lead to release, no disposition, just close out
 * the call_history row (mirrors leadLifecycle.hangup's timing logic). */
async function endManualCall(callHistoryId, user) {
  const call = await get(callHistoryId);
  if (!call) throw new ApiError(404, 'Call not found');
  callLifecycle.assertCanActOn(call, user);

  if (!call.ended_at) {
    const now = new Date();
    const durationSeconds = Math.max(0, Math.round((now - new Date(call.started_at)) / 1000));
    await db.query(
      `UPDATE call_history SET ended_at = $2, duration_seconds = $3, telephony_state = 'ended' WHERE id = $1`,
      [callHistoryId, now, durationSeconds]
    );
  }

  return get(callHistoryId);
}

// ---------------------------------------------------------------------------
// Multi-line (3-line) dialing
// ---------------------------------------------------------------------------

// In-memory state for the lines currently up, keyed by user. Everything that
// matters is still persisted to call_history as it happens (same as
// single-line); this map only tracks which slot is on which call right now so
// events can be routed and slots refilled. A restart drops the lines, and
// leadQueue.releaseStaleLocks() returns their leads to the queue.
const multilineSessions = new Map();

function emitSlot(session, slot, status, extra = {}) {
  const lead = slot.lead || {};
  callEvents.emit('call', {
    userId: session.userId,
    sessionId: session.sessionId,
    slotNumber: slot.slotNumber,
    callId: slot.callId ?? null,
    leadId: lead.id ?? null,
    leadName: lead.name ?? null,
    brokerage: lead.brokerage ?? null,
    phone: lead.phone ?? null,
    extension: lead.extension ?? null,
    state: lead.state ?? null,
    duration: null,
    status,
    ...extra,
  });
}

/**
 * Places one call for a multi-line slot. Deliberately separate from start()
 * above rather than a refactor of it: single-line dialing is working code and
 * stays on exactly the path it has always used. The differences here are the
 * slot_number column and routing every telephony event through callEvents.
 */
async function placeSlotCall(session, slot) {
  const { lead, slotNumber } = slot;
  const fromNumber = MOCK_FROM_NUMBER;

  const { rows } = await db.query(
    `INSERT INTO call_history (lead_id, user_id, from_number, was_mock, telephony_state, session_id, slot_number)
     VALUES ($1, $2, $3, true, 'ringing', $4, $5)
     RETURNING *`,
    [lead.id, session.userId, fromNumber, session.sessionId, slotNumber]
  );
  const call = rows[0];
  slot.callId = call.id;

  await db.query('UPDATE leads SET attempts = attempts + 1, updated_at = now() WHERE id = $1', [lead.id]);
  if (session.sessionId) {
    await dialingSession.incrementStat(session.sessionId, 'total_dials').catch(() => {});
  }

  slot.status = 'dialing';
  emitSlot(session, slot, 'dialing');

  let telephonyCallId;
  try {
    telephonyCallId = await telephony.placeCall(fromNumber, lead.phone, (event) => {
      // The mock adapter keeps firing timers for a call we've already moved
      // past (dropped, or the slot refilled) — ignore anything that isn't for
      // the call this slot is currently on.
      const current = session.slots.get(slotNumber);
      if (session.stopped || !current || current.callId !== call.id) return;

      const write = event.type === 'ended' ? callLifecycle.markEnded(call.id, event.duration) : recordState(call.id, event.type);
      write.catch((err) => {
        console.error(`Failed to record telephony event "${event.type}" for call ${call.id}:`, err.message);
      });

      handleSlotEvent(session, current, event).catch((err) => {
        console.error(`Multi-line slot ${slotNumber} failed handling "${event.type}":`, err.message);
      });
    });
  } catch (err) {
    // The dial never happened: no phantom call, no attempt, no stat, lead released.
    await cleanUpFailedDial({ call, lead, userId: session.userId, err });
    if (session.sessionId) await dialingSession.decrementStat(session.sessionId, 'total_dials').catch(() => {});
    session.slots.delete(slotNumber);
    session.dialFailures += 1;
    slot.status = 'failed';
    emitSlot(session, slot, 'failed', { message: DIAL_FAILED_MESSAGE });
    return false;
  }

  session.dialFailures = 0;
  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);
  return true;
}

async function handleSlotEvent(session, slot, event) {
  if (event.type === 'ringing') {
    slot.status = 'ringing';
    emitSlot(session, slot, 'ringing');
    return;
  }

  if (event.type === 'answered') {
    slot.answeredAt = Date.now();

    // The rep can only talk to one person at a time. A second live answer is
    // NOT dropped — a real human who picked up must never be logged as
    // abandoned just because the rep was mid-conversation. It waits as
    // 'held' and is presented as soon as the current disposition is
    // submitted (see releaseActiveSlot).
    if (session.activeSlot != null && session.activeSlot !== slot.slotNumber) {
      slot.status = 'held';
      emitSlot(session, slot, 'held', { duration: 0 });
      return;
    }

    session.activeSlot = slot.slotNumber;
    slot.status = 'active_disposition';
    emitSlot(session, slot, 'answered', { duration: 0 });
    return;
  }

  if (event.type === 'voicemail_detected') {
    slot.status = 'voicemail';
    emitSlot(session, slot, 'voicemail');
    await releaseSlot(session, slot, 'voicemail');
    return;
  }

  // Busy is resolved exactly like voicemail/no_answer: count the attempt,
  // free the slot, dial the next lead.
  if (event.type === 'busy') {
    slot.status = 'busy';
    emitSlot(session, slot, 'busy');
    await releaseSlot(session, slot, 'no_answer');
    return;
  }

  if (event.type === 'ended') {
    // A line the rep is on (or holding) ends when they disposition it, and
    // voicemail/busy lines were already released above — none of those are a
    // no-answer.
    if (['active_disposition', 'held', 'voicemail', 'busy'].includes(slot.status)) return;
    slot.status = 'no_answer';
    emitSlot(session, slot, 'no_answer', { duration: event.duration ?? null });
    await releaseSlot(session, slot, 'no_answer');
  }
}

/**
 * A line finished without a human: record the outcome through the existing
 * lifecycle rules (attempts, 4h requeue, cold at max_attempts), then pull the
 * next queued lead into the freed slot so three lines stay live.
 */
async function releaseSlot(session, slot, disposition) {
  try {
    await leadLifecycle.applyDisposition({ callHistoryId: slot.callId, disposition });
  } catch (err) {
    console.error(`Multi-line slot ${slot.slotNumber} disposition failed:`, err.message);
  }

  if (session.stopped) return;
  session.slots.delete(slot.slotNumber);
  await queueRefill(session, slot.slotNumber);
}

/**
 * The rep just submitted a disposition for the line they were on. Promote a
 * held call to be presented next — before dialing anything new into the
 * freed slot, so a real person who is already waiting always jumps the queue.
 */
async function releaseActiveSlot(userId, slotNumber) {
  const session = multilineSessions.get(userId);
  if (!session) return { promoted: null };

  const finished = session.slots.get(Number(slotNumber));
  if (finished) session.slots.delete(finished.slotNumber);
  if (session.activeSlot === Number(slotNumber)) session.activeSlot = null;

  // Any line still holding a live person is presented next.
  const held = [...session.slots.values()]
    .filter((s) => s.status === 'held')
    .sort((a, b) => (a.answeredAt || 0) - (b.answeredAt || 0))[0];

  if (held) {
    session.activeSlot = held.slotNumber;
    held.status = 'active_disposition';
    emitSlot(session, held, 'answered', {
      duration: held.answeredAt ? Math.round((Date.now() - held.answeredAt) / 1000) : 0,
      promotedFromHold: true,
    });
  }

  // Refill the slot the rep just finished with.
  if (finished && !session.stopped) {
    await queueRefill(session, finished.slotNumber);
  }

  return { promoted: held ? held.slotNumber : null };
}

/**
 * Marks every other active line abandoned. Ending a call from the app side
 * isn't part of the TelephonyAdapter interface (see telephony/index.js) — the
 * caller just stops acting on further events, which the stale-call guard in
 * placeSlotCall() does. Here we close out the DB row and hand the lead back
 * to the queue so it isn't stranded in_progress.
 */
// Statuses where the line is genuinely still up and worth dropping. A line
// that already came back voicemail/no_answer has been dispositioned properly
// and must not be recounted as abandoned.
const DROPPABLE_STATUSES = ['dialing', 'ringing'];

async function dropOtherSlots(session, keepSlotNumber) {
  const others = [...session.slots.values()].filter((s) => s.slotNumber !== keepSlotNumber);

  for (const slot of others) {
    session.slots.delete(slot.slotNumber);
    if (!slot.callId || !DROPPABLE_STATUSES.includes(slot.status)) continue;
    await abandonSlotCall(session, slot);
  }
}

async function abandonSlotCall(session, slot) {
  let abandoned = false;
  try {
    // disposition IS NULL guards against clobbering a call that finished on
    // its own a moment before the drop landed.
    const { rowCount } = await db.query(
      `UPDATE call_history
       SET was_abandoned = true, ended_at = now(),
           duration_seconds = COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int))
       WHERE id = $1 AND disposition IS NULL`,
      [slot.callId]
    );
    abandoned = rowCount > 0;

    if (abandoned) {
      await leadLifecycle.releaseAbandoned(slot.lead.id);
      session.abandonedCount += 1;
    }
  } catch (err) {
    console.error(`Failed to abandon multi-line slot ${slot.slotNumber}:`, err.message);
  }

  if (abandoned) {
    slot.status = 'dropped';
    emitSlot(session, slot, 'dropped');
  }
}

/**
 * Locks the next queued lead into a slot, without dialing yet. Callers must
 * await these one at a time: leadQueue.lockNext() reads the queue and then
 * marks the lead in_progress, so three concurrent calls all read before any
 * of them write and every line ends up on the same lead.
 */
async function reserveSlot(session, slotNumber) {
  if (session.stopped) return null;

  const placeholder = { slotNumber, lead: {}, status: 'loading', callId: null };
  emitSlot(session, placeholder, 'loading');

  // A DNC number must never be dialed. The import already blocks them, but a
  // lead can be added to the list after import (a rep pressing DNC on an
  // earlier call), so re-check right before dialing and skip past any that
  // slipped through.
  const MAX_DNC_SKIPS = 25;
  for (let attempt = 0; attempt < MAX_DNC_SKIPS; attempt++) {
    let lead;

    if (session.leadIds) {
      // A rep-selected list is driving this session (see startMultilineSession)
      // — dial only from it, in order, and never fall back to the general
      // queue once a selection was explicitly given.
      if (session.leadIds.length === 0) {
        emitSlot(session, placeholder, 'idle', { message: 'No more selected leads to dial.' });
        return null;
      }
      const nextId = session.leadIds.shift();
      try {
        lead = await leadQueue.lockNext({ userId: session.userId, leadId: nextId });
      } catch (err) {
        // That specific lead is no longer dialable (handled since selection,
        // DNC'd, outside calling hours, etc.) — move to the next selected id
        // rather than treating it as the whole line stopping.
        continue;
      }
    } else {
      try {
        // Reuses the existing queue + calling-hours logic exactly as
        // single-line dialing does.
        lead = await leadQueue.lockNext({ userId: session.userId });
      } catch (err) {
        // Queue exhausted, or nothing dialable inside calling hours right now.
        emitSlot(session, placeholder, 'idle', { message: err.message });
        return null;
      }
    }

    if (await dncCheck.isOnDncList(lead.phone)) {
      console.log(`Multi-line: skipping lead ${lead.id} — number is on the DNC list`);
      await db.query(
        `UPDATE leads SET status = 'dnc', dnc_flag = true, locked_by = NULL, locked_at = NULL, updated_at = now()
         WHERE id = $1`,
        [lead.id]
      );
      session.dncSkipped += 1;
      continue;
    }

    const slot = { slotNumber, lead, status: 'dialing', callId: null, answeredAt: null };
    session.slots.set(slotNumber, slot);
    return slot;
  }

  const skipMessage = session.leadIds
    ? 'Too many selected leads were skipped in a row (already handled or not dialable) — stopping this line.'
    : 'Too many DNC numbers in a row — stopping this line.';
  emitSlot(session, placeholder, 'idle', { message: skipMessage });
  return null;
}

/** Refills one freed slot: reserve a lead, then dial it. A refused dial is
 * retried with the next lead, until MAX_CONSECUTIVE_DIAL_FAILURES in a row
 * stop the line with a plain message. */
async function dialIntoSlot(session, slotNumber) {
  for (;;) {
    if (session.stopped) return;
    if (session.dialFailures >= MAX_CONSECUTIVE_DIAL_FAILURES) {
      emitSlot(session, { slotNumber, lead: {}, callId: null }, 'idle', {
        message: `Stopped dialing: the phone service refused ${session.dialFailures} calls in a row. Check the phone settings, then start again.`,
      });
      return;
    }
    const slot = await reserveSlot(session, slotNumber);
    if (!slot) return;
    if (await placeSlotCall(session, slot)) return;
  }
}

/**
 * Every refill of a session goes through one promise chain, so refills run
 * one at a time even when several lines free up in the same instant (the
 * "await these one at a time" rule from reserveSlot). A failed refill is
 * logged and never breaks the chain for the refills queued after it.
 */
function queueRefill(session, slotNumber) {
  session.refillChain = session.refillChain
    .then(() => dialIntoSlot(session, slotNumber))
    .catch((err) => {
      console.error(`Multi-line refill of slot ${slotNumber} failed:`, err.message);
    });
  return session.refillChain;
}

/**
 * Opens `lineCount` lines at once for a rep (1-3, chosen on the dashboard).
 * Returns immediately after the dials are placed — progress arrives over
 * callEvents (SSE), not as a response body.
 *
 * selectedLeadIds, when given, constrains the whole session to dial only
 * those leads (the dashboard's checkbox selection), in the same priority
 * order the regular queue would use (leadQueue.batchQueue — the same helper
 * the older single-line selected-power-dial flow already used). Omitted or
 * empty, the session dials the general queue exactly as before.
 */
async function startMultilineSession(userId, sessionId, lineCount = MULTILINE_SLOTS, selectedLeadIds = null) {
  await stopMultilineSession(userId);

  const lines = Math.min(MULTILINE_SLOTS, Math.max(1, Number(lineCount) || MULTILINE_SLOTS));

  let orderedLeadIds = null;
  if (Array.isArray(selectedLeadIds) && selectedLeadIds.length > 0) {
    const ordered = await leadQueue.batchQueue(selectedLeadIds);
    orderedLeadIds = ordered.map((lead) => lead.id);
  }

  const session = {
    userId,
    sessionId: sessionId || null,
    slots: new Map(),
    stopped: false,
    activeSlot: null,
    abandonedCount: 0,
    dncSkipped: 0,
    lineCount: lines,
    leadIds: orderedLeadIds,
    refillChain: Promise.resolve(), // see queueRefill
    dialFailures: 0, // refused dials in a row (see dialIntoSlot)
  };
  multilineSessions.set(userId, session);

  // Reserve the leads one at a time (see reserveSlot on why), then fire all
  // the calls together so the lines genuinely ring in parallel.
  const reserved = [];
  for (let slotNumber = 1; slotNumber <= lines; slotNumber++) {
    const slot = await reserveSlot(session, slotNumber);
    if (slot) reserved.push(slot);
  }
  const placed = await Promise.all(reserved.map((slot) => placeSlotCall(session, slot)));
  // A line whose first dial was refused tries the next lead (dialIntoSlot caps it).
  reserved.forEach((slot, i) => {
    if (!placed[i]) queueRefill(session, slot.slotNumber);
  });

  return {
    lineCount: lines,
    slots: [...session.slots.values()].map((s) => ({
      slotNumber: s.slotNumber,
      leadId: s.lead.id,
      leadName: s.lead.name,
      status: s.status,
    })),
  };
}

/** Manually drops one line (the "Drop line" button) and refills the slot. */
async function dropMultilineSlot(userId, slotNumber) {
  const session = multilineSessions.get(userId);
  if (!session) return { dropped: false };

  const slot = session.slots.get(Number(slotNumber));
  if (!slot) return { dropped: false };

  session.slots.delete(slot.slotNumber);
  if (slot.callId) await abandonSlotCall(session, slot);
  await queueRefill(session, slot.slotNumber);
  return { dropped: true };
}

/**
 * Legacy "Take this call" hand-off to the single-line call screen. The panel
 * now expands the disposition UI in place instead, but this stays for the
 * route that still exposes it (and ends multi-line tracking cleanly).
 */
async function takeMultilineCall(userId, slotNumber) {
  const session = multilineSessions.get(userId);
  if (!session) return null;

  const slot = session.slots.get(Number(slotNumber));
  if (!slot) return null;

  await dropOtherSlots(session, slot.slotNumber);
  session.stopped = true;
  multilineSessions.delete(userId);

  return { leadId: slot.lead.id, callId: slot.callId, abandonedCount: session.abandonedCount };
}

// A line with a real person on it — never abandon one of these just because
// the session is ending. 'answered' is kept alongside the newer
// 'active_disposition' so an in-flight session from before this change is
// still handled correctly.
const LIVE_CALL_STATUSES = ['answered', 'active_disposition', 'held'];

/**
 * Ends multi-line dialing.
 *   Manual Stop (the rep pressed Stop): the call the rep is talking on stays
 *   live and is finished normally (disposition as usual). Lines still ringing,
 *   and answered callers waiting on hold, are hung up and recorded as
 *   abandoned (was_abandoned = true); their leads go back to the queue.
 *   Automatic stop ({ automatic: true } — the rep's browser went away, see
 *   streamClosed): nobody is there to talk, so every line, including the
 *   active and held calls, is abandoned and recorded, and the dialing
 *   session is closed.
 * Ending a call at the phone provider is not part of the TelephonyAdapter
 * interface; the app stops acting on the call (see dropOtherSlots).
 */
async function stopMultilineSession(userId, { automatic = false } = {}) {
  const session = multilineSessions.get(userId);
  if (!session) return { abandonedCount: 0 };

  session.stopped = true;
  let keptLive = null;
  for (const slot of [...session.slots.values()]) {
    session.slots.delete(slot.slotNumber);
    if (!slot.callId) continue;
    const isActive = session.activeSlot === slot.slotNumber && ['active_disposition', 'answered'].includes(slot.status);
    if (isActive && !automatic) {
      keptLive = { slotNumber: slot.slotNumber, callId: slot.callId, leadId: slot.lead.id };
      continue;
    }
    if (LIVE_CALL_STATUSES.includes(slot.status) || DROPPABLE_STATUSES.includes(slot.status)) {
      await abandonSlotCall(session, slot);
    }
  }
  multilineSessions.delete(userId);
  if (automatic && session.sessionId) {
    await dialingSession.endSession(session.sessionId).catch((err) => {
      console.error(`Could not close dialing session ${session.sessionId}:`, err.message);
    });
  }
  return { abandonedCount: session.abandonedCount, keptLive };
}

// ---------------------------------------------------------------------------
// Browser connection (F-28): the multi-line screen holds an SSE stream open
// (routes/calls.js GET /stream). When a user's LAST stream closes — tab
// closed, laptop asleep, network gone — their multi-line session is stopped
// automatically after a grace period, unless a stream reconnects first.
// ---------------------------------------------------------------------------

const SSE_DISCONNECT_GRACE_MS = 10_000;
const openStreams = new Map(); // userId → number of open streams
const disconnectTimers = new Map(); // userId → pending auto-stop timer

function streamOpened(userId) {
  const key = String(userId);
  openStreams.set(key, (openStreams.get(key) || 0) + 1);
  clearTimeout(disconnectTimers.get(key));
  disconnectTimers.delete(key);
}

function streamClosed(userId) {
  const key = String(userId);
  const left = (openStreams.get(key) || 1) - 1;
  if (left > 0) {
    openStreams.set(key, left);
    return;
  }
  openStreams.delete(key);
  clearTimeout(disconnectTimers.get(key));
  const timer = setTimeout(() => {
    disconnectTimers.delete(key);
    if (openStreams.has(key) || !multilineSessions.has(userId)) return;
    console.log(`Multi-line session of user ${userId} stopped: browser disconnected for ${SSE_DISCONNECT_GRACE_MS / 1000} s`);
    stopMultilineSession(userId, { automatic: true }).catch((err) => {
      console.error(`Auto-stop of user ${userId}'s multi-line session failed:`, err.message);
    });
  }, SSE_DISCONNECT_GRACE_MS);
  timer.unref();
  disconnectTimers.set(key, timer);
}

/** Server shutdown: no pending auto-stop timer is left behind. */
function clearConnectionTimers() {
  for (const timer of disconnectTimers.values()) clearTimeout(timer);
  disconnectTimers.clear();
}

/**
 * Server startup (F-29): multi-line sessions live in memory, so after a
 * restart (crash, deploy) nothing is dialing any more. Close what the
 * previous process left open: dialing sessions without ended_at, and calls
 * still open (no ended_at, no disposition) — recorded as abandoned — and put
 * their leads back in the queue (leadLifecycle). With a real phone provider
 * such a call may still be up at the provider; ending it there is not part
 * of the adapter interface (phase C).
 */
async function recoverAfterRestart() {
  const { rowCount: sessions } = await db.query('UPDATE dialing_sessions SET ended_at = now() WHERE ended_at IS NULL');
  const { rows: calls } = await db.query(
    `UPDATE call_history
     SET ended_at = now(), was_abandoned = true, telephony_state = CASE WHEN telephony_state = 'failed' THEN 'failed' ELSE 'ended' END,
         duration_seconds = COALESCE(duration_seconds, GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int))
     WHERE ended_at IS NULL AND disposition IS NULL
     RETURNING lead_id`
  );
  const released = await leadLifecycle.releaseAbandoned(calls.map((c) => c.lead_id));
  return { sessions, calls: calls.length, leads: released.length };
}

module.exports = {
  start,
  get,
  startManual,
  endManualCall,
  MOCK_FROM_NUMBER,
  MULTILINE_SLOTS,
  callEvents,
  startMultilineSession,
  dropMultilineSlot,
  takeMultilineCall,
  releaseActiveSlot,
  stopMultilineSession,
  streamOpened,
  streamClosed,
  clearConnectionTimers,
  recoverAfterRestart,
};
