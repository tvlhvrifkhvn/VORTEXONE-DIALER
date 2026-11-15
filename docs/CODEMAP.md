# Code map (Vortex One Outreach, repo vortexone-dialer)
Update the lines for files you change, in the same commit. Built from grep (migrations, module.exports, routes, imports), checked on `latest` 66ab018.

## TABLES (backend/src/db/migrations, 001–032; the next new file is 033)
- users: id, email (unique), password_hash, name, role (rep | supervisor), created_at
- leads: id, name, phone (UNIQUE, E.164), email, address, brokerage, state, status (lifecycle), attempts, max_attempts, next_action_at, cold_at, cold_reason, dnc_flag, locked_by→users, locked_at, deleted_at (007), sms_opt_out (015), missing_phone (017), tags[] (018), office_key (020), original_phone, extension (023), tz_zones[] (027), created_at, updated_at
- call_history: id, lead_id→leads (NULL for manual calls, 013), user_id→users, started_at, ended_at, duration_seconds, disposition, note, from_number, was_mock, telephony_state, telephony_call_id, pre_disposition_snapshot (JSONB), disposition_at, session_id→dialing_sessions, slot_number, was_abandoned (008), to_number, is_manual (013), recording_url, was_recorded (014)
- dnc_list: id, phone (unique), source (manual | imported), lead_id→leads, added_at
- callbacks: id, lead_id→leads, scheduled_at, note, done (005)
- phone_numbers: id, e164 (unique), area_code, state, provider, active, retired_at (caller IDs)
- dialing_sessions: id, user_id→users, started_at, ended_at, mode, total_dials, total_contacts, total_voicemails, total_no_answers, total_callbacks, total_dnc
- import_history: id, user_id, filename, imported_at, total_rows, imported, skipped_dnc, skipped_duplicate, skipped_invalid (legacy summary)
- import_jobs: id, user_id, filename, status, total_rows, processed_rows, failed_rows, result_summary, error_message, cancelled, source_rows, mapping, phase, rows_to_save, saved_rows, written_leads (024)
- import_rows: id, job_id→import_jobs, sheet, row_number, data, prep, outcome (imported | no_number | merged | already_in_list | dnc_blocked | invalid), reason (025)
- settings: key (PK), value, updated_at (global settings)
- user_settings: user_id→users, key, value, updated_at (030; per-user, e.g. pitch_script, daily_goal)
- sms_templates: id, user_id, name, body, created_at, updated_at
- sms_messages: id, lead_id→leads (NULL = unknown number), direction, body, template_id, status, is_read, segment_count, sent_at, media_url (016), from_number, to_number, provider_message_id, keyword_action (029)
- sms_inbound_receipts: provider_message_id (PK), received_at (029; webhook dedupe)
- sms_opt_events: opt-out/opt-in log (029); sms_suppressions: phone (PK), source (inbound_keyword | rep | backfill) (031)
- lead_notes: id, lead_id→leads, call_id→call_history, user_id, body, created_at (018)
- email_messages: id, lead_id→leads, direction, subject, body, status, sent_at (019)
- objection_types: id, label (UNIQUE), is_active, sort_order (021)
- call_objections: id, call_id→call_history, lead_id, objection_type_id, rebuttal_used; unique (call, type)
- rebuttal_suggestions: id, objection_type_id, suggestion, based_on_count, generated_at, status (022), review_note, reviewed_at; 032 adds the expired state

## SERVICES (backend/src/services: logic; routes call these, no SQL in routes)
- aiCsvMapper.js: AI column mapping and row cleanup for imports (Groq) — SCHEMA_FIELDS, mapColumns, guessStates, cleanRows, cleanRowsChunk
- authService.js: login and profile — countSupervisors, login, getById, updateProfile
- callLifecycle.js: end/fail a call row and ownership guards — markEnded, markFailed, assertCanActOn, assertLeadNotTaken
- callSession.js: placing calls (single, manual dial pad, multi-line), the event stream — start, get, startManual, endManualCall, MOCK_FROM_NUMBER, MULTILINE_SLOTS, callEvents, startMultilineSession, dropMultilineSlot, takeMultilineCall, releaseActiveSlot, stopMultilineSession, streamOpened, streamClosed, clearConnectionTimers, recoverAfterRestart (internal: reserveSlot, placeSlotCall, queueRefill, dialIntoSlot)
- callingHours.js: 8am–9pm enforcement per lead/number zone — assertCallingHours, assertNumberCallingHours, zonesForLead, zonesForNumber, openZones, openZonesNow, zonesOpen, nextOpensAt, isEnforced, isCallingHoursEnforced, isWithinCallingHours, timezoneForState, localHour, ENFORCEMENT_SETTING_KEY, CALLING_HOURS_START, CALLING_HOURS_END
- colleagueIntel.js: same-office social proof for a lead — getColleagueSummary, LIVE_ANSWER_DISPOSITIONS, CLIENT_TAG, INTERESTED_TAG
- csvImport.js: CSV/XLSX import jobs (stage, map, save, summary) — LEAD_FIELDS, MAPPABLE_FIELDS, parseCsv, guessMapping, completeMapping, commitImport, getImportHistory, IMPORT_BATCH_SIZE, createImportJob, stageRows, setUploadResult, deleteImportJob, startJob, getImportJob, cancelImportJob, progressOf, expireStaleImports, failInterruptedImports, writeSkippedRowsCsv, processImportJob (internal: savePhase, prepareRow, buildSummary)
- dialingSession.js: session rows and their stats — STAT_COLUMNS, DISPOSITION_TO_STAT, startSession, endSession, incrementStat, decrementStat, getSessionStats
- dncCheck.js: the DNC list — isOnDncList, addToDncList, removeFromDncList, listDnc
- emailService.js: send one email through the email adapter — sendSingleEmail
- leadLifecycle.js: every lead status change (dispositions, undo, hangup, DNC, callbacks) — DISPOSITIONS, UNDO_WINDOW_SECONDS, applyDisposition, undoDisposition, hangup, snooze, markDncFromQueue, markDncFromSlot, phoneNumberChanged, releaseAfterFailedDial, releaseAbandoned, scheduleCallback, parseCallbackTime (internal: snapshotOf)
- leadQueue.js: the queue, locks, lead CRUD, list and search — DIALABLE_STATUSES, releaseStaleLocks, backfillZones, candidates, peekNext, lockNext, refreshOwnLock, create, getById, getHistory, addTag, removeTag, addNote, listNotes, countsByState, list, updateFields, softDelete, search, batchQueue, parseListQuery (internal: claimLead, buildListFilters, validateLeadInput)
- mediaUpload.js: SMS image uploads and /uploads serving — UPLOADS_DIR, saveImage, assertOwnMediaUrl, serveUploads, imageType
- noteExpander.js: AI "Expand note" — expandNote
- objectionService.js: objection types, per-call logging, report — POSITIVE_OUTCOMES, listTypes, createType, updateType, reorderTypes, listForCall, logForCall, removeForCall, saveRebuttal, getReport, listOffices
- pdfExport.js: the daily report PDF (pdfkit) — buildDailyReportBuffer
- preCallBrief.js: pre-call brief (instant + AI line) — buildBrief, buildMessages, gather, buildInstant
- rebuttalCoach.js: AI rebuttal suggestions and review — MODEL, BANNED_PHRASES, INSUFFICIENT_MESSAGE, buildMessages, fewShotExamples, findViolations, generateAndStore, listPending, reviewSuggestion, parseSuggestions, gatherInstances, getSuggestions, regenerate, getHints
- reportingPeriod.js: reporting timezone and day/period boundaries — TIMEZONE_KEY, DAY_START_KEY, DEFAULT_TIMEZONE, DEFAULT_DAY_START, MAX_RANGE_DAYS, getSettings, validateSetting, dayContaining, dayStarting, resolvePeriod, describe, zonedToInstant
- reports.js: call stats for a period, per state, manual calls — PLACED_CALL_SQL, todayStats, periodStats, periodCalls, perStateReport, manualCallsToday
- settings.js: global and per-user settings with a whitelist — getSetting, setSetting, onSettingChanged, registerValidator, readForApi, writeFromApi, API_SETTINGS, defaultMaxAttempts, getUserSettings, setUserSetting, USER_SETTINGS
- smsService.js: templates, sending, inbox, opt-out/STOP, timeline — mergeFields, renderMessage, renderOrThrow, invalidTokens, TEMPLATE_FIELDS, segmentCount, listTemplates, createTemplate, updateTemplate, deleteTemplate, sendSingleSms, sendBulkSms, getInbox, markRead, optOut, setSmsOptOut, isSuppressed, applySuppressionToNewLeads, keywordAction, receiveInbound, getUnmatchedInbound, countUnmatchedUnread, markUnmatchedRead, getTimeline
- xlsxParser.js: reading CSV/XLSX uploads — CSV_SHEET_NAME, parseUpload, readUploadInBatches, checkUploadType, headersOf, rowsFor

## ROUTES (mounted in backend/src/index.js; every router uses requireAuth except POST /api/auth/login and POST /api/sms/inbound; all /api is behind apiLimiter)
- /api/auth: POST /login [loginLimiter] → authService.login · GET /me → getById · PUT /profile → updateProfile
- /api/leads: GET / → leadQueue.parseListQuery, list · GET /state-counts → countsByState · GET /search → search · POST /batch-queue → batchQueue · POST / → create · GET /:id → getById · PUT /:id → updateFields · DELETE /:id → softDelete
- /api/leads/:id: GET /timeline → smsService.getTimeline · GET /history → leadQueue.getHistory · GET /colleagues → colleagueIntel.getColleagueSummary · GET /brief → preCallBrief.buildBrief · POST /tags, DELETE /tags/:tag → addTag, removeTag · GET|POST /notes → listNotes, addNote · POST /callback → leadLifecycle.scheduleCallback · POST /snooze → leadLifecycle.snooze
- /api/calls: GET /stream (token in query) → callSession.streamOpened · POST / → leadQueue.lockNext, callSession.start · GET /:id → get · POST /:id/hangup → leadLifecycle.hangup, endManualCall · POST /manual/start → startManual · POST /multiline/start|drop|take|release|stop → startMultilineSession, dropMultilineSlot, takeMultilineCall, releaseActiveSlot, stopMultilineSession
- /api/dispositions: POST / → leadLifecycle.applyDisposition · POST /:callId/undo → undoDisposition
- /api/sessions: POST /start → dialingSession.startSession · POST /end → endSession
- /api/imports: POST /preview, /analyze [upload] → csvImport.parseCsv, guessMapping · POST /commit → commitImport · POST /upload → xlsxParser.checkUploadType · POST /process → startJob, processImportJob · GET /status/:jobId → getImportJob, progressOf · POST /cancel/:jobId → cancelImportJob · GET /:jobId/skipped.csv → writeSkippedRowsCsv · GET /history → getImportHistory
- /api/reports: GET /today → reports.todayStats · GET /per-state → perStateReport · GET /manual-today → manualCallsToday (period via reportingPeriod.resolvePeriod)
- /api/exports: GET /daily-pdf → pdfExport.buildDailyReportBuffer
- /api/sms: POST /inbound (webhook) → smsAdapter.verifyInbound, parseInbound, smsService.receiveInbound · POST /upload-media → mediaUpload.saveImage · GET|POST /templates, PUT|DELETE /templates/:id → listTemplates, createTemplate, updateTemplate, deleteTemplate · POST /send → sendSingleSms · POST /bulk-send → sendBulkSms · GET /inbox → getInbox, getUnmatchedInbound · POST /mark-read/:leadId, /mark-read-unmatched/:messageId → markRead, markUnmatchedRead · POST /opt-out/:leadId → optOut
- /api/email: POST /send → emailService.sendSingleEmail
- /api/objections: GET|POST /types, POST /types/reorder, PUT /types/:id → objectionService · GET /hints → rebuttalCoach.getHints · GET /types/:id/suggestions, POST …/regenerate, GET /suggestions/pending, PUT /suggestions/:id → rebuttalCoach · GET|POST /calls/:callId, PUT|DELETE /calls/:callId/:typeId → listForCall, logForCall, saveRebuttal, removeForCall · GET /report → getReport · GET /offices → listOffices
- /api/ai: POST /expand-note → noteExpander.expandNote
- /api/settings: GET /me, PUT /me/:key → getUserSettings, setUserSetting · GET /:key → readForApi · PUT /:key → writeFromApi (supervisor only)

## MIDDLEWARE (backend/src/middleware)
- auth.js: requireAuth — verifies the JWT, sets req.user
- rateLimit.js: loginLimiter (5/min), apiLimiter (100/min, keyed by user or IP)
- asyncHandler.js: wraps async handlers so rejections reach the error handler
- errorHandler.js: errorHandler, notFound, ApiError (status + code)

## TELEPHONY (backend/src/telephony; adapters chosen by env)
- index.js: TelephonyAdapter contract `placeCall(from, to, onEvent)` — placeCall, getAdapter, PROVIDERS (TELEPHONY_PROVIDER)
- mockAdapter.js: timed ringing/answered/voicemail/no_answer/busy events (dev and tests)
- twilioAdapter.js: unused phase-2 stub; don't delete
- smsIndex.js: SMS adapter selection, verifyInbound (webhook check), parseInbound · mockSmsAdapter.js: sendSms, parseInbound
- emailIndex.js: email adapter selection · mockEmailAdapter.js: sendEmail

## UTILS AND CONFIG (backend/src)
- utils/phoneNormalize.js: normalizePhone (E.164), parsePhone (with extension), areaCodeFromE164
- utils/timeZones.js: zones per state, area-code overrides and split places (used only by callingHours)
- utils/stateFromAreaCode.js, utils/stateFromAddressText.js: state guesses for imports
- utils/officeKey.js: the "same office" grouping key · utils/usStates.js: US_STATES
- config/index.js: env config (DATABASE_URL, PORT, NODE_ENV, JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGIN, TELEPHONY_PROVIDER, SMS_PROVIDER, EMAIL_PROVIDER, GROQ_API_KEY) · config/validateProviders.js: provider check at startup
- db/index.js: pg pool · db/migrate.js: `npm run migrate` · db/seeds/run.js: `npm run seed` (owner + sample leads) · db/seeds/seedObjectionDemo.js

## FRONTEND ROUTES (frontend/src/App.jsx; all but /login behind RequireAuth, inside AppShell)
- /login → pages/Login.jsx (useAuth)
- / → pages/Dashboard.jsx (useLeads, useCall, useUserSettings): stats, goal, lead table, start session
- /dialer → pages/DialerSession.jsx (useMultiline, useCall): multi-line session
- /call/manual → pages/ManualCall.jsx: dial pad (components/call/DialPad.jsx)
- /call/:leadId → pages/CallScreen.jsx (useCall, useBrief): the call screen; /call/next dials the next queued lead
- /leads/:id → pages/LeadDetail.jsx: lead record, LeadActionHub, callback, contact details
- /inbox → pages/Inbox.jsx · /sms/templates → pages/SmsTemplates.jsx
- /import → pages/Import.jsx (useImportJob) · /reports → pages/Reports.jsx · /settings → pages/Settings.jsx (useAuth, useUserSettings)
- /styleguide → pages/Styleguide.jsx (hidden; every ui primitive)

## FRONTEND HOOKS AND LIB (frontend/src)
- hooks/useAuth.jsx: auth context (user, login, logout)
- hooks/useCall.js: single call state, dispositions, undo, sessions (startDialingSession, getActiveSessionId)
- hooks/useMultiline.js: multi-line session state from the event stream
- hooks/useLeads.js: useLeads (paged list), useStateCounts
- hooks/useBrief.js: pre-call brief · hooks/useImportJob.js: the running import job · hooks/useUserSettings.js: per-user settings
- lib/api.js: every API call goes through `request()`; the 500 toast; openCallStream (EventSource); resolveMediaUrl
- lib/format.js: phone, date, duration formats · lib/retry.js: sendWithRetry · lib/usStates.js

## FRONTEND COMPONENTS (frontend/src/components)
- ui/Panel, Button, Field: panel, button (primary | secondary | ghost), input/select/textarea
- ui/ActionButton: call, hangup and outcome buttons · ui/Badge: Tag (outline | solid | dashed | muted | signal)
- ui/Keycap, SectionLabel, FileTag, StatusDot, Meter (goal | budget), Segmented, Dialog
- layout/AppShell.jsx: header, nav, search, clocks, theme switch · layout/StateSidebar.jsx
- call/: CallContactHeader, CallHeader (status + timer), CallActionGrid, CallControls, DispositionPanel (notes, V/N/D hotkeys, outcomes), DispositionButtons, NotesField, BriefCard, ObjectionPanel, MultilinePanel, DialPad; ContactCard.jsx is unused
- leads/: LeadTable, LeadRow, LeadFilters, BulkSmsModal, LeadActionHub (SMS/email compose, timeline), ColleagueCard, LeadLocalTime, StatusBadge, AttemptBadge
- stats/: StatCard, QueueHoursCards, StateReport, ObjectionReport
- styles/: globals.css (tokens, focus), theme.js (status tags and labels), tokens.js (styleguide list)

## CHECKS
- `./dev.sh` (start Postgres, migrate, backend :4000, frontend :5173) · `./dev.sh status` · `./dev.sh stop`
- `cd frontend && npm run build` · `npm run contrast` (token contrast, both themes)
- `bash audit/scripts/reskin-grep.sh`: design-rule grep; must print nothing
- `node audit/scripts/reskin-shots.js --seg <x> --pages <list> [--lead <id>] [--smoke]`: screenshots and the M/Esc/D/V/N smoke (AUDIT_PASSWORD set)
- `node audit/scripts/reskin-a11y.js --lead <id>`: labels, names and focus rings on Dashboard, call, lead, Settings
- `cd backend && npm run migrate` · `npm run seed` · `npm run verify` (from C0B on)
