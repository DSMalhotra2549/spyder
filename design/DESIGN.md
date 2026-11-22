# Spyder design spec

Visual source of truth for the renderer. Behavior lives in `SPYDER_PLAN.md` §12. References: `design/reference/INDEX.md`.
The bar follows Rize's desktop widget (P23, P43). The dashboard is Linear/Vercel-style (P56): neutral greys, hairline borders, dense tables, small type, Spyder purple as the only accent, colour only where it carries meaning. Light, dark or follow Windows (P57).

**Brand rule:** no Rize logo, wordmark, name, or the purple "agent orb". Spyder's own mark is an accent circle with a white "S" (tray/app icon only). In the widget the orb's slot is taken by a functional **workday ring**.

## 1. Tokens (light and dark, P57)

`nativeTheme.themeSource` (Settings → Theme: System / Light / Dark, default System) drives `prefers-color-scheme` in every window, so the CSS tokens switch live. Dark values are the `@theme` defaults; light values override them under `@media (prefers-color-scheme: light)`. `src/main/theme.ts` sets the dashboard's native background to match `--color-bg`.

### Colours (`src/renderer/styles.css`)
| Token | Dark | Light | Use |
|---|---|---|---|
| `--color-bg` | `#0E0E10` | `#FFFFFF` | dashboard content background |
| `--color-sidebar` | `#09090B` | `#F7F7F8` | dashboard sidebar |
| `--color-surface` | `#141417` | `#FFFFFF` | cards, tables, bar, prompt window |
| `--color-surface-2` | `#1C1C20` | `#F3F3F5` | hover, selected nav, segmented control, timeline track |
| `--color-border` | `#232328` | `#E8E8EC` | hairline borders, row dividers |
| `--color-border-strong` | `#313138` | `#D5D5DB` | bar border, popovers, checkbox outline |
| `--color-text` | `#ECECEF` | `#18181B` | primary text |
| `--color-muted` | `#8F8F99` | `#6C6C77` | secondary text, labels |
| `--color-faint` | `#5E5E68` | `#A3A3AD` | tertiary text, axis labels, untracked |
| `--color-accent` | `#7B61FF` | `#6A4FF0` | primary buttons, selection, named sessions |
| `--color-on-accent` | `#FFFFFF` | `#FFFFFF` | text on accent |
| `--color-red` | `#EF5157` | `#DC3A40` | overtime, distraction, destructive |
| `--color-orange` | `#F2A33A` | `#C97A10` | warnings |
| `--color-green` | `#3FB27F` | `#1F9D63` | goal met |
| `--color-planned` / `timed` / `open` / `break` / `away` | | | session states (see `styles.css`) |
| `--color-productive` / `neutral` / `distracting` / `uncategorized` | | | activity categories |

Project colours (user-picked): `#7B61FF #22D3EE #2DD4BF #F59E0B #E3A6F2 #5B7FE0 #F472B6 #A3E635`.

### Type
- Family: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` (ships with Windows 11; no web-font download). All numbers use `font-variant-numeric: tabular-nums`.
- Scale (px / weight / line-height):
  - `timer-xl` 22 / 700 / 1 — widget timer
  - `stat` 20 / 600 / 1.2 — dashboard stat numbers
  - `h1` 14 / 600 — page title (top bar)
  - `section-title` 13 / 600 — section and card titles
  - `body` 13 / 400 / 1.45
  - `small` 12 / 400
  - `caps` 9 / 700 / 1.05, `letter-spacing: .06em`, uppercase — widget caption (Rize two-line caption)
  - `section-label` 12 / 500, sentence case, muted — labels above values; sidebar groups 11 / 500 faint

### Radii, spacing, shadows
- Radii: `pill` 9999 · `card` 8 · `control` 6 · `chip` 4 · `bar` 2.
- Spacing: 4-px grid (4, 8, 12, 16, 20, 24, 32). Card padding 16 (20 on dashboard stat cards).
- Shadows: `--shadow-float` for the prompt window, `--shadow-pop` for menus, tooltips, the merge panel and the toast. Dashboard cards have no shadow, only the 1 px border.
- Motion: 150 ms ease-out for hover/expand; the timer never animates digits.

## 2. Widget (`#/widget`)

The bar is the only widget (P50; Full and Compact were removed). The BrowserWindow is transparent: the bar plus an 8 px margin on every side, **528 × 50**. It is display-only; session controls live in the dashboard sidebar.

### Bar (P43, P46, P49, P50) — 512 × 34, sharp corners
Modelled on the real Rize widget (`design/reference/rize floating widget.jpeg`): a flat status strip, no title, no ring, no rounded corners. Window 528 × 50. No hover card and no panel. No drop shadow (the 8 px window margin would clip it into a visible box); the distracted pulse is the 4 px red ring only.
```
┌──┬───────────────────────────────────────────────────────────────┬───┬──┐
│▦▦│   24:59 WRITING WEEKLY    0 min PRODUCTIVE    14% PERCENT       │ – │⋮⋮│
│▦▦│         REPORT                  TODAY               OF DAY      │   │  │
└──┴───────────────────────────────────────────────────────────────┴───┴──┘
```
- **Dashboard button** (32 px, left-most, `surface-2` tint, right border, 2×2 grid icon): opens the dashboard on Today. It's the only way in from the bar.
- Three cells, each as wide as its content and spread evenly (`justify-around`, P49); even a full two-line label leaves ≥ 12 px between cells. Each is a 19/700 tabular number + a two-line `caps` label (muted). **Cells do nothing when clicked**; they drag like the gaps.
  1. **Session timer.** Label: the session name typeset exactly like the other captions (`caps`: 9/700, uppercase, same tracking and leading), but wrapping across both lines instead of one word per line, max 104 px wide, with `…` only past the second line (`line-clamp-2`); the full name is in the tooltip. The label shows in every working state, including distracted, overtime and paused (the paused session's name). States show by colour only: `text`/`muted` normally, `red` when overtime or distracted, `break` when paused. An unlabelled session shows a two-line caption (`SESSION / ELAPSED`, `DISTRACTED / youtube.com`, …). `Off hours` / `Away` (muted 15/600) replace the timer, captioned `WORKDAY / DONE`, `DAY / OFF`, `BEFORE / WORK HOURS`, `AWAY FROM / COMPUTER`. The prompt dot sits at its top-right.
  2. **Productive today** in `accent` (`23 min`, `2h 14m` from an hour); `green` once the goal is met.
  3. **Percent of day** (`14%`, `–` on a day off).
- **Minimize** (32 px, left border, `–`): hides the bar; the tray or the hotkey brings it back. Not remembered across launches.
- **Drag handle** (24 px, `surface-2` tint, ⋮⋮ grip, `cursor: move`) at the far right. Everything except the two buttons drags.
- Red border for overtime/distracted, which also tints the fill red and pulses once.
- Session controls live in the dashboard sidebar (see Dashboard shell).

## 3. Prompt window (`#/prompt`)

420 px wide, height = content (main resizes to `document.body.scrollHeight`). Fill `surface`, border 1 px `border-strong`, radius card, `shadow-float`, 20 px padding. Styled like the reference popover card (`rize-autotag-example.png`).
```
 ╭──────────────────────────────────────────╮
 │ ● TIME'S UP                     1 of 3   │  ← caps, colour of the prompt type; queue count muted
 │ Time's up: Replying to emails            │  ← 17/600 text
 │ Planned 30 min. Done, or need more time? │  ← body muted
 │                                          │
 │ [ name ▾ autocomplete ] [ project ▾ ]    │  ← only for label/check-in/offline work
 │                                          │
 │ [Done] [+5 min] [+15 min] [Custom…]      │
 │ [Switch task]                            │
 ╰──────────────────────────────────────────╯
```
- Header strip: a 6 px dot + `caps` label in the type colour: away/recovery `away`, timeUp `planned`, label/checkIn `accent`, breakEnd `break`. A 2 px top border in the same colour.
- Buttons wrap; height 34, radius pill (as in the reference popover), primary action first with accent fill. The away prompt's five choices are equal-weight secondary pills; `I was working` gets accent outline.
- Inputs: height 36, `surface-2` fill, 1 px `border`, focus border `accent`. Autocomplete list: surface-2 card under the input, rows 30 px, the matched prefix bold.
- Draggable by the header strip. Enter submits the primary action; it never closes on Esc (P22: prompts don't auto-dismiss).

### Start-session popover (rendered in the prompt window)
```
 ╭──────────────────────────────────────────╮
 │ START A SESSION                          │
 │ ( Planned | Timed | Open | Break )       │  ← segmented control, active = accent fill
 │ What are you working on?                 │
 │ [ Replying to emails            ]        │
 │ [ Project: none ▾ ]                      │
 │ Duration                                 │
 │ (15)(25)(30)(45)(60)(90)( custom __ m )  │  ← chips, selected = accent outline+tint
 │ Count  [↓ down | ↑ up]                   │  ← planned only
 │                        [Cancel] [Start ▶]│
 ╰──────────────────────────────────────────╯
```
- Fields hidden per tab: Timed has no name; Open has no duration; Break has an optional duration; direction only on Planned.
- When `start` returns `needs_label`, a step-0 card appears above: "What were you doing for the last 45m?" with name + project, then the form continues.
- Project dropdown last item: `+ New project` → inline name + colour swatch row.

## 4. Dashboard (`#/dashboard/*`)

1200 × 800, min 960 × 640, framed window, background `bg`.
- **Sidebar** 216 px, `sidebar` fill, right border. Top: 20 px accent square mark + "Spyder" 14/600. Groups with 11/500 faint headings: Today (Today, Review), Trends (Week, Month), Setup (Rules, Settings). Nav items 32 px tall, 16 px icons (inline SVG, 1.5 px stroke), radius control; active = `surface-2` fill, `text`, 500; inactive `muted`, hover `surface-2` at 60 %. A badge (accent pill) on Review shows pending items.
- **Sidebar footer** (a small bordered `surface` card): state dot + caption + timer, then `Start session` (primary, full width) whenever working — also while a session runs, so a planned or timed session can start at any time — then the session controls (P46, equal-width 28 px buttons): `Pause` · `Break` (start form on the Break tab) · `Done`; paused → `Resume` (outline) · `Done`; on a break → `End break`. Off hours: `Keep working +N` (P20). None while away. Then a `Show widget` ghost button.
- **Top bar** (48 px, bottom border): page title `h1`, `‹ ›` (28 px ghost) and the date, right side page actions (`Export…` secondary; Review: `Complete review` primary).
- **Content:** padding 24, 12-column grid, gap 16. Cards: `surface`, 1 px `border`, radius card, padding 16, header = `section-title` + optional right-aligned muted total.
- **Toast** (P52): bottom centre, `surface` card with `shadow-pop`, one line + `Undo` (accent text) + ×; gone after 8 s. Errors show in `red` without Undo.

### Today (P55 — core first)
One centred column, max 960 px, 32 px between sections. Section heads: `section-title` left, muted totals right.
1. **Stat row**: one bordered strip of 4 cells divided by hairlines: Productive (green when the goal is met, a 4 px progress bar, `of 5h goal · met`), Worked (`1h break`), Day score (`of 7h scheduled`), Streak (`goal met in a row`). Values `stat`, labels `section-label`.
2. **Session log**: a bordered table of sessions, away periods and untracked spans in time order, 40 px rows: checkbox · time range (`11:00–now` while running) · 3 px colour bar (project colour, else accent when named, `open` grey when unlabelled, break 50 %) · name (click to rename; `Unlabelled` muted) + project in muted 12 px + `● Running` · kind (and plan, red when > 10 % over) · duration · on hover, rename ✎ and delete 🗑 icon buttons. Away and untracked rows are muted and read-only, without a checkbox. Header right: `8 sessions · 30m untracked`; with ticks: `2 selected · Merge… · Clear`.
   - **Rename** turns the row into name input (autocomplete) + project select + Save / Cancel; Enter saves, Esc cancels.
   - **Merge…** opens a panel above the table: radio list of the ticked sessions (longest pre-picked; a running one is forced and the others disabled), `Merge` primary, `Breaks merge only with breaks` in red when mixed.
   - Delete and merge apply at once and show the toast with Undo.
3. **Timeline**, one track (P55): 30 px track; work hours lit (`surface-2`), the rest at 45 %. Sessions in their log colour, breaks and classified away at 35–40 %, pending away hatched lilac, untracked hatched `faint`. A 4 px category strip under the track, small red triangles above it for flags, an accent `now` line. Hour labels 11 px `faint`. Hover: tooltip card (name · project, time range · duration). Clicking a session outlines it, dims the rest and highlights its log row. Legend (Session · Break · Away · Untracked) at the right of the head.
4. **Apps & sites** (scope right): a 6 px stacked category bar with an inline legend, then the top 5 in a bordered table: category square · name · `h:mm` · faint `%` · quiet category label (click opens the 3-option menu). `Show all N` reveals the rest.
5. **Distractions**, only when there is distracting time or a flag: head right `1 flag · 7m distracting`, then one row per flag (red dot · time · target · `5m straight`).
6. Off-hours note, 12 px faint.

### Week
Stat row (total work, productive, avg score, goals hit `3/5`). Stacked bar chart (8 cols, 280 px): one bar per day, stacks productive / neutral / distracting / uncategorized / break / away. Goal-hit marker: green ✓ dot above the bar. Right (4 cols): top 10 sites ranked list. Bottom: estimate accuracy table (session · planned · actual · delta, delta red when over by > 10 %).

### Month
Calendar heatmap (custom SVG, 7 columns Mon–Sun, 44 px cells, radius 6): fill = accent at opacity scaled by productive hours (0 h → `surface-2`, ≥ goal → 100 %), day number top-left 11 px (`on-accent` above half the goal), a green dot ringed in `surface` if goal met; unscheduled days outlined only. Right: trend line charts (productive hours, score) and one small line chart per KPI.

### Review
Two columns. Left (7 cols): "Leftover" card listing unlabelled sessions and pending away periods, each with inline label / classification controls; an unlabelled session also has a `Delete session` ghost link (P50, P53); a check-mark empty state "All time accounted for". Day summary card (mini stats + small timeline). Right (5 cols): "Today's wins" and "How I'll improve" bullet editors (each item a row with drag handle `⋮⋮`, text input without border until focus, delete ×; `Enter` adds a row), KPI inputs (label + number input + unit). `Complete review` primary in the top bar, disabled with a tooltip while leftovers exist; completed state shows a green "Reviewed at 17:12" chip.

### Rules
Tabs (segmented): Rules · Title patterns · Uncategorized · Projects · KPIs. Each is an editable table with an `+ Add` row at top. Default rows show a muted `default` chip; user rows win. Uncategorized inbox: rows `key · time today · [Productive][Neutral][Distracting]` one-click buttons.

### Settings
Sections as cards: Work hours (7-row grid: toggle, start time, end time; plus "Today only" override row), Timers (check-in, nag, nudge, idle, short-away, keep-working step — number inputs with unit suffix), Goal, Widget & hotkey (Theme System / Light / Dark segmented control, P57; count direction; hotkey field; orange warning banner if registration failed), Tracking (sample interval, app % scope radio), System (autostart toggle, data folder path + `Open folder`), Export (`Export…` button). Capture-unavailable banner: orange, top of page.

Toggles: 32 × 18 track, `surface-2` off / `accent` on, white 14 px knob.

## 5. Charts (Recharts + custom SVG)
- Background transparent on the card; gridlines `border` 1 px, horizontal only, dashed `3 3`. Axis text `11px muted`, no axis lines, ticks off.
- Bars radius `[3,3,0,0]` on the top stack only, max width 28. Lines 2 px, no dots except on hover (4 px). Donut: inner radius 62 %, padding angle 1, centre label = total `h:mm` (`stat` 20) + `section` caption.
- Colours: categories use the category tokens; kinds use session-state tokens; anything else uses the categorical series order.
- Tooltip: `surface` card, 1 px `border`, `shadow-pop`, radius control, 12 px, values tabular.
- Durations displayed as `h:mm` in tables, `2h 15m` in prose and prompts, `38m` under an hour.

## 6. Tray & icon
- Icon: 256 px accent (`#7B61FF`) circle with a white bold "S" (`scripts/make-icon.ps1`). Tray uses the PNG resized to 16/32.
- Notifications (nudge toast) use the system toast; title `Spyder`, body per plan §8.
