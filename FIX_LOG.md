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

Still open (later segments):
- **F-20** queue starvation under calling hours (Segment 6).
- **F-15** the 30 s sweep releases live calls (Segment 3).
- **F-24/F-25** lazy sweep; `ended_at` not set by the mock `ended` event.
- **F-28/F-29/F-30** session disconnect, stop cleanup and telephony rollback (Segment 5).

## New findings (not in the audit)

| ID | Found in | Description | Planned |
|---|---|---|---|
| F-55 | Segment 1 | A phoneless lead (`missing_phone = true`, e.g. from an import) that gets a number through `PUT /api/leads/:id` stores the number but keeps `missing_phone = true`, so it still cannot be dialed ("This lead has no phone number yet"). Evidence: `audit/logs/fix-seg1-regression.txt` | Segment 4 |
