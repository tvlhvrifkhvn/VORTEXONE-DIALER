const { EventEmitter } = require('events');
const db = require('../db');
const telephony = require('../telephony');
const leadQueue = require('./leadQueue');
const leadLifecycle = require('./leadLifecycle');
const dialingSession = require('./dialingSession');

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
    slot.status = 'answered';
    slot.answeredAt = Date.now();
    emitSlot(session, slot, 'answered', { duration: 0 });
    // A live human is on this line — every other line is dead weight now.
    await dropOtherSlots(session, slot.slotNumber);
    return;
  }

  if (event.type === 'voicemail_detected') {
    slot.status = 'voicemail';
    emitSlot(session, slot, 'voicemail');
    await releaseSlot(session, slot, 'voicemail');
    return;
  }

  if (event.type === 'ended') {
    // An answered line ends when the rep dispositions it on the call screen,
    // and a voicemail line was already released above — neither is a
    // no-answer.
    if (slot.status === 'answered' || slot.status === 'voicemail') return;
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

  if (session.stopped || session.hasLiveCall) return;
  session.slots.delete(slot.slotNumber);
  await dialIntoSlot(session, slot.slotNumber);
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
  session.hasLiveCall = true;
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
  if (session.stopped || session.hasLiveCall) return null;

  const placeholder = { slotNumber, lead: {}, status: 'loading', callId: null };
  emitSlot(session, placeholder, 'loading');

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

  const slot = { slotNumber, lead, status: 'dialing', callId: null, answeredAt: null };
  session.slots.set(slotNumber, slot);
  return slot;
}

/** Refills one freed slot: reserve a lead, then dial it. */
async function dialIntoSlot(session, slotNumber) {
  const slot = await reserveSlot(session, slotNumber);
  if (!slot) return;
  await placeSlotCall(session, slot);
}

/**
 * Opens three lines at once for a rep. Returns immediately after the first
 * three dials are placed — progress arrives over callEvents (SSE), not as a
 * response body.
 */
async function startMultilineSession(userId, sessionId) {
  await stopMultilineSession(userId);

  const session = {
    userId,
    sessionId: sessionId || null,
    slots: new Map(),
    stopped: false,
    hasLiveCall: false,
    abandonedCount: 0,
  };
  multilineSessions.set(userId, session);

  // Reserve the three leads one at a time (see reserveSlot on why), then fire
  // all three calls together so the lines genuinely ring in parallel.
  const reserved = [];
  for (let slotNumber = 1; slotNumber <= MULTILINE_SLOTS; slotNumber++) {
    const slot = await reserveSlot(session, slotNumber);
    if (slot) reserved.push(slot);
  }
  await Promise.all(reserved.map((slot) => placeSlotCall(session, slot)));

  return {
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
 * Rep clicked "Take this call": the other lines are already dropped, so this
 * just tears down multi-line tracking and hands back the lead to open on the
 * existing call screen.
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

/** Ends multi-line dialing, dropping every line still up. */
async function stopMultilineSession(userId) {
  const session = multilineSessions.get(userId);
  if (!session) return { abandonedCount: 0 };

  session.stopped = true;
  for (const slot of [...session.slots.values()]) {
    session.slots.delete(slot.slotNumber);
    if (slot.callId && slot.status !== 'answered') await abandonSlotCall(session, slot);
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
  stopMultilineSession,
};
