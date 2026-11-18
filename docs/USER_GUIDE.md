# Vortex One Outreach: user guide

The assistant answers "how do I…" questions from this file (tool `get_app_help`). One short section per page and per common task. Keep each section under about 12 lines.

## Header and navigation
- One row: VORTEX ONE, the file switcher (FILE 01 · name ▾), the pages TODAY · PIPELINE · LEADS · DIALER · INBOX · REPORTS, then search, the calling-hours chip, the spend chip, ASK (the assistant), DIAL (dial any number) and your initials.
- Search all leads (name, phone, company or tag, every file): the search field on a wide screen, or the magnifier button, which opens the field.
- The calling-hours chip shows Eastern time and OPEN or CLOSED (calls are allowed 8 AM–9 PM in the lead's time zone). Click it for all four zones: ET, CT, MT and PT.
- The spend chip ("$3.40 TODAY") appears once call rates are set; it turns orange at 80 % of a budget. Click it for the split by file.
- Your initials open the account menu: SETTINGS, THEME (INK | PAPER) and LOG OUT.
- IMPORT is not in the header: open it from the Leads page (or go to /import).
- The TODAY badge counts callbacks and tasks due today; the INBOX badge counts unread texts.

## Today page
- What to do now. The header row has the date and START DIALING SESSION →.
- Four tiles: DIALS ("19 of 100" with the goal bar; a supervisor changes the daily goal with EDIT in the tile), CONTACTS, CONNECT RATE and DUE (callbacks and tasks due, overdue included).
- TO DO merges callbacks, tasks, replies and gone-quiet leads. The buttons OVERDUE · TODAY · UPCOMING show their counts; the TYPE select narrows to Callbacks, Tasks, Replies or Gone quiet (no activity 7+ days: leads past Contacted with no activity for 7 days and no open task).
- Each row: time, type, name and company (click the name to open the lead), what to do, then CALL, REPLY or DONE. On a task, ⋯ → RESCHEDULE changes its due time.
- Right rail: PIPELINE (each stage with its count; OPEN BOARD →) and AI BRIEF (GENERATE BRIEF, then REFRESH BRIEF).

## Leads page
- Find people. Left rail: ALL LEADS (clears the filters), SMART LISTS, LISTS and STATES (click a state to filter; hover it for how many are not contacted yet; ▾ hides the list).
- Header row: DIAL (the queue, or "DIAL 3 SELECTED" for ticked leads). Its ▾ arrow holds LINES (1, 2 or 3 at once) and how many leads are dialable now or waiting for their hours. IMPORT opens the import page. ⋯ has Export CSV (the leads with the current filters), Daily report PDF, Find duplicates and Save filters as a smart list.
- Under it: the search field (name, phone, company or tag), "11 of 11", and FILTERS, which opens status, stage, tag, attempts, no activity for N days, callback overdue and date added. Active filters show as chips; × removes one.
- Tick leads to select them: the toolbar becomes "3 SELECTED" with SMS, ADD TO LIST, STAGE, TAG and FILE (each opens its own small form), SELECT ALL and CLEAR.
- Click a lead to open its page.

## Lead page
- Top bar: BACK, name and company, STATUS and STAGE, the lead's local time (OPEN or CLOSED), then CALL · SMS · EMAIL (SMS and EMAIL open that composer tab) · ⋯ (Move to another file, supervisors; Delete lead, with a confirm).
- Left (PROFILE): contact details (copy the phone with the copy button; EDIT to change them, then SAVE or CANCEL), TAGS & LISTS (+ ADD), FIELDS (the file's own fields; EDIT, SAVE), BEST TIME.
- Middle (ACTIVITY): the composer with tabs NOTE · SMS · EMAIL · TASK · CALLBACK (SMS and EMAIL have DRAFT WITH AI), then the timeline (calls, texts, emails, notes, stage changes, tasks, activity) with its filter.
- Right (WORK): PIPELINE (stage and deal value; SAVE shows after a change), NEXT (the scheduled callback with CLEAR, which sends the lead back to the queue; open tasks: DONE, ⋯ → Delete task), AI SUMMARY (GENERATE), OFFICE (colleagues at the same office).

## Create a file (campaign)
- A file is a separate campaign with its own leads, stages, fields, pitch script, AI context, daily goal and budget.
- Go to SETTINGS → FILES → + NEW FILE, pick a template (Real estate, Roofing or Blank), type a name, CREATE FILE. Only a supervisor can create or change files.
- Then fill the tabs: BASICS (name, company label, daily goal, max attempts, monthly budget), SCRIPT & AI (AI context, pitch script), STAGES, FIELDS.
- Switch files with the FILE switcher in the header. In SETTINGS → FILES the list marks the file you're in as CURRENT; pause, resume or archive the selected file from ⋯ beside its name.

## Add a task
- On a lead page: the TASK tab of the composer (middle column). Type what to do, pick the type (call, email, text, other) and the due date and time, then ADD TASK. It shows under NEXT on the right.
- After a call: the outcome panel has "Add a follow-up task".
- On Today, TO DO shows the tasks: DONE marks one done, RESCHEDULE changes its due time. Tasks due soon also pop up as reminders (CALL, OPEN, SNOOZE 10 MIN).

## Make a smart list or a list
- Smart list = saved filters that update themselves. On LEADS set the filters, then "+" beside SMART LISTS in the left rail (or ⋯ → Save filters as a smart list), and name it. Click it in SMART LISTS to open it; the number is its live count. × beside the open one deletes it.
- List = hand-picked people. On LEADS tick the leads, then ADD TO LIST in the selection strip (pick a list or type a new name). "+" beside LISTS does the same for the current selection. Click a list in LISTS to open those leads.
- A list is stored as a tag "list:<name>" and shows on the lead page as "LIST · name".

## Import leads
- LEADS → IMPORT: choose a CSV or Excel file and the target file (campaign). The AI suggests which column is which; check the mapping, then import.
- Every number on the DNC list is skipped, and so is a number already in the list. Rows without a usable number are imported but marked "no phone" until one is added.
- The import keeps running if you leave the page (a progress bar shows in the header; click it to go back); skipped rows can be downloaded as a CSV.

## Move stages (pipeline)
- PIPELINE shows one column per stage. Drag a card to another column, or use MOVE → on the card. Moving a stage never changes the dialer status.
- The number beside "Pipeline" counts the leads in open stages. Search the board (top right) by name, company, phone digits or tag; × clears it and the number becomes the matches. The board scrolls sideways; each column scrolls on its own and ends with LOAD MORE when there are more cards. Hover a card to see its tags.
- On a lead page the stage and the deal value are in WORK. A call outcome can move the stage too (Spoke / Interested → Contacted; DNC → Lost).

## Set call rates and budgets
- SETTINGS → SPEND LIMITS (supervisor): outbound and recording cents per minute, a per-call fee, and the global monthly budget in dollars. Until a rate is set, spend reads "RATES NOT SET".
- A file's own monthly budget is on SETTINGS → FILES → BASICS. At 80 % the header warns; at 100 % dialing stops (a call in progress is never cut).

## Dialing session
- START DIALING SESSION on Today, or DIAL on Leads, dials the queue: callbacks due first, then new leads, then leads waiting longest. LINES = how many leads ring at once (1–3).
- The dialer only calls inside 8am–9pm local time of the lead (unless a supervisor turned calling hours off) and never calls a DNC number.
- When someone answers, log the outcome: Spoke / Interested, Voicemail, No answer, Callback (with a time), Bad number, No contact (person), DNC. UNDO is available for 10 seconds.
- No answer and voicemail come back 4 hours later until the max attempts; then the lead goes cold.

## Call screen
- Left (LEAD): name, company, phone, state, attempt and local time; the BRIEF (what happened before, the opener, the best time); OFFICE (colleagues at the same office); RECENT (the last 5 calls and notes); VIEW LEAD ↗ opens the lead page in a new tab (leaving this screen would end the call).
- Middle (CALL): the call's state and timer; EST. COST once call rates are set; MUTE · HOLD · END CALL; NOTES (EXPAND NOTE rewrites them with AI); OUTCOME: optionally MOVE TO STAGE and a FOLLOW-UP TASK, then one of the six outcome buttons. After the call: REDIAL, or UNDO and NEXT LEAD →.
- Right (HELP): the PITCH SCRIPT, OBJECTIONS (tap the ones you hear; a tip shows what worked before) and QUICK ACTIONS: ADD TAG, QUICK SMS, ADD TASK, SCHEDULE CALLBACK. On a screen narrower than 1280px these are tabs (SCRIPT · OBJECTIONS · ACTIONS) under the middle column.
- Notes are saved with the outcome. MUTE and HOLD only change the screen until the real phone provider is connected.

## Dial a number (dial pad)
- DIAL in the header opens the dial pad. Type or paste a number (or tap the keys), then CALL. RECENT under it lists your last 10 dial-pad calls: click one to put its number back in the pad.
- During the call: the keys send tones (for phone menus; "Tones sent" shows them). MUTE · HOLD · RECORD · HANG UP sit where CALL was. The first RECORD asks you to remember that some states need everyone's consent to record. MUTE, HOLD, RECORD and tones only change the screen until the real phone provider is connected.
- If the number belongs to a lead, its name shows with OPEN LEAD ↗ (a new tab). NOTES save on their own ("Saved").
- When the call ends, the notes are added once to that lead's activity as "Manual call · m:ss · your notes" (and updated if you edit them within 24 hours). With no lead, SAVE AS LEAD creates one and adds the notes to it. A dial-pad call never changes a lead's status or attempts; DNC numbers are refused.

## Hotkeys on the call screen
- M mutes and unmutes. Esc asks to hang up. D jumps to the outcome buttons. V logs Voicemail. N logs No answer and moves on.
- Hotkeys never fire while you type in a field (notes, the callback time, a stage picker).

## Inbox, texts and emails
- INBOX lists text conversations (this file or all files); unread ones first. REPLY opens the lead page with the SMS composer open.
- A text can use a template or custom text, with {{first_name}}, {{name}}, {{brokerage}}, {{state}}, {{city}}. Texts follow the same 8am–9pm rule as calls.
- A lead that replied STOP or opted out never gets a text; DNC leads get neither calls nor texts.

## Reports
- REPORTS: dials, contacts and connect rate for today or a date range, per state, manual calls, objections, BEST HOURS (connect rate by local hour, 90 days) and the STAGE FUNNEL (how many reached each stage, conversion, wins, cost per win). THIS FILE or ALL FILES; EXPORT PDF.

## Assistant (ASK)
- ASK opens the assistant on the right. THIS FILE or ALL FILES picks which data it looks at. It answers from your CRM data, explains how to use the app, and gives general calling advice (marked "General advice — not from your data").
- It never sends, dials or changes anything; it can propose a task or a stage move as a card you CONFIRM or DISMISS. CLEAR empties the conversation.
- Settings: SETTINGS → INTEGRATIONS & AI (Groq key, assistant on/off, model).

## Settings
- Open it from your initials in the header → SETTINGS. The left menu: Profile, Dialing defaults (max attempts, lines, calling hours, reminder notifications), Reporting day (time zone and day start), Files, Objections, Integrations & AI, Spend limits, SMS templates, Activity (supervisor: who changed what). Each section has one SAVE at the bottom; hover a field's label for what it does.

## Merge duplicates
- LEADS → ⋯ → Find duplicates lists likely pairs (BACK TO LEADS returns) (same email; same name and company; same name, state and office). Choose KEEP THIS ONE, then REVIEW MERGE: pick the values that differ, check what moves, MERGE. There is no undo.
- Everything moves to the kept lead; if either is DNC, the kept lead becomes DNC.
