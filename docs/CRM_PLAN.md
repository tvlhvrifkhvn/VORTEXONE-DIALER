# CRM build plan: phases C0A to C4B

Goal: Vortex One Outreach becomes a simple CRM with campaigns ("files"). Each campaign has its own leads, pipeline stages, fields, script, templates and objections. The dialer, inbox, tasks and reports work inside the chosen campaign. Everything still runs on mock adapters.

How it runs: one phase per Claude Code session, on a branch `claude/crm-<phase>-<slug>` from the newest `latest`, with one PR into `latest`. The owner merges it before the next phase starts.

When the owner says "next": merge the open phase PR (that is the approval), take the first phase in Status that is "not started", run it exactly as its section and section 0 say, open its PR, report, and stop. Don't merge a PR whose gate failed and don't start a phase on top of one: report instead. "fix: …" changes the open PR; "stop" leaves everything as it is.

## Section 0: rules for every phase
1. Read only:
   - docs/CODEMAP.md,
   - this file: sections 0 to 4 and your own phase,
   - the files your phase names,
   - docs/DESIGN.md and the ui/ primitives, for UI work.

   Don't open FIX_LOG.md, AUDIT_REPORT.md, audit/ (unless named) or finished phases. Don't explore.
2. Where code goes:
   - New behavior goes in new files: a new service, a new route file, a new migration, a new page.
   - Existing files get only the edits your phase names. Never rewrite, rename or reformat them.
   - If the gate can't pass without an unnamed edit, make the smallest one and list it under UNPLANNED EDITS in the report.
3. Never change:
   - the telephony adapter contract `placeCall(from, to, onEvent)`;
   - the list of dispositions and the values of `leads.status`;
   - `UNIQUE(phone)` on leads;
   - the DNC, SMS opt-out and calling-hours checks (they stay global and ignore campaigns).
4. Migrations: one new file per phase, with the next free number (033 is the first). Never edit an applied one. Each file runs in one transaction, so no `CREATE INDEX CONCURRENTLY`. Backfill inside the same file, then add NOT NULL.
5. Tests: each new rule gets an assertion in backend/tests. Don't run the old audit/scripts regressions.
6. UI work follows docs/DESIGN.md and uses the ui/ primitives. Campaigns are shown as files: "FILE 01 · REAL ESTATE".
7. Gate, run once at the end:
   a. `cd backend && npm run verify` passes (from C0B on).
   b. If frontend/ changed:
      - `cd frontend && npm run build && npm run contrast`,
      - `bash audit/scripts/reskin-grep.sh` prints nothing,
      - `node audit/scripts/reskin-shots.js --seg <phase> --pages <touched pages>` in both themes, with `--smoke` when the call screen changed.

      A change under frontend/src/lib only needs the build.
   c. Print `git diff --stat origin/latest...HEAD`.
8. Bookkeeping: update the CODEMAP lines for the files you changed or added; set your Status line below; log each decision as one line in docs/DECISIONS.md; open a PR titled "CRM <phase>: <name>".
9. Report, max 25 lines, then stop: DONE / FILES / UNPLANNED EDITS / DECISIONS / PROOF / NEEDS FROM YOU / NEXT.

## Section 1: decisions
- D1. One phone number = one lead = one campaign. A lead can be moved to another campaign.
- D2. `leads.status` is the dialer lifecycle and stays as it is. `leads.pipeline_stage_id` is the CRM stage.
- D3. Dispositions are the same for every campaign. A campaign customizes stages, fields, script, templates, objections, goal and labels.
- D4. Global: DNC, SMS opt-out, calling hours, reporting timezone, the total budget.
- D5. Scoping is explicit. Only collection functions (lists, queues, counts, reports) take `campaignId`. Functions that work on one lead or one call by id don't: the row carries its own campaign.
- D6. No companies table. `brokerage` + `office_key` act as the company; `campaigns.company_label` names it ("Brokerage", "Company").
- D7. No deals table. A lead has `deal_value_cents`, `won_at`, `lost_reason`.
- D8. No automation (sequences) in these phases.
- D9. Solo owner. No team routing or permissions beyond today's roles.

## Section 2: data model (the phase that adds each part is in brackets)
Tables:
- `campaigns` [C1A]: id, file_number (unique, 1, 2, …), name (unique), slug (unique), kind (`real_estate` | `roofing_supplement` | `custom`), status (`active` | `paused` | `archived`), company_label, ai_context, pitch_script, daily_goal, default_max_attempts (null = global default), monthly_budget_cents (null = none), created_at, archived_at.
- `pipeline_stages` [C2A]: id, campaign_id, name, position, kind (`open` | `won` | `lost`), auto_on (null | `contacted`). Unique (campaign_id, name).
- `lead_stage_history` [C2A]: id, lead_id, from_stage_id, to_stage_id, source (`create` | `import` | `disposition` | `manual` | `undo` | `move` | `bulk`), user_id, created_at.
- `campaign_fields` [C2C]: id, campaign_id, key, label, type (`text` | `number` | `date` | `select` | `boolean`), options, position, show_in_list. Unique (campaign_id, key).
- `saved_views` [C2E]: id, user_id, campaign_id, name, filters (JSONB), position.
- `tasks` [C3A]: id, campaign_id, lead_id, user_id, type (`call` | `email` | `text` | `other`), title, due_at, done_at, source (`manual` | `disposition`), created_at.

Columns:
- `leads` [C1A]: campaign_id NOT NULL.
- `leads` [C2A]: pipeline_stage_id NOT NULL, deal_value_cents, won_at, lost_reason.
- `leads` [C2C]: custom JSONB NOT NULL DEFAULT '{}'.
- `call_history` [C1A]: campaign_id NOT NULL (copied from the lead when the call starts; manual calls take the active campaign). [C4A]: billed_seconds, cost_est_cents.
- `dialing_sessions`, `import_jobs` [C1A]: campaign_id NOT NULL.
- `sms_templates`, `objection_types` [C1A]: campaign_id (null = shared by all campaigns). `objection_types`: unique (label) is replaced by two partial unique indexes: (campaign_id, label) where campaign_id is set, and (label) where campaign_id is null. Works on every Postgres version; don't use NULLS NOT DISTINCT.

Invariants (I1 to I8 already exist; "I9" in audit/scripts/invariants.sql is a lead count, not a rule, so the new ones start at I10):
- I10: every lead has exactly one campaign.
- I11: every call row has a campaign.
- I12: a lead's stage belongs to the lead's campaign.
- I13: every lead has a stage.
- I14: a dial session only dials leads of its own campaign.
- I15: DNC, opt-out and calling-hours checks never look at the campaign.

## Section 3: API conventions
- Header `X-Campaign-Id: <id>` on requests, added once in `frontend/src/lib/api.js`. `ALL` is accepted only on read routes marked "or ALL".
- The call event stream (`/api/calls/stream`) is per user and needs no campaign.
- `backend/src/middleware/campaign.js`:
  - `requireCampaign`: the id exists and is not archived; sets `req.campaign`.
  - `requireActiveCampaign`: as above, and status is `active`. Used for dialing and importing.
  - `campaignOrAll`: as `requireCampaign`, or `ALL` (then `req.campaign` is null).
  - A bad or missing header answers 400 with code `campaign_invalid`.
- Routes that work on one lead, call, template or task by id need no header.
- Collection functions and their final signatures:
  - leadQueue: `candidates({ campaignId, limit })`, `peekNext(campaignId)`, `lockNext({ userId, leadId, campaignId })`, `countsByState(campaignId)`, `list({ …, campaignId })` (or ALL), `batchQueue(ids, campaignId)`, `create(input)` with `input.campaignId`. `search(q)` stays global and returns each lead's file number and campaign name.
  - callSession: `startMultilineSession(userId, sessionId, lineCount, selectedLeadIds, campaignId)`, `startManual({ userId, toNumberRaw, campaignId })`.
  - dialingSession: `startSession(userId, mode, campaignId)`.
  - csvImport: `createImportJob({ userId, filename, campaignId })`, `commitImport({ …, campaignId })`.
  - reports: `periodStats(period, campaignId)`, `periodCalls(period, campaignId)`, `perStateReport(campaignId)`, `manualCallsToday(period, campaignId)` (all accept ALL). pdfExport: `buildDailyReportBuffer(periodInput, repName, campaignId)`.
  - smsService: `listTemplates(campaignId)` (the campaign's plus shared), `createTemplate({ …, campaignId })`, `getInbox({ page, limit, campaignId })` (or ALL).
  - objectionService: `listTypes({ campaignId, includeInactive })`, `createType({ …, campaignId })`, `getReport({ …, campaignId })`, `listOffices(campaignId)`. rebuttalCoach: `getHints(campaignId)`.
- One SQL helper, `backend/src/services/campaignScope.js`: `scope(alias, campaignId, paramIndex)` returns `{ sql, params }`; for ALL it returns `TRUE` and no params. Use it instead of hand-writing the condition.

## Section 4: UI map (after C3B)
- Nav: TODAY `/` · PIPELINE `/pipeline` · LEADS `/leads` · DIALER `/dialer` · INBOX `/inbox` · REPORTS `/reports` · SETTINGS `/settings` (campaigns at `/settings/campaigns`).
- Header: the FileTag is the campaign switcher [C1E]; the spend meter sits beside the theme toggle [C4B].
- The call screen keeps its layout, order and hotkeys in every phase.

## C0B Safety-net tests (Sonnet 5.5, high)
Read: backend/package.json, backend/src/index.js (exports `app`), backend/src/db/index.js, backend/src/db/migrate.js, backend/src/middleware/rateLimit.js, backend/src/telephony/mockAdapter.js, audit/stubs/ (fake-now.js, force-outcome.js, groq-stub-server.js), audit/scripts/invariants.sql. For a scenario you can't build from CODEMAP, read only the function under test.

Do:
- `backend/tests/run.js` and `"verify": "node tests/run.js"` in backend/package.json. No new dependencies (node:test, built-in fetch).
  - Take the Postgres server from DATABASE_URL (env or backend/.env). Drop and create a database named `vortex_verify`, run the migrations on it, run `node --test` on backend/tests with concurrency 1, drop it, and print a short pass/fail table.
  - Refuse to run against any database not named `vortex_verify`.
  - Force mock providers, a test JWT secret and no real Groq key (use the stub server or the no-AI paths).
- One named edit in backend/src/middleware/rateLimit.js: the two max values can be raised by RATE_LIMIT_API_MAX and RATE_LIMIT_LOGIN_MAX, read only when NODE_ENV is test. tests/run.js sets NODE_ENV=test and both values. The defaults stay 100 and 5; add one assertion that they apply without the override.
- `backend/tests/helpers.js`: reset tables between files, create a user and leads, get a token, start `app` on a free port, control the mock call outcome and the clock (reuse the ideas in audit/stubs). All HTTP calls go through one helper, so a later phase can add a header in one place.
- About 35 assertions, in a few files, for the rules that must never break:
  - invariants I1 to I8 after a mixed run of calls;
  - DNC: an import row is blocked; editing a phone to a DNC number is handled as today; a DNC lead can't be dialed by id, from the queue or from the dial pad;
  - locks: 20 parallel "next lead" requests get 20 different leads; 10 parallel requests for one lead get one winner; the stale-lock sweep frees an old lock; a soft-deleted lead is never dialed;
  - each disposition sets the expected status, attempts and next action; max attempts makes the lead cold; Undo inside the window restores the snapshot; Undo after the window is refused;
  - calling hours: the boundary minutes around 8:00 and 21:00 local, for two time zones, with enforcement on and off;
  - import: the outcome counts add up to the file's rows; importing the same file again adds 0 leads;
  - reports: the totals equal the call rows; a failed dial is not counted;
  - SMS: inbound STOP opts the lead out and suppresses the number; START reverses it;
  - settings and auth: a rep can't write settings; an unknown key answers 400; protected routes answer 401 without a token.
- Document current behavior, not wished behavior. If a test shows a real bug, don't fix it: mark the test `todo` and list it under NEEDS FROM YOU.

Gate: `npm run verify` passes 3 times in a row and takes under 3 minutes. Mutation check: break 3 rules one at a time (remove the DNC check in the by-id lock, remove a condition in `claimLead`, skip one field in Undo), confirm the suite fails each time, restore, and show that `git status` is clean for backend/src. Add the verify command to CLAUDE.md ("Checks") and CODEMAP.

## C1A Campaign schema and writes (Opus 5.5, high)
Read: backend/src/db/migrations/002, 003, 008, 011, 015, 021 (table shapes only), middleware/auth.js, and the INSERT sites: leadQueue.js `create`, csvImport.js `createImportJob` and the lead INSERT in `savePhase`, callSession.js `start`, `startManual`, `placeSlotCall`, dialingSession.js `startSession`, smsService.js `createTemplate`, objectionService.js `createType`, db/seeds/run.js, db/seeds/seedObjectionDemo.js. Frontend: lib/api.js `request`.

Do:
- Migration 033: `campaigns`; seed File 01 "Real Estate" (kind `real_estate`, company_label "Brokerage", an ai_context sentence about VA support for US real estate agents); add every `campaign_id` column of section 2 [C1A], backfill to File 01, then NOT NULL where section 2 says so; indexes on `leads(campaign_id)` and `call_history(campaign_id, started_at)`; the two partial unique indexes on objection_types (section 2). If createType or a seed uses ON CONFLICT (label), change it to match the new indexes.
- New `services/campaigns.js`: list, getById, create (next file_number, slug), update, setStatus (pause, resume, archive; refuse to archive the last active campaign; refuse while one of its leads is `in_progress`), and `moveLead(leadId, toCampaignId)` (refuse while the lead is `in_progress`; old call rows keep their campaign).
- New `routes/campaigns.js` (supervisor only for writes): GET /api/campaigns, POST, PUT /:id, POST /:id/status, and POST /api/leads/:id/move-campaign.
- New `middleware/campaign.js` and `services/campaignScope.js` (section 3).
- Writes carry the campaign: each INSERT site above sets `campaign_id`. Lead calls copy it from the lead; the dial pad, sessions, imports, templates, objection types and new leads take `req.campaign.id`. Add `requireActiveCampaign` to the dialing and import routes and `requireCampaign` to the other write routes. Seeds use File 01.
- Check once that CORS lets the `X-Campaign-Id` header through (print one preflight result).
- Frontend, two small edits: new `lib/campaign.js` (`getCampaignId()` and `setCampaignId()` on localStorage `vortex.campaign`, default "1"); `request()` in lib/api.js sends the header, also on uploads. On a 400 `campaign_invalid`, reset to "1" and retry once.
- Reads are NOT scoped in this phase (C1B to C1D do that).

Tests: I10 and I11 after a mixed run; each write path stores the right campaign; a paused or archived campaign refuses dialing and importing; a missing header answers 400; moveLead rules. Gate extra: run the migration on a copy with 100,000 generated leads and print its time.

## C1B Dialer scoping (Opus 5.5, high)
Read: leadQueue.js `candidates`, `peekNext`, `lockNext`, `claimLead`, `countsByState`, `batchQueue`; callSession.js `reserveSlot`, `startMultilineSession`; routes/calls.js, routes/sessions.js, routes/leads.js (state-counts, batch-queue).

Do:
- Apply the section 3 signatures for candidates, peekNext, lockNext, countsByState, batchQueue, startMultilineSession and startSession. Use `campaignScope.scope`.
- `lockNext` with a `leadId`: if the lead's campaign differs from `campaignId`, answer 409 "This lead belongs to FILE NN · NAME".
- The multi-line session object stores `campaignId`; `reserveSlot` passes it on; a selected list keeps only leads of that campaign.
- `releaseStaleLocks`, the DNC checks and calling hours stay global and unchanged.
- Check that the queue query still uses an index (print the plan once).

Tests: two campaigns with dialable leads; the queue, a single-line session and a multi-line session never return the other campaign's leads (I14); the lock tests still pass per campaign; state counts are per campaign. Gate extra: queue read time on 100,000 leads stays within +20% of before (print both).

## C1C Leads, import and reports scoping (Opus 5.5, medium)
Read: leadQueue.js `parseListQuery`, `buildListFilters`, `list`, `search`; csvImport.js `savePhase` (the duplicate checks and the INSERT) and `buildSummary`; reports.js; pdfExport.js `buildDailyReportBuffer` and its header drawing; routes/leads.js, imports.js, reports.js, exports.js.

Do:
- `list` filters by campaign (or ALL) and returns each lead's file number; `search` stays global and returns the file number and campaign name.
- Import: leads go to the job's campaign. A phone that exists in another campaign is skipped with the reason "Already in FILE NN · NAME (same phone number)". The no-phone identity check (same name and state) looks only inside the job's campaign.
- Reports: every function takes `campaignId` or ALL and filters on `call_history.campaign_id` (per-state: on the lead's campaign). The PDF prints the file name, or "All files", in its header.
- Routes: `campaignOrAll` on the lead list, reports and export; `requireCampaign` on state counts.

Tests: per-campaign counts add up to the ALL totals; the import accounting test passes with two campaigns; the "already in another file" reason; the PDF builds for one campaign and for ALL.

## C1D SMS, objections and AI context (Sonnet 5.5, high)
Read: smsService.js `listTemplates`, `getInbox`; objectionService.js; rebuttalCoach.js `getHints`, `gatherInstances`, `buildMessages`; and only the prompt-building parts of aiCsvMapper.js, preCallBrief.js, colleagueIntel.js, noteExpander.js; routes/sms.js, objections.js, ai.js.

Do:
- Templates: the campaign's plus shared ones. Inbox: by campaign or ALL (unmatched inbound messages show in ALL and in every campaign). Objection types, reports, offices and hints: by campaign.
- AI wording: replace the hardcoded real-estate wording in the six AI files with the campaign's `ai_context` and `company_label`, passed in by the caller. With File 01 the prompts must say the same thing as today.
- Opt-out, STOP and START handling stay global.

Tests: template and objection lists per campaign; the inbox filter; with the Groq stub, a File 01 prompt contains the real-estate context and a second campaign's prompt contains its own context and no real-estate wording.

## C1E Campaign UI (Sonnet 5.5, medium)
Read: components/layout/AppShell.jsx (the FileTag area), App.jsx, lib/api.js, lib/campaign.js, hooks/useUserSettings.js, pages/Dashboard.jsx, Reports.jsx, Inbox.jsx, Import.jsx, LeadDetail.jsx, CallScreen.jsx (pitch script part), components/leads/LeadTable.jsx, ColleagueCard.jsx.

Do:
- Migration: copy the first supervisor's `pitch_script` and `daily_goal` user settings into File 01 where the campaign's value is empty.
- New `hooks/useCampaign.jsx` (a context): the campaign list, the active campaign, `switchTo(id)`. Switching remounts the pages (a `key` on the routes wrapper) and is disabled during a call or a dial session.
- AppShell: the FileTag becomes a menu button listing the campaigns, with "MANAGE FILES →".
- New page `pages/Campaigns.jsx` at `/settings/campaigns`, linked from Settings: list, create (from the Real Estate template, the Roofing template or blank), edit (name, company label, daily goal, max attempts, AI context, pitch script), pause, resume, archive.
- Reports and Inbox get a Segmented "THIS FILE | ALL FILES". Import shows its target file and is blocked for a paused campaign.
- The pitch script and daily goal are read from the campaign. "Brokerage" labels use `company_label`.
- Opening a lead that belongs to another campaign switches to it and says so in a toast.
- The nav label "Dashboard" becomes "LEADS" (the route moves in C3B).

Gate extra: screenshots of every page with two campaigns, in both themes; the hotkey smoke passes.

## C2A Pipeline backend (Opus 5.5, high)
Read: leadLifecycle.js `snapshotOf`, `applyDisposition`, `undoDisposition`, `markDncFromQueue`, `markDncFromSlot`; leadQueue.js `create`, `parseListQuery`, `buildListFilters`, `list`; the lead INSERT in csvImport.js `savePhase`; services/campaigns.js; routes/dispositions.js, routes/leads.js.

Do:
- Migration: `pipeline_stages`, `lead_stage_history`, the [C2A] lead columns. Create stages for every existing campaign from its template. Backfill leads: status `contacted` or `callback_scheduled` goes to the campaign's `auto_on = contacted` stage; `dnc` goes to its `lost` stage with lost_reason "Do not call"; the rest go to the first stage. Then NOT NULL.
- New `services/pipeline.js`:
  - Templates. Real estate: New, Contacted (auto_on contacted), Interested, Intro call booked, Proposal sent, Client (won), Lost (lost). Roofing: New, Contacted (auto_on contacted), Interested, Sample claim received, First claim in progress, Client (won), Lost (lost). Custom: New, Contacted (auto_on contacted), Interested, Client (won), Lost (lost).
  - Stage list, create, rename, reorder and delete (delete only when empty). A campaign always keeps exactly one `won` stage, one `lost` stage and a first `open` stage.
  - `moveLead({ leadId, stageId, source, userId, lostReason })`: the stage must belong to the lead's campaign (I12); set `won_at` on a won stage and clear it otherwise; write a history row.
  - `board(campaignId, { perStage })`: each stage with its count and its most recently updated leads.
  - `onDisposition(client, lead, disposition, stageId)`, run inside the disposition's transaction: an explicit `stageId` wins; otherwise `contacted` moves the lead to the auto stage only when it sits in an earlier open stage; `dnc` moves it to the lost stage.
- Small named edits:
  - `campaigns.create` creates the stages; `campaigns.moveLead` sets the target's first stage.
  - `leadQueue.create` and the import INSERT set the first stage (I13).
  - `applyDisposition` accepts an optional `stageId` and calls `pipeline.onDisposition`; `snapshotOf` adds `pipeline_stage_id`, `won_at`, `lost_reason`; `undoDisposition` restores them and writes a history row with source `undo`; the two `markDnc…` functions move the lead to the lost stage.
  - `list` accepts a `stageId` filter and returns the stage name and kind.
- New `routes/pipeline.js`: GET and POST /api/pipeline/stages, PUT /:id, POST /reorder, DELETE /:id, GET /api/pipeline/board, POST /api/leads/:id/stage.

Tests: I12 and I13; each auto rule; an explicit stage wins; Undo restores stage, won_at and lost_reason; every move writes history; create and import set the first stage; the delete guard; all earlier disposition tests still pass unchanged.

## C2B Pipeline UI (Sonnet 5.5, medium)
Read: App.jsx, AppShell.jsx (nav), pages/Dashboard.jsx, LeadDetail.jsx, Campaigns.jsx, components/leads/LeadTable.jsx, LeadRow.jsx, LeadFilters.jsx, components/call/DispositionPanel.jsx, hooks/useLeads.js, and the place that builds the disposition payload.

Do:
- New page `pages/Pipeline.jsx` at `/pipeline`, added to the nav: one column per stage with its count; cards (name, company, status Tag, last activity); "LOAD MORE" per column; move a card by drag and drop (native, no new dependency) and by a "MOVE →" menu that works by keyboard.
- Leads table: a STAGE column and a stage filter.
- Lead page: a stage picker, deal value, and a lost reason when the stage is a lost stage.
- Outcome panel: an optional "MOVE TO STAGE" picker (default "Auto") sent as `stageId`. Keep the 3×2 outcome grid, its order and its hotkeys.
- Campaigns page: a stage editor (rename, add, delete, move up and down).

Gate extra: screenshots of the board, the leads table, the lead page, the outcome panel and the stage editor in both themes; the hotkey smoke passes.

## C2C Lead record backend (Opus 5.5, medium)
Read: csvImport.js `LEAD_FIELDS`, `MAPPABLE_FIELDS`, `guessMapping`, `completeMapping`, `prepareRow` and the lead INSERT; aiCsvMapper.js `SCHEMA_FIELDS` and `mapColumns`; leadQueue.js `validateLeadInput`, `updateFields`, `list`; smsService.js `getTimeline`; routes/leads.js (timeline, update), routes/imports.js.

Do:
- Migration: `campaign_fields`; `leads.custom`.
- New `services/customFields.js`: definitions (list, create, update, delete, reorder) and `validateValues(campaignId, values)` by type.
- `updateFields` accepts `custom` (validated, merged) and `deal_value_cents`; `list` returns `custom`.
- Import: each campaign field is an extra mapping target named `custom.<key>`; mapped values are stored in `leads.custom`; the AI mapper is told about these optional targets. The core lead fields and the import accounting must not change.
- New `services/timeline.js`: one list for a lead, newest first, with calls, notes, texts, emails, stage changes and the import event. The timeline route calls it. Remove `smsService.getTimeline` only after a grep shows no other caller.
- New routes: /api/campaigns/:id/fields (GET, POST, PUT, DELETE, reorder).

Tests: value validation per type; a custom CSV column lands in `leads.custom`; the earlier import tests pass unchanged; the timeline returns every event type in time order.

## C2D Lead record UI (Sonnet 5.5, medium)
Read: pages/LeadDetail.jsx, Campaigns.jsx, Import.jsx (the mapping table), components/leads/LeadTable.jsx, LeadActionHub.jsx.

Do:
- Lead page: a panel for the campaign's fields; tags with add and remove; the timeline as a hairline list with a type filter (All, Calls, Texts, Emails, Notes, Stages).
- Campaigns page: a field editor (label, type, options, show in list).
- Leads table: columns for fields marked "show in list".
- Import mapping: the custom targets appear in the target list.

Gate extra: screenshots of the lead page, the field editor, the table and the import mapping in both themes.

## C2E Smart views and bulk actions (Sonnet 5.5, medium)
Read: leadQueue.js `parseListQuery`, `buildListFilters`, `list`; routes/leads.js; pages/Dashboard.jsx; components/leads/LeadFilters.jsx, LeadTable.jsx, BulkSmsModal.jsx (as the pattern for selection).

Do:
- Migration: `saved_views`.
- New `services/savedViews.js` and routes /api/views (list, create, rename, delete, reorder), per campaign. A view stores the same filter object the list route accepts.
- Extra list filters, added to `parseListQuery` and `buildListFilters` only: tag, minimum attempts, "no activity for N days", "callback overdue".
- New bulk routes, max 500 ids per request: move to a stage, add or remove a tag, move to a campaign. Each uses the existing single-lead function in one transaction and skips leads that are `in_progress`.
- UI: a row of saved views above the table with live counts and "+ SAVE CURRENT FILTERS"; three new actions in the selection strip.

Tests: a saved view returns the same rows as the same filters sent by hand; each bulk action; the 500 limit; `in_progress` leads are skipped and reported.

## C3A Tasks (Sonnet 5.5, medium)
Read: services/timeline.js, leadLifecycle.js `applyDisposition` (the end only), routes/dispositions.js, pages/LeadDetail.jsx, CallScreen.jsx, components/call/CallActionGrid.jsx, DispositionPanel.jsx.

Do:
- Migration: `tasks`.
- New `services/tasks.js` and `routes/tasks.js`: create, update, complete, reopen, delete, list by lead, and list due (campaign or ALL).
- New `GET /api/today` (campaign or ALL): callbacks due and overdue; tasks due and overdue; unread inbound texts; open-stage leads past the auto stage with no activity for 7 days and no open task. Each list is capped at 50 and comes with its total.
- The disposition route accepts an optional `task` ({ title, due_at, type }) and creates it after the disposition succeeds. The timeline includes tasks.
- UI: a task panel on the lead page (add, complete); an "ADD TASK" tile on the call screen that opens a Dialog; an optional follow-up task row in the outcome panel. No new hotkeys.

Tests: due and overdue with a controlled clock; the today lists and totals; a task created with a disposition; Undo of that disposition leaves the task and says so in the response.

## C3B Today page and CRM navigation (Sonnet 5.5, medium)
Read: App.jsx, AppShell.jsx, pages/Dashboard.jsx, and one grep for `navigate('/')`, `to="/"` and `href="/"` across frontend/src.

Do:
- New page `pages/Today.jsx` at `/`: "01 — DUE TODAY" (callbacks, replies and tasks, with CALL, REPLY and OPEN actions and a filter), "02 — PIPELINE" (stage counts, linking to the board), "03 — NUMBERS" (dials today in display size, contacts, connect rate, the goal Meter), and START DIALING SESSION as the only primary button.
- The leads list moves to `/leads`. Update every link found by the grep. The nav follows section 4.
- Nav badges: Today (due + overdue) and Inbox (unread), as solid Tags.

Gate extra: screenshots of every page in both themes; the hotkey smoke passes; no link points to a wrong page (click through the nav in the screenshot script).

## C4A Cost engine (Opus 5.5, high)
Read: callLifecycle.js `markEnded`, `markFailed`; settings.js (`API_SETTINGS`, validators); reports.js (`PLACED_CALL_SQL`); reportingPeriod.js (month boundaries); routes/calls.js; callSession.js `queueRefill`, `dialIntoSlot`.

Do:
- Migration: `call_history.billed_seconds`, `call_history.cost_est_cents`.
- Settings (add to the whitelist, supervisor only): `rate_outbound_cents_per_min`, `rate_recording_cents_per_min`, `rate_per_call_cents`, `monthly_budget_cents`. They start empty; costs show as "not set" until the owner enters real rates.
- New `services/costEngine.js`:
  - `estimate(call)`: a connected call is billed in whole minutes, rounded up; a call that never connected costs only the per-call fee. Stored once when the call ends (one call from `markEnded`).
  - `spend({ campaignId | ALL, period })`: today and this month, using the reporting timezone.
  - `budgetState(campaignId)`: `ok`, `warning` at 80% or more, `reached` at 100% or more, for the campaign's budget and for the global one. The stricter one wins.
  - `assertBudget(campaignId)`: refuses a new dial with 409 "Budget reached — dialing stopped".
- Named edits: the three dial entry points (single, multi-line start, dial pad) call `assertBudget`; a running multi-line session stops refilling when the state becomes `reached` (calls in progress finish normally).
- New route GET /api/spend (campaign or ALL): today, month, budgets, state, per-campaign split.

Tests: 20 calls checked against a hand calculation; warning at 80%; dialing blocked at 100% on all three entry points; a running session stops refilling; no rates set means no blocking and "not set".

## C4B Spend meter and timers (Sonnet 5.5, medium)
Read: AppShell.jsx, pages/CallScreen.jsx, DialerSession.jsx, Campaigns.jsx, Settings.jsx (the section list only), hooks/useMultiline.js, hooks/useCall.js (read only).

Do:
- Header: a budget Meter with today's spend and "month / budget", the 80% and 100% texts of DESIGN.md, and "RATES NOT SET" when empty. Clicking it opens a Panel with the per-file split.
- Call screen: a mono row with this call's estimated cost and, during a session, the session time and dial count. Use data the hooks already expose, or the session stats route. Don't change hook logic.
- Campaigns page: the campaign's monthly budget. Settings: a "SPEND LIMITS" section with the rates and the global budget.

Gate extra: the meter equals the sum of the call costs in the test data; screenshots at 0%, 80% and 100% in both themes; the hotkey smoke passes.

## Later (specs get written when their turn comes)
- Real Telnyx adapter (roadmap Phase C): possible once C1E and C4A are merged.
- Meetings and reminders. Extra phone numbers per lead and a company panel. Email templates and a unified inbox. Sequences. Website lead capture. Reports v2 (funnel by stage, cost per meeting).

## Status
- C0A: done
- C0B: done
- C1A: not started
- C1B: not started
- C1C: not started
- C1D: not started
- C1E: not started
- C2A: not started
- C2B: not started
- C2C: not started
- C2D: not started
- C2E: not started
- C3A: not started
- C3B: not started
- C4A: not started
- C4B: not started
