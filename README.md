# Strategy Map 2027

Interactive corporate strategy map (Office of the CEO), published at
**https://ethanso13.github.io/Strat-Map/**

Four perspective bands — Finance, Business, Internal Business Process, Learning and
Growth — each holding objectives and their initiatives.

The masthead carries **SBU** (fixed at `CORP`) and **Year**. Year is the switcher:
FY2026 and FY2027 are two separate maps and one is shown at a time. It defaults to
FY2027, and the heading tracks the selection. Switching is a view change only —
nothing is written.

On FY2026 each objective offers *Copy to 2027 →*, and each band a *Copy all to 2027 →*,
to carry work forward. Those actions do not appear on FY2027, which has nothing to copy
into.

The map is always editable — there is no lock mode. Two controls sit on the right:

| Control | Does |
|---|---|
| ↺ reset icon | Restore the starting template (asks first). |
| **Save** | Flush to Supabase immediately, and report sync state. |

There is no Export PDF button — the print stylesheet is still in place, so the browser's
own Print / Save-as-PDF (Ctrl-P) produces a clean A4 landscape sheet with the editing
controls stripped out.

## Files

Plain static files. No build step, no framework, no dependencies — open `index.html`
and it runs.

| File | What's in it |
|---|---|
| `index.html` | Page shell: masthead, toolbar, footer. Bands are rendered by `app.js` into `#bands`. |
| `styles.css` | Design tokens, layout, responsive rules, print rules. |
| `app.js` | State, Supabase sync, rendering, toolbar wiring. |
| `assets/` | Archivo font subsets (3 × woff2) and the Megawide logo, now used only as the favicon. |

Edit any of them directly and push — GitHub Pages redeploys automatically.

**When you change `styles.css` or `app.js`, bump the `?v=` on its `<link>` / `<script>`
in `index.html`.** GitHub Pages serves assets with `Cache-Control: max-age=600` and does
not let you configure headers, so without a new URL a browser can keep serving the old
file for ten minutes after a deploy — which looks exactly like the deploy failing.

Anything read back from storage is treated as untrusted and passed through
`normalizeYears()` before it reaches the renderer, so a stale or half-written cache
degrades to an empty map rather than throwing.

## How data is stored

The map state lives in a single Supabase row and is shared by everyone who opens the page.

| | |
|---|---|
| Project | `megawide-strategy-map` (`bshdkeuvovulcixupwys`) |
| Table | `public.strategy_map` |
| Row | `id` = the SBU code, currently `CORP` |
| Payload | `years jsonb` |

**Saves are scoped to the selected SBU and year.** Writing goes through
`cloudSaveYear()`, which re-reads the row and replaces only the lane for the year on
screen. Sending the whole object back would let someone editing FY2027 overwrite FY2026
with whatever stale copy their browser was holding — last write wins, silently. Reset is
scoped the same way, for the same reason.

Adding another SBU means adding a row with that code and letting the page pick it; the
storage layer already keys on it.

The old pre-SBU row `id = 'default'` is migrated from once on first load and then left
alone, so it remains as a point-in-time backup.

The `years` payload mirrors the app's state exactly:

```
years = { prev: Band[], curr: Band[] }  // prev = FY2026, curr = FY2027
Band  = Cell[]                          // one entry per perspective band
Cell  = { title: string, items: Item[] }
Item  = { text: string, target: string }   // an initiative
```

The stored keys are deliberately left as `prev` / `curr` / `items` — renaming them in
the UI is free, but renaming them here would orphan every row already saved.

`localStorage` (`megawide-strategy-map-v2`) is an offline cache: the page paints from it
immediately, then reconciles against Supabase, which is the source of truth. With no
network the map still works and the Save button reads *"Offline — saved locally."*
Edits are debounced ~700 ms; the Save button flushes immediately.

Text edits deliberately do **not** trigger a re-render, so the caret stays put while
typing. Only structural changes (add, delete, copy, toggle, reset) re-render.

Objective and initiative fields grow to fit their text via `autogrow()` in `app.js`,
called on input and on every render. This replaces CSS `field-sizing: content`, which
Chrome supports but Safari and iOS do not — there a long initiative was clipped by
`overflow: hidden` instead of wrapping.

### Known gap

`Item.target` is loaded, copied and saved but never displayed — the original design had
no field for it. Existing values (NIAT = "1.2 Billion") are preserved rather than
dropped. Add an input in `renderCard()` if you want it surfaced.

## ⚠️ Access is currently unrestricted

This repository is **public** (required for GitHub Pages on the free plan), so the
Supabase publishable key is visible in the page source. That key is designed to be
public, but the row-level security policies on `strategy_map` currently allow
`SELECT`, `INSERT`, and `UPDATE` to anonymous users with no conditions:

```
public can read   strategy map  — SELECT  using (true)
public can update strategy map  — UPDATE  using (true)
public can insert strategy map  — INSERT  with check (true)
```

**Anyone who finds the URL can read and overwrite this strategy map.** There is no edit
history, so an overwrite is not recoverable from the app.

To lock it down, either tighten the policies to `authenticated` and add Supabase Auth,
or drop the `UPDATE`/`INSERT` policies to make the page read-only.

## Layout

The desktop design is a 1440px canvas. Two breakpoints:

- **≤ 1180px** — the fixed width relaxes to fill the viewport.
- **≤ 880px** — the masthead stacks, band labels rotate from vertical to horizontal and
  sit above their cards, the 46px label gutter collapses, the toolbar becomes a 44px
  reset icon plus a full-width Save, and objectives go one per row.

  Initiative fields and the Horizon dropdown are also lifted to 16px here. iOS zooms the
  whole page when you focus a control smaller than 16px, which made editing on a phone
  jump around; raising the font size fixes it without `maximum-scale=1`, which would
  have disabled pinch-zoom for everyone.

Verified with no horizontal overflow at 375px, 768px, and 1440px.

## History

This page began as a single 353KB Claude Design canvas export — one `index.html` with
the app JSON-encoded onto a single line, plus React, a proprietary template runtime
(`sc-for` / `{{ }}` / `DCLogic`), and base64 fonts inlined. It was unpacked into the
plain files above; React and the template runtime were dropped entirely.

The original bundle is preserved in git history at commit `161435c`.
