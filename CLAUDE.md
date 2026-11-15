# Vortex One Outreach (repo: vortexone-dialer)

Internal names (dialer, tables, env vars) stay as they are; only the product name changed.

**Read first:** docs/CODEMAP.md; docs/CRM_PLAN.md (sections 0 to 4 and your phase);
docs/DESIGN.md for any UI work.

Custom cold-calling dialer for Vortexone Agency. Solo caller (Talha Arif) offering
virtual-assistant services to US real estate agents from Pakistan. Leads come from
spreadsheets: name, phone, address, brokerage, state.

## Non-negotiable design principles

1. **API-first.** Every read/write to lead or call data goes through the backend API.
   The frontend never talks to the database directly. Future integrations (CRM,
   Google Sheets, Google Calendar) plug into this same API.
2. **Telephony is a pluggable adapter.** `TelephonyAdapter` interface lives in
   `backend/src/telephony/index.js`. `mockAdapter.js` is used for all of phase 1 and
   stays forever as the CI-safe / dev adapter. `twilioAdapter.js` is the phase-2 swap —
   no other code should change when it's filled in. **Never change the adapter
   interface without discussing it first.**
3. **No lead ever silently disappears.** Every lead sits in exactly one clearly-defined
   status at all times (see below), with an explicit rule for what happens next.
4. **State-tagged leads.** Every lead is tagged with a US state (2-letter). This powers
   the sidebar view and automatic calling-hour enforcement per time zone.
5. **Small, targeted changes.** When fixing a bug, edit the specific file/function
   named. Don't rewrite files that weren't asked for.

## Tech stack

- Backend: Node.js + Express (plain JavaScript, not TypeScript)
- Database: PostgreSQL (raw `pg`, no ORM)
- Frontend: React + Vite + Tailwind CSS
- Auth: JWT with bcrypt; users with roles (supervisor, rep); only a supervisor changes settings
- PDF export: pdfkit
- Telephony, SMS and email: mock adapters. Telnyx is the planned provider;
  twilioAdapter.js is an unused stub (don't delete it)

## Lead status values (a lead has exactly one at any time)

- `new` — never dialed
- `in_queue` — ready to dial
- `in_progress` — currently locked to a rep during dialing
- `contacted` — spoke to someone
- `voicemail` / `no_answer` — attempted, will requeue if attempts < max_attempts
- `callback_scheduled` — has a specific time set for later
- `no_contact_number` — this specific phone is bad; other numbers on file stay workable
- `no_contact_person` — this person is done, all their numbers stop
- `dnc` — legally protected, never dial again, blocked from re-import
- `cold` — hit max attempts with no contact, parked for later recycling

## Lead lifecycle rules

- When a rep starts dialing, the next lead in queue is **locked** to them (`in_progress`).
- If they hang up without submitting a disposition, the lead returns to `in_queue`
  after 30 seconds.
- Voicemail / no_answer requeue the lead with `next_action_at` set 4 hours out for the
  next attempt, until `attempts >= max_attempts`, then status becomes `cold`.
- `no_contact_number` marks that specific phone bad; other numbers on the lead stay
  dialable.
- `no_contact_person` locks all numbers for that lead and moves status to `cold` with a
  distinct reason.
- `dnc` writes to the DNC list AND permanently blocks re-import: every CSV import
  checks the DNC list and skips matching numbers.
- **Calling-hours enforcement:** the dialer refuses to place a call outside 8am–9pm
  local time of the lead's state (mapped to a US time zone).

## Telephony adapter interface

```js
placeCall(fromNumber, toNumber, onEvent) → callId
```

`onEvent` receives events shaped like:
- `{ type: 'ringing' }`
- `{ type: 'answered' }`
- `{ type: 'voicemail_detected' }`
- `{ type: 'ended', duration: <seconds> }`
- optional: `{ type: 'busy' }` (followed by `ended`). An adapter that never sends it still works: a call
  that ends without being answered is handled exactly like a busy one (counted as a no-answer, requeued).

`mockAdapter.js` fires these on a timer (3s ring, then randomly answered / voicemail /
no_answer). The route handler in `routes/calls.js` reads which adapter to use from
`TELEPHONY_PROVIDER=mock` in `.env` (real providers come later).

## Design language: Neo-Swiss

Rules: docs/DESIGN.md. Plan and status: docs/RESKIN.md (all segments done). Decisions: docs/DECISIONS.md. Build UI from the primitives in src/components/ui/ (Panel, Button, Field, ActionButton, Badge, Keycap, SectionLabel, FileTag, StatusDot, Meter, Segmented, Dialog), all shown on the hidden /styleguide page. Two themes: ink (default) and paper. Check with `npm run build` and `npm run contrast` in frontend/, `bash audit/scripts/reskin-grep.sh` (must print nothing), and `node audit/scripts/reskin-shots.js` / `reskin-a11y.js` for screenshots, the hotkey smoke test and the keyboard and label pass.

## Rules for Claude Code working on this project

1. **One task per session, tested before the next.** Don't build three features in
   one go.
2. **Never change the telephony adapter interface without discussing it first.**
3. **When fixing a bug, quote the exact error and name the file/function.** Don't
   rewrite unrelated files.
4. **Every backend feature has a route in `/routes/` and its logic in `/services/`.**
   No SQL in route handlers.
5. **Every new frontend piece uses the `/components/ui/` primitives, following docs/DESIGN.md.**
   Don't hand-roll shadows on new components.
6. **Commit after every working feature.** If a change breaks something and you
   can't fix it in 2 tries, revert to the last commit and try a different approach.
7. **Use environment variables for anything that changes between environments**
   (`DATABASE_URL`, `TELEPHONY_PROVIDER`, `PORT`, `JWT_SECRET`). Never hardcode.
8. **Prefer editing over rewriting.** If asked to change one function, change that
   one function.
9. **Collection functions take `campaignId` explicitly** (docs/CRM_PLAN.md section 3).
   No hidden "current campaign" on the server.
10. **`leads.status` belongs to the dialer; `pipeline_stage_id` belongs to the CRM.** Never mix them.
11. **DNC, SMS opt-out, calling hours and the total budget are global.** No campaign can bypass them.
12. **New behavior goes in new files** (service, route, migration). Existing files get small, named edits.
13. **Never edit an applied migration;** add the next numbered one.
14. **Every new rule gets an assertion in backend/tests** (`npm run verify`, from phase C0B on).
15. **Update docs/CODEMAP.md in the same commit.**

## Running locally

```bash
# backend
cd backend
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET
npm install
npm run migrate
npm run seed            # optional: creates a dev user + sample leads
npm run dev             # http://localhost:4000

# frontend
cd frontend
npm install
npm run dev              # http://localhost:5173
```
