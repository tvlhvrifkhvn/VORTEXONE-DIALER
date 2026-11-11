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
