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

### Built and verified by an earlier codebase audit
- Login/auth, lead table with state sidebar, filters, pagination, checkbox selection, global search, time zone clock
- CSV and Excel import (multi-sheet), background import jobs with progress and cancel, Groq-based column mapping and cleaning, duplicate merge, DNC check
- Lead lifecycle: queue, locking, retry cap, cold parking, DNC, undo, callbacks
- Dialing sessions and multi-line dialing (1-3 lines) over Server-Sent Events, on the mock adapter. Voicemail, busy, and no-answer auto-resolve. A second live answer is "held", not dropped. A single line replaces the old "power dial" mode.
- Dispositions, notes, previous-notes history, pitch script panel
- Daily PDF export (table format), reports page, daily goal tracker, session summary
- Settings (profile, dialing defaults, script, Groq key), dark mode
- Calling-hours enforcement exists but is off by default (a settings toggle), for testing

### Reported built in later rounds (re-verify in the repo)
- Full-page call screen with action grid (tag, note, view lead, quick SMS, mute, hold) and a working dial pad with paste support
- Call recording plumbing (`was_recorded`, recording only for contacted calls, "Recording" indicator). No real audio until Twilio.
- SMS: templates with merge fields, throttled bulk send, opt-out, inbox, per-lead conversation and unified timeline, MMS attachment plumbing, all on the mock adapter
- Email: mock adapter, compose from the lead page
- Lead detail as a full page at `/leads/:id`, with per-row call and snooze buttons removed
- CSV fix: merge duplicate name rows only when name and city/state match, fall back from `office` to `source` for brokerage, and a `missing_phone` flag that keeps phoneless leads out of the dial queue

### Added by the owner after those rounds
- Objection tracker and rebuttal coach
- Pre-call brief (built without colleague mode, so check how the colleague section behaves)

### Not added as of the last update (confirm status with the owner)
- Colleague mode (office-level social proof)
- Voicemail-to-text automatic follow-up
- Rebuttal quality additions: review gate (pending/approved), "why this works" line, gold-example tagging, "I used this" tracking, low-performance flag
- Rebuttal voice and quality prompt for the AI model (strict voice rules, few-shot real examples, length cap, self-check, temperature about 0.7, approvals fed back as examples)
- Phase 2: real Twilio or Telnyx calling and SMS, SendGrid email

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
