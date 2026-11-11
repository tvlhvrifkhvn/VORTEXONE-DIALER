# Fix log

Running ledger of fixes for findings in `AUDIT_REPORT.md`. Later segments append rows. "Test" names the repro script under `audit/scripts/`; its before/after output is in the log file named.

## Segment 1 — branch `claude/fix-seg1-secrets-dnc` (base `origin/claude/full-bug-audit` @ `34d47bb`)

| Finding | Status | Commit | File:function | Test that proves it | Notes |
|---|---|---|---|---|---|
| F-01 Groq key hardcoded | **Deferred (owner)** | — | `backend/src/config/index.js` | — | The owner asked to leave the Groq key for the end. The literal is still in `config/index.js` and in git history; revoking the key in the Groq console is the real remedy |
| F-06 Default seed password | **Fixed** | `475ee4c` | `backend/src/db/seeds/run.js` `seed()`; `backend/.env.example` | `fix-seg1-f06.sh`: pre-fix the committed default logs in (200). Post-fix a fresh seed prints a random 24-char password (login 200) and the old default gets 401. A reseed prints "left unchanged" with the hash unchanged, and `SEED_USER_PASSWORD` works (200). Log: `audit/logs/fix-seg1.txt` | No change-password endpoint exists; rotation one-liner is in the PR. The old default still appears in `AUDIT_REPORT.md` (owner-approved exception); everything under `audit/` is masked |
| F-16 DNC bypass via phone edit + single-line dial | **Fixed** | `3834098` (refactored into the shared validator by `65b12f9`) | `backend/src/services/leadQueue.js` `updateFields`, `lockNext`; `backend/src/services/leadLifecycle.js` `markDncFromQueue` (new) | `fix-seg1-f16.sh`: pre-fix all 3 formats of a DNC'd number were stored raw (200) and dialed (201). Post-fix each format gives 409, `abc` 400, duplicate 409, clean number 200 stored as E.164; dnc_list-only lead by-id 409; queue parks it as `dnc` and serves another lead; dial pad still 409. `fix-seg1-f16-multiline.sh`: multi-line never dials it. Re-run after F-52 is still green | `leadLifecycle.js` was added with the owner's approval. Behaviour change: in a multi-line *selected-leads* session a DNC-listed lead is now skipped and left in its status, not marked `dnc` (still never dialed) |
| F-22 Soft-deleted lead dialable by id | **Fixed** | `71f02d9` | `backend/src/services/leadQueue.js` `lockNext` (by-id SELECT) | `fix-seg1-f22.sh`: pre-fix the deleted lead dial gave 201; post-fix 404 "Lead not found". The queue doesn't serve it; a live lead still dials (201) | — |
| F-52 Lead edit skips create's validation | **Fixed** | `65b12f9` | `backend/src/services/leadQueue.js` `validateLeadInput` (new), `create`, `updateFields` | `fix-seg1-f52.sh`: pre-fix `ZZ` stored (200), null name gave 500 with a raw PG message, 10,000-char name stored. Post-fix each gives 400 with a clear message, a 201-char name gives 400, 200 chars gives 200, all 6 valid edits give 200, `ca` is stored as `CA` | New rule `MAX_NAME_LENGTH = 200` on create and edit. Create now also rejects names over 200 chars (it accepted 10,000 before) |

Regression (`audit/logs/fix-seg1-regression.txt`):
- schema-check: 0 problems before and after.
- 77 routes, identical before and after.
- auth matrix: 75 protected routes + SSE all 401, identical before and after (only the public login row differs, from the login limiter).
- frontend build passes.
- invariants pasted.
- F-14 still reproduces (20 calls on 4 leads): out of scope, Segment 2.

## Segment 2 — branch `claude/fix-seg2-atomic-locking` (base `origin/claude/fix-seg1-secrets-dnc` @ `0b85b56`)

| Finding | Status | Commit | File:function | Test that proves it | Notes |
|---|---|---|---|---|---|
| F-14 Locking race: one lead dialed many times at once | **Fixed** | `f45a9c4` | `backend/src/services/leadQueue.js` `lockNext` + new `claimLead` (compare-and-set UPDATE); `backend/src/routes/calls.js` POST (Redial only with `redial:true`); `frontend/src/lib/api.js` `startCall`; `frontend/src/hooks/useCall.js` `redial` | `fix-seg2-f14.sh`, each run on a fresh clone of the same data. Pre-fix: 20 parallel next-lead requests gave 20 calls on **3** leads; 10 by-ID gave **8×201**, attempts +8; leads 14, 15, 16 were served to both users. Post-fix, **3 consecutive runs**: 20 calls on **20** leads, 0 leads with more than one open call, 10 by-ID gave **1×201 + 9×409**, attempts +1, no lead served to both users, I7 = 0, queue order identical to base, 0 server errors. `fix-seg2-redial.sh`: a plain repeat gives 409; `redial:true` gives 201; another user with `redial:true` gives 409. Log: `audit/logs/fix-seg2.txt` | Compare-and-set rather than SKIP LOCKED, so calling hours, the DNC check and `peekNext` ordering stay exactly as they were. `routes/calls.js` and `lib/api.js` were changed with the owner's approval |
| F-27 Multi-line lines dial the same lead | **Fixed** | `a6bede4` (plus F-14's claim) | `backend/src/services/callSession.js` new `queueRefill`, used by `releaseSlot`, `releaseActiveSlot` and `dropMultilineSlot`; `session.refillChain` | `fix-seg2-f27.sh`. Pre-fix: one session dialed lead 4 on slots 1, 2 and 3 at `29.413`; lead 10 was in both sessions. Post-fix, **3 consecutive runs**: 15 calls on 15 leads, 0 same-second duplicates, 30 calls on 30 leads across two users with no overlap. §5.2 is unchanged (answered → 2 held → slot 2 promoted). The selected-leads run skips the deleted and DNC-listed leads and leaves 0 `in_progress` | The F-14 claim alone already removed the duplicates (run "after-f14-only"); serialising is the second guard the code comments require |
| F-51 Dev-mode double dial from the call screen | **Fixed** | `4b7b746` | `frontend/src/hooks/useCall.js` effect (`startedForRef`, `activeRef`), `startCallFor(isCurrent)` | `fix-seg2-f51.sh` + `fix-seg2-ui-strictmode.js` under `vite dev`. Pre-fix on base: 2 POSTs (201, 201), 2 calls, attempts 0→2, UI "Ringing…". With F-14 only: 2 POSTs (201, 409), UI "Couldn't start this call". Post-fix, **3 runs**: 1 POST, 1 call, attempts 0→1, UI "Connected". Navigating A → B gives 1 call each; `/call/next` gives 1 POST; the production build gives 1 POST and ui-smoke is clean (0 console errors, 0 4xx/5xx on 12 views) | StrictMode kept |

Regression (`audit/logs/fix-seg2-regression.txt`):
- All Segment 1 repros (`fix-seg1-f06`, `f16`, `f16-multiline`, `f22`, `f52`) still pass.
- schema-check: 0 problems.
- 77 routes, identical to base.
- calling-hours.js output identical to base.
- auth matrix identical to base (75 + SSE all 401).
- frontend build passes.
- Server logs: 0 errors or warnings across every Segment 2 run.
- invariants: 0 leads with more than one open call; I7 = 0.

## Segment 3 — branch `claude/fix-seg3-lock-ownership` (base `origin/latest` @ `e99d97f`)

| Finding | Status | Commit | File:function | Test that proves it | Notes |
|---|---|---|---|---|---|
| F-25 `ended_at` not set by the network `ended` event | **Fixed** | `2592d76` | `backend/src/services/callLifecycle.js` `markEnded` (new file); `backend/src/services/callSession.js` the three event handlers in `start`, `startManual`, `placeSlotCall` | `fix-seg3.sh` part `f25`. Pre-fix: a no_answer call had `telephony_state=ended`, `ended_at` NULL, duration NULL. Post-fix, **3 runs**: `ended_at` set, duration 3 s, lead `locked_at` refreshed to the call's end. A hangup at 4.5 s (d=5) and a disposition at 4.5 s are not overwritten by the network `ended` at ~7 s. Calls with state ended but `ended_at` NULL: 1 → 0 | One statement: state, `COALESCE(ended_at, now())`, `COALESCE(duration_seconds, event duration)`, and the lead's `locked_at` if this event ended the call and the lead is still locked to the call's rep |
| F-15 30 s sweep releases live calls | **Fixed** | `936a382` | `backend/src/services/leadQueue.js` `releaseStaleLocks`, new `maxLiveCallMinutes`; `backend/src/services/leadLifecycle.js` `undoDisposition` | `fix-seg3.sh` parts `live`, `hungup`, `nocall`, `ceiling`, `undo`. Pre-fix: answered call with `locked_at` 60 s old → swept to `in_queue`; U2 dialed the same lead (201), 2 open calls on it. Post-fix, **3 runs**: stays `in_progress` (lazy sweep and timer); U2 gets 409; 1 open call. Hung-up call: `in_progress` at 25 s, `in_queue` at 32 s. Lead locked with no call: `in_progress` at 25 s, `in_queue` at 31 s. Ceiling: open call 239 min old keeps the lead; 241 min → `in_queue` and the call row gets `ended_at` | Undo now keeps `ended_at`/`duration_seconds` and gives a lead restored to `in_progress` a fresh `locked_at`. Without that, the new rule left an undone lead locked for 4 h (shown: `f15-sweep-without-undo-change` → still `in_progress` 31 s after undo) |
| F-24 sweep only runs on queue reads | **Fixed** | `e6e2f80` | `backend/src/index.js` `startStaleLockSweep`, `shutdown`; `backend/.env.example` | `fix-seg3.sh` part `f24` (DB polled directly, no API reads). Pre-fix: still `in_progress` 60 s after hangup. Post-fix, **3 runs**: `in_queue` 35–36 s after hangup. `STALE_LOCK_SWEEP=off`: still `in_progress` after 60 s. SIGTERM: log "stale-lock sweep stopped", process gone in ~0.5 s. `require('./src/index.js')` (not the entry point): 0 sweep intervals started | Every 10 s, `.unref()`, errors logged. Lazy calls on queue reads kept. `MAX_LIVE_CALL_MINUTES` and `STALE_LOCK_SWEEP` are read from `process.env` directly, not `config/index.js`, so this diff doesn't touch the file that holds the F-01 key |
| F-32 any user can disposition / undo / hang up another rep's call | **Fixed** | `66ff793` | `backend/src/services/callLifecycle.js` `assertCanActOn`, `assertLeadNotTaken`; `backend/src/services/leadLifecycle.js` `applyDisposition`, `undoDisposition`, `hangup`; `backend/src/services/callSession.js` `endManualCall`; `backend/src/routes/dispositions.js`; `backend/src/routes/calls.js` hangup; `frontend/src/hooks/useCall.js` | `fix-seg3.sh` parts `f32`, `late`; `fix-seg3-ui.sh`. Pre-fix: U2's DNC on U1's call 200 (lead `dnc`, number on dnc_list), U2's undo 200, U2's hangup on U1's manual call 200. U1's late disposition 200 after U2 took the lead (U2's lock wiped). Post-fix, **3 runs**: U2's dnc, hangup and undo → **403 ×3** (lead untouched, not on dnc_list). U1's own → 200. Supervisor disposition and hangup → 200. U2 on U1's manual call → 403. Late disposition → **409** "This lead is now with another rep.", U2 keeps the lock. UI (vite dev): the 409 and 403 messages are shown, buttons re-enable, live state keeps polling, 0 page errors | Roles from `users.role` (`rep`/`supervisor`) via the JWT. Multi-line slot calls carry the session owner's `user_id`, so the owner passes. `hangup` now refreshes `locked_at` only for the call's own rep |

Test shortcuts (labelled in the scripts): mock outcomes forced with `audit/stubs/force-outcome.js`; `locked_at`/`started_at` backdated in SQL; for the UI 403 case the call's `user_id` is switched in SQL. Logs: `audit/logs/fix-seg3.txt`, `audit/logs/fix-seg3-regression.txt`.

Regression (`audit/logs/fix-seg3-regression.txt`):
- All Segment 1 repros (`fix-seg1-f06`, `f16`, `f16-multiline`, `f22`, `f52`) still pass.
- All Segment 2 repros still pass:
  - `fix-seg2-f14`: 20 calls on 20 leads; 1×201 + 9×409 by-ID; queue order unchanged.
  - `fix-seg2-f27`: 15 on 15, 30 on 30 across two users; §5.2 held → promoted unchanged.
  - `fix-seg2-redial`: identical to base.
  - `fix-seg2-f51` (vite dev): 1 POST, UI "Connected".
- Multi-line, 3 lines forced no_answer: 15 calls on 15 leads, 0 left with `ended_at` NULL, I6 = 0 in all 3 post-fix runs.
- schema-check: 0 problems.
- 77 routes, identical to base.
- auth matrix identical to base: 75 + SSE all 401, run paced (`PACE_MS=650`) to stay under the API limiter.
- calling-hours.js: all result lines identical to base (only the DB toggle's starting value differs).
- invariants: I1, I4, I5, I7 = 0. I6 shows leads 4 and 26 with two undispositioned calls, explained in the log; both are present on base too:
  - lead 4: an abandoned multi-line row plus a test-setup SQL dial.
  - lead 26: Redial leaves two calls by design.
- Frontend build passes. The production ui-smoke has 0 console errors and 0 4xx/5xx on 12 views.
- Server logs: 0 errors or warnings in every Segment 3 run.

Known limitations (not fixed here):
- **Read routes stay open:** any logged-in user can read any call or lead (`GET /api/calls/:id`, `GET /api/leads/...`). Only the write actions above are restricted.
- **Browser closed mid-call:** an answered call nobody hangs up stays open, so its lead stays `in_progress` until the `MAX_LIVE_CALL_MINUTES` ceiling (4 h by default). Segment 5 (F-28/F-29/F-30: session disconnect, stop cleanup) is where it belongs. The same goes for answered/held multi-line lines left up by `stopMultilineSession`.
- **Roles:** only `rep` and `supervisor` exist. The seed user is a supervisor; there is no UI or endpoint to change a role, and a role change takes effect at the next login (it's in the JWT).
- **Redial without a fresh lock time:** Redial reuses the existing lock and doesn't refresh `locked_at`. Any redial that actually starts a call is protected by the open-call rule. Not seen in testing.

## Segment 4 — branch `claude/fix-seg4-lifecycle` (base `origin/claude/fix-seg3-lock-ownership` @ `8b89b7f`, since PR #17 is not merged yet)

| Finding | Status | Commit | File:function | Test that proves it | Notes |
|---|---|---|---|---|---|
| F-21 Undo after "Callback scheduled" crashes | **Fixed** (+1 more undo failure found) | `e869879` | `backend/src/services/leadLifecycle.js` `undoDisposition`; `backend/src/services/dialingSession.js` `decrementStat` (new) | `fix-seg4.sh` part `undo`: all 8 dispositions (contacted, voicemail, no_answer, callback_scheduled, no_contact_number, no_contact_person, dnc, cold at max attempts), each applied with a note in a dialing session and then undone. The lead (status, attempts, next_action_at, notes_count, cold, dnc_flag, locked_by), open callbacks, the dnc_list and the session stats are compared before and after. Pre-fix: **2 PASS / 6 FAIL**. callback_scheduled undo → 500 `syntax error at or near "ORDER"` (lead stays callback_scheduled, callback row kept); 5 more failed because the session stat wasn't taken back. Post-fix, **3 runs: 8/8 PASS**, 0 server errors | The undo matrix found the second failure: undo never reversed the dialing-session stat (`total_contacts` etc.). `dialingSession.js` is an extra file for that |
| F-17 no_contact_person cascades by name | **Fixed** (cascade removed, owner decision) | `b900117` | `leadLifecycle.js` `applyDisposition` (block removed, response no longer has `cascadedLeadIds`), `undoDisposition` comment | `fix-seg4.sh` part `cascade`: three "Sam Same" leads in TX / FL / AZ (AZ a scheduled callback), no_contact_person on TX. Pre-fix: `cascadedLeadIds [FL, AZ]`, both cold/no_contact_person, still cold after undo. Post-fix, **3 runs**: only TX cold; FL stays in_queue, AZ stays callback_scheduled with its callback; undo restores TX | Old victims are not changed; a read-only query to find them is in the PR. No frontend text mentioned the cascade |
| F-35 Callback time not validated | **Fixed** | `14ee003` | `leadLifecycle.js` `parseCallbackTime` (new, shared), `applyDisposition`; `leadQueue.js` `scheduleCallback` uses the shared parser | `fix-seg4.sh` part `callback`. Pre-fix: "next tuesday" → **500** raw Postgres error; 2020-01-01 → 200. Post-fix, **3 runs**: "next tuesday" → 400 "A valid callback date and time is required"; 2020-01-01 → 400 "That callback time is in the past"; now−30 s → 200; +3 days → 200 | Past = more than 1 minute before now (owner decision). The lead-page callback route keeps its behaviour (same parser, no past-time rule) |
| F-36 Note linked to another lead's call | **Fixed** | `b64ba7e` | `leadQueue.js` `addNote` | `fix-seg4.sh` part `note`, plus the exact audit repro on a clone of the audit DB (`seg4-f36-audit`). Pre-fix: lead 69 + call 154 (lead 249's) → **201**; unknown call id → 500 (foreign key). Post-fix, **3 runs**: 400 "That call isn't one of this lead's calls" for both; own call → 201; no callId → 201; lead 249 + call 154 → 201 | — |
| F-23 no_contact_number is a dead end | **Fixed** | `30ceef4` | `leadLifecycle.js` `phoneNumberChanged` (new); `leadQueue.js` `updateFields` calls it after a real phone change | `fix-seg4.sh` part `ncn`. Pre-fix: new valid phone → status stays no_contact_number, dial → 409. Post-fix, **3 runs**: "abc" → 400 and DNC-listed number → 409 (status unchanged), valid new number → `in_queue`, attempts kept (1), `next_action_at` NULL, timeline note "Number changed, back in queue", dial → 201 | Multiple numbers per lead not added (schema change, later phase) |
| F-55 missing_phone lead stays undialable | **Fixed** | `b1870dc` | `leadLifecycle.js` `phoneNumberChanged`; `leadQueue.js` `updateFields` (blank phone on a phoneless lead = unchanged) | `fix-seg4.sh` part `missing` = the FIX_LOG Segment 1 repro (phoneless lead by DIRECT SQL as csvImport inserts it). Pre-fix: dial → 409; the edit form (sends phone "") → **400**; PUT phone → 200 but `missing_phone` stays true, dial → 409. Post-fix, **3 runs**: edit form → 200; PUT phone → `missing_phone=false`, status stays `new`, note "Number added, lead is now dialable", dial → 201 | — |
| DNC lead's phone editable | **Fixed** (owner decision, no override) | `373e2ff` | `leadQueue.js` `updateFields` | `fix-seg4.sh` part `dncedit`. Pre-fix: new phone on a dnc lead → **200** (number replaced). The full edit form with the lead's own number → 409 (its own number is on the DNC list), so a DNC lead's name couldn't be edited from the form. Post-fix, **3 runs**: new phone → 409 "This lead is on the DNC list; its number can't be changed", phone unchanged; name only → 200; only its current phone → 200 (no-op); full form, phone unchanged → 200 | Sending the number a lead already has now counts as no change, for every lead |

UI (`fix-seg4-ui.sh`, vite dev):
- Pre-fix on base:
  - past callback accepted (call finalized);
  - Undo of that callback shows `syntax error at or near "ORDER"` (500);
  - DNC lead phone saved (200), then the form's name save → 409;
  - phoneless lead: the form shows "Enter a valid 10-digit…" on a brokerage edit; adding a phone saves, but `missing_phone` stays true;
  - no_contact_number lead stays no_contact_number.
- Post-fix, **3 runs**:
  - "That callback time is in the past" shown, buttons usable; a valid callback then Undo → lead back to in_progress, callback removed, no error;
  - DNC lead: the 409 message shown, phone unchanged, name saved;
  - phoneless lead saves and becomes dialable;
  - "abc" shows the 400 message;
  - the no_contact_number lead goes to in_queue;
  - 0 page errors.
- No frontend file needed a change: the existing error lines (`setActionError`, `setError`) show the server's message.

Test shortcuts (labelled in the scripts): mock outcome forced to answered; synthetic same-name leads, a phoneless lead, a dnc_list entry and "one attempt left" set by DIRECT SQL. Logs: `audit/logs/fix-seg4.txt`, `audit/logs/fix-seg4-regression.txt`.

Regression (`audit/logs/fix-seg4-regression.txt`):
- Segment 1 repros (`fix-seg1-f06`, `f16`, `f16-multiline`, `f22`, `f52`) pass. Expected change: `fix-seg1-f16`'s setup step that moves the number off a DNC lead now gets 409 (the new DNC phone rule); every Segment 1 assertion after it is unchanged.
- Segment 2 repros pass:
  - `fix-seg2-f14`: 20 calls on 20 leads; 1×201 + 9×409; same queue order.
  - `fix-seg2-f27`: 15/15 and 30/30; held → promoted.
  - `fix-seg2-redial`: unchanged.
  - `fix-seg2-f51` (dev): 1 POST, "Connected".
- Segment 3 repros pass (`fix-seg3.sh`, all parts):
  - live-call lock, hung-up/no-call release, ceiling, undo, F-25, F-24 (35 s);
  - F-32: 403 ×3 and the late-disposition 409;
  - `fix-seg3-ui.sh`: the 403/409 messages on the call screen.
- 77 routes identical to base; schema-check 0 problems.
- Auth matrix identical to base (75 + SSE all 401, paced). calling-hours results identical (only the DB toggle's starting value differs).
- Invariants unchanged from Segment 3: I1, I3, I4, I5, I7 = 0. I6 lead 4 and I8 = 1 are the same Segment 1 test-setup rows.
- Frontend build passes. The production ui-smoke has 0 console errors and 0 4xx/5xx on all 12 views.
- Server logs: 0 errors or warnings in every Segment 4 run.

Known limitations (not fixed here):
- One phone per lead. no_contact_number now recovers when the number is fixed, but there are no "other numbers on the lead" (CLAUDE.md). That needs a schema change.
- Old cascade victims are left as they are; the owner reviews them with the query in the PR.
- The lead-page callback route (`POST /api/leads/:id/callback`) still accepts past times. The owner's past-time rule was set for the disposition path; say if it should apply there too.
- `leadQueue.scheduleCallback` (lead-page route) still sets the status itself rather than through `leadLifecycle.js`. This is existing code, unchanged apart from the shared time parser.

Still open (later segments):
- **F-01** Groq key, deferred by the owner to the last segment.
- **F-20** queue starvation under calling hours (Segment 6).
- **F-28/F-29/F-30** session disconnect, stop cleanup and telephony rollback (Segment 5).

## New findings (not in the audit)

| ID | Found in | Description | Planned |
|---|---|---|---|
| F-55 | Segment 1 | A phoneless lead (`missing_phone = true`, e.g. from an import) that gets a number through `PUT /api/leads/:id` stores the number but keeps `missing_phone = true`, so it still cannot be dialed ("This lead has no phone number yet"). Evidence: `audit/logs/fix-seg1-regression.txt` | **Fixed in Segment 4** (`b1870dc`) |
