const { EventEmitter } = require('events');
const db = require('../db');
const telephony = require('../telephony');
const leadQueue = require('./leadQueue');
const leadLifecycle = require('./leadLifecycle');
const dialingSession = require('./dialingSession');
const dncCheck = require('./dncCheck');

// Reserved-for-fiction NANP range (555-0100 through 555-0199) — safe
// placeholder until phone_numbers is populated with real numbers in phase 2.
const MOCK_FROM_NUMBER = '+15555550100';

const MULTILINE_SLOTS = 3;

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

  const telephonyCallId = telephony.placeCall(fromNumber, lead.phone, (event) => {
    const nextState = event.type; // 'ringing' | 'answered' | 'voicemail_detected' | 'ended'
    db.query('UPDATE call_history SET telephony_state = $2 WHERE id = $1', [call.id, nextState]).catch((err) => {
      console.error(`Failed to record telephony event "${event.type}" for call ${call.id}:`, err.message);
    });
  });

  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);

  return { ...call, telephony_call_id: telephonyCallId, attempts: lead.attempts + 1 };
}

async function get(callHistoryId) {
  const { rows } = await db.query('SELECT * FROM call_history WHERE id = $1', [callHistoryId]);
  return rows[0] || null;
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

  const telephonyCallId = telephony.placeCall(fromNumber, lead.phone, (event) => {
    // The mock adapter keeps firing timers for a call we've already moved
    // past (dropped, or the slot refilled) — ignore anything that isn't for
    // the call this slot is currently on.
    const current = session.slots.get(slotNumber);
    if (session.stopped || !current || current.callId !== call.id) return;

    db.query('UPDATE call_history SET telephony_state = $2 WHERE id = $1', [call.id, event.type]).catch((err) => {
      console.error(`Failed to record telephony event "${event.type}" for call ${call.id}:`, err.message);
    });

    handleSlotEvent(session, current, event).catch((err) => {
      console.error(`Multi-line slot ${slotNumber} failed handling "${event.type}":`, err.message);
    });
  });

  await db.query('UPDATE call_history SET telephony_call_id = $2 WHERE id = $1', [call.id, telephonyCallId]);
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
  await dialIntoSlot(session, slot.slotNumber);
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
    await dialIntoSlot(session, finished.slotNumber);
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
      await db.query(
        `UPDATE leads SET status = 'in_queue', locked_by = NULL, locked_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'in_progress'`,
        [slot.lead.id]
      );
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
    try {
      // Reuses the existing queue + calling-hours logic exactly as single-line
      // dialing does.
      lead = await leadQueue.lockNext({ userId: session.userId });
    } catch (err) {
      // Queue exhausted, or nothing dialable inside calling hours right now.
      emitSlot(session, placeholder, 'idle', { message: err.message });
      return null;
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

  emitSlot(session, placeholder, 'idle', { message: 'Too many DNC numbers in a row — stopping this line.' });
  return null;
}

/** Refills one freed slot: reserve a lead, then dial it. */
async function dialIntoSlot(session, slotNumber) {
  const slot = await reserveSlot(session, slotNumber);
  if (!slot) return;
  await placeSlotCall(session, slot);
}

/**
 * Opens `lineCount` lines at once for a rep (1-3, chosen on the dashboard).
 * Returns immediately after the dials are placed — progress arrives over
 * callEvents (SSE), not as a response body.
 */
async function startMultilineSession(userId, sessionId, lineCount = MULTILINE_SLOTS) {
  await stopMultilineSession(userId);

  const lines = Math.min(MULTILINE_SLOTS, Math.max(1, Number(lineCount) || MULTILINE_SLOTS));

  const session = {
    userId,
    sessionId: sessionId || null,
    slots: new Map(),
    stopped: false,
    activeSlot: null,
    abandonedCount: 0,
    dncSkipped: 0,
    lineCount: lines,
  };
  multilineSessions.set(userId, session);

  // Reserve the leads one at a time (see reserveSlot on why), then fire all
  // the calls together so the lines genuinely ring in parallel.
  const reserved = [];
  for (let slotNumber = 1; slotNumber <= lines; slotNumber++) {
    const slot = await reserveSlot(session, slotNumber);
    if (slot) reserved.push(slot);
  }
  await Promise.all(reserved.map((slot) => placeSlotCall(session, slot)));

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
  await dialIntoSlot(session, slot.slotNumber);
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

/** Ends multi-line dialing, dropping every line that's still just ringing. */
async function stopMultilineSession(userId) {
  const session = multilineSessions.get(userId);
  if (!session) return { abandonedCount: 0 };

  session.stopped = true;
  for (const slot of [...session.slots.values()]) {
    session.slots.delete(slot.slotNumber);
    if (slot.callId && !LIVE_CALL_STATUSES.includes(slot.status)) await abandonSlotCall(session, slot);
  }
  multilineSessions.delete(userId);
  return { abandonedCount: session.abandonedCount };
}

module.exports = {
  start,
  get,
  MOCK_FROM_NUMBER,
  MULTILINE_SLOTS,
  callEvents,
  startMultilineSession,
  dropMultilineSlot,
  takeMultilineCall,
  releaseActiveSlot,
  stopMultilineSession,
};
