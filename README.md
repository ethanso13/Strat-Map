# Strategy Map 2027

Interactive corporate strategy map (Office of the CEO), published at
**https://ethanso13.github.io/Strat-Map/**

Four perspective bands — Finance, Business, Internal Business Process, Learning and
Growth — each holding objectives and measures for the previous and current fiscal year.

The previous year (2026) is **hidden by default**; use the *Show 2026* button to bring
it back for side-by-side comparison. That toggle is view-only and is not persisted.

## Files

Plain static files. No build step, no framework, no dependencies — open `index.html`
and it runs.

| File | What's in it |
|---|---|
| `index.html` | Page shell: masthead, toolbar, footer. Bands are rendered by `app.js` into `#bands`. |
| `styles.css` | Design tokens, layout, responsive rules, print rules. |
| `app.js` | State, Supabase sync, rendering, toolbar wiring. |
| `assets/` | Archivo font subsets (3 × woff2) and the Megawide logo. |

Edit any of them directly and push — GitHub Pages redeploys automatically.

## How data is stored

The map state lives in a single Supabase row and is shared by everyone who opens the page.

| | |
|---|---|
| Project | `megawide-strategy-map` (`bshdkeuvovulcixupwys`) |
| Table | `public.strategy_map` |
| Row | `id = 'default'` |
| Payload | `years jsonb` |

The `years` payload mirrors the app's state exactly:

```
years = { prev: Band[], curr: Band[] }
Band  = Cell[]                          // one entry per perspective band
Cell  = { title: string, items: Item[] }
Item  = { text: string, target: string }
```

`localStorage` (`megawide-strategy-map-v2`) is an offline cache: the page paints from it
immediately, then reconciles against Supabase, which is the source of truth. With no
network the map still works and the Save button reads *"Offline — saved locally."*
Edits are debounced ~700 ms; the Save button flushes immediately.

Text edits deliberately do **not** trigger a re-render, so the caret stays put while
typing. Only structural changes (add, delete, copy, toggle, reset) re-render.

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
- **≤ 880px** — the year lanes stack, band labels rotate from vertical to horizontal
  and sit above their cards, the 46px label gutter collapses, the toolbar wraps into
  full-width 40px touch targets, and objectives go one per row.

Verified with no horizontal overflow at 375px, 768px, and 1440px.

## History

This page began as a single 353KB Claude Design canvas export — one `index.html` with
the app JSON-encoded onto a single line, plus React, a proprietary template runtime
(`sc-for` / `{{ }}` / `DCLogic`), and base64 fonts inlined. It was unpacked into the
plain files above; React and the template runtime were dropped entirely.

The original bundle is preserved in git history at commit `161435c`.
