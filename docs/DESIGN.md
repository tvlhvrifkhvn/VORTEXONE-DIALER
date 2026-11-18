# Vortex One Outreach: design rules (Neo-Swiss v1)

Source: the VortexOne website language, "Two Files, One Desk". It reads like a calm, precise spec sheet: monochrome with one hot accent, hairlines, square edges, and big numbers next to tiny mono labels. These rules adapt it for a dense tool used during live calls.

Every UI change follows this file. If a case isn't covered here, decide by these priorities, in order: (1) speed and safety during live calls, (2) accessibility, (3) consistency, (4) this style. Log each such decision as one line in docs/DECISIONS.md.

## 1. Tokens
CSS variables are "R G B" triplets in src/styles/globals.css. `:root` is the ink theme (the default); `[data-theme="paper"]` overrides it. The choice is saved in localStorage under `vortex.theme` (`ink` | `paper`).

| Token | ink (default) | paper | Tailwind | Use |
|---|---|---|---|---|
| --background | #0E0E0E | #E4E4E2 | bg-background | page |
| --card | #1A1A1A | #F2F2F0 | bg-card | panels, table body, dialogs, menus |
| --muted | #222220 | #D6D6D3 | bg-muted | hover, selected row, keycaps |
| --foreground | #F2F2F0 | #0E0E0E | text-foreground, bg-foreground | text, solid tags, hard hover fill |
| --muted-foreground | #8A8A88 | #5A5A58 | text-muted-foreground | secondary text, labels |
| --border | #2E2E2C | #C4C4C0 | border (default color) | decorative hairlines between panels and rows |
| --border-strong | #8A8A88 | #0E0E0E | border-strong | edges of inputs, secondary buttons, tags, keycaps |
| --primary | #FF4D1F | #FF4D1F | bg-primary | signal fills |
| --primary-foreground | #0E0E0E | #0E0E0E | text-primary-foreground | text on signal (always ink) |
| --primary-border | #FF4D1F | #0E0E0E | border-primary-border | 1px edge of primary buttons |
| --signal-text | #FF4D1F | #0E0E0E | text-signal | emphasis and error text |
| --live | #1F9D55 | #1F9D55 | bg-live | connected/live dot only |
| --ring | #F2F2F0 | #0E0E0E | (focus outline) | focus |
| --meter-track | #2E2E2C | #0E0E0E | bg-meter-track | budget meter track (goal meters and report bars use bg-muted) |

- Scrim: `bg-scrim` is ink at 80% in both themes.
- Never use `text-primary` (orange text fails contrast on paper; use `text-signal`).
- Never use `text-live`.

## 2. Color meaning
- Signal orange marks three things only: the primary action, the active or ringing call, and budget warnings.
  - Use it for fills, bars and blocks, never as scattered accents.
  - At most one primary button per section.
- Green means connected/live only, shown as an 8px dot next to a text label.
- Everything else is monochrome. Every state has a text label; color is never the only cue.
- Text on orange is always ink. Orange text appears only on ink surfaces, through `text-signal`.

## 3. Type
- Fonts, self-hosted through Fontsource:
  - Inter Tight Variable: UI text.
  - IBM Plex Mono 400/500: labels, buttons, table headers, phone numbers, timers, times, costs, IDs and hotkeys.
- Scale (Tailwind key, size/line-height in px):

  | Key | Size / line height | Use |
  |---|---|---|
  | xs | 12/16 | |
  | sm | 13/18 | |
  | base | 14/20 | body |
  | lg | 16/24 | |
  | xl | 20/28 | |
  | 2xl | 28/32 | |
  | display | 56/56 | only the call timer, dials today and the budget meter |

  Nothing under 12px, and no `text-[Npx]`.
- `.label`: Plex Mono 500, 12px, uppercase, letter-spacing 0.08em, muted-foreground.
- Headings: Inter Tight 600, letter-spacing -0.01em. Body: 400. Text is left-aligned.
- All numbers are tabular (`tabular-nums`); data numbers use mono.
- US English, with typographic ’ and en dashes (Mon–Fri, 9–6).
- No emoji. ✓ is fine as a glyph.

## 4. Shape, space, layout
- Radius 0 everywhere. Only status dots and radio buttons are round.
- 1px hairlines (`border`) separate panels and rows; controls use `border-strong`. 8px bars are used only for meters.
- Never use: box-shadow, gradients, blur or backdrop-filter, glow, neumorphic insets, hover lift, ripple.
- 8px grid: panel padding, gaps and section spacing are 8, 16, 24, 32 or 48px (p-2/4/6/8/12, gap-2/4/6/8). 4px steps are allowed only inside small controls.
- Content: max-width 1440px, side padding 24px, a 12-column grid with 24px gutters. Keep it dense but aligned: asymmetric is fine, misaligned is not.
- Section header: a hairline on top, then one mono row with the label on the left ("01 — ACTIVE CALL") and optional meta on the right ("LINE 02"). Numbering restarts on every screen.
- Campaigns are "files", shown as small outlined square mono tags: FILE 01 = Real Estate, FILE 02 = Insurance Supplementing.

## 5. Components (src/components/ui/, all shown on /styleguide)

### Button (ui/Button.jsx; call and outcome buttons use ui/ActionButton.jsx)
Square, mono 13px uppercase, letter-spacing 0.06em. Minimum height 40px (44px for call controls, 48px for END CALL). Colors change over 150ms.
- primary: bg-primary, text-primary-foreground, 1px border-primary-border. Hover: bg-foreground text-background.
- secondary: transparent, 1px border-strong, text-foreground. Hover: bg-foreground text-background.
- ghost: no border. Hover: bg-muted.
- destructive (DNC, delete): secondary with a leading "⊘", and it keeps its existing confirm. Never red.
- pressed or toggled (e.g. Mute on): bg-foreground text-background, with aria-pressed.
- disabled: 40% opacity, no hover.

### Segmented
Options sit inside a 1px border-strong frame. The active option is bg-foreground text-background, with aria-pressed. Used for the theme toggle (INK | PAPER) and Lines 1/2/3.

### Keycap
- A `<kbd>`: mono 12px, 1px border-strong, bg-muted, min-width 20px, placed before its label: [V] VOICEMAIL.
- Real hotkeys only: M mute, Esc end call, V voicemail, N no answer, D jump to outcome. Never invent shortcuts.

### Panel (ui/Panel.jsx)
bg-card with a 1px border. The `inset` variant is bg-muted.

### Field (ui/Field.jsx)
40px high, bg-background, 1px border-strong, text-base, placeholder in muted-foreground. Error state: 2px border-primary, an "ERROR" label and the message. Always has a visible label or an aria-label.

### Tag (ui/Badge.jsx)
Mono 12px uppercase, px-2 py-0.5. Tones:
- outline
- solid: bg-foreground text-background
- dashed
- muted: bg-muted text-muted-foreground
- signal: bg-primary text-primary-foreground

### StatusDot
An 8px circle, live (bg-live) or signal (bg-primary), always followed by text.

### SectionLabel and FileTag
- SectionLabel: as in section 4.
- FileTag: an outlined tag "FILE 01" plus the name.

### Meter
- An 8px bar. Budget: a bg-primary fill on bg-meter-track. Goal: a bg-foreground fill on bg-muted (in paper the meter track is ink, the same as the foreground, so a goal fill on it would vanish).
- Report bars follow the goal look: bg-foreground on bg-muted; a second series is bg-muted-foreground, told apart by its legend and order, never by hue.
- The value is always printed in mono ("$41 / $60 · 68%").
- Budget at 80% or more: a signal tag "80% OF BUDGET USED". At 100%: "BUDGET REACHED — DIALING STOPPED".

### Stat (stats/StatCard.jsx)
A label plus a number in mono tabular figures, 2xl. Display size only where section 3 allows.

### Table
- Sticky header with mono 12px uppercase muted headings.
- 1px hairline rows, 48px high.
- Numbers right-aligned and tabular.
- Hover: bg-muted.
- Selected row: bg-muted, a 3px primary bar on the left, and a checked checkbox.

### Dialog
- A fixed bg-scrim backdrop (no blur) behind a square bg-card frame with a 1px border-strong.
- The header has a mono title. Show "CLOSE ×" only when an existing close or cancel handler exists.
- role="dialog", aria-modal="true", aria-labelledby.
- No new key handlers (Esc already ends calls).

### Toast
bg-card, 1px border-strong, a 3px primary bar on the left, text-foreground.

### Menu (ui/Menu.jsx, C8A)
- A button ("⋯", or a label with ▾) that opens a bg-card list with a 1px border-strong; rows are 40px mono uppercase, hover and focus bg-muted.
- Keyboard: Enter, Space or ↓ opens it on the first item; ↑ ↓ Home End move; Enter runs an item; Tab leaves and closes it.
- Esc closes it and returns focus to the button, only while focus is inside the menu (the key stops there, so it never ends a call).
- `Popover` is the same frame for other content (the calling-hours zones).

### Icons
- lucide-react at 16px (20px in call controls), strokeWidth 1.5.
- aria-hidden when next to text; icon-only buttons need an aria-label.
- Arrows as type: → internal, ↗ external, ↓ download.

## 6. Status mapping (source of truth: src/styles/theme.js)
| Status | Label (unchanged) | Tag |
|---|---|---|
| new, in_queue, voicemail, no_answer | as today | outline |
| in_progress | In progress | signal |
| contacted, callback_scheduled | as today | solid |
| no_contact_number, no_contact_person | Bad number, No contact — person | dashed |
| dnc | DNC | solid, with a leading "⊘" |
| cold | Cold | muted |

- Attempts: "2/5" outline; on the last attempt "4/5 · LAST" solid; at the limit "5/5 · MAX" muted.
- Dialing lines are told apart by "LINE 01/02/03" labels, not colors:

  | Line state | Shown as |
  |---|---|
  | ringing | signal dot + "RINGING" |
  | answered, connected | live dot + "CONNECTED" |
  | idle, loading, dialing | muted text |
  | held, voicemail, busy, no answer | outline tag with today's label |
  | dropped | dashed tag |

## 7. Motion
- Only 150ms color and opacity changes, on a change of state.
- No pulse, glow, ripple, lift, row fade-in or other decorative animation, and none during calls.
- Loading spinners (animate-spin) are allowed.
- prefers-reduced-motion sets every duration to 0.

## 8. Accessibility (WCAG 2.1 AA)
- Text at least 4.5:1 (3:1 at 24px and above). Control edges and meter fills at least 3:1 against their neighbors. `npm run contrast` checks the token pairs in both themes.
- Checks: `bash audit/scripts/reskin-grep.sh` (no shadows, radius, gradients, raw colors, decorative animation or emoji) and `node audit/scripts/reskin-a11y.js --lead <id>` (labels, names and a visible focus ring on every tab stop).
- Focus: `:focus-visible { outline: 2px solid rgb(var(--ring)); outline-offset: 2px }`. Never remove it, and never use `outline-none` without it. Date and time inputs also get the ring on `:focus` and `:focus-within`, because Tab lands on their built-in calendar button, where the input matches neither.
- Every input and dialog is labelled.
- Everything works by keyboard.
- Targets at least 40px (44px for call controls).
- Color is never the only cue.

## 9. Clarity rules (C8A, Block 4; every screen follows them)
1. Every element needs a reason: an action the owner takes on this screen, or information they need here. Otherwise remove it.
2. One fact, one place per screen. The current file appears only in the header switcher; pages don't repeat it.
3. No explanatory paragraphs in the UI. An empty state is one short line. Explanations go in a `title` tooltip or in docs/USER_GUIDE.md (the assistant answers "how do I"). Section labels are plain names ("TO DO", "OUTCOME"): the "01 —" numbers go.
4. One primary (orange) button per screen. Buttons that submit a form inside a panel use the solid style (`Button variant="solid"`: bg-foreground, text-background), never orange. Other actions are secondary buttons; rare actions go in a "⋯" menu (ui/Menu.jsx).
5. Sizes: buttons 40px (`size="md"`); compact buttons 32px (`size="sm"`: inside rails, lists, cards, panel headers); call controls 48px. A page's header row uses 44px (`size="lg"`) for every button in it (the primary and the buttons beside it). Buttons in one row share one height and sit on one center line. Gaps: 8px inside a group of buttons, 16px between groups. Buttons of the same kind in one row have equal widths. Rows stacked on a page share their left and right edges. Segmented controls match the height of the buttons beside them. Tags never wrap.
6. Every page starts with one header row: the title on the left (with at most one muted count or date), its actions on the right. Then the content.
7. Status and stage are labeled when they appear together ("STATUS · NEW", "STAGE · NEW").
8. Regions follow the Block 3 frame: fixed header, each region scrolls on its own, no browser scrollbar at 1440×900 and 1280×720.
9. Each phase updates the docs/USER_GUIDE.md sections for the screens it changes, so the assistant's "how do I" answers stay right.

The app header (C8A) is one 56px row: wordmark · file switcher · nav · search · calling-hours chip · spend chip · ASK · DIAL · user menu. It never wraps from 1180px. To fit, it narrows in steps: the search field (280px) shows from 1680px, below that a search icon button opens it; the file name beside FILE nn shows from 1440px; the wordmark shows from 1280px; nav labels are 12px below 1536px.
