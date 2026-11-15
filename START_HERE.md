# Start here — Vortex Dialer

A short note for whoever picks this project up next (a new Claude Code chat, or a person).
Last updated after Segment 10+11 (November 2026).

## 1. Where things stand

- **`latest` holds all the fixes.** Segments 1–10 of the bug audit are merged into `latest` (PRs #13–#26).
  52 of the 55 audit findings are fixed. The full list, with what each segment changed, is in
  [`FIX_LOG.md`](FIX_LOG.md), under "Closing status".
- **One PR is still open: #27** (`claude/fix-seg11-groq-key`). It removes the hardcoded Groq API key
  (finding F-01). **Merge it only after the owner has:**
  1. revoked the old key in the Groq console (it is in the git history, so removing it from the code isn't enough);
  2. set a new key as `GROQ_API_KEY` where the app runs, or saved it under Settings → Integrations.
- **Partly fixed, by decision:**
  - **F-02:** the `xlsx` library has an advisory with no npm fix. It is kept: the maintained build can't
    be downloaded here, and the alternative changes imported data.
  - **F-46:** the PDF prints accents and black-and-white emoji; other alphabets print "?". The app is English-only.
- **Everything is tested on the mock adapters only.** No real phone, SMS or email provider is
  connected yet. See "Before real calling" in `FIX_LOG.md` for what Phase C must still do.

## 2. Read first, in this order

1. [`CLAUDE.md`](CLAUDE.md): the project rules (API-first, no SQL in routes, the telephony adapter
   contract, small edits). A Claude Code chat loads it automatically.
2. [`FIX_LOG.md`](FIX_LOG.md): read the **last two sections** ("Segment 11" and "Segment 10", which
   contains "Closing status" and "Before real calling"). Older sections only when a task touches that area.
3. [`AUDIT_REPORT.md`](AUDIT_REPORT.md): the original audit. Search for a finding ID (`F-NN`)
   rather than reading it all.

## 3. Run the app

```bash
git checkout latest && git pull
(cd backend && npm install) && (cd frontend && npm install)
./dev.sh              # Postgres, migrations, backend :4000, frontend :5173
./dev.sh status       # what is running
./dev.sh stop
```

Things that surprise people:
- **Calling hours are ON by default:** calls are refused outside 8am–9pm in the lead's US time
  zone, which is most of the daytime in Pakistan. Switch them off under Settings → Dialing defaults only for testing.
- **"Today"** follows Settings → Reporting day (default Asia/Karachi, from midnight).
- **Only a supervisor can change settings.** The seed creates the owner as a supervisor.

## 4. How the work was done (keep doing it this way)

- **One segment per branch and PR:** `claude/fix-segN-…`, with one commit per fix and a commit for tests + `FIX_LOG.md`.
- **Every fix has a real test**, run **3 times on the old code (base) and 3 times on the new code**,
  with before/after numbers in `FIX_LOG.md` and the output in `audit/logs/fix-segN.txt`.
- **A full regression of all earlier segments once per segment**
  (`audit/logs/fix-segN-regression.txt`). It covers:
  - imports at 300 / 4,000 / 30,000 rows as CSV and XLSX;
  - the calling-hours boundary table;
  - the report and PDF checks;
  - SMS and email;
  - multi-line 15 calls on 15 leads, and "Connected" under `npm run dev`;
  - routes, the schema check, the auth matrix, the DB invariants, and the production UI smoke test.
- **Never against real data.** Tests use throwaway databases and synthetic leads only. Never print
  passwords or API keys in logs.

## 5. The test setup (needs rebuilding on a new machine)

The scripts in `audit/scripts/` (helpers in `audit/lib/env.sh`) expect a local test Postgres. That
setup lived on the old machine and is **not** in the repo, so a new chat must rebuild it once:

- **Postgres:** on `localhost:5432`, with a role `vortex` / password `vortex` that owns the test databases.
  The old machine ran its own cluster with its socket in `/var/tmp/audit-pg`; the scripts call `psql -h /var/tmp/audit-pg`
  to create and drop databases, so either recreate that or adjust `fresh_db()` in the scripts.
- **Template databases** the scripts clone (`CREATE DATABASE … TEMPLATE …`). Each one is fully migrated
  (`cd backend && npm run migrate`):
  - `vortex_empty`: migrated, no data.
  - `vortex_seg2_tpl` and `vortex_seg3_tpl`:
    - seeded with `SEED_USER_PASSWORD=<a test password you choose> npm run seed`;
    - two reps added: `node audit/scripts/add-user.js rep2@example.com 'Rep2Pass!' "Rep Two"`, and the same for `rep3@example.com` / `Rep3Pass!`;
    - `vortex_seg3_tpl` also has `audit/fixtures/j_5000.csv` imported through the app (about 5,000 synthetic leads);
    - setting `calling_hours_enforced = 'false'` in both, which is the condition the older tests were written under.
- **Run a script:** `AUDIT_PASSWORD=<that seed password> bash audit/scripts/fix-segN.sh <label> <checkout>`,
  where `<checkout>` is the project folder, or a `git worktree` of the base commit for "before" runs.
- **Test stubs (`audit/stubs/`):**
  - `fake-now.js`: a controlled clock.
  - `force-outcome.js`: forces the mock call outcome.
  - `no-busy.js`: an adapter that never sends `busy`.
  - `groq-stub-server.js`: a local fake Groq server. **Never call the real Groq API in tests.**

## 6. Likely next work

- **Merge #27** once the Groq key has been rotated.
- **A new interface (frontend redesign):** the backend doesn't need to change. Keep the hooks in
  `frontend/src/hooks/` and `lib/api.js`, and replace the pages and components screen by screen. Keep the
  call screen's action buttons big and high-contrast. Update the UI tests (`audit/scripts/*ui*.js`), which look for button names.
- **Phase C (real calling):** the real telephony adapter behind `placeCall` (map busy hang-ups; add ending
  a call at the provider), the real SMS adapter (`parseInbound`, the webhook signature check at the marked
  place in `telephony/smsIndex.js`, `SMS_WEBHOOK_SECRET`), and real email. Then retest calling hours,
  STOP / START and the reports against real traffic.
- **Before real calling, the owner should:**
  - check Settings (calling hours ON, reporting timezone, max attempts);
  - change the login password if the instance was ever seeded with the old default;
  - set `trust proxy` if a reverse proxy is put in front of the server.
