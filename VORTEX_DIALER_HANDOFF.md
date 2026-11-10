# Vortex Outreach — Project Handoff

Read this together with CLAUDE.md. CLAUDE.md holds the build rules and original spec; this file holds the history, decisions, current state, and open items. Where this file and the actual code disagree, the code wins. Verify before trusting any "built" claim below.

## 1. What this is

Vortex Outreach (formerly "Vortex Dialer") is an in-house hybrid dialer plus light CRM for Vortexone Agency. Vortexone sells virtual assistant services (lead follow-up, appointment setting, admin support) to US real estate agents. Calls are placed from Pakistan to US agents, using lead lists scraped from brokerage sites.

- Typical lead file: name, phone, email, office/brokerage, city, source, profile URL. Brokerage sits in `office` in some files and in `source` when `office` is blank.
- Contact rate is low (about 2-3%), so most dials end in voicemail or no answer.
- The product is also meant to be used by colleagues who are newer to cold calling, so anything coaching-related must be reliable and plain-spoken.
- Display name is "Vortex Outreach". Internal names (repo, tables, routes, env vars) still say `dialer`. That is intentional. Do not rename them.

## 2. Stack and environment

- Backend: Node.js, Express, PostgreSQL (raw `pg`, no ORM), JWT auth, pdfkit, multer, xlsx
- Frontend: React, Vite, Tailwind, neumorphic design with dark mode, brand blue `#3B82F6`. Action buttons (call, hang up, dispositions) are deliberately high-contrast, not pure neumorphism.
- Repo: `tvlhvrifkhvn/VORTEXONE-DIALER` on GitHub
- Development environment: GitHub Codespaces. Postgres runs locally inside the Codespace, so database contents are not in the repo.
- Known Codespaces issues: preview URLs change, ports can default to Private, and "Failed to fetch" errors usually mean a stale `VITE_API_URL`, a stopped backend, or a Private port. CORS allows `*.app.github.dev` in dev mode only.
- Secrets: `backend/.env` and `frontend/.env` are not committed. The Groq API key can also be saved from Settings, which stores it in the `settings` table in plain text.
- Migrations are numbered `.sql` files in `backend/src/db/migrations/`. Several briefs asked for specific numbers that were already taken, so numbers were bumped. Always check the real highest number before adding one.

## 3. Architecture rules (do not break)

- API-first. The frontend never touches the database. All reads and writes go through the backend API.
- Pluggable providers with mock versions. Telephony, SMS, and email each have an adapter interface and a mock implementation selected by env var (`TELEPHONY_PROVIDER`, `SMS_PROVIDER`, `EMAIL_PROVIDER`). Real providers drop in later with no UI changes. Do not change the telephony adapter contract without discussing it first.
- No lead silently disappears. Every status change goes through `leadLifecycle.js` or the stale-lock sweep.
- DNC and SMS opt-out are legally different. A "STOP" text sets `sms_opt_out` only. It must never set the DNC flag. DNC is permanent and blocks re-import.
- Logic lives in `/services`, routes stay thin, no SQL in route handlers.
- Edit, do not rewrite. Targeted changes only. Read each file before editing.

## 4. Current state

Audited 2026-11-10. The old bullets here were replaced with what the code actually does.

### Where the code is (read this first)

- **`main` has only the phase-1 MVP** (merge of PR #3, commit `04691c2`). None of the later work is merged.
- Everything after that sits on **open, unmerged branches stacked on each other**. The most complete one is `claude/rebuttal-coach-v2` (commit `3038c70`, **no PR opened for it**). It contains the commits of PRs #7 (visual polish), #8 (full-feature batch), #9 (colleague intel), #10 (objection tracker) and #11 (pre-call brief). In this section it is called **"tip"**.
- **Not in tip:** PR #4 (remove zip), PR #5 (devcontainer Postgres) and PR #6 (Vite host fix).
- Each item below has two statuses: **main / tip**.

### How it was checked

- **[R]** file read.
- **[B]** `vite build` of each frontend (both pass).
- **[A]** live API test: each backend was run against a throwaway Postgres 16 database with mock adapters, after `npm run migrate` (all 6 migrations on main, all 22 on tip, applied cleanly) and `npm run seed`.
- **[UI]** headless Chromium against each Vite frontend, with page text and controls read back.
- **Groq:** this container cannot reach Groq ("Connection error" after 3 retries), so nothing that depends on Groq output could be verified. That is stated per item.
- Paths are relative to the repo root.

### Built and verified by an earlier codebase audit

| Item | main | tip | What was checked |
|---|---|---|---|
| Login / auth | Working | Working | [A] `POST /api/auth/login` returns a JWT, `/me` works. [UI] login form on both. `backend/src/routes/auth.js`, `services/authService.js`, `middleware/auth.js`, `frontend/src/hooks/useAuth.jsx` |
| Lead table, state sidebar, filters | Working | Working | [A] `GET /api/leads?state=TX`, `?search=`, `/api/leads/state-counts`. [UI] table and sidebar counts. `services/leadQueue.js`, `components/layout/StateSidebar.jsx`, `components/leads/LeadFilters.jsx` |
| Pagination | Partial | Working | main: the API takes `page`/`pageSize`, but `pages/Dashboard.jsx` has no pager, so only the first 50 leads show. tip: [UI] Previous/Next and "Showing 20 of 20" |
| Checkbox selection | Missing | Working | main: [R] no checkboxes in `components/leads/*`. tip: [UI] 21 checkboxes (20 rows + select-all); `POST /api/leads/batch-queue` |
| Global search | Missing | Working | main: only the table filter. tip: [UI] typing "Karen" in the navbar "Search all leads…" box shows Karen Mitchell; `GET /api/leads/search`; `components/layout/AppShell.jsx` |
| Time zone clock | Missing | Working | tip: [UI] EST/CST/MST/PST clock in the header (`AppShell.jsx`) |
| CSV import | Working | Working | main: [A] `/api/imports/preview` then `/commit`. tip: [A] `/api/imports/upload` → `/process` → `/status/:jobId` |
| Excel import (multi-sheet) | Missing | Working | tip: [A] a 2-sheet `.xlsx` imported both sheets' rows. `services/xlsxParser.js` |
| Background import jobs with progress and cancel | Missing | Working | tip: [A] status polled to 100% / `completed`; cancelling mid-run gave status `cancelled` and wrote 0 rows. `services/csvImport.js` `processImportJob` |
| Groq column mapping and cleaning | Missing | Can't verify without running it (needs the real Groq API) | tip: [A] with Groq unreachable, upload falls back to `guessMapping` and the import still completes. Gap: the fallback does not map an `office` header to brokerage, so with AI down the brokerage comes from `source` (saw "kw.com" instead of "Keller Williams"). `services/aiCsvMapper.js` |
| Duplicate merge | Missing | Working | main: in-file duplicate phones are skipped, never merged. tip: [A] two "John Smith" rows in Dallas merged into one lead (clean name, email filled from the second row); the "John Smith" in Houston stayed separate. `csvImport.js` `mergeDuplicateRows` |
| DNC check on import | Working | Working | [A] on both: dispositioned a lead DNC, re-imported its number, got `skippedDnc: 1, imported: 0` |
| Queue and locking | Working | Working | [A] `POST /api/calls` sets the lead to `in_progress`. After hangup, with `locked_at` backdated 31s, the next list read returned it to `in_queue` |
| Retry cap and cold parking | Working | Working | main: [A] lead at attempt 5/5 + `no_answer` became `cold`, `cold_reason=max_attempts`. tip: [R] same logic in `services/leadLifecycle.js` `applyDisposition` |
| DNC disposition | Working | Working | [A] on both: status `dnc`, number written to `dnc_list` |
| Undo | **Partial** | **Partial** | [A] undoing `voicemail` works. **Undoing `callback_scheduled` returns HTTP 500 `syntax error at or near "ORDER"`** on both, because `leadLifecycle.js` `undoDisposition` runs `DELETE … ORDER BY … LIMIT 1`, which Postgres rejects. The whole undo rolls back and the callback stays in place |
| Callbacks | Working | Working | [A] `callback_scheduled` sets the status and `next_action_at` and inserts a `callbacks` row (but see the Undo bug) |
| Dialing sessions and multi-line (1-3 lines) over SSE | Missing | Working | main: the "Multi-line" button is disabled ("arrives in phase 3"). tip: [A] `/api/sessions/start` + `/api/calls/multiline/start` with 3 lines, watched `GET /api/calls/stream`: voicemail, busy and no-answer slots resolved and redialed on their own. `/api/sessions/end` returned per-session stats. Multi-line state is in memory (`callSession.js` `multilineSessions`) |
| Second live answer is "held" | Missing | Working | tip: [A] with the mock forced to "answered": slot 1 `answered`, slots 2 and 3 `held` |
| Single line replaces "power dial" | Missing | Working | main: the dashboard still has a "Power dial" toggle. tip: [UI] a "Lines 1 / 2 / 3" selector and no power-dial mode |
| Dispositions and notes | Working | Working | [A] each disposition, with its note saved on `call_history` |
| Previous-notes history | Missing | Working | tip: [UI] "Previous Notes" panel on the call screen; `GET /api/leads/:id/history` |
| Pitch script panel | Missing | Working | tip: [UI] panel on the call screen. The script is stored only in browser `localStorage`, not the API |
| Daily PDF export (table format) | Partial | Working | main: [A] a PDF downloads, but it is a list, not a table. tip: [A] `pdftotext` shows a table (Lead, Brokerage, Phone, Status, Note, Duration, Time) under summary totals. `services/pdfExport.js` |
| Reports page | Working | Working | [UI] + [A] `/api/reports/today` and `/per-state` |
| Daily goal tracker | Missing | Working | tip: [UI] "17 / 100 dials today". The goal is stored in `localStorage` only |
| Session summary | Missing | Can't verify without running it | tip: [A] `/api/sessions/end` returns the stats. [R] `pages/DialerSession.jsx` `SessionSummaryModal`. The modal was not opened in the UI |
| Settings (profile, dialing defaults, script, Groq key) | Missing | **Partial** | tip: [UI] page renders. The Groq key and the calling-hours toggle are saved to the server. Max attempts, daily goal, default lines and the script are saved to `localStorage` only (`pages/Settings.jsx`). **"Default max attempts" is read nowhere in the backend, so it does nothing** (leads keep the DB default of 5). Also, `GET /api/settings/:key` returns any stored value, including the Groq key, to any logged-in user |
| Dark mode | Missing | Working | tip: [UI] the toggle adds the `dark` class to `<html>` |
| Calling-hours enforcement, off by default via a toggle | Partial | Working | main: always enforced, no toggle (`services/callingHours.js`). tip: [A] with no setting, an 11pm TX call is allowed. With `calling_hours_enforced=true`: 11pm TX → 422 "Outside calling hours", 2pm TX allowed. The toggle takes up to 5s to apply (in-memory cache) |

### Reported built in later rounds

| Item | main | tip | What was checked |
|---|---|---|---|
| Full-page call screen with action grid (tag, note, view lead, quick SMS, mute, hold) | Missing | Working (rendered) | [UI] all six buttons plus Objection / End call / ✨ Expand render on a live call. Mute and Hold are placeholders ("arrives with Twilio in phase 2"). Tag, Note and SMS were not clicked in this audit. `components/call/CallActionGrid.jsx` |
| Dial pad with paste support | Missing | Working | [UI] on `/call/manual`, pasting "+1 (305) 555-0138" gave `3055550138`; the keypad renders. No manual call was placed. `components/call/DialPad.jsx` |
| Call recording plumbing | Missing | Working | [A] `contacted` → `was_recorded=true`, `voicemail` → `false`. [UI] "Recording" badge on a connected call and in lead history |
| SMS on the mock adapter | Missing | **Partial** | [A] Templates work with `{{name}}`, `{{brokerage}}` and `{{state}}` only; `{first_name}` was sent literally. Bulk send works: 3 of 3 sent, with a 1.5s delay between sends in code. Opt-out sets `sms_opt_out=true`, keeps `dnc_flag=false`, and further sends get 400. MMS works: upload returns a `/uploads/...` URL and `media_url` is stored. Per-lead conversation and unified timeline work ([UI] lead page shows SMS and email). **Inbox: there is no inbound SMS path at all** (no webhook, no STOP-keyword handling, and the mock is send-only), so `/inbox` can only ever be empty. `services/smsService.js`, `telephony/mockSmsAdapter.js` |
| Email: mock adapter, compose from the lead page | Missing | Working | [A] `POST /api/email/send` returns 201, and 400 when the lead has no email. [UI] "Send Email" on the lead page. `services/emailService.js`, `telephony/mockEmailAdapter.js` |
| Lead detail page at `/leads/:id`, row call/snooze removed | Missing (main still has per-row Call / Not now) | Working | [UI] full page with Call / Send SMS / Send Email / History / edit / delete. Rows only have Open and Select |
| CSV fix: merge only on name + city/state, `office` → `source` fallback, `missing_phone` | Missing | Working | [A] The merge behaved as above. With `office` mapped, a blank office fell back to `source` ("Compass"), and filled ones kept the office ("Keller Williams", "RE/MAX"). A phoneless row was imported with `phone=NULL, missing_phone=true`, and `POST /api/calls` on it returned 409 "no phone number yet" |

### Added by the owner after those rounds

| Item | main | tip | What was checked |
|---|---|---|---|
| Objection tracker | Missing | Working | [A] logged "Too expensive" on a live call, saved the rebuttal used, and dispositioned it contacted; `/api/objections/report` showed count 1, 100% positive. [UI] Reports and Settings lists. `services/objectionService.js`, `routes/objections.js` |
| Rebuttal coach | Missing | Partial / Can't verify | [A] the "not enough data" path and the approve review (`PUT /api/objections/suggestions/:id`) work. Generating suggestions needs Groq: can't verify. `services/rebuttalCoach.js` |
| Pre-call brief; how the colleague section behaves | Missing | Working (instant part) / Can't verify (AI part) | [A] `GET /api/leads/:id/brief?ai=0`; [UI] BRIEF card while ringing. The colleague section works because colleague intel is on the tip. With **one** interested colleague it says "**A few agents** at RE/MAX · Houston, TX have already been interested", which overstates the evidence. `services/preCallBrief.js` |

### Previously listed as "not added"

| Item | main | tip | What was checked |
|---|---|---|---|
| Colleague mode (office-level social proof) | Missing | **Working (actually built, PR #9)** | [A] put two leads in the same office: `GET /api/leads/13/colleagues` returned the office label, contacted/interested counts and the recent positive outcome. Grouping is by `office_key`, so the same office spelled "kw.com" and "Keller Williams" counts as two offices. `services/colleagueIntel.js`, `utils/officeKey.js` |
| Voicemail-to-text automatic follow-up | Missing | Missing | [R] no voicemail-to-text or transcription code anywhere |
| Rebuttal quality additions | Missing | Partial | Review gate (pending/approved/rejected) **built**: migration `022_rebuttal_review.sql`, [A] approve works. "Why this works" line: missing. Gold-example tagging: missing (code comment in `rebuttalCoach.js` says no such column exists). "I used this" tracking: missing (only the free-text `rebuttal_used` per call). Low-performance flag: missing |
| Rebuttal voice and quality prompt | Missing | Partial (built, output unverified) | [R] `rebuttalCoach.js` on `claude/rebuttal-coach-v2` has strict voice rules, a banned-phrase list checked in code, few-shot examples from approved suggestions and logged wins, a 30-word / 2-sentence cap with a code check and one rewrite retry, a self-check instruction, temperature 0.7, and approvals fed back. Model: Groq `openai/gpt-oss-20b`. Output quality can't be verified without Groq |
| Phase 2: Twilio/Telnyx calling and SMS, SendGrid email | Missing | Missing | [R] `telephony/twilioAdapter.js` throws "not implemented"; `smsIndex.js` and `emailIndex.js` only register `mock` |

### Problems found (not fixed; this was an audit only)

1. **A live Groq API key is hardcoded and committed in a public repo.** It is the fallback value in `backend/src/config/index.js`, on every branch from `claude/full-feature-batch` onward (commits `4673858` and `0fe67f8`, "Build in Groq API key"). The repo is public. **Revoke the key in the Groq console now and issue a new one.** Deleting it in a later commit does not remove it from git history. Side effect: because a key is always present, the "no key → degrade gracefully" path never runs.
2. **On tip, a disposition can fail after about a minute on a live call.** The call screen polls `GET /api/calls/:id` every 600 ms (`frontend/src/hooks/useCall.js`), which is about 100 requests a minute, and `middleware/rateLimit.js` allows 100 a minute per user.
   - [UI] Measured on a production build: the first 429 came at 55s into an answered call.
   - Polling then stops, so the screen goes stale.
   - [A] A disposition sent after 100 polls in the same minute got **429 "Too many requests"**.
   - Long calls are the ones with real conversations, so this hits the most valuable calls.
3. **Undoing a callback disposition crashes** (HTTP 500, on both main and tip). See Undo above.
4. **In dev mode, opening a call screen places two calls.** React StrictMode runs the start-call effect twice (`main.jsx` + `useCall.js`). [A] Two `call_history` rows were created for the same lead in the same millisecond, and on tip the screen then stayed on "Ringing…" while the DB said `answered`. The owner runs `npm run dev` in Codespaces, so this affects daily use. The production build places one call.
5. Settings "Default max attempts" has no effect (see Settings above).
6. The SMS inbox can never receive anything (see SMS above).

### Where the code contradicts CLAUDE.md

- **Rule 7 (no hardcoded env values):** the Groq key in `config/index.js` (item 1 above).
- **Rule 4 (no SQL in route handlers):** `backend/src/routes/calls.js:67` (`SELECT * FROM leads …`) and `backend/src/routes/imports.js:147` (`SELECT source_rows FROM import_jobs …`).
- **"Every status change goes through `leadLifecycle.js` or the stale-lock sweep"** (Section 3): `services/callSession.js` sets `status='in_queue'` in `abandonSlotCall` and `status='dnc'` in `reserveSlot` directly.
- **Rule 2 (telephony adapter interface):** on tip, `telephony/mockAdapter.js` now emits a `{ type: 'busy' }` event that is not in the documented interface in `telephony/index.js` (still only ringing / answered / voicemail_detected / ended). Additive, but it changes the contract without updating it.
- **Rule 1 (one task per session) and rule 6 (commit per feature):** `claude/full-feature-batch` and the branches stacked on it bundle many features into each branch and PR (e.g. "Parts D+E+F").
- **CLAUDE.md itself is out of date** relative to tip: it still describes "Vortex Dialer", phase 1 only, CSV only, and `csv`/`pdfkit` without `xlsx` or Groq.

### Dropped by the owner
- Golden-hour planner

## 5. Decisions already made

- AI providers: Groq stays for CSV cleaning and note expansion (high volume, free tier matters). For the rebuttal coach, the choice is open: Claude Haiku 4.5 (paid, roughly $1 per million input tokens and $5 per million output, no permanent free tier, one-time $5 starter credit) versus Groq `openai/gpt-oss-20b` (free). Volume is only about 50-200 generations a month, so Haiku's cost would be under $2 a month. Gemini Flash-Lite was judged underpowered for this.
- Rebuttal "training" means better prompts plus a feedback loop of approved examples. It is not model fine-tuning.
- Telephony: no physical SIM cards. Use a virtual US number (DID) through Twilio or Telnyx. Telnyx is cheaper per minute. Start with Twilio, consider moving later. Do not use SIM-box setups.
- Recording: only calls with a live conversation are kept. Several US states require two-party consent, so add a verbal notice to the pitch script before enabling real recording.
- No "call transfer" feature until there is a team to transfer to.
- Email: SendGrid pattern, needs a verified sending domain before real sending.
- Hosting: Codespaces is a development environment, not a home for production. Plan a move to Render or Railway.

## 6. Known risks and gaps

- Database lives only in the Codespace. No automated backups.
- API keys saved through Settings are stored in plain text in the database.
- xlsx 0.18.5 has two unpatched advisories (prototype pollution, ReDoS) and parses uploaded files.
- Multi-line session state is held in memory. A backend restart mid-session drops the live UI, though leads recover.
- No automated tests on DNC, disposition, or lifecycle logic.
- Real Groq cleaning quality was only recently tested against real data. Verify with the real API, not mocks.
- Past rounds reported features as working that were not. Require real described tests and real output in every completion report.

## 7. How to work with the owner

- Messages are often dictated, so expect rough phrasing. Restate what you understood if it is ambiguous.
- Prompts to Claude Code should be one feature at a time, with a Definition of Done that requires a described real test.
- Use Plan Mode first for anything involving AI prompt design or cross-cutting refactors, and a stronger model for those.
- The owner prefers short answers when asking quick questions, and detailed prompts when asking for build instructions.
- Visual polish (symmetry, spacing) is deferred until the functional work is done.

## 8. First steps in a new session

1. Run `git status` and `git log --oneline -15` and confirm everything is merged into `main`.
2. Audit the codebase against Section 4. Report each feature as working, partial, or missing, and flag anything that differs from CLAUDE.md.
3. Update Section 4 of this file with the audit results and commit it.
4. Ask the owner which of the "Not added" items to build next.
