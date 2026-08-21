# Strategy Map 2027

Interactive corporate strategy map (Office of the CEO), published at
**https://ethanso13.github.io/Strat-Map/**

Four perspective bands — Finance, Business, Internal Business Process, Learning and
Growth — each holding objectives and measures for the previous and current fiscal year.

The previous year (2026) is **hidden by default**; use the *Show 2026* button to bring
it back for side-by-side comparison. The toggle is view-only and is not persisted.

## Layout

The desktop design is a fixed 1440px canvas whose containers carry inline styles, so
the responsive rules override them with `!important`. Two breakpoints:

- **≤ 1180px** — the fixed width relaxes to fill the viewport.
- **≤ 880px** — the two year lanes stack vertically, band labels rotate from vertical
  to horizontal and sit above their cards, the 46px label gutter collapses, the
  toolbar wraps into full-width 40px touch targets, and objectives go one per row.

Verified with no horizontal overflow at 375px, 768px, and 1440px; the 1440px layout is
unchanged from the original design.

## How data is stored

The map state lives in a single Supabase row and is shared by everyone who opens the page.

| | |
|---|---|
| Project | `megawide-strategy-map` (`bshdkeuvovulcixupwys`) |
| Table | `public.strategy_map` |
| Row | `id = 'default'` |
| Payload | `years jsonb` — mirrors the app's `{ prev: [...], curr: [...] }` state |

`localStorage` (`megawide-strategy-map-v2`) is kept as an offline cache: the page paints
from it immediately on load, then reconciles against Supabase, which is the source of
truth. If the network is unavailable the map still works and the Save button reports
*"Offline — saved locally."* Edits are debounced ~700 ms before being written.

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

**Anyone who finds the URL can read and overwrite this strategy map.** There is no
edit history, so an overwrite is not recoverable from the app.

To lock it down later, either tighten the policies to `authenticated` and add Supabase
Auth, or drop the `UPDATE`/`INSERT` policies to make the page read-only.

## Editing the page

`index.html` is a self-contained design-canvas bundle. The app document is stored as a
JSON-encoded string on line 382, inside `<script type="__bundler/template">`, with
fonts and images base64-embedded on line 370. To change the app logic, decode that
string, edit it, then re-encode it — escaping the slash in every `</` as `/` so
the payload cannot terminate the enclosing `<script>` tag.
