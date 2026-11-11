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
*pending*

## 4. Verified working
*pending*

## 5. Can't verify
*pending*

## 6. Architecture-rule compliance
*pending*

## 7. Observations needing a decision
*pending*

## 8. Suggested fix order
*pending*
