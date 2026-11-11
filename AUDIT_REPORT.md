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

## 5. Can't verify
*pending*

## 6. Architecture-rule compliance
*pending*

## 7. Observations needing a decision
*pending*

## 8. Suggested fix order
*pending*
