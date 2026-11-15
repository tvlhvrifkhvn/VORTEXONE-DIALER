# Reskin plan R1 to R7 (visual only)

Goal: move the frontend from neumorphism to docs/DESIGN.md without changing behavior.

Order: R1, then the owner approves the look; R2; R3, then the owner tries a mock call; R4; R5; R6; R7.

Each segment runs as:
- a fresh Claude Code session,
- on a branch `claude/reskin-rN-<slug>` taken from the newest `latest`,
- with one PR into `latest`. The owner merges it before the next segment starts.

When screens compete for attention, this is the order of priority: call screen, dialing lines, leads table, lead page, the rest.

## Section 0: rules for every segment
1. Read only:
   - this file (section 0 and your segment),
   - docs/DESIGN.md,
   - the files listed for your segment,
   - the ui/ primitives you use.

   Don't explore the repo or re-read finished segments.
2. Visual only.
   - You may change className strings, wrapper markup, static text labels, and the presentational props of ui/ primitives.
   - Never change:
     - backend/
     - src/hooks/
     - src/lib/ (exception in R2: the toast className string in lib/api.js)
     - routes (exception in R1: /styleguide)
     - API calls, handlers, effects, state, conditions, data shapes or hotkey logic
   - If a layout needs any of these, stop and list it under NEEDS FROM YOU.
3. Use the ui/ primitives; no one-off look-alikes.
   - Never: raw hex or rgb outside src/styles/, shadow-*, gradients, blur, text-[Npx], text-white, bg-white, bg-black, text-primary (use text-signal).
   - rounded-* only as rounded-full, for dots.
4. Edit in place with minimal diffs. Never rewrite a whole file, and don't reformat code you didn't touch.
5. Gate, run once at the end:
   a. `cd frontend && npm run build` passes.
   b. `cd frontend && npm run contrast` passes.
   c. Screenshots:
      - If backend/.env is missing, copy backend/.env.example, set a throwaway JWT_SECRET and keep every provider on mock. Never commit .env.
      - Start the stack with ./dev.sh (mock adapters).
      - On a fresh database, run `SEED_USER_PASSWORD=<throwaway> npm run seed` in backend/ and use the same value as AUDIT_PASSWORD.
      - If there are fewer than 20 leads, insert 20 demo leads ("Demo Agent 01" and up, phones from +12145550101, states TX, FL and CA).
      - Run `node audit/scripts/reskin-shots.js --seg rN --pages <your pages>` (both themes).
      - Spend at most 10 minutes on setup. If the stack won't start, skip screenshots and say so.
   d. Run the same script with --smoke on a dialable lead. Every listed page must load without console errors, and on the call: M flips mute, V picks Voicemail, Esc opens the hang-up confirm.
   e. Diff guard: `git diff --name-only origin/latest...HEAD` lists only allowed files, and `git diff origin/latest...HEAD -- backend frontend/src/hooks` prints nothing.
6. Bookkeeping:
   - Log each decision as one line in docs/DECISIONS.md.
   - Set your segment's line in Status below.
   - If docs/CODEMAP.md exists, update only the lines for files you changed.
   - Commit the screenshots and open the PR.
7. Report (max 25 lines), then stop:
   - DONE
   - FILES
   - DECISIONS
   - PROOF: build, contrast, smoke, diff guard, screenshot folder
   - NEEDS FROM YOU
   - NEXT

## Facts from the code (checked 2026-11-14 on `latest` 1115ea4)
- Stack: React 18, Vite 7, Tailwind 3.4, plain JS, lucide-react icons, no chart library. The only script is build: there is no lint and no typecheck.
- Before R1, the theme was CSS variables in globals.css, with zero `dark:` classes. The toggle in AppShell switched a `.dark` class saved under the key vortex_dialer_theme.
- Neumorphism to remove:
  - 70 `shadow-neu*`
  - 98 `rounded*`
  - about 140 `action-*` color classes
  - 31 `text-[10px]`/`text-[11px]`
  - the btn-glow, pulse-call, ripple, neu-card lift and fade-in-row animations, and pulsing dots
- Primitives: NeuCard, NeuButton, NeuInput, ActionButton and Badge, plus StatusBadge, AttemptBadge and StatCard.
- Real hotkeys: in CallScreen.jsx, M (mute) and Esc (end call, with a confirm); in DispositionPanel.jsx, V (voicemail), N (no answer) and D (jump to outcome).
- Emoji in the UI: "✨ Expand" (DispositionPanel), "✏️" (Dashboard daily goal), "✨" (Import).
- Overlays without role or aria: the hang-up confirm in CallScreen, DispositionPanel, DialerSession and BulkSmsModal.
- Unused: components/call/ContactCard.jsx. Don't restyle it; R7 lists it.
- Not in the app yet, so don't fake them: campaign switcher, queue list, spend meter and header stats.
  - Their parts exist on /styleguide only.
  - They get wired in CRM phases 1C (switcher), 3A (Today) and 4B (meter).
- The exported PDF is made by the backend, so it's out of scope.

## R1 Foundation (Sonnet 5.5, high)
Covers tokens, fonts, themes, primitives, /styleguide, the contrast and screenshot scripts, these docs, the project skill, and the text-[10px]/[11px] replacement. The full task list was in the R1 prompt.

## R2 Shell and dialing (Sonnet 5.5, medium)
Files: components/layout/AppShell.jsx, components/layout/StateSidebar.jsx, pages/Login.jsx, lib/api.js (toast className string only), pages/DialerSession.jsx, components/call/MultilinePanel.jsx, components/call/DialPad.jsx, pages/ManualCall.jsx.
- Header:
  - Wordmark: "VORTEX ONE" plus a mono "OUTREACH". The display name becomes Vortex One Outreach throughout the UI.
  - A static FileTag "FILE 01 · REAL ESTATE" as plain text, not a button (it becomes the switcher in Phase 1C).
  - Nav as mono tabs; the active tab is solid, with aria-current.
  - Search as a Field, with results in a Panel with hairline rows.
  - Clocks in mono ("EST 11:20"), labels muted, no green text.
  - Live session: live dot plus "LIVE".
  - Unread inbox: a solid Tag with the count.
  - Import progress: mono text plus a thin Meter.
  - DIAL: secondary button. Theme: Segmented INK | PAPER. LOG OUT: ghost.
- StateSidebar: mono state codes; tabular counts, right-aligned; the active state gets a 3px primary bar and bg-muted.
- Login: a Panel with labelled Fields, a primary "LOG IN →" button, and errors per DESIGN.md section 5.
- Toast in lib/api.js: change the className string only, per DESIGN.md section 5.
- DialerSession:
  - A "01 — LINES" section.
  - The session summary and other overlays use the Dialog frame.
  - Empty state: a mono label, one sentence and one action.
- MultilinePanel: LINE 01/02/03 labels replace the SLOT_ACCENTS colors; states per DESIGN.md section 6; timers in mono; no pulse.
- DialPad and ManualCall: square keys of at least 56px with mono digits, and a mono 28px number display. Remove `outline-none` so focus shows.
- Pages to shoot: login, dashboard (for the shell), dialer, manual.

## R3 Call screen (Opus 5.5, medium)
Files: pages/CallScreen.jsx; components/call/BriefCard.jsx, CallActionGrid.jsx, CallContactHeader.jsx, CallControls.jsx, CallHeader.jsx, DispositionButtons.jsx, DispositionPanel.jsx, NotesField.jsx, ObjectionPanel.jsx; components/leads/ColleagueCard.jsx, LeadActionHub.jsx, LeadLocalTime.jsx.
- Layout on the 12-column grid: the call column spans 8 columns, the side column 4 (pitch script, schedule callback). Keep the component order and every condition exactly as they are.
- Sections: 01 — BRIEF, 02 — ACTIVE CALL, 03 — OFFICE, 04 — ACTIONS, 05 — NOTES, 06 — OUTCOME.
- Active call:
  - Name in 2xl, then brokerage, then the phone in mono, then the state and attempt Tags.
  - Status: a dot plus text. RINGING has a signal dot, CONNECTED a live dot, ENDED text only.
  - Recording: a signal dot plus "REC".
  - Timer in display size (56px, mono, tabular).
- Controls:
  - END CALL: primary, full width, 48px, with the [ESC] keycap.
  - Mute: secondary, with the [M] keycap. When pressed it turns solid and sets aria-pressed.
  - Other controls: square secondary tiles with an icon and a mono label.
- Outcomes:
  - Keep the same 3×2 grid and order, with 52px secondary buttons.
  - [V] keycap on Voicemail and [N] on No Answer.
  - DNC becomes "⊘ DNC" and keeps its existing confirm.
  - The 06 label carries a "[D] JUMP HERE" hint. The D highlight is a 2px primary outline, with no animation.
- "✨ Expand" becomes "EXPAND NOTE". The hang-up confirm and the DNC confirm use the Dialog frame.
- ColleagueCard becomes a spec table (mono keys, tabular values). LeadActionHub is restyled for both the call screen and the lead page.
- Pages to shoot, both themes: the call screen while ringing, while connected, after it ends with the outcomes shown, and with the hang-up confirm open. Smoke: M, V, N, D, Esc.

## R4 Leads and CRM (Sonnet 5.5, medium)
Files: pages/Dashboard.jsx, pages/LeadDetail.jsx, components/leads/LeadTable.jsx, LeadRow.jsx, LeadFilters.jsx, BulkSmsModal.jsx, components/stats/QueueHoursCards.jsx.
- Dashboard:
  - Stats as Stat tiles on hairlines: DIALS TODAY in display size, the others in 2xl.
  - Daily goal: a Meter (goal tone) with an "EDIT" text button instead of ✏️.
  - START DIALING SESSION is the only primary button; EXPORT PDF ↓ is secondary.
  - Lines: Segmented 1/2/3.
- Table, per DESIGN.md section 5:
  - Phone and dates in mono.
  - The row CALL button is a secondary square button, with no pulse.
  - The selection strip is a Panel with the count and the actions.
  - "Select all N leads" is an underlined text button.
- Filters: Fields with labels.
- LeadDetail as a spec sheet:
  - Header: name in 2xl, brokerage, status Tag.
  - Actions row: CALL primary, SMS and EMAIL secondary.
  - History as a hairline list with mono timestamps.
  - A callback Field with its button.
  - Contact details as labelled Fields.
- BulkSmsModal uses the Dialog frame. Empty states: a mono label, one plain sentence and one action.
- Pages to shoot: dashboard (with 3 rows selected), lead, an empty filter result, the bulk SMS dialog.

## R5 Inbox, templates and settings (Sonnet 5.5, medium)
Files: pages/Inbox.jsx, pages/SmsTemplates.jsx, pages/Settings.jsx.
- Inbox:
  - Conversation list as hairline rows; unread shown with a solid Tag.
  - The thread as hairline rows with mono timestamps. Sides are marked "YOU" or the lead's name, not by color.
  - Opted out: a solid Tag "OPTED OUT".
- SmsTemplates: a list plus labelled Fields; the character counter in mono.
- Settings:
  - Numbered sections 01 — PROFILE to 06 — OBJECTIONS.
  - Labelled Fields.
  - One primary save button per section.
  - "Configured ✓" stays as text.
- Pages to shoot: inbox (with a thread open), templates, settings.

## R6 Import and reports (Sonnet 5.5, medium)
Files: pages/Import.jsx, pages/Reports.jsx, components/stats/ObjectionReport.jsx, StateReport.jsx.
- Import:
  - Numbered steps: 01 — FILE, 02 — MAPPING, 03 — REVIEW, 04 — RESULT.
  - The mapping as a table.
  - Confidence as Tags: HIGH (solid), MEDIUM (outline), LOW (dashed).
  - "✨" becomes an "AI" Tag.
  - Progress as a Meter (goal tone); result counts as Stats.
- Reports:
  - Labelled date Fields and Stats.
  - Bars in bg-foreground on bg-meter-track, with mono values.
  - ObjectionReport as a table plus bars; its Badge `color` props become tones.
  - EXPORT PDF ↓ is secondary.
- Pages to shoot: import (every step the mock allows), reports.

## R7 Cleanup and final audit (Sonnet 5.5, medium)
Files: tailwind.config.js, src/styles/*, src/components/ui/* (renames), any file with leftovers (mechanical edits only), CLAUDE.md, docs/*, .claude/skills/vortex-ui/SKILL.md.
- Rename the old token classes mechanically (sed), then delete the compat aliases (colors, neu shadows, card and input radius) and the empty animation classes.
  - bg-base → bg-background
  - bg-surface → bg-card
  - text-text-primary → text-foreground
  - text-text-secondary → text-muted-foreground
  - border-shadow → border-border
  - action-* per the R1 compat table
- Rename NeuCard to Panel, NeuButton to Button and NeuInput to Field (git mv, then update imports only). Update DESIGN.md and SKILL.md to the new names.
- Grep audit. It must print nothing (ContactCard.jsx excluded):
  - `shadow-`
  - `rounded-` other than rounded-full and rounded-none
  - `gradient`, `blur`, `backdrop`
  - `text-\[`
  - `text-white`, `bg-white`, `bg-black`
  - `text-primary` without `-foreground`
  - raw hex or rgb outside src/styles/
  - `animate-` other than animate-spin
  - `outline-none`
  - emoji
- Keyboard and label pass on Dashboard, the call screen, the lead page and Settings: fix any unlabelled input or invisible focus.
- Full screenshot set: every page, in ink and in paper. Include the contrast table in the report.
- Finalize CLAUDE.md, set every Status line to done, and list ContactCard.jsx under NEEDS FROM YOU (delete it or keep it?).

## Status
- R1: done
- R2: done
- R3: done
- R4: done
- R5: done
- R6: not started
- R7: not started
