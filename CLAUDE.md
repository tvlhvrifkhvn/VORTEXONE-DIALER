# Vortex Dialer — CLAUDE.md

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
- Auth: JWT with bcrypt (single user for MVP, multi-user ready)
- PDF export: pdfkit
- Telephony: mock adapter now, Twilio in phase 2

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

`mockAdapter.js` fires these on a timer (3s ring, then randomly answered / voicemail /
no_answer). The route handler in `routes/calls.js` reads which adapter to use from
`TELEPHONY_PROVIDER=mock|twilio` in `.env`.

## Design language: neumorphism, with a critical exception

Base palette: background `#E4E9F0`, raised surfaces use dual shadows
(`-6px -6px 12px #FFFFFF` + `6px 6px 12px #A3B1C6`), text `#3E4C63` / `#6A7A94`,
14px radius on cards, 10px on inputs, Inter font.

Neumorphic style applies to containers, cards, inputs, sidebar, and non-critical
buttons. **Action buttons (Call, Hangup, the six disposition buttons) use solid,
high-contrast fills instead** — see `frontend/src/styles/theme.js` for exact colors.
Reason: strict neumorphism minimizes contrast, which slows down repetitive clicking
during fast dialing. Containers pretty, actions loud.

## Rules for Claude Code working on this project

1. **One task per session, tested before the next.** Don't build three features in
   one go.
2. **Never change the telephony adapter interface without discussing it first.**
3. **When fixing a bug, quote the exact error and name the file/function.** Don't
   rewrite unrelated files.
4. **Every backend feature has a route in `/routes/` and its logic in `/services/`.**
   No SQL in route handlers.
5. **Every new frontend piece uses the `/components/ui/` neumorphic primitives.**
   Don't hand-roll shadows on new components.
6. **Commit after every working feature.** If a change breaks something and you
   can't fix it in 2 tries, revert to the last commit and try a different approach.
7. **Use environment variables for anything that changes between environments**
   (`DATABASE_URL`, `TELEPHONY_PROVIDER`, `PORT`, `JWT_SECRET`). Never hardcode.
8. **Prefer editing over rewriting.** If asked to change one function, change that
   one function.

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
