# Vortex Outreach — Full Bug Audit

Audit only. No tracked source file was modified. Everything the audit produced lives in this file and in `audit/`:

- `audit/scripts/`: repro scripts
- `audit/fixtures/`: test files
- `audit/stubs/`: stubs, always labelled when used
- `audit/logs/`: raw output, saved as `.txt` because `.gitignore` ignores `*.log`
- `audit/screenshots/`

Status: **in progress.** This report is written section by section. Any section not yet filled in is marked *pending*.

---

## 1. Audit base and environment

| Item | Value |
|---|---|
| Branch audited | `origin/latest` |
| Commit | `1a3ff4a0f5e5d4ccb6a5dd30296e4f829339ccfd` (= `claude/rebuttal-coach-v2` + merge of `claude/vite-host-fix`) |
| Audit branch | `claude/full-bug-audit`, created from that commit |
| Node / npm | v22.23.4 / 10.9.9 |
| PostgreSQL | 16.15 (Ubuntu build, already installed in the container; apt not needed) |
| DB | Fresh cluster in `/var/tmp/audit-pg`, TCP `localhost:5432`, `scram-sha-256` auth, role `vortex`/`vortex`, DBs `vortex_dialer` (main) + `vortex_empty` (migration test) |
| `backend/.env` | Copied from `.env.example`. `JWT_SECRET` = random 64 hex. `TELEPHONY_PROVIDER`, `SMS_PROVIDER` and `EMAIL_PROVIDER` = `mock`. `GROQ_API_KEY=audit-dummy-not-real`, so the hardcoded fallback key is never used (see F-01). Git-ignored (`.gitignore:5:.env`) and not committed |
| Handoff | `VORTEX_DIALER_HANDOFF.md` is **not on `latest`**. It exists only on `claude/handoff-audit` (PR #12); I read it from there |

Origin branches **not** in the base (`git merge-base --is-ancestor`, log: `audit/logs/00-setup.txt`):

| Branch | Status |
|---|---|
| `claude/devcontainer-postgres-setup` (PR #5) | **Not in base** |
| `claude/full-feature-batch` (PR #8) | Not in base, but its only unique commit, `0fe67f8` "Build in Groq API key", is **already covered**. `git diff origin/latest origin/claude/full-feature-batch -- backend/src/config/index.js` is empty; the equivalent commit `4673858` is in the base |
| `claude/handoff-audit` (PR #12) | **Not in base** (docs only) |
| `claude/remove-zip-verify-login` (PR #4) | **Not in base**, so `vortex-dialer.zip` is still in the tree |
| `tvlhvrifkhvn-patch-1` (PR #1, closed) | **Not in base** |

Setup output (`audit/logs/00-setup.txt`):

- `npm ci` succeeded in both packages.
- `npm run migrate` applied `001`…`022`, then printed `Migrations up to date.`
- `npm run seed` printed `Seed complete. Login with vortexoneagency@gmail.com / ChangeMe123!`
- `git status --porcelain` showed only `?? audit/`.

What could **not** be set up:

- **Groq:** no real API key is available, and the container has no route to Groq. AI calls are either run against a **stub**, labelled wherever used, or marked *Can't verify*.
- **Twilio / SendGrid:** not called, by design.
- **Browser:** `npx playwright install` was not run, because this environment forbids it. The pre-installed Chromium + Playwright were used instead.

---

## 2. Summary
*pending*

## 3. Findings

Severity follows the brief:

- **Critical:** data loss, a lead lost or stuck, a DNC or legal rule broken, an exploitable security hole, or the app won't build or start.
- **High:** a core feature is broken or gives wrong results.
- **Medium:** a partial feature or a bad edge case.
- **Low:** cosmetic or code quality.

Findings are numbered in the order found; §2 lists them by severity.

### F-01 · Critical · Security · Live Groq API key hardcoded in a public repo
- **Where:** `backend/src/config/index.js:21`, the `module.exports.groqApiKey` fallback. Introduced by `4673858` and `0fe67f8` ("Build in Groq API key").
- **Evidence** (`audit/logs/01-static.txt`, value masked):
  ```
  backend/src/config/index.js:21:  groqApiKey: process.env.GROQ_API_KEY || 'gsk_****MASKED',
  GROQ_API_KEY blank -> config.groqApiKey = gsk_****(len 56)
  ```
  `gh api repos/tvlhvrifkhvn/vortexone-dialer` reports `visibility: public`.
- **Repro:**
  ```
  cd backend && GROQ_API_KEY= node -e 'console.log(!!require("./src/config").groqApiKey)'
  ```
  prints `true`.
- **Expected:** with no key configured, AI features are disabled. `backend/.env.example:24-26` says "Leave blank to disable those features".
- **Actual:** a blank key silently falls back to the committed key. Anyone who clones the repo can use it.
- **Also:** `aiCsvMapper.js:26-28`, `noteExpander.js:11-13` and `rebuttalCoach.js:13-15` log "GROQ_API_KEY not set — … will be unavailable", which is false because of this fallback.
- **Suggested fix:** revoke the key in the Groq console now. Remove the literal: `groqApiKey: process.env.GROQ_API_KEY || null`. Purging it from git history is optional once it's revoked.

### F-02 · Medium · Dependencies · Open `npm audit` advisories, one with no fix
- **Where:** `backend/package.json`, `frontend/package.json`.
- **Evidence** (`npm audit --json`, `audit/logs/01-static.txt`):
  - Backend: `{"moderate":1,"high":3,"critical":1}`
    - `proxy-addr` (critical, GHSA-jqcg-44mw-7w3h): not exploitable here, since `trust proxy` is never set (`grep -rn "trust proxy" backend/src` returns nothing)
    - `multer` 2.0.x (high, two DoS advisories)
    - `body-parser` (high, DoS)
    - `xlsx@0.18.5` (high, prototype pollution + ReDoS, **`fixAvailable:false`**)
  - Frontend: `{"moderate":1,"high":2}`. `vite@7.3.6` (high, dev-server advisories) is relevant because the owner runs `vite dev` on a public Codespaces port.
- **Expected:** no known high/critical advisories in a parser of uploaded files.
- **Actual:** `xlsx` parses every uploaded spreadsheet (`services/xlsxParser.js`) and has no npm fix.
- **Suggested fix:** `npm audit fix` for the fixable ones. Replace `xlsx` with the SheetJS CDN build (`https://cdn.sheetjs.com`) or `exceljs`.

### F-03 · Low · Architecture · SQL in route handlers (CLAUDE.md rule 4)
- **Where:**
  - `backend/src/routes/calls.js:67`, in `POST /api/calls`: `SELECT * FROM leads WHERE id = $1 AND status = $2 AND locked_by = $3 AND missing_phone = false`
  - `backend/src/routes/imports.js:147`, in `POST /api/imports/process`: `SELECT source_rows FROM import_jobs WHERE id = $1 AND user_id = $2`
- **Evidence:** `grep -nE "db\.query" backend/src/routes/*.js` (`audit/logs/01-static.txt`).
- **Expected:** no SQL in routes.
- **Actual:** two queries.
- **Suggested fix:** move them to `leadQueue.getLockedByUser()` and `csvImport.getJobSourceRows()`.

### F-04 · Low · Architecture · Lead status written outside `leadLifecycle.js` / the stale-lock sweep
- **Where:**
  - `services/callSession.js:346` `abandonSlotCall` → `status='in_queue'`
  - `services/callSession.js:414` `reserveSlot` → `status='dnc'`
  - `services/leadQueue.js:188` `scheduleCallback` → `status='callback_scheduled'`
  - `services/leadQueue.js:93` `lockNext` → `in_progress`, which is the lock itself, arguably part of the queue
- **Evidence:** grep in `audit/logs/01-static.txt`.
- **Expected:** handoff §3 says "Every status change goes through `leadLifecycle.js` or the stale-lock sweep."
- **Actual:** 3–4 other writers. `scheduleCallback` (`POST /api/leads/:id/callback`) changes status without a `call_history` row, snapshot or undo. The behavioral consequences are tested in §4.
- **Suggested fix:** route these through small exported functions in `leadLifecycle.js` (`requeueAbandoned`, `markDncFromQueue`, `scheduleCallback`).

### F-05 · Low · Architecture · Telephony adapter emits an undocumented `busy` event (CLAUDE.md rule 2)
- **Where:** `backend/src/telephony/mockAdapter.js:46`: `onEvent({ type: 'busy' })`. `services/callSession.js` handles it (`event.type === 'busy'`). `telephony/index.js:24-31` still documents only `ringing | answered | voicemail_detected | ended`.
- **Expected:** the interface does not change without discussion, or the docs are updated with it.
- **Actual:** the contract was widened silently. A Twilio adapter written to the documented interface would never emit `busy`, so the multi-line busy path would not run.
- **Suggested fix:** decide on `busy` and document it in `telephony/index.js` and CLAUDE.md, or map busy to `ended` in the adapter.

### F-06 · Low · Security · Default login credentials committed in a public repo
- **Where:** `backend/src/db/seeds/run.js:4-5`: `SEED_EMAIL … 'vortexoneagency@gmail.com'`, `SEED_PASSWORD … 'ChangeMe123!'`.
- **Expected:** a dev seed password that is not reused anywhere real.
- **Actual:** if the owner's real instance was seeded and the password never changed, anyone can log in; the CORS/Codespaces ports are public.
- **Suggested fix:** require `SEED_USER_PASSWORD` from the environment, or print a random one on seed.

### F-07 · Low · Server · Disallowed CORS origin returns HTTP 500 with a stack trace in the log
- **Where:** `backend/src/index.js:39`, `corsOriginCheck` → `callback(new Error(...))` → `errorHandler`.
- **Evidence** (`audit/logs/02-auth.txt`):
  ```
  curl $API/api/leads -H 'Origin: https://evil.example.com'
  {"error":"Not allowed by CORS: https://evil.example.com"} [HTTP 500]
  ```
  The server log shows `Error: Not allowed by CORS … at corsOriginCheck (src/index.js:39:19)`. The preflight also returns `HTTP/1.1 500 Internal Server Error`.
- **Expected:** a non-error rejection, i.e. no `Access-Control-Allow-Origin` header, status 403 or a plain 204 without CORS headers. Not a 500 that counts as a server error and logs a stack on every request.
- **Actual:** HTTP 500. The browser still blocks the request, so this is not a security hole, but it pollutes the error logs and server-error metrics.
- **Suggested fix:** `return callback(null, false)` for disallowed origins.

### F-08 · Medium · Import · Cancel during the write phase is ignored but reported as successful
- **Where:** `backend/src/services/csvImport.js` `processImportJob`. The last cancel check is at `:466` ("Final gate"); after that, `commitImport()` inserts every row without checking the flag. `cancelImportJob` (`:552`) returns `{cancelled:true}` regardless.
- **Evidence** (`audit/logs/03-import.txt`, step j3):
  ```
  at cancel: 100% status=processing leads_written=393
  cancel -> {"cancelled":true,"jobId":16} [HTTP 200]
  after: job=completed cancelled_flag=true leads_written=5000
  ```
- **Repro:**
  1. Upload a 5,000-row CSV and process it.
  2. Poll `/api/imports/status/:id` until `percentage` is 100 while `status` is still `processing`.
  3. `POST /api/imports/cancel/:id`.
- **Expected:** either the cancel stops the inserts, or the API answers that it's too late to cancel.
- **Actual:** the user is told the import was cancelled, all 5,000 leads are imported, and the job ends `completed`. Cancelling before the write phase does work (step j-cancel: `status=cancelled`, 0 leads written).
- **Suggested fix:** in `cancelImportJob`, refuse (409) once commit has started. Or check the flag every N rows inside `commitImport` and stop.

### F-09 · Medium · Import · Phone numbers with an extension or letters are discarded and the original value is lost
- **Where:** `backend/src/utils/phoneNormalize.js:7` `normalizePhone`, which keeps only digits and requires exactly 10 or 11. `csvImport.commitImport` then imports the row with `phone=NULL, missing_phone=true`.
- **Evidence** (fixture `f_phones.csv`):
  ```
  Phone Extension | NULL | missing_phone t     (input "602-555-0605 x123")
  Phone Letters   | NULL | missing_phone t     (input "602-555-CALL")
  ```
  `importedWithoutPhone: 5` for this file. Neither the raw value nor the extension is stored anywhere (`leads` has no raw-phone column), so the lead shows "No number".
- **Expected:** `x123`/`ext. 123` is split off and kept, and vanity letters are converted. At minimum, keep the raw string so the rep can see it.
- **Actual:** a real, dialable number is thrown away and the lead becomes non-dialable.
- **Suggested fix:** strip `\s*(x|ext\.?)\s*\d+$` before counting digits and store the extension. Map letters to keypad digits. Keep the raw input in a column.

### F-10 · Medium · Import · With AI unavailable, the `office` column is never mapped, so brokerage comes from `source` (website domains)
- **Where:** `backend/src/services/csvImport.js` `guessMapping`, used by `routes/imports.js` `/upload` whenever `aiCsvMapper.mapColumns` fails or is unavailable. It only matches header text containing a field name (`brokerage`, `source`, …); a header named `office` matches nothing.
- **Evidence** (`audit/logs/03-import.txt`, fixture a, real path with Groq unreachable):
  ```
  upload a_clean.csv: mapping={"name":"name","phone":"phone","email":"email","state":"state","city":"city","source":"source"}
  Alice Archer | ... | kw.com | TX
  ```
  With the stub mapping, the same file maps `brokerage: "office"` and gives "Keller Williams".
- **Expected:** the handoff's typical file (`office` + `source` columns) maps `office` → brokerage even without AI.
- **Actual:** every lead gets the website domain as brokerage. Colleague intel (§8) then groups by the wrong office key.
- **Suggested fix:** add synonyms to `guessMapping` (`office|company|brokerage` → brokerage, `mobile|cell` → phone).

### F-11 · Low · Import · Progress reaches 100% long before rows are written
- **Where:** `csvImport.processImportJob`. `processed_rows` counts AI-cleaned rows only; the insert phase (`commitImport`) does not report progress.
- **Evidence** (step j2, every poll printed):
  ```
  t= 0.7s  100%  status=processing  leads_written=1215
  t= 1.3s  100%  status=processing  leads_written=2749
  t= 2.5s  100%  status=completed   leads_written=5000
  ```
- **Expected:** progress reflects rows written.
- **Actual:** the bar shows 100% while about 75% of rows are still pending. With real Groq latency, the gap is longer. This also widens the F-08 window.
- **Suggested fix:** report two phases ("cleaning", then "saving N/M"), or weight the bar.

### F-12 · Low · Import · The real scrape artifact (same name, everything else blank) is reported as "invalid", not merged
- **Where:** `csvImport.js` `mergeDuplicateRows` / `localityKey`. The identity is name + locality, and a row whose locality is blank does not match a row with "Dallas".
- **Evidence** (fixture `b_scrape.csv`, row b1 `Joshua Barkes,,,,,,`):
  ```
  "mergedDuplicates":1, "skippedInvalid":1, skippedDetails:[{"row":"Joshua Barkes","reason":"Could not determine a US state for this lead"}]
  ```
  The b2 variant (same name, same city kept) merged correctly.
- **Expected:** the duplicate is merged, or reported as a duplicate.
- **Actual:** no data is lost (the full row was imported), but the summary tells the user a row was invalid. The handoff described this exact pattern as one that merges.
- **Suggested fix:** in `mergeDuplicateRows`, let a row with a blank locality merge into a single same-name row that has one.

### F-13 · Low · Import · Upload validation gaps: any extension accepted, oversize gives 500, orphan jobs
- **Where:** `routes/imports.js` `/upload` (no extension check, unlike `/preview`'s `requireCsvFile`); multer `limits.fileSize` 15 MB → `errorHandler`.
- **Evidence:**
  - `upload k_fake.pdf -> {"jobId":18, …"headers":["%PDF-1.4"]…}` (accepted)
  - `upload k_wrong_ext.txt -> {"jobId":17…}` (accepted)
  - `upload k_oversized.csv (16500017B) -> {"error":"File too large"} [HTTP 500]`
  - `import_jobs`: `pending|2` left behind by uploads that were never processed
- **Expected:** a 400 for non-CSV/XLSX files, a 413 for too large, and pending jobs expire.
- **Actual:** as above. No crash, and the server stayed up (`/health` ok).
- **Suggested fix:** check the extension on `/upload`. Map `err.code === 'LIMIT_FILE_SIZE'` to 413 in `errorHandler`. Delete pending jobs older than a day.

### F-14 · Critical · Lifecycle · Locking race: one lead is handed to many simultaneous dials, and attempts blow past `max_attempts`
- **Where:** `backend/src/services/leadQueue.js` `lockNext` (`:62-99`). It reads the candidate (`peekNext`, or `SELECT … WHERE id=$1`), then runs `UPDATE leads SET status='in_progress' … WHERE id = $2` with **no status guard and no row lock** (`FOR UPDATE SKIP LOCKED`). `callSession.start` then increments `attempts` once per call.
- **Evidence** (`audit/logs/04-lifecycle.txt` §4.1; status codes mis-printed by my `xargs -I%`, but all 20 calls were created):
  ```
  20 parallel POST /api/calls {}  ->  calls created: 20   distinct leads: 4
   lead_id | calls | call_ids
         4 |    10 | {6,7,8,9,10,11,12,13,14,15}
         5 |     7 | {16,…,22}
   4 | James Whitfield | attempts 10 | in_progress
  10 parallel POST /api/calls {leadId:98} -> calls on lead 98: 10  attempts now: 10
  ```
  The end-of-§4 invariant I7 still shows `attempts > max_attempts` for leads 4 (11/5), 98 (10/5) and 5 (7/5).
- **Repro:**
  ```
  seq 1 20 | xargs -P20 -I% curl -s -X POST $API/api/calls -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{}'
  ```
  Then `select lead_id, count(*) from call_history group by 1 having count(*)>1`.
- **Expected:** each lead is locked by exactly one request. The rest get the next lead or 409.
- **Actual:** the same agent is phoned up to 10 times at once, and the retry cap is meaningless. This triggers in real use whenever two reps start dialing together, a double-click happens, or the dev-mode StrictMode double start fires (§10).
- **Suggested fix:** do it in one statement: `UPDATE leads SET … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` for "next". For by-id: `… WHERE id=$2 AND status = ANY(dialable) RETURNING *` and 409 if no row.

### F-15 · Critical · Lifecycle · The 30 s stale-lock sweep releases leads that are still on a live call; a second rep dials the same person, and dispositions have no ownership check
- **Where:**
  - `leadQueue.js` `releaseStaleLocks` (`:29-35`) releases **every** `in_progress` lead whose `locked_at` is over 30 s old. `locked_at` is only set at lock time and at hangup; nothing refreshes it during a live call.
  - `leadLifecycle.js` `applyDisposition` never checks `call.user_id` or `lead.locked_by` against the caller (the route passes no user).
- **Evidence** (§4.3 third run, forced *answered* outcome, two real users):
  ```
  user1 starts call 40 on lead 57, no hangup
  t=33s call 40 telephony_state=answered
  after one dashboard read: lead 57 = in_queue locked_by=null
  user2 dials the same lead: "call":{"id":41 [HTTP 201]
   40 | 57 | user 1 | answered |
   41 | 57 | user 2 | answered |
  user1 dispositions the original call while user2 is on the lead: "status":"voicemail" [HTTP 200]
   57 | voicemail | locked_by NULL
  ```
- **Repro:** start a call; keep it answered for more than 30 s (a normal conversation); load the dashboard (any `GET /api/leads`); dial the same lead from another account.
- **Expected:** a lead on a live call stays locked to its rep until hangup or disposition (CLAUDE.md: return to the queue "after 30 seconds" only "if they hang up without submitting a disposition").
- **Actual:** after about 30 s any queue read frees it. Another rep or a multi-line slot can call the same person mid-conversation. Either rep can then disposition the other's call and unlock the lead from under them.
- **Suggested fix:** sweep only leads whose latest call has `ended_at IS NOT NULL` (hung up), or heartbeat `locked_at` from the call screen. In `applyDisposition`, require `call.user_id = req.user.sub` (or a supervisor).

### F-16 · Critical · DNC / Data · Editing a lead's phone stores it un-normalised, which bypasses the DNC list and dedup; a DNC'd number was dialed using only the API
- **Where:**
  - `backend/src/services/leadQueue.js` `updateFields` (`:337-345`) writes `fields.phone` verbatim; `createLead` normalises, `updateFields` doesn't.
  - The single-line dial path, `lockNext` (`leadQueue.js:62-99`), checks only `lead.dnc_flag`, never `dnc_list`. The multi-line `reserveSlot` and the manual dial pad do check `dnc_list`.
- **Evidence** (§4.8h–i, no SQL used):
  ```
  1. PUT /api/leads/11 {"phone":"(214) 555-0199"}  -> 200   (DNC lead's number edited away)
  2. PUT /api/leads/63 {"phone":"(214) 555-0101"}  -> 200, dnc_flag false   (the DNC'd number)
     dnc_list still has +12145550101: 1
  3. POST /api/calls {leadId:63} -> "call":{"id":55 [HTTP 201]      <- DNC'd person dialed
   11 | Alice Archer  | (214) 555-0199 | dnc_flag t
   63 | Bulk Agent 14 | (214) 555-0102 |            <- stored raw, not +1…
  duplicate person: 14 | Dan Diaz | +16025550104   and   63 | Bulk Agent 14 | +1 (602) 555-0104
  ```
  `POST /api/leads` with the same number is correctly refused (`409 "This number is on the DNC list…"`), so only the edit path is open. Invariant I8 shows `phones not in E.164: 3`.
- **Expected:** a number on the DNC list is never dialed by any path (CLAUDE.md "dnc — legally protected, never dial again"), and phones are stored normalised so the unique constraint and DNC lookups work.
- **Actual:** an edit plus a single-line dial reaches a DNC'd number. Duplicates of the same person also become possible.
- **Suggested fix:** normalise and validate `phone` (and `state`) in `updateFields` the way `createLead` does, and reject DNC'd numbers there. Add `dncCheck.isOnDncList(lead.phone)` to `lockNext`. Optionally add a DB `CHECK (phone ~ '^\+1[2-9]\d{9}$')`.

### F-17 · High · Lifecycle · `no_contact_person` cascades by name alone to other people in other states; Undo does not reverse it
- **Where:** `leadLifecycle.js` `applyDisposition`, the cascade block (`:130-142`): `WHERE id != $1 AND lower(trim(name)) = lower(trim($3)) AND status NOT IN ('dnc','cold')`. `undoDisposition` restores only the one lead (documented in a code comment).
- **Evidence** (§4.7; three synthetic SQL leads named "Sam Same" in TX, FL and AZ, the AZ one `callback_scheduled`):
  ```
  dispo no_contact_person on 15049 (TX): "cascadedLeadIds":[15050,15051]
   15050 | FL | cold | no_contact_person
   15051 | AZ | cold | no_contact_person     <- had a scheduled callback
  undo -> 15049 back to in_progress; 15050 and 15051 stay cold
  ```
- **Expected:** "no_contact_person locks all numbers for **that lead**" (CLAUDE.md).
- **Actual:** every lead in the database with the same name, in any state, is parked, including a different person's scheduled callback. Undo leaves them parked. With scraped lists, common names collide.
- **Suggested fix:** remove the name cascade, since a lead has one phone, or scope it to the same name + office/state and include those leads in the undo snapshot.

### F-18 · High · Legal · Calling hours use one time zone per state, so multi-zone states are dialed outside 8am–9pm local
- **Where:** `backend/src/services/callingHours.js` `STATE_TIMEZONES` / `timezoneForState`. The code comment calls this "a documented phase-1 simplification".
- **Evidence** (§4.10 re-run, controlled clock, toggle ON):
  ```
  TX El Paso      mapped America/Chicago     allowed from … = 7:00 AM MST in El Paso
  FL Pensacola    mapped America/New_York    allowed from … = 7:00 AM CST in Pensacola
  KY Bowling Green / IN Gary                 allowed from 7:00 AM local
  OR Ontario / TN Knoxville                  last allowed … = 9:59 PM local
  unknown/invalid state code falls back to America/New_York (PR, GU too)
  ```
- **Expected:** refuse outside 8am–9pm **local time of the lead** (CLAUDE.md, TCPA).
- **Actual:** calls are allowed one hour early or one hour late for leads in the Mountain/Central parts of TX, FL, KY, IN, TN, ID and OR. Single-zone states are correct at every boundary (07:59 block, 08:00 allow, 20:59 allow, 21:00 block for FL, AZ, HI, CA, TX, NY and AK), and DST is handled.
- **Suggested fix:** derive the zone from the phone's area code (more precise) or the city, or use the *intersection*: allow only when every zone in the state is within hours.

### F-19 · High · Legal · The manual dial pad ignores calling hours
- **Where:** `backend/src/services/callSession.js` `startManual` (`:76-110`). It checks the DNC list (`:84`) but has no `callingHours` call.
- **Evidence** (§4.11, real clock 11:00Z = 06:00 ET, toggle ON):
  ```
  POST /api/calls {leadId: TX lead}            -> 422 "Outside calling hours for TX (8am-9pm local time)…"
  POST /api/calls/manual/start (713) 555-4242  -> "id":58 [HTTP 201]      <- dialed at 5 AM Central
  ```
- **Expected:** the same 8am–9pm guard on every outbound path.
- **Actual:** the dial pad bypasses it.
- **Suggested fix:** in `startManual`, infer the state from the area code (`utils/stateFromAreaCode`) and call `assertCallingHours`.

### F-20 · High · Queue · Queue starvation: 50 out-of-hours leads at the front hide every in-hours lead
- **Where:** `leadQueue.js` `peekNext`: `rows = await candidates()` (`LIMIT 50`), then `rows.find(isWithinCallingHours)`.
- **Evidence** (§4.12, controlled clock 15:30Z, toggle ON, 60 synthetic CA callbacks due):
  ```
  control: next lead … TX
  Dialable in-hours (ET/CT) leads still in queue: 10518
  POST /api/calls {} : {"error":"No dialable leads in queue right now"} [HTTP 404]
  after cleanup: TX
  ```
- **Expected:** the next in-hours lead is served.
- **Actual:** "No dialable leads" whenever 50+ higher-priority leads (callbacks, older requeues) are in states that are currently closed. This is the normal situation each morning, when West Coast callbacks are due before the West Coast opens.
- **Suggested fix:** filter by hours in SQL (compute the allowed states for "now" and add `AND state = ANY($allowed)`), or page through candidates until one matches.

### F-21 · High · Lifecycle · Undo after "Callback scheduled" crashes with HTTP 500 (Postgres syntax error)
- **Where:** `backend/src/services/leadLifecycle.js:218`, `undoDisposition`:
  `'DELETE FROM callbacks WHERE lead_id = $1 AND done = false ORDER BY created_at DESC LIMIT 1'`. Postgres `DELETE` accepts neither `ORDER BY` nor `LIMIT`.
- **Evidence** (§4.9):
  ```
  undo: {"error":"syntax error at or near \"ORDER\""} [HTTP 500]
  lead after failed undo: callback_scheduled ; callbacks rows: 1
  ```
  Server log: `error: syntax error at or near "ORDER"`.
- **Repro:** dial, disposition `callback_scheduled` with `scheduledAt`, then `POST /api/dispositions/:callId/undo` within 10 s.
- **Expected:** the lead is restored and the callback row is removed.
- **Actual:** 500 and the whole transaction rolls back. The UI's Undo button fails for callbacks. The same line is on `main`.
- **Suggested fix:** `DELETE FROM callbacks WHERE id = (SELECT id FROM callbacks WHERE lead_id=$1 AND done=false ORDER BY created_at DESC LIMIT 1)`.

### F-22 · Medium · Lifecycle · A soft-deleted lead can still be dialed by id
- **Where:** `leadQueue.js` `lockNext`, by-id branch (`:65-80`). It has no `deleted_at IS NULL` check, while `candidates()` has one.
- **Evidence** (§4.8g):
  ```
  delete: [HTTP 200]  deleted_at set=t
  dial by id: "call":{"id":54 [HTTP 201]
  ```
- **Expected:** 404 or 409. **Actual:** the deleted lead is dialed.
- **Suggested fix:** add `AND deleted_at IS NULL` to the by-id `SELECT`.

### F-23 · Medium · Lifecycle · `no_contact_number` is a dead end: one phone per lead, no recovery, no "next" rule
- **Where:** the schema has a single `leads.phone` (`phone_numbers` holds caller IDs, not lead numbers). `applyDisposition` sets `status='no_contact_number', next_action_at=NULL`. `updateFields` never changes status.
- **Evidence** (§4.6):
  ```
  60 | no_contact_number | +17135551001 | next_action_at NULL
  re-dial: {"error":"Lead is not dialable (status: no_contact_number)"} [HTTP 409]
  PUT /api/leads/60 {"phone":"(713) 555-7777"} -> status still no_contact_number; re-dial -> 409
  ```
  No code path moves a lead out of `no_contact_number` (grep).
- **Expected:** CLAUDE.md says "other numbers on the lead stay dialable", and every status needs "an explicit rule for what happens next".
- **Actual:** there are no other numbers. Fixing the number doesn't requeue the lead, so it is parked forever.
- **Suggested fix:** when `phone` changes on a `no_contact_number` lead, move it to `in_queue`. Longer term, support multiple numbers per lead as the spec describes.

### F-24 · Low · Lifecycle · The stale-lock sweep only runs on some reads; nothing runs it on a timer
- **Where:** `leadQueue.releaseStaleLocks` is called from `candidates`, `lockNext`, `countsByState` and `list` only. Not from `search`, not on a schedule.
- **Evidence** (§4.2):
  ```
  (a) without any queue read: DB status after 40s -> status=in_progress locked_at age=40s
  (b) one GET /api/leads/state-counts -> status=in_queue
  (c) polling GET /api/leads/search only: lead 53 still in_progress after 60s
  (c2) polling GET /api/leads?pageSize=1 -> back to in_queue after 31s
  ```
- **Expected:** back in the queue about 30 s after hangup. **Actual:** correct when the dashboard is open; otherwise a lead stays `in_progress` until the next queue read. It isn't lost, but reports show it as in progress.
- **Suggested fix:** a `setInterval(releaseStaleLocks, 10_000)` in `index.js`, or keep it lazy and document it.

### F-25 · Low · Lifecycle · Calls that end without a disposition never get `ended_at`, so they stay open forever
- **Where:** `callSession.js:52`, `:99` and `:190`. The adapter's `ended` event only does `UPDATE call_history SET telephony_state = $2`; `ended_at` and `duration_seconds` are set only by hangup or disposition.
- **Evidence:** invariant I5, `dangling_calls: 35` (never dispositioned, never ended, older than 5 min). I6 shows leads with up to 11 open calls.
- **Expected:** a call the network ended is closed with its duration.
- **Actual:** the rows stay open. They feed duration and connect-rate maths and confuse "open call" checks.
- **Suggested fix:** on `ended`, also set `ended_at = now()` and `duration_seconds = event.duration` when `ended_at IS NULL`.

### F-26 · Low · Lifecycle · Turning the calling-hours toggle off takes ~13–15 s, not the documented 5 s
- **Where:** `callingHours.js` `refreshEnforcedCache` / `isCallingHoursEnforced`. The first read after the cache expires returns the stale value and only *starts* the refresh.
- **Evidence** (§4.11):
  ```
  immediately after OFF -> 422;  6s after OFF -> 422;  13 s after the settings row changed -> 201
  ```
- **Suggested fix:** await the refresh when the cache is stale, or have the settings `PUT` invalidate the cache directly.

### F-27 · Critical · Multi-line · In a single rep's session, several lines dial the same lead at once
- **Where:** `backend/src/services/callSession.js`. `releaseSlot` → `dialIntoSlot` → `reserveSlot` → `leadQueue.lockNext()` runs concurrently for every line that frees up at the same moment. The code's own comment at `reserveSlot` says: *"Callers must await these one at a time … three concurrent calls all read before any of them write and every line ends up on the same lead."* Only `startMultilineSession` serialises; the refill path does not. The root cause is F-14.
- **Evidence** (`audit/logs/05-sessions.txt` §5.4, mock outcome forced to `no_answer` so all lines end together):
  ```
   id  | lead_id | user_id | session_id | slot_number |   started    | disposition
   123 |      30 |       1 |          7 |           1 | 11:06:19.578 | no_answer
   124 |      30 |       1 |          7 |           3 | 11:06:19.578 | no_answer
   125 |      30 |       1 |          7 |           2 | 11:06:19.582 | no_answer
   126 |      31 |       2 |          6 |           1 | 11:06:19.590 | no_answer
   127 |      31 |       2 |          6 |           2 | 11:06:19.595 | no_answer
   128 |      31 |       2 |          6 |           3 | 11:06:19.600 | no_answer
  ```
  23 overlapping same-lead call pairs in a 15 s run. Leads 27–29 and 41 were also dialed by both users.
- **Repro:** `node audit/scripts/sse-session.js $SCRATCH/token 3 15 '[]'` with `echo no_answer > /var/tmp/audit-scratch/force-outcome`, then query `call_history` for the same `lead_id` and `session_id` across slots.
- **Expected:** each line dials a different lead.
- **Actual:** one person gets 3 simultaneous calls from one rep, and the attempt counter and disposition each apply 3 times. With real telephony, lines end at nearly the same time often (busy signals, carrier no-answer timeouts).
- **Suggested fix:** fix F-14 (atomic `SKIP LOCKED` claim) and/or serialise refills per session with a promise chain (`session.refill = session.refill.then(() => dialIntoSlot(...))`).

### F-28 · High · Multi-line · A session keeps dialing after the rep's browser disconnects
- **Where:** `backend/src/routes/calls.js` `GET /stream`: `req.on('close')` only removes the event listener. `callSession.js` multi-line sessions live in `multilineSessions` until `/multiline/stop`.
- **Evidence** (§5.3, SSE closed at t=4 s):
  ```
  calls placed by the session: at t~5s=6, 20s after the listener left=27
  stop: {"abandonedCount":3}   calls after stop: 30 -> 8s later 30
  ```
- **Expected:** closing the tab, a laptop sleeping or a network drop stops (or pauses) the dialer.
- **Actual:** it keeps placing about one call per line every 3 s with nobody listening. With real telephony, answered calls would reach a person with no rep, which are abandoned calls (see §7 of this report on abandonment rules).
- **Suggested fix:** on SSE `close`, if it was the user's last stream, call `stopMultilineSession(userId)` after a short grace period (for example 10 s, to survive reconnects).

### F-29 · Medium · Multi-line · Stop (or a crash) orphans answered and held calls: leads stay `in_progress`, calls stay open, session never ends
- **Where:**
  - `callSession.js` `stopMultilineSession`: slots in `LIVE_CALL_STATUSES` (`answered`, `active_disposition`, `held`) are removed from the session but neither abandoned nor dispositioned.
  - After a restart, `multilineSessions` (in-memory) is empty and `dialing_sessions.ended_at` stays NULL.
- **Evidence:**
  - §5.2: after stop, call 74 (held), lead 9 = `in_progress` / `was_abandoned f`; call 72 (promoted), lead 7 = `in_progress`.
  - §5.5: after kill + restart, `in_progress = 3`. The leads were freed only by the lazy sweep about 31 s later. Calls 147–149 stayed `answered … open t`, and `dialing_sessions … id=8 ended_at=NULL`.
- **Expected:** a held caller is either kept and surfaced to the rep, or ended and recorded as abandoned. The session is closed.
- **Actual:** the held person is silently dropped from the UI. The lead returns to the queue with an attempt used and an open call row. Session stats never close.
- **Suggested fix:** in `stopMultilineSession`, return held slots to the client (or abandon them with `was_abandoned=true`). On startup, close `dialing_sessions` with `ended_at IS NULL` and end open calls.

### F-30 · Medium · Telephony · A telephony failure leaves the lead locked, an attempt used and a phantom "ringing" call
- **Where:** `callSession.js` `start` (`:37-60`) inserts `call_history`, increments `attempts`, then calls `telephony.placeCall`. There is no try/catch or rollback when the adapter throws.
- **Evidence** (§5.7):
  ```
  TELEPHONY_PROVIDER=twilio  POST /api/calls {leadId:50} -> 500 "twilioAdapter is not implemented yet — set TELEPHONY_PROVIDER=mock"
  lead 50 after: status=in_progress attempts=1 locked_by=1; call rows: 1 (telephony_state ringing)
  ```
  The same happens with `TELEPHONY_PROVIDER=bogus`.
- **Expected:** a failed dial doesn't count as an attempt and doesn't hold the lead.
- **Actual:** in Phase 2 every Twilio error (bad number, auth, rate limit) will burn an attempt and hold the lead for 30 s. The call log shows calls that never happened.
- **Suggested fix:** call `placeCall` inside try/catch. On failure, delete or mark the call row `failed`, decrement or skip the attempt, and release the lock.

### F-31 · Low · Config · Invalid provider names are accepted at startup and only fail per request
- **Where:** `telephony/index.js` `getAdapter`, `telephony/smsIndex.js` and `telephony/emailIndex.js` resolve the adapter lazily.
- **Evidence:** `TELEPHONY_PROVIDER=bogus` gives "server STARTED", then the first call returns `500 Unknown TELEPHONY_PROVIDER: "bogus"`. `SMS_PROVIDER=bogus` gives `500 Unknown SMS_PROVIDER`.
- **Suggested fix:** validate all three providers in `config/index.js` at boot, the way the missing-table check does.

### F-32 · Medium · Authorization · Any logged-in rep can disposition, undo or hang up another rep's call
- **Where:**
  - `routes/dispositions.js` (`POST /`, `POST /:callId/undo`) and `routes/calls.js` (`POST /:id/hangup`) pass no user to `leadLifecycle.applyDisposition`, `undoDisposition` or `hangup`, and those functions never compare `call.user_id` / `lead.locked_by` with the caller.
  - The same applies to `GET /api/calls/:id`, `/api/leads/*` and the other routes: every authenticated user sees and edits everything. That is acceptable for a single user, but the handoff says colleagues will use it.
- **Evidence** (`audit/logs/06-dispositions.txt` §6.3):
  ```
  call 164 user=1 lead locked_by=1
  user2 POST /api/dispositions dnc: "status":"dnc" [HTTP 200]
  user2 undo: "status":"in_progress" [HTTP 200]
  user2 hangup on user1's call: {"gracePeriodSeconds":30} [HTTP 200]
  ```
- **Expected:** "multi-user ready" (CLAUDE.md): a rep acts only on their own calls, or a supervisor role is required.
- **Actual:** a mis-click or a wrong call ID from one colleague can DNC another rep's live lead. This is the second half of F-15.
- **Suggested fix:** pass `req.user` into these services and 403 when `call.user_id !== user.sub && user.role !== 'supervisor'`.

### F-33 · Medium · Call screen · "Previous Notes" never shows notes added mid-call with "Add note"
- **Where:** `frontend/src/components/call/DispositionPanel.jsx:51` loads only `api.getLeadHistory(leadId)`, which reads `call_history.note`. The action grid's "Add note" posts to `POST /api/leads/:id/notes`, which stores rows in `lead_notes`.
- **Evidence** (§6.2):
  ```
  lead 69 /history: [[153,"contacted","note for contacted on lead 69"]]
  lead 69 /notes:   [[1,null,"standalone note on 69"]]          <- not in /history
  lead 69 /timeline: [["note","standalone note on 69"],["call","note for contacted on lead 69"]]
  ```
- **Expected:** on the next call, the rep sees everything previously noted about the lead.
- **Actual:** notes typed into the mid-call "Add note" box appear only on the lead page timeline, never in the call screen's Previous Notes. The brief (`preCallBrief`) does read the timeline.
- **Suggested fix:** have `DispositionPanel` load `/api/leads/:id/timeline`, or merge `/notes` into `/history`.

### F-34 · Medium · Reports · "Today" is UTC midnight, which splits the owner's calling shift in two
- **Where:**
  - `backend/src/services/reports.js:17` and `:42`: `started_at >= date_trunc('day', now())`, with the DB session timezone `Etc/UTC`.
  - `pdfExport.buildDailyReportBuffer` uses the server-local day (§9).
  - The frontend daily goal (`Dashboard.jsx`) reads `/api/reports/today`.
- **Evidence:**
  ```
  DB session TimeZone: Etc/UTC   server process TZ: UTC
  UTC day start=2026-11-11 00:00:00+00 | PKT day start=2026-11-10 19:00:00+00 | ET day start=2026-11-11 05:00:00+00
  ```
- **Expected:** "today" means the rep's working day. US calling hours (8am–9pm ET) are 18:00–07:00 in Pakistan.
- **Actual:** the counters, daily goal and daily report reset at 05:00 Pakistan time, in the middle of every shift, so one night's work is split across two "days".
- **Suggested fix:** make the reporting timezone a setting (default `Asia/Karachi`, or the shift start) and use `date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz`.

### F-35 · Low · Dispositions · Callback time not validated: past times accepted; garbage gives a 500 with a raw Postgres error
- **Where:** `leadLifecycle.applyDisposition` only checks `!scheduledAt`. `new Date("next tuesday")` reaches Postgres.
- **Evidence** (§6.1):
  ```
  scheduledAt 2020-01-01 -> "status":"callback_scheduled" "next_action_at":"2020-01-01T00:00:00.000Z" [HTTP 200]
  scheduledAt "next tuesday" -> {"error":"invalid input syntax for type timestamp with time zone: \"0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN\""} [HTTP 500]
  ```
  `POST /api/leads/:id/callback` validates (`leadQueue.js:183` "A valid callback date and time is required"); the disposition path doesn't.
- **Suggested fix:** reuse that validation: a 400 for invalid times, a 400 (or a warning) for past ones.

### F-36 · Low · Notes · A note can be linked to a call from a different lead
- **Where:** `leadQueue.addNote` stores `callId` without checking `call_history.lead_id = leadId`.
- **Evidence:** `POST /api/leads/69/notes {"callId":154}` (call 154 is lead 249) gave `"lead_id":69 "call_id":154 [HTTP 201]`.
- **Suggested fix:** verify the call belongs to the lead, or 400.

### F-37 · High · SMS / Legal · No inbound SMS path: STOP replies can't be processed, the inbox can never fill, there's no opt-back-in
- **Where:** no route accepts an inbound message (route list: only `send`, `bulk-send`, `inbox`, `mark-read`, `opt-out`, templates and `upload-media` under `/api/sms`). `telephony/mockSmsAdapter.js` is send-only. Nothing parses keywords. `smsService.getInbox` (`:156`) only reads `direction='inbound'` rows, which no code path creates.
- **Evidence** (`audit/logs/07-sms-email.txt` §7.3–7.5):
  ```
  => every STOP variant (STOP, stop, "Stop.", UNSUBSCRIBE, QUIT, CANCEL, END, START/UNSTOP): MISSING
  (DB-seeded inbound row 'STOP' for lead 22)  ->  lead 22 sms_opt_out after an inbound 'STOP' row exists: f
  is there a way to undo an opt-out (START)? routes: 0 matching
  ```
  With inbound rows inserted by SQL, the inbox, unread count, mark-read and timeline all render correctly, so the read side works.
- **Expected** (handoff §4/§3): "SMS … opt-out, inbox", and "A STOP text sets `sms_opt_out` only".
- **Actual:** opt-out is only possible by a rep clicking a button. On real SMS (Phase 2), a recipient's STOP would be ignored and they'd keep getting bulk texts. That is a carrier and TCPA compliance problem.
- **Suggested fix:** add `POST /api/sms/inbound` (provider webhook shape, mock-callable). Store the row; if the normalised body matches `STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT`, set `sms_opt_out` only (never DNC); `START|UNSTOP` clears it.

### F-38 · Medium · SMS · Unsupported template placeholders are sent to the lead literally
- **Where:** `backend/src/services/smsService.js:9` `mergeFields`. It replaces only `{{name}}`, `{{brokerage}}` and `{{state}}`, does no unknown-placeholder check, and template save doesn't validate either.
- **Evidence** (§7.1):
  ```
  template 2 -> lead 22: Hi {first_name}, {{first_name}} — {{ name }} / {{Name}} / {{city}}
  template 1 -> lead 15050 (no brokerage): Hi Sam Same at in FL!
  ```
- **Expected:** a missing or unknown field never leaks a placeholder into a sent message.
- **Actual:** the literal braces reach the recipient (stored as sent: `status 'sent'`). An empty field leaves "at in".
- **Suggested fix:** reject templates containing `{…}` tokens other than the supported list at save time, and refuse to send if any `{{…}}` remains after merging. Support `{{first_name}}`.

### F-39 · Medium · SMS / Legal · Texts ignore calling hours
- **Where:** `smsService.sendSms` / `sendBulkSms` never call `callingHours`.
- **Evidence** (§7.4, 06:11 ET, `calling_hours_enforced=true`):
  ```
  call to a TX lead: "error":"Outside calling hours for TX (8am-9pm local time)…" [HTTP 422]
  SMS to lead 22 (FL): "status":"sent" [HTTP 201]
  ```
- **Expected:** marketing texts follow the same 8am–9pm local window as calls (TCPA quiet hours apply to texts; some states are stricter).
- **Actual:** texts go out at any hour. This needs a decision (§7 of this report) but is currently unenforced.
- **Suggested fix:** call `assertCallingHours(lead.state)` in `sendSms` and filter bulk recipients by it.

### F-40 · Medium · Security · Uploaded media is public, any file type is accepted, and HTML is served as a page
- **Where:**
  - `backend/src/index.js` `app.use('/uploads', express.static(UPLOADS_DIR))`: no auth.
  - `routes/sms.js` `uploadMedia`: multer with `limits.fileSize` 5 MB and **no `fileFilter`**; the original extension is kept.
  - `smsService.sendSms` stores any `mediaUrl`.
- **Evidence** (§7.6):
  ```
  page.html -> {"url":"/uploads/…a818b5b0e797.html"}   GET it WITHOUT any token -> 200 content-type=text/html
  tool.exe  -> {"url":"/uploads/…cfa597d7d65d.exe"}    GET … -> 200 content-type=application/x-msdos-program
  big.png (6000000B) -> {"error":"File is too large — the limit is 5MB"} [HTTP 400]     (limit works)
  mediaUrl "https://evil.example.com/x.png" -> stored and "sent" [HTTP 201]
  ```
- **Expected:** MMS media limited to image types, served only to the app or to the carrier via a signed URL.
- **Actual:** an authenticated user can host arbitrary files (HTML/JS, executables) on the API origin, readable by anyone who has the URL.
- **Suggested fix:** add a `fileFilter` allowing `image/jpeg|png|gif`, serve with `Content-Disposition: attachment` / `X-Content-Type-Options: nosniff`, and validate that `mediaUrl` starts with `/uploads/`.

### F-41 · Low · Email · Empty subject accepted; mock send leaves no trace in the server log
- **Where:** `services/emailService.js` (requires the body only); `telephony/mockEmailAdapter.js` (no output).
- **Evidence:** `missing subject: … "subject":"" … "status":"sent" [HTTP 201]`; `mockEmailAdapter.js has no console output` (the SMS mock does log media).
- **Suggested fix:** require a subject (or default one). Log `[mockEmailAdapter] would send to …` like the SMS mock.

### F-42 · Low · Coaching · Pre-call brief says "A few agents … have already been interested" when there is exactly one
- **Where:** `backend/src/services/preCallBrief.js`, the instant opener built from the `colleagues` summary.
- **Evidence** (`audit/logs/08-objections-ai.txt` §8.8): a colleague summary of `"interested":1` gives the opener `A few agents at Compass · Miami, FL have already been interested in what we do.`
- **Expected:** plain, accurate coaching for newer callers (handoff §1), e.g. "Another agent at …".
- **Actual:** it overstates the evidence. A rep repeating it to the lead would be saying something untrue.
- **Suggested fix:** branch on the count (1 → "Another agent", 2+ → "{n} agents").

### F-43 · Low · Rebuttal coach · Flagged suggestions can be approved with no warning, then become top few-shot examples and the call-screen hint
- **Where:** `rebuttalCoach.reviewSuggestion` (no check on `review_note`). `fewShotExamples` puts approved ones first. `getHints` shows the newest approved.
- **Evidence** (§8.4–8.5):
  - Approving #8 ("needs manual rewrite: used 'innovative', 'optimize'") returned `"status":"approved" [HTTP 200]`.
  - The hint became `{"text":"Our innovative solution will optimize your day.","source":"ai"}`.
  - The next prompt's `Example 1 (approved by the team): "Our innovative solution will optimize your day."`.
- **Expected:** a suggestion that failed the banned-phrase or length check can't be approved unedited, or the reviewer gets an explicit warning.
- **Actual:** the feedback loop can teach the model the exact phrases the prompt bans.
- **Suggested fix:** in `reviewSuggestion`, reject approval while `review_note` starts with "needs manual rewrite" unless the text was edited. Re-run `describeViolations` on approval.

### F-44 · Low · Rebuttal coach · Each "Regenerate" adds another pending batch and the list shows all of them
- **Where:** `rebuttalCoach.js`, the list query (`:255-258`, `status IN ('approved','pending') ORDER BY … generated_at DESC`). Its comment says "then the newest pending batch", but it returns every pending row.
- **Evidence:** after 4 regenerations the response held 12 suggestions, including the earlier batches and the flagged ones. `pending queue (reviewer view): 12 pending`.
- **Suggested fix:** return only the latest `generated_at` batch of pending rows, or expire older pending batches on regenerate.

## 4. Verified working

### §1 Static checks (`audit/logs/01-static.txt`)

| Check | Result | Evidence |
|---|---|---|
| Frontend build | **Pass** | `npm run build` printed `✓ built in 2.06s` (318.51 kB JS) |
| Lint | **N/A** | `no lint script in either package.json`, so none was invented |
| Backend syntax | **Pass** | `node --check` on every file: `checked=56 failed=0` |
| Imports resolve to declared deps | **Pass** | `audit/scripts/deps-check.js`: frontend 7 packages and backend 12 packages, all `DECLARED` and `installed=true`. No declared dependency is unused |
| `lucide-react` | **Declared, not a bug** | `frontend/package.json:12: "lucide-react": "^0.469.0"`, added in `088780a` (visual polish). Moving `node_modules/lucide-react` aside reproduces the exact Codespaces error, `Rollup failed to resolve import "lucide-react" from ".../pages/ManualCall.jsx"`. Restoring it builds again. **Cause: `npm install` was not re-run after switching to this branch** |
| Migration numbering | **Pass** | 22 files, `001`–`022`, no duplicates, no gaps |
| Migrate on empty DB, then again | **Pass** | Run 2 printed `Migrations up to date.` with exit 0. `pg_dump -s` before vs after differs only in pg_dump's random `\restrict` token (932 lines otherwise identical). Re-executing every migration file's SQL directly, bypassing `schema_migrations`, also succeeds with zero errors |
| Columns referenced by INSERT/UPDATE exist | **Pass** | `audit/scripts/schema-check.js`: `column/table problems: 0` across 26 INSERTs and every static `UPDATE … SET` |
| INSERT column/value order | **Pass** | All 26 reviewed. Script output, plus a manual read of `leadLifecycle.js:125`, `dialingSession.js:28`, `leadQueue.js:195`, `rebuttalCoach.js:391-396` and `seedObjectionDemo.js:113`, where the regex picked the wrong params array. `rebuttal_suggestions` now binds `($1 type, $2 count, $n text, $n+1 note)` to `(objection_type_id, based_on_count, suggestion, review_note)`, which is correct. A live insert and read-back is in §8 |
| Frontend never touches the DB | **Pass** | `grep -rnE "\bpg\b|postgres|DATABASE_URL" frontend/src` returns `none` |
| `placeCall(fromNumber, toNumber, onEvent) → callId` | **Pass (signature)** | `telephony/index.js:38` is unchanged. Event set widened: see F-05 |
| Route coverage | **Pass** | `audit/scripts/routes.js`: 77 routes, all under `requireAuth` except `POST /api/auth/login`, `GET /api/calls/stream` (own `?token=` check, tested in §2) and `GET /health`. `audit/scripts/apijs-calls.js`: all 76 calls in `frontend/src/lib/api.js` match a real route. `frontend calls with no backend route: 0`; the only uncalled route is `/health`. No `fetch`/`EventSource` outside `api.js`. The first run showed 5 false "MISSING" from nested `${qs}` templates; the parser was fixed and re-run, and both outputs are in the log |
| Committed `.env` | **Pass** | `git ls-files` shows `none tracked` |

### §2 Auth and server basics (`audit/logs/02-auth.txt`)

| Check | Result | Evidence |
|---|---|---|
| Login with the seeded user | **Pass** | `{"token":"<jwt>","user":{"id":1,…,"role":"supervisor"}} [HTTP 200]` |
| Wrong password / unknown user | **Pass** | Both return `{"error":"Invalid email or password"} [HTTP 401]` (same message, so no user enumeration) |
| Empty body | **Pass** | `{"error":"email and password are required"} [HTTP 400]` |
| Login brute-force limiter | **Pass** | 7 rapid bad logins: attempts 1–5 got `401`, attempts 6–7 got `429` (`loginLimiter` max 5/min/IP) |
| Every protected route rejects bad tokens | **Pass** | `audit/scripts/auth-matrix.js`: **75 protected routes + SSE**, each hit with no token, `Bearer garbage`, a correctly-signed **expired** JWT, and a JWT signed with the **wrong secret**. Result: `routes not returning 401 for every bad token: 0`. SSE `?token=` returned `401 \| 401 \| 401 \| 401`. Full table in the log. The first unpaced run hit the 100/min API limiter (`429` on 53 routes) before auth; the run was paced at 670 ms/request and repeated. Both runs are logged |
| Startup without `JWT_SECRET` | **Pass** | `Error: Missing required environment variable: JWT_SECRET`, exit 1 |
| Startup without `DATABASE_URL` | **Pass** | `Error: Missing required environment variable: DATABASE_URL`, exit 1 |
| Startup with a bad DB password | **Pass** | `Could not verify the database schema on startup: password authentication failed for user "vortex"`, exit 1. On `latest` this fails fast at startup; on `main` it only surfaced at login, which is the error the owner hit in Codespaces |
| CORS allowed origin | **Pass** | `http://localhost:5173` gets `204` + `Access-Control-Allow-Origin: http://localhost:5173` |
| CORS `*.app.github.dev`, dev only | **Pass** | `https://glorious-fiesta-x-5173.app.github.dev` is allowed with `NODE_ENV=development` and refused with `NODE_ENV=production`. Look-alikes `https://evil.app.github.dev.attacker.com` and `http://x.app.github.dev` are refused in both modes. Refusals are an HTTP 500 (F-07) |
| Unreachable API message (see below) | **Pass** | Production build with the backend stopped: `Couldn't reach the server — check that the backend is running and the app's URL is up to date`, after `POST http://localhost:4000/api/auth/login -> net::ERR_CONNECTION_REFUSED`. Screenshot: `audit/screenshots/02-login-backend-down.png` |


### §3 Import and data cleaning (`audit/logs/03-import.txt`)

All imports used the real background-job path: `POST /api/imports/upload`, then `/process` with the upload's mapping, then polling `/status/:id`.

- **Fixture (a)** ran with Groq genuinely unreachable (dummy key).
- **Everything else** ran with `GROQ_BASE_URL` pointed at `audit/stubs/groq-stub-server.js`. **The AI mapping and cleaning there are stubbed**: they prove the code around the model, not the model.

**Row conservation** (`totalRows = imported + mergedDuplicates + skippedDnc + skippedDuplicate + skippedInvalid + aiSkipped`), taken from each `resultSummary`:

| Fixture | totalRows | imported | merged | DNC | dup | invalid | Sum | Leads actually added (DB) |
|---|---|---|---|---|---|---|---|---|
| a clean (no AI) | 10 | 9 | 0 | 0 | 1 (fixture phone collided with a seed lead) | 0 | 10 ✓ | 9 |
| b scrape | 4 | 2 | 1 | 0 | 0 | 1 (see F-12) | 4 ✓ | 2 |
| c source | 2 | 2 | 0 | 0 | 0 | 0 | 2 ✓ | 2 |
| d no phone | 2 | 2 | 0 | 0 | 0 | 0 | 2 ✓ | 2 (`missing_phone=t`, phone `NULL`) |
| e merge | 4 | 3 | 1 | 0 | 0 | 0 | 4 ✓ | 3 |
| f phones | 10 | 10 | 0 | 0 | 0 | 0 | 10 ✓ | 10 (5 phoneless, F-09) |
| g state | 6 | 6 | 0 | 0 | 0 | 0 | 6 ✓ | 6 |
| h DNC | 2 | 1 | 0 | 1 | 0 | 0 | 2 ✓ | 1 |
| h2 DNC reformatted | 2 | 0 | 1 | 1 | 0 | 0 | 2 ✓ | 0 |
| i xlsx | 3 | 3 | 0 | 0 | 0 | 0 | 3 ✓ | 3 |
| j 5,000 | 5000 | 5000 | 0 | 0 | 0 | 0 | 5000 ✓ | 5000 |
| l a_clean again | 10 | 0 | 0 | 1 | 9 | 0 | 10 ✓ | 0 (count 48 → 48) |
| l2 phoneless again | 2 | 0 | 0 | 0 | 2 | 0 | 2 ✓ | 0 |

| Check | Result | Evidence |
|---|---|---|
| Name + city merge (e) | **Pass** | "Pat Price" Austin and Houston stay **2 leads**. "Quinn Quade" Austin ×2 becomes **1 lead** with the email from the second row |
| Scrape artifact (b) | **Partial** | b2 (same city kept) merged, and the license text was stripped from the name. b1 (everything blank) is "invalid" (F-12) |
| `office` → `source` fallback (c) | **Pass** (with mapping) / **Fail** without AI (F-10) | `Lia Lane` (office blank) gets `Compass`; `Max Moore` keeps `Douglas Elliman` |
| Phoneless → `missing_phone`, never queued | **Pass** | Imported with `phone NULL, missing_phone t`. `POST /api/calls {leadId}` returned `409 "This lead has no phone number yet — add one before calling."`. `POST /api/leads/batch-queue` returned `{"leads":[]}`. `candidates()` filters `missing_phone = false` (`leadQueue.js:43`) |
| Phone formats (f) | **Partial** | `+1 (602)…`, `(602)…`, `602-555-…`, 10-digit and `16025550609` all became `+1602…`. Extension and letters are dropped (F-09). `+44…`, `555-0608` and junk are correctly treated as no phone |
| State (g) | **Pass** | `fl` → FL, `Florida` → FL, blank → HI from area code 808. Invalid `ZZ` was inferred from the area code (HI), not rejected, which is acceptable. A given state wins over the area code (`TX` with 808) |
| DNC on import (h) | **Pass** | `skippedDnc:1, reason "Phone number is on the DNC list: +12145550101"`. A reformatted `214.555.0101` is also blocked (normalised before the check) |
| Multi-sheet xlsx (i) | **Pass** | 3 sheets (one with reordered columns, one empty) gave 3 leads with the right states |
| 5,000 rows (j) | **Pass** | `imported:5000`, lead delta exactly 5000, 16.4 s with a 150 ms stub delay per AI call. Progress is monotonic (0 → 8 → 17 → 26 → 61 → 100%) but runs ahead of the writes (F-11) |
| Cancel mid-cleaning | **Pass** | Cancelled at 840/5000: `status=cancelled`, **0 leads written**, still the same 5 s later |
| Cancel mid-write | **Fail** | F-08 |
| Second import (l) | **Pass** | No duplicates: lead count 48 → 48 for both the phone file and the phoneless file (name + state dedup) |
| Bad files (k) | **Pass** (clean failures) with gaps (F-13) | Empty, header-only and no-file uploads give 400 with clear messages. Malformed CSV gives `400 "Could not parse CSV: Quote Not Closed … at line 3"` and 0 rows written. Unknown job gives 404. No stack trace in any body. `/health` was ok afterwards |
| Real-Groq-unreachable fallback (a) | **Pass** (behaviour) | A 10-row file took 12.2 s (SDK retries plus the app's 2 s and 4 s back-off), `needsManualReview:10`, and the rows were still imported uncleaned |

Lead-count baseline at the end of §3: **15,048** leads (`select count(*) from leads`). §4–§6 invariants compare against it.

### §4 Lead lifecycle (`audit/logs/04-lifecycle.txt`)

| Rule | Result | Evidence |
|---|---|---|
| new → in_progress on dial | **Pass** | `before dial: status=new attempts=0` → `after dial: status=in_progress attempts=1` |
| One lead per "next lead" request | **Fail** | F-14 |
| Hangup → in_queue after ~30 s | **Pass** (when a queue read happens) | `lead 54 back to in_queue after 31s (target 30s)`. Lazy-sweep caveat in F-24. The lead was never lost: attempts stayed 1 and status ended `in_queue` |
| Live call stays locked | **Fail** | F-15 |
| Voicemail/no_answer → +4 h, attempts increment | **Pass** | `status=voicemail attempts=1/5 … next_action_in=4.00h`. Immediate re-dial gave `409 "Lead is not due yet…"` |
| `max_attempts` boundary | **Pass** (no off-by-one) | Dials 2–4 gave `no_answer attempts=n/5`; dial 5 gave `status=cold attempts=5/5 cold_reason=max_attempts`; dial 6 gave `409 "Lead is not dialable (status: cold)"`. The 4 h wait was simulated by moving `next_action_at` into the past via SQL (labelled in the log) |
| Where `max_attempts` is configured | **Info** | DB column default `5` (`002_create_leads.sql:14`). The Settings page value is only written to `localStorage` (`Settings.jsx:104`) and never sent to the API (§9) |
| Callback resurfaces at its due time, with priority | **Pass** | Callback due in 8 s: before due, next lead served = 1; after due, next lead served = 59 (the callback). `CANDIDATE_ORDER_SQL` puts `callback_scheduled` first |
| no_contact_number | **Partial** | F-23 |
| no_contact_person | **Pass** for the lead itself / **Fail** for the cascade | `15049 \| cold \| no_contact_person`; cascade in F-17 |
| DNC: list row, queue, by-id, manual pad, re-import | **Pass** | `dnc_list: +12145550101\|manual\|11`. Queue candidates containing DNC leads = 0. By-id: `409 "Lead is not dialable (status: dnc)"`. Manual pad: `409 "This number is on the DNC list and cannot be dialed"`. Re-import blocked (§3). **Except** the edit path (F-16) |
| Undo a DNC (within 10 s) | **Works as coded, needs a decision** | `after undo: lead=in_progress/dnc_flag=false dnc_list rows for +13055551001 = 0`. Undo deletes the DNC list entry (§7 of this report) |
| Undo: reverts, refused after the window, safe twice | **Pass** | Undo #1 gave `status=in_progress attempts=1`, history `dispo=null note=null`. Undo #2 gave `409 "Nothing to undo for this call"`. After 11 s: `410 "Undo window has expired"` |
| Undo after callback | **Fail** | F-21 |
| Calling hours: boundaries in 7 states | **Pass** | Controlled clock (`audit/scripts/calling-hours.js`), toggle ON: FL, AZ, HI, CA, TX, NY and AK each give `07:59=block 08:00=ALLOW 20:59=ALLOW 21:00=block` |
| Calling hours: DST | **Pass** | NY `8:00 AM EST ALLOW` (2026-03-07 13:00Z) becomes `9:00 AM EDT` (03-08). After fall-back, `7:30 AM EST block`. AZ stays MST throughout. The spring-forward gap goes 1:59 to 3:00 |
| Calling hours: multi-zone states | **Fail** | F-18 |
| Calling hours: refused call doesn't leave a stuck lead | **Pass** | Before `status=new attempts=0`, then `422 "Outside calling hours for TX…"`, after `status=new attempts=0 locked_by=null`. `assertCallingHours` runs before the lock UPDATE |
| Calling hours: toggle OFF → calls go through | **Pass** (after a delay, F-26) | Calls 59–62 got 201 once the cache refreshed |
| Manual pad respects calling hours | **Fail** | F-19 |
| Queue under calling hours | **Fail** | F-20 |
| Invariants (`audit/scripts/invariants.sql`) | Run | I1 bad statuses: **0 rows**. I4 orphan calls: **0**. I3 stale locks: **0**. I5 dangling calls: **35** (F-25). I6 multi-open-call leads: 8 (F-14). I7 attempts > max: 3 (F-14). I8: 1 lead on `dnc_list` but unflagged (synthetic row 15052, F-16); 3 non-E.164 phones (F-16) |
| Lead count conserved | **Pass** | `total 15052` = §3 baseline 15,048 + 4 synthetic SQL rows (3 "Sam Same" + 1 "Pre Listed"). 60 synthetic starvation rows were inserted and deleted. 1 lead soft-deleted via the API (still counted) |

Notes on test validity, all logged: four of my own harness mistakes produced invalid runs, which are kept in the log and marked as such.
- The `xargs -I{}` brace clash.
- Two misplaced token-file arguments in 4.3.
- `utcFor()` returning `null` in the first 4.10 run.

Each was re-run correctly, and only the re-runs are cited.

### §5 Dialing sessions and telephony (`audit/logs/05-sessions.txt`)

All sessions ran over the real endpoints (`/api/sessions/start`, `/api/calls/multiline/*`), with events read from the real SSE stream by `audit/scripts/sse-session.js`. Mock call outcomes were **forced** per step with `audit/stubs/force-outcome.js` (labelled stub), so every branch could be hit on purpose.

| Check | Result | Evidence |
|---|---|---|
| Single line: SSE events, auto-resolve, auto-advance | **Pass** | `voicemail lead=1` → next `dialing lead=2` → `busy lead=2` → `dialing lead=3` → … → `no_answer lead=5` → `answered lead=6`. Rep dispositioned `contacted` (200), `release` dialed `lead=7`, then `stop` gave `dropped`. DB: voicemail → `voicemail`, busy → `no_answer`, no-answer → `no_answer`/`cold` at cap, answered → `contacted`, dropped → `in_queue` (`was_abandoned t`) |
| 3 lines, double/triple answer → held, not dropped | **Pass** | `slot 2 answered`, `slot 1 held`, `slot 3 held`. After disposition + `release`: `slot 1 answered (promoted from hold)`, `{"promoted":1}` |
| Never more live lines than configured | **Pass** | `maxConcurrentLiveSlots=1 (lineCount=1)`, `=3 (lineCount=3)`, `=2 (lineCount=2)` |
| No duplicate lead across lines | **Fail** | F-27 |
| DNC skip in multi-line | **Pass** | Lead 11 (DNC) was skipped: slot refilled lead 10, then lead 12 (§5.2). `reserveSlot` checks `dnc_list` |
| Stop mid-dial | **Pass** for ringing lines / **Fail** for held | `{"abandonedCount":1}`, `slot 2 dropped`, lead back to `in_queue`. Held/answered lines: F-29 |
| SSE disconnect | **Fail** | F-28 |
| Same user starts a 2nd session | **Pass** (documented behaviour) | The first session's lines get `dropped` (it is stopped), and only the second session dials |
| Two users concurrently | **Fail** | Duplicate leads across users (F-27 / F-14) |
| Backend restart mid-session | **Partial** | Leads recovered: `in_progress = 3` → one list read about 31 s later → `0`. Calls stay open and the session never ends (F-29) |
| Empty queue / only phoneless / only out-of-hours | **Pass** | Each line gets `idle msg=No dialable leads in queue right now`. Phoneless-only selection gives `{"lineCount":2,"slots":[]}`. Out-of-hours gives `404 "No dialable leads in queue right now"` (§4.11; see F-20 for starvation) |
| Adapter selection by env | **Pass** | `listening on port 4000 (telephony: twilio)` |
| Invalid `TELEPHONY_PROVIDER` fails clearly | **Partial** | A clear message, but only at call time (F-31) and it leaves a phantom call (F-30) |
| `twilioAdapter.js` fails loudly | **Pass** | `500 "twilioAdapter is not implemented yet — set TELEPHONY_PROVIDER=mock"`; it does not pretend to succeed |

### §6 Dispositions, notes, history, recording (`audit/logs/06-dispositions.txt`)

The code defines **7** dispositions, not CLAUDE.md's "six": the six buttons plus `callback_scheduled`.

| Disposition | Result | Lead after | Call row |
|---|---|---|---|
| contacted | **Pass** | `status=contacted attempts=1 notes_count=1` | `note="note for contacted on lead 69" disposition_at=11:08:57 ended=true was_recorded=true` |
| voicemail | **Pass** | `voicemail`, +4 h | `was_recorded=false` |
| no_answer | **Pass** | `no_answer`, +4 h | `was_recorded=false` |
| no_contact_number | **Pass** (see F-23) | `no_contact_number` | `was_recorded=false` |
| no_contact_person | **Pass** (see F-17) | `cold cold_reason=no_contact_person` | `was_recorded=false` |
| dnc | **Pass** | `dnc dnc_flag=true` | `was_recorded=false` |
| callback_scheduled | **Pass** (see F-35) | `callback_scheduled` | `was_recorded=false` |

| Check | Result | Evidence |
|---|---|---|
| Bad input | **Pass** | Unknown disposition gives `400 "Unknown disposition: bogus"`. Callback without time gives `400 "scheduledAt is required…"` |
| Double submit (2 in parallel) | **Pass** | One `[HTTP 200]`, one `409 "Call already has a disposition"`. Attempts counted once (`attempts 1`) |
| Disposition after the session ended | **Pass** | `200`, `contacted`. Session counters updated (`contacts=1`) even though `ended_at` was set |
| Notes scoped per lead | **Pass** | Lead 69's notes never appear on lead 249, and vice versa. `lead_notes` rows whose call belongs to another lead: 0 (before the F-36 probe) |
| Previous notes on the call screen | **Partial** | F-33 |
| `was_recorded` only for contacted | **Pass** | All calls: `contacted t 5`; every other disposition `f`. Rule `leadLifecycle.js:150 const wasRecorded = disposition === 'contacted'`. The lead-page badge renders on `entry.was_recorded`. The live call-screen badge renders on `state === 'answered'` (`CallHeader.jsx:53`), i.e. during any answered call, before the outcome is known (§7 of this report) |
| Session summary vs SQL | **Pass** | Session 10: API `dials=1 contacts=1 vm=0 na=0` = SQL `dials=1 contacts=1 vm=0 na=0`. Across all sessions, stored counters vs `call_history`: **0 mismatches** |
| `/reports/today` vs SQL | **Pass** (numbers) / **Fail** (day boundary, F-34) | API `{"dials":164,"contacts":5}` = SQL over all calls since `date_trunc('day', now())`: `dials=164`. Manual dial-pad calls are included in "dials" (163 without them) |
| Daily goal tracker | **Info** | The goal value lives in `localStorage` only (`Dashboard.jsx:31`), the count comes from `/api/reports/today` |

### §7 SMS and email (`audit/logs/07-sms-email.txt`)

| Check | Result | Evidence |
|---|---|---|
| Supported merge fields | **Pass** | `Hi {{name}} at {{brokerage}} in {{state}}!` gave `Hi Lia Lane at Compass in FL!` |
| Unsupported or missing fields | **Fail** | F-38 |
| Bulk send skips opted-out and DNC | **Pass** | 5 leads gave `{"sent":3,"skipped_opt_out":1,"skipped_dnc":1,"failed":0}` |
| Bulk throttle | **Pass** | `sent_at` gaps of 1.89 s and 2.25 s between the 3 sends (`BULK_DELAY_MS = 1500` plus the mock's 300–800 ms). Cap of 50: 51 leads gave `400 "Too many leads selected — split into batches of 50…"`. Bulk runs inside the HTTP request (4.5 s for 3; about 75 s+ for 50) |
| Bulk / single send to a DNC lead | **Pass** | Bulk counted it under `skipped_dnc`. Single send: `400 "This lead is on the Do Not Call list"`. Opted out: `400 "This lead has opted out of SMS"` |
| Manual opt-out sets `sms_opt_out` only, never DNC | **Pass** | Before `sms_opt_out=false dnc_flag=false status=new dnc_list=0`; after `sms_opt_out=true dnc_flag=false status=new dnc_list=0`. The lead is still callable (`call 165 [HTTP 201]`) |
| STOP variants (STOP, stop, "Stop.", UNSUBSCRIBE, QUIT, CANCEL, END, START/UNSTOP) | **Missing** | F-37: no inbound path, so none could be sent. Each variant is unprocessed by construction |
| Inbox, unread count, mark-read | **Pass** (with DB-seeded inbound rows) | `{"leadId":22,…,"unreadCount":2}`; mark-read leaves `unread left: 0` |
| Unified timeline ordering | **Pass** | Notes, SMS (in and out) and calls interleave, `sorted newest-first: true` across 11 items |
| MMS plumbing | **Pass** (works) / **Fail** (hardening) | Upload returns `/uploads/…png`, 5 MB limit works, `media_url` is stored. F-40 |
| Email compose and validation | **Pass** | Valid send gives `201 … "body":"Hi Ben Brooks"` (merge works). Missing body: 400. No email on file: 400. Unknown lead: 404. Empty subject: F-41 |
| Email to a DNC lead | **Info** | `201 sent` to lead 11 (DNC). DNC is a phone-call list, so this is legally distinct, but it needs a decision (§7 of this report) |
| SMS quiet hours | **Fail** | F-39 |

### §8 Objections, rebuttal coach, pre-call brief, colleague intel (`audit/logs/08-objections-ai.txt`)

**Every AI call in this section went to the local Groq stub (`GROQ_BASE_URL` → `audit/stubs/groq-stub-server.js`), so results are stubbed.** They prove prompt assembly, validation, retry, fallback, storage and gating. Real output quality is *Can't verify* (§5 of this report).

| Check | Result | Evidence |
|---|---|---|
| Objection logging and report | **Pass** | Logged on real calls via `POST /api/objections/calls/:callId`, with rebuttal text via `PUT`. Report gave `{"count":9,"dispositioned":9,"positive":2,"positiveRate":22}`, equal to SQL `count=9 dispositioned=9 positive=2` (the 10th harness dial did not start; noted). Duplicate log: 201 (idempotent via the unique index). Delete: 200. Re-add: 201 |
| Objection types CRUD | **Pass** | Create gives 201; duplicate label gives `409 "An objection with that label already exists"`; deactivate gives `is_active:false`, hidden by default and shown with `includeInactive=1`. A bogus id in reorder is ignored (200) |
| Coach config (from code) | **Info** | `MODEL=openai/gpt-oss-20b` (Groq, the free option of the two the handoff weighs), `TEMPERATURE=0.7`, `MIN_INSTANCES=10`, `MIN_POSITIVE=2`, 3 suggestions, `MAX_WORDS=30`, `MAX_SENTENCES=2`, `MAX_EXAMPLES=5`, timeout 20 s, `maxRetries 1`. **33 banned phrases**, all listed in the log |
| Threshold | **Pass** | 9 instances gave `{"source":"insufficient","eligible":false,…"instanceCount":9,"positiveCount":2}`. At 10/3 it generates |
| Prompt assembly | **Pass** | The captured system prompt contains the 5 hard rules, the full banned list, the self-check instruction and a JSON-only output contract. The user message has `Objection the agent raised: "Too expensive"` plus 3 `(worked on a real call)` examples. The stub received `model=openai/gpt-oss-20b temperature=0.7` |
| Banned phrase → retry | **Pass** (stubbed) | 2 Groq requests. The retry has roles `system,user,assistant,user`; the final user message reads `Your previous draft #1 used 'synergy', 'leverage', 'seamless', 'unlock'. … Rewrite all 3 without any banned phrase…` |
| Still failing after retry | **Pass** (stubbed) | Stored as `pending` with `review_note` set to `needs manual rewrite: used 'win-win', 'circle back'` or `was 33 words (over 30)` |
| Malformed JSON / HTTP 500 | **Pass** (stubbed) | Falls back to `"source":"logged"` with the 3 real logged rebuttals and `"AI suggestions are unavailable right now — showing rebuttals that worked on past calls instead."` |
| Storage columns | **Pass** | `rebuttal_suggestions` rows: `objection_type_id=2 based_on_count=10 status=pending suggestion="Totally fair…" review_note=-`. The text is in `suggestion` and the note in `review_note`, so the earlier wrong-column bug is fixed |
| Unapproved never on the call screen | **Pass** | `ObjectionPanel.jsx` calls `getObjectionHints()`. Before approval, hints = only the `"source":"logged"` rebuttal, with 12 pending present. After approving #2/#8, hints show the approved AI text. `preCallBrief` uses the same `getHints()` |
| Approvals fed back as few-shot | **Pass** | After approval the next prompt has `Example 1 (approved by the team): …`, `Example 2 (approved by the team): …`, then `(worked on a real call)` examples. See F-43 |
| Review status validation | **Pass** | `status:"gold"` gives `400 "status must be 'approved' or 'rejected'"` |
| Brief: empty states | **Pass** | A lead with no brokerage, address or history gives `"headline":"First call · local time 6:13am"`, `colleagues:null`, `objections:[]`, `ai:null` (AI is skipped on a first call by design). Unknown or deleted lead: 404 |
| Brief: AI failure / timeout | **Pass** (stubbed) | Stub 500 gives `ai=null`. Stub 5 s delay gives `ai=null` after **3.1 s**, with the instant brief intact. AI results are cached 30 min per lead (`preCallBrief.js:23`) |
| Brief: colleague section | **Pass** (wording issue F-42) | Shows the colleague count and an opener |
| Colleague matching | **Pass** for spelling variants / **Partial** overall | `Keller Williams`, `KW`, `keller williams`, `  KELLER WILLIAMS  `, `Keller Williams Realty` and `Keller-Williams` all give `keller williams\|dallas\|TX`; `RE/MAX` and `Remax` give `re max\|dallas\|TX`. **Not merged:** `kw.com` (F-10's fallback brokerage) and `Keller Williams Dallas` (brokerage containing the city) |
| Current lead excluded | **Pass** | `self appears in its own list? 0` |
| What other agents' data is exposed | **Pass** | Summary counts plus `recentPositive[{leadId,name,outcome,date}]`. No phone, notes or call notes |
| N+1 at scale | **Pass** | 2 queries per request (self + one `LATERAL` join). A 5,000-lead office: `/colleagues` 0.038 s, `/brief?ai=0` 0.033 s. `Bitmap Index Scan on idx_leads_office_key … Execution Time: 0.942 ms` |

**Handoff "Not added" items: true status on `latest`** (grep over `backend/src` and `frontend/src`, plus the behaviour above):

| Item | Status | Evidence |
|---|---|---|
| Colleague mode (office social proof) | **Working** | `services/colleagueIntel.js`, `ColleagueCard.jsx`, call screen + lead page + brief, tested above |
| Voicemail-to-text follow-up | **Missing** | `NO MATCHES` |
| Review gate (pending/approved) | **Working** | Migration `022_rebuttal_review.sql`; gate proven above |
| "Why this works" line | **Missing** | `NO MATCHES` |
| Gold-example tagging | **Missing** | `rebuttalCoach.js:133` comment: "is_gold_example rebuttals — no such column exists yet, so skipped" |
| "I used this" tracking | **Missing** | `NO MATCHES` (only the free-text `rebuttal_used` per call) |
| Low-performance flag | **Missing** | `NO MATCHES` |
| Rebuttal voice/quality prompt | **Working** (stubbed; quality unverified) | Above |
| Monthly review banner | **Partial** | `ObjectionReport.jsx:101-114` `RecalibrationBanner` shows "It's been a month — worth skimming recently approved rebuttals…" whenever the setting `rebuttal-recalibration-dismissed-month` ≠ the current calendar month, i.e. **once per calendar month until dismissed**, not a month after the last review. On the first Reports visit of any month it claims "it's been a month" even if rebuttals were approved the day before. Rendering is checked in §10 |

## 5. Can't verify
*pending*

## 6. Architecture-rule compliance
*pending*

## 7. Observations needing a decision
*pending*

## 8. Suggested fix order
*pending*
