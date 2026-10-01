# Visual style: match the reference

The reference is the Zentra dashboard in [`reference/`](reference/): `02-overview-full.png` is the whole page, and the others are close-ups of the toolbar and Gross Volume card (`03`), the Retention, Transactions and Customers cards (`04`), and the Payments funnel with the prompt bar (`05`). Match its look closely. Keep our information architecture, data and behaviour.

This file overrides SPEC §5.3 wherever they disagree. Color values are sampled from the reference.

## 1. Surfaces and shape

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` (canvas) | `#F2F2F2` | `#0E0F11` | Page background |
| `--card` | `#F8F8F8` | `#16171A` | Cards. Gradient `#FAFAFA` to `#F6F6F6` top to bottom (dark `#18191C` to `#141518`) |
| `--card-edge` | inner `inset 0 1px 0 rgba(255,255,255,.9)` plus outer ring `0 0 0 1px rgba(0,0,0,.035)` | `0 0 0 1px rgba(255,255,255,.06)` | Card border, drawn as box-shadow, not `border` |
| `--card-shadow` | `0 1px 2px rgba(0,0,0,.03), 0 16px 36px -18px rgba(0,0,0,.10)` | none | Card lift |
| `--well` | `#EAEAEA` | `#232428` | Toolbar groups, segmented-control tracks, secondary buttons |
| `--raised` | `#F8F8F8` + `0 1px 2px rgba(0,0,0,.08), inset 0 1px 0 #fff` | `#2C2D31` | Selected segment or raised pill inside a well |
| `--border` | `#E4E4E4` | `rgba(255,255,255,.08)` | Hairlines, table rules, chart column separators (`#ECECEC`) |
| `--circle-border` | `#DADADA` | `rgba(255,255,255,.14)` | Circular icon buttons |

Radii:

| Element | Radius | Tailwind |
|---|---|---|
| Cards | 28px | `rounded-[28px]`, token `--radius-card` |
| Nested panels and tiles | 20px | |
| Controls (buttons, inputs, segments) | 14px | Segments inside a 16px well are 12px |
| Chips, badges, delta pills, dots, avatars | full | |

Card padding is 28px on overview pages and 20px on dense pages. Grid gap is 16–20px. Page container: `max-w-[1440px]`, `px-8` (desktop) and `px-5` (mobile).

## 2. Type

- **Font:** Inter via `next/font/google` with the `opsz` axis, so display cuts apply at large sizes (the reference uses a display grotesk). Keep Geist Mono for ids, paths, JSON, diffs and logs.
- **Ink:** titles and hero numbers `#0B0B0B` (dark `#F4F4F5`). Body `#1A1A1A`.
- **Muted text:** `#6E6E6E` (AA on `#F8F8F8`) for text under 16px. `#8A8A8A` is allowed only for labels 16px and up and for inactive big numbers; `#A6A6A6` only for inactive column values of 26px and up, the way the funnel does it.

| Role | Size / line height | Weight | Tracking |
|---|---|---|---|
| Page title ("Overview") | 48–56px / 1.05 | 400 | -0.035em |
| Card title ("Payments") | 20–22px / 1.2 | 500 | -0.015em |
| Hero number ("$41,540") | 64–72px / 1 | 400 | -0.045em, `tabular-nums` |
| KPI number ("106k") | 44–52px / 1 | 400 | -0.04em |
| Funnel column value ("65.2k") | 26–28px | 400 | -0.02em. Muted when inactive, ink when active |
| Label ("Online Payments", "vs last period") | 15–16px | 400 | muted |
| Body | 14px / 20px | 400 | |
| Small | 12–13px | 400 or 500 | |

Kickers (uppercase, tracked) are rare in the reference. Keep them only for tiny section captions, at `#8A8A8A`.

## 3. Controls

- **Primary button: an ink pill,** styled like the reference's "Home" nav item.
  - Background `linear-gradient(180deg,#3A393C,#1C1C1E)`, white text.
  - Radius 14px, height 40–44px, padding `px-4.5`.
  - Shadow `inset 0 1px 0 rgba(255,255,255,.18), 0 2px 6px -1px rgba(0,0,0,.35)`.
  - Dark mode: `#F2F2F2` background with `#111` text.
  - This is Button's `default` variant, token `--ink` / `--ink-foreground`.
- **Secondary button:** background `var(--well)`, text ink, radius 16px, height 40–44px, no border; hover `#E3E3E3`. Examples: "Daily ▾", "Add widget +".
- **Circle icon button:** 40–44px circle, 1px `--circle-border`, transparent background, 18px ink icon. Examples: "···", search, bell. The bell shows a small `#FF4D1A` dot when something needs attention.
- **Segmented control:**
  - A `--well` track: radius 16px, padding 4px, height 44px.
  - The selected segment is `--raised` with radius 12px and ink text. Unselected segments are muted text with no fill.
  - Use it for stage sub-step pills, rail tabs, Board/Table toggles, the speed setting, filters and every shadcn `Tabs` list. Counts inside a segment are small muted numbers, or a soft tone chip when they need action.
- **Toolbar group:** segments separated by muted text, like `[📅 Jan 01 – Jul 31 ▾] compared to [📅 Aug 01 – Dec 31 ▾]`. Use it for page-level filters.
- **Inputs, selects and textareas:** white background, 1px `#E6E6E6`, radius 14px, height 44px, 15px text. Focus ring is 3px blue at 25%.
- **Floating chip,** for labels such as "Peak: Wed", "42%" and "▲ 15%":
  - White pill, height 30–32px, `px-3`, 13–14px text. The label is muted and the value is ink, medium weight.
  - 1px `rgba(0,0,0,.06)` edge.
  - Shadow `0 6px 16px -6px rgb(<tone> / .35), 0 1px 2px rgba(0,0,0,.06)`.
  - A delta pill has a small colored triangle.
- **Glass tooltip,** for example "48.6k transactions | Conversion: 89% | Drop-off: -11%":
  - `rgba(255,255,255,.72)` with `backdrop-blur-md`, a 1px white edge plus an outer `rgba(0,0,0,.06)` ring, and a soft shadow.
  - 13px text; separators are muted `|`; values are ink, medium weight.
- **Token chip:** an inline highlight such as `/successful payments`. Background `#FDE9C9`, 1px `#FFCA88` border, text `#C2610C`, radius 6px, `px-1.5`.
- **Status pill:**
  - A soft tinted pill (tone background plus tone foreground) with an icon and a label, full radius, height 24–28px, 12–13px medium text.
  - Keep "icon + label, never color alone".
  - Offer `variant="chip"` (the white floating chip above, with a tone-colored icon) for hero deltas and floating labels.

## 4. Color meaning

Stages have no color of their own; color means status or a data series.

| Tone | Text / icon | Soft bg | Solid / stripe |
|---|---|---|---|
| brand / running | `#1558D6` | `#E7F0FF` | `#1B6FFC` |
| attention | `#B45309` | `#FFF1DC` | `#F59E0B` |
| review | `#5B45D6` | `#EFEBFF` | `#7C5CFF` |
| success | `#0E7F24` | `#E3F6E7` | `#0EAA28` |
| danger | `#C8252C` | `#FFE8E8` | `#EF4444` |
| neutral | `#6E6E6E` | `#EDEDED` | `#A3A3A3` |

Chart-only extras: pink line `#E8358A`, pink stripe `#FF9FCC`, blue dot `#1976FF` with its light variant `#A1CBF8`, green dot `#0DAA2C` with its light variant `#9CD6A3`. Brand mark: an orange rounded square, `linear-gradient(135deg,#FFB547,#F26A1B)`, holding the Wefty "woven W": two V-shaped threads, cream `#FFF6E4` over peach `#FFD9A0`, where the peach thread passes under the cream one at the crossing (`src/components/shell/brand.tsx`; the favicon and app icons in `src/app/` use the same geometry).

`--primary` stays brand blue: links, focus rings, current-stage highlight, the active chart column. Primary buttons and the active nav item use `--ink`.

## 5. Data-viz textures (the signature of the reference)

- **Striped bar:**
  - A full-radius bar, 14px tall, on a white track (`inset 0 0 0 1px rgba(0,0,0,.04)`).
  - Fill `repeating-linear-gradient(135deg, var(--c) 0 5px, color-mix(in srgb, var(--c) 55%, white) 5px 8px)`.
  - Use it for breakdown bars (Gross Volume), progress, and wave and epic progress. Partial or in-progress segments use the same stripes at 60% opacity.
- **Funnel columns** (Payments), for the portfolio pipeline:
  - Columns are split by 1px `#ECECEC` rules. The top label is 14px muted; the value is 26–28px (muted `#A6A6A6`, or ink when active).
  - Bar: gradient from `#1D5BF0` at the top to `rgba(191,227,255,.2)` at the bottom, overlaid with 45° white stripes (2px lines every 9px).
  - Between neighbouring bars, a sloped "side" polygon in a lighter blue gradient.
  - A 28×6px pill marker (blue gradient, white edge) floats above each bar.
  - Active column: a solid gradient bar `#1B70FC` to `#3B2FD8`, the column background glowing `linear-gradient(#E6F0FF, transparent)`, and a glass tooltip.
- **Step area chart** (Retention):
  - `stepAfter` line, 2.5px `#E8358A`.
  - Area fill of vertical pink stripes (`repeating-linear-gradient(90deg, rgba(232,53,138,.16) 0 2px, transparent 2px 6px)`) fading to transparent at the bottom.
  - Marker dot plus a floating chip.
  - Month or day labels are 13px muted.
- **Dot matrix** (Transactions / Customers):
  - Columns of 11–12px rounded dots with 3px gaps. The peak column is saturated; the others are light.
  - A floating chip above the peak column ("Peak: Wed").
  - A big number on the left; "vs last period" plus the delta on the right.
- **Mesh insight card** (Insights):
  - Radial gradients: peach `#F7B58A` and coral `#F48A7A` top right, into blue `#2A5BD7` / `#1E3FAE` bottom left.
  - A grain overlay (an SVG `feTurbulence` data URI at 10–14%).
  - A white 72px numeral and white 16–18px text.
  - Chip: `bg-white/20 backdrop-blur border-white/40`, with a lightbulb icon.
  - Carousel indicator: three 2px white bars, the active one solid and the rest at 40%.
  - It is the only loud element on a page.
- **Prompt band** ("What would you like to explore next?"):
  - A light blue frosted band, `linear-gradient(180deg,#D3E3F6,#C7DCF3)` with a soft blue glow, overlapping the bottom of the card above it.
  - A sparkle icon and a muted question.
  - A white 44px input (radius 12px, soft shadow) that can hold token chips.

## 6. Layout changes

1. **Top navigation replaces the sidebar,** laid out like the reference:
   - Left: orange brand mark and the "Wefty" wordmark.
   - Centre: text nav items (Home, Inbox with a count chip, Projects, Runs, Settings); the active item is an ink pill.
   - Right: circle search (opens ⌘K), circle bell (dot and count, links to the Inbox), a small live dot, and an avatar with a gradient ring that opens the "Acting as" menu (name, theme, demo speed).
   - Nested pages show a small muted breadcrumb row under the nav.
   - Below 900px the nav items collapse into a menu sheet.
2. **Page header:** a big title on the left, with an optional circle icon button next to it (for example "copy link"); a toolbar group and secondary buttons on the right.
3. **Card header:** the title on the left, a circle "···" or action button on the right.
4. **Home mirrors the reference grid:**
   - Row 1: the pipeline funnel card with a prompt band ("What would you like to do next?", which opens the command palette, with `/project`-style token chips for suggestions), plus an "Agent spend" card built like Gross Volume (hero dollar amount, a delta chip, striped breakdown bars by stage).
   - Row 2: a step chart card (like Retention), dot-matrix cards for agent runs and for human decisions (like Transactions and Customers), and a mesh Insights card with rotating computed insights.
   - Then attention, activity and the projects table.
5. **Stage pages:**
   - Big stage title.
   - Sub-steps and rail tabs as segmented controls.
   - The gate footer as a frosted band in the style of the prompt band, with an ink primary button.
   - Request cards as cards with a glass header strip.
6. **Tables:** no outer border inside cards; 1px row rules `#ECECEC`; 13px muted headers; 48px rows; hover `#F2F2F2`.
