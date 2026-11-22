# Spyder design spec

Visual source of truth for the renderer. Behavior lives in `SPYDER_PLAN.md` §12. References: `design/reference/INDEX.md`.
The look follows Rize's dark desktop widget and dashboard (P23): near-black surfaces, a bold tabular timer with a tiny all-caps caption, state colour carried by a progress stroke on the pill border, small-caps section headings, purple accent.

**Brand rule:** no Rize logo, wordmark, name, or the purple "agent orb". Spyder's own mark is an accent circle with a white "S" (tray/app icon only). In the widget the orb's slot is taken by a functional **workday ring**.

## 1. Tokens (dark theme only for v1)

### Colours (`@theme` in `src/renderer/styles.css`)
| Token | Hex | Use |
|---|---|---|
| `--color-bg` | `#0E0E12` | dashboard window background |
| `--color-surface` | `#16161B` | widget pill fill, cards, prompt window |
| `--color-surface-2` | `#1E1E25` | hover, inputs, table header, segmented control |
| `--color-border` | `#2A2A33` | 1 px borders, gridlines |
| `--color-border-strong` | `#3A3A46` | focused inputs, pill border |
| `--color-text` | `#EDEDF2` | primary text |
| `--color-muted` | `#8E8E9C` | secondary text, captions |
| `--color-faint` | `#5C5C6A` | disabled, tertiary |
| `--color-accent` | `#7B61FF` | primary buttons, links, selection, active nav |
| `--color-accent-hover` | `#8E78FF` | |
| `--color-red` | `#F04452` | overtime, distraction tint, destructive |
| `--color-orange` | `#F59E0B` | warnings (nag re-ring, hotkey taken) |
| `--color-green` | `#22C55E` | goal met, positive deltas |
| **Session state** | | |
| `--color-planned` | `#22D3EE` | planned session (cyan, Rize "focus") |
| `--color-timed` | `#2DD4BF` | timed session (teal) |
| `--color-open` | `#EDEDF2` | open session (white, Rize "normal") |
| `--color-break` | `#5B7FE0` | break (Rize blue) |
| `--color-away` | `#E3A6F2` | away periods / meeting (Rize lilac) |
| **Categories** | | |
| `--color-productive` | `#2DD4BF` | |
| `--color-neutral` | `#7C8293` | |
| `--color-distracting` | `#F04452` | |
| `--color-uncategorized` | `#4A4A57` | |

Categorical chart series (projects, top sites), in order: `#7B61FF #22D3EE #2DD4BF #F59E0B #E3A6F2 #5B7FE0 #F472B6 #A3E635`.

### Type
- Family: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` (ships with Windows 11; no web-font download). All numbers use `font-variant-numeric: tabular-nums`.
- Scale (px / weight / line-height):
  - `timer-xl` 22 / 700 / 1 — widget timer
  - `stat` 28 / 600 / 1.1 — dashboard stat numbers
  - `h1` 20 / 600 — page title
  - `h2` 15 / 600 — card title
  - `body` 13 / 400 / 1.45
  - `small` 12 / 400
  - `caps` 9 / 700 / 1.05, `letter-spacing: .06em`, uppercase — widget caption (Rize two-line caption)
  - `section` 11 / 600, uppercase, `letter-spacing: .08em`, muted — sidebar groups and card headers

### Radii, spacing, shadows
- Radii: `pill` 9999 · `card` 10 · `control` 8 · `chip` 6 · `bar` 3.
- Spacing: 4-px grid (4, 8, 12, 16, 20, 24, 32). Card padding 16 (20 on dashboard stat cards).
- Shadows: `--shadow-float: 0 8px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04)` for widget/prompt. Dashboard cards have no shadow, only the 1 px border.
- Motion: 150 ms ease-out for hover/expand; the timer never animates digits.

## 2. Widget (`#/widget`)

The BrowserWindow is transparent; its size is the content plus an 8 px margin on every side for the shadow. It resizes when expanding (main process sets bounds): **collapsed 336 × 80**, **expanded 336 × 196**. Top-left anchor stays fixed.

### Collapsed pill — 320 × 64, radius pill
```
 ╭───────────────────────────────────────────────────────────╮
 │ ■ 24:59   Replying to emails                     ╭──╮     │
 │           ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░              │62│     │
 │           62% OF DAY · 2:14 / 5:00 PRODUCTIVE    ╰──╯     │
 ╰═══════════════════════════════════════════════════════════╯
   └ session-progress stroke runs along the border ┘
```
- Fill `surface`, border 1.5 px `border-strong`, `shadow-float`. Whole pill is `-webkit-app-region: drag`; the ring and (in expanded state) buttons are `no-drag`. A click (mousedown+up without movement > 3 px) toggles expanded — implement the click target as a `no-drag` overlay over the text block so clicks register.
- **Left block (x 16):** 8 × 8 px rounded-square state marker in the session colour (hidden for open sessions, like Rize "normal"), then the timer `timer-xl`, min-width 68 px. Format `mm:ss` under 1 h, `h:mm:ss` above. Overtime: `+mm:ss` in `red`.
- **Middle block (flex 1, gap 3):**
  - line 1: session title, `body` 13/600, `text`, single line ellipsis. `Untitled session` in `muted` italic when unlabelled. `Off hours` in off hours.
  - line 2: workday bar, 4 px tall, radius bar, track `surface-2`, fill `muted` (turns `accent` after 50 %).
  - line 3: `caps` caption in `muted`: `62% OF DAY · 2:14 / 5:00 PRODUCTIVE` (productive turns `green` once goal met).
- **Right (x −16):** 34 px workday ring: 3 px stroke, track `border`, arc `accent`, centre number `11/700` (`62`). Replaces Rize's orb.
- **Session-progress stroke** (Rize signature): an SVG `rect rx=32` overlaid on the border, 2 px, stroked with the session colour using `stroke-dasharray` = progress × perimeter, starting bottom-left going clockwise.
  - planned/timed/break with duration: progress = elapsed / planned (full when time up).
  - open: no stroke (border only).
  - Overtime: whole border `red`, 2 px (like Rize "past break threshold", which uses full orange border).
- **States:**
  - *Distracted*: fill blends to `rgba(240,68,82,.18)` over surface, border `red`, title gets a `⚠ ` prefix; 2 s pulse on the border once when it starts.
  - *Paused*: the current is a break named "Paused" → break colours, caption `PAUSED · {paused session name}`.
  - *Away*: timer replaced by the word `Away` in `muted` (Rize "Locked" style).
  - *Off hours*: timer replaced by `Off hours` (muted 15/600), caption `{productive} / {goal} PRODUCTIVE TODAY`, workday ring shows 100 or `–` on a day off. A small `Keep working +30` chip (accent outline) sits in the middle block on hover/expanded.
  - *Has prompt*: 6 px `orange` dot at the ring's top-right.

### Compact pill (P31, `widgetStyle = "compact"`) — 176 × 40, radius pill
Closest to Rize's widget (`rize-widget_meeting_dark.png`). Window: collapsed 192 × 56, expanded 336 × 172 (the panel is 320 wide and left-aligned under the pill).
```
 ╭─────────────────────────────╮
 │ ■ 24:59  PLANNED   ╭──╮     │
 │          REMAINING │62│     │
 ╰═════════════════════════════╯
```
- Same fill/border/shadow/progress stroke/state colours as Full.
- Timer 18/700. Caption `caps` two lines describing the timer: `PLANNED / REMAINING`, `PLANNED / ELAPSED` (count-up), `TIMED / REMAINING`, `SESSION / ELAPSED` (open), `BREAK / REMAINING|ELAPSED`, `OVERTIME / {name}` (red), `TRACKING / STATUS` under `Away` / `Off hours`.
- Workday ring 26 px (2.5 px stroke, centre number 9/700).
- **Hover card** (after 300 ms hover): appears below the pill (above it if there's no room), 240 px, surface card: title 13/600, workday bar + `62% of day`, `2:14 / 5:00 productive`. The window grows to fit while it's shown. Distracted adds a red line `On youtube.com for 6 min`.

### Bar (P43, `widgetStyle = "bar"`, the default) — 468 × 34, radius 7
Modelled on the real Rize widget (`design/reference/rize floating widget.jpeg`): a flat status strip, no title, no ring. Window: collapsed 484 × 50, expanded 484 × 168. No hover card. No drop shadow (the 8 px window margin would clip it into a visible box); the distracted pulse is the 4 px red ring only.
```
┌───────────────────────────────────────────────────────────────┬────┐
│  24:59 PLANNED      0 min PRODUCTIVE       14% PERCENT          │ ☰  │
│        REMAINING          TODAY                OF DAY           │    │
└───────────────────────────────────────────────────────────────┴────┘
```
- Three cells, each a 19/700 tabular number + a two-line `caps` label (muted):
  1. **Session timer** (160 px, the click target that opens the panel). Caption as Compact. Colour: `text`; `red` when overtime or distracted (caption `DISTRACTED / youtube.com`); `break` when paused. `Off hours` / `Away` (muted 15/600) replace the timer, captioned `WORKDAY / DONE`, `DAY / OFF`, `BEFORE / WORK HOURS`, `AWAY FROM / COMPUTER`.
  2. **Productive today** in `accent` (`23 min`, `2h 14m` from an hour); `green` once the goal is met.
  3. **Percent of day** (`14%`, `–` on a day off).
- ☰ segment (40 px, `surface-2` tint, left border, no hover effect) opens the **dashboard**; the prompt dot sits at its top-right.
- States show by colour only (no bottom strip): red border + red timer for overtime/distracted, which also tints the fill red and pulses once, like the pills.
- The rest of the bar is the drag area.

### Style toggle
The expanded panel has a `⇄` 32 px ghost button (tooltip "Switch to …") next to `×`; it cycles compact → full → bar → compact. Settings → Widget has a three-option segmented control (Bar / Full / Compact). Switching applies live, keeps the top-left position.

### Expanded — panel below the pill, 320 × 112, radius card, gap 8
Same surface/border/shadow. Two rows of buttons, 8 px gaps, 16 px padding:
```
 ╭──────────────────────────────────────────────────╮
 │ [▶ Start]  [✓ Done]  [+5]  [+15]                 │
 │ [⏸ Pause]  [☕ Break]  [▦ Dashboard]   [⇄] [×]  │
 ╰──────────────────────────────────────────────────╯
```
- Buttons: height 32, radius control, `surface-2` fill, 12/600 text, 1 px `border`; hover `border-strong`. `Start` is primary (accent fill, white text). `×` (Hide) is a 32 px square ghost button. Disabled buttons (e.g. +5 on an open session) use `faint`.
- `Pause` toggles to `Resume` (accent outline) while paused.
- Click outside / Esc collapses.

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
- **Sidebar** 220 px, `surface` fill, right border. Top: 24 px Spyder mark + "Spyder" 15/600. Groups with `section` headings: **TODAY** (Today, Review), **TRENDS** (Week, Month), **SETUP** (Rules, Settings). Nav items 34 px tall, 18 px icons (inline SVG, 1.5 px stroke), radius control, active = `surface-2` fill + `text`, inactive `muted`. A badge (accent pill) on Review shows pending items.
- **Sidebar footer:** mini status like Rize's bottom bar: state marker + timer + 2-line caps caption, and a `Show widget` ghost button.
- **Top bar** (56 px, bottom border): page title `h1`, date navigator `‹ › 📅 Tue, Nov 24 2026` (buttons 32 px, `surface-2`), right side page actions (`Export…` secondary; Review: `Complete review` primary).
- **Content:** padding 24, 12-column grid, gap 16. Cards: `surface`, 1 px `border`, radius card, padding 16, header = `section` text + optional right-aligned muted total.

### Today
Row 1 — five stat cards (each 2–3 cols): Work time · Productive / goal (with a 44 px ring, green when met) · Day score (`74%`) · Streak (`🔥` not used; plain `6 days`) · Distractions (count + minutes, red when > 0). Stat card: `section` label, `stat` number, `small` muted sub-line.
Row 2 — **Timeline** (12 cols, height 132), custom SVG:
- x axis = the day's work window ±1 h (or 08:00–20:00 on a day off), hour ticks + labels `small muted`, gridlines `border`.
- Lane 1 "Sessions" (28 px): blocks per segment, coloured by kind (planned cyan, timed teal, open white @ 70 %, break blue), radius 4; label inside if ≥ 60 px wide (`11/600`, dark text on light fills).
- Lane 2 "Away" (16 px): lilac blocks, hatched (`pattern` 45°) while pending classification.
- Lane 3 "Activity" (20 px): thin blocks coloured by category.
- Lane 4 flags: red 6 px triangles at distraction flag times.
- Shaded `surface-2` background outside work hours. A red vertical `now` line.
- Hover tooltip: card `surface-2`, 12 px text, name + time range + duration.
Row 3 — Sessions table (7 cols) · Category donut (5 cols).
Row 4 — Apps & sites (7 cols) · Distraction flags + off-hours note (5 cols).

Tables: header 32 px `surface-2`, `section` text; rows 36 px, 1 px `border` dividers, hover `surface-2`. Numbers right-aligned tabular. Apps & sites rows follow Rize's ranked list: `1  youtube.com     38m   1.2%  [Distracting ▾]` with a faint bar (category colour @ 15 %) behind the row sized to pct. The category chip is a 22 px pill, dot + label, click opens a 4-option menu.

### Week
Stat row (total work, productive, avg score, goals hit `3/5`). Stacked bar chart (8 cols, 280 px): one bar per day, stacks productive / neutral / distracting / uncategorized / break / away. Goal-hit marker: green ✓ dot above the bar. Right (4 cols): top 10 sites ranked list. Bottom: estimate accuracy table (session · planned · actual · delta, delta red when over by > 10 %).

### Month
Calendar heatmap (custom SVG, 7 columns Mon–Sun, 44 px cells, radius 6): fill = accent at opacity scaled by productive hours (0 h → `surface-2`, ≥ goal → 100 %), day number top-left 11 px, a green dot if goal met; unscheduled days outlined only. Right: trend line charts (productive hours, score) and one small line chart per KPI.

### Review
Two columns. Left (7 cols): "Leftover" card listing unlabelled sessions and pending away periods, each with inline label / classification controls and a `Mark as Unknown` ghost link; a check-mark empty state "All time accounted for". Day summary card (mini stats + small timeline). Right (5 cols): "Today's wins" and "How I'll improve" bullet editors (each item a row with drag handle `⋮⋮`, text input without border until focus, delete ×; `Enter` adds a row), KPI inputs (label + number input + unit). `Complete review` primary in the top bar, disabled with a tooltip while leftovers exist; completed state shows a green "Reviewed at 17:12" chip.

### Rules
Tabs (segmented): Rules · Title patterns · Uncategorized · Projects · KPIs. Each is an editable table with an `+ Add` row at top. Default rows show a muted `default` chip; user rows win. Uncategorized inbox: rows `key · time today · [Productive][Neutral][Distracting]` one-click buttons.

### Settings
Sections as cards: Work hours (7-row grid: toggle, start time, end time; plus "Today only" override row), Timers (check-in, nag, nudge, idle, short-away, keep-working step — number inputs with unit suffix), Goal, Widget & hotkey (hotkey field; orange warning banner if registration failed), Tracking (sample interval, app % scope radio), System (autostart toggle, data folder path + `Open folder`), Export (`Export…` button). Capture-unavailable banner: orange, top of page.

Toggles: 32 × 18 track, `surface-2` off / `accent` on, white 14 px knob.

## 5. Charts (Recharts + custom SVG)
- Background transparent on the card; gridlines `border` 1 px, horizontal only, dashed `3 3`. Axis text `11px muted`, no axis lines, ticks off.
- Bars radius `[3,3,0,0]` on the top stack only, max width 28. Lines 2 px, no dots except on hover (4 px). Donut: inner radius 62 %, padding angle 1, centre label = total `h:mm` (`stat` 20) + `section` caption.
- Colours: categories use the category tokens; kinds use session-state tokens; anything else uses the categorical series order.
- Tooltip: `surface-2` card, 1 px `border-strong`, radius chip, 12 px, values tabular.
- Durations displayed as `h:mm` in tables, `2h 15m` in prose and prompts, `38m` under an hour.

## 6. Tray & icon
- Icon: 256 px accent (`#7B61FF`) circle with a white bold "S" (`scripts/make-icon.ps1`). Tray uses the PNG resized to 16/32.
- Notifications (nudge toast) use the system toast; title `Spyder`, body per plan §8.
