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
| Unreachable API message | **Pass** | Production build with the backend stopped: `Couldn't reach the server — check that the backend is running and the app's URL is up to date`, after `POST http://localhost:4000/api/auth/login -> net::ERR_CONNECTION_REFUSED`. Screenshot: `audit/screenshots/02-login-backend-down.png` |

## 5. Can't verify
*pending*

## 6. Architecture-rule compliance
*pending*

## 7. Observations needing a decision
*pending*

## 8. Suggested fix order
*pending*
