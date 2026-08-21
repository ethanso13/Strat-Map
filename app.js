/* ============================================================================
   Strategy Map — plain vanilla JS. No framework, no build step.

   State mirrors the Supabase `years` jsonb column exactly:

     years = { prev: Band[], curr: Band[] }
     Band  = Cell[]                        // one entry per perspective band
     Cell  = { title: string, items: Item[] }
     Item  = { text: string, target: string }

   `target` is loaded, copied and saved but never rendered — the original
   design has no field for it. Existing values (NIAT = "1.2 Billion") are
   carried through rather than silently dropped.
   ========================================================================== */

'use strict';

const PREV_YEAR = '2026';
const CURR_YEAR = '2027';
const STORE_KEY = 'megawide-strategy-map-v2';

/* The four perspective bands. Only `name` drives the layout; `cells` is the
   starting template used on first run and by Reset. */
const DEFAULT_BANDS = [
  { name: 'Finance', cells: [
    { title: 'Net Income', items: [
      { text: 'NIAT', target: '1.2 Billion' },
      { text: 'Book Value', target: '' },
      { text: 'Share Price', target: '' }
    ] }
  ] },
  { name: 'Business', cells: [
    { title: 'Capital Structure Management', items: [] }
  ] },
  { name: 'Internal Business Process', cells: [
    { title: 'Engagement Plan', items: [] },
    { title: 'Communications Plan', items: [] },
    { title: 'Digitalization', items: [] },
    { title: 'Policies and Procedures', items: [] }
  ] },
  { name: 'Learning and Growth', cells: [
    { title: 'Org Development', items: [] },
    { title: 'Leadership and Talent Development', items: [] },
    { title: 'Culture Development', items: [] },
    { title: 'Learning Curriculum', items: [] },
    { title: 'Cadetship Program', items: [] }
  ] }
];

const clone = v => JSON.parse(JSON.stringify(v));
const emptyYears = () => ({
  prev: DEFAULT_BANDS.map(b => clone(b.cells)),
  curr: DEFAULT_BANDS.map(() => [])
});

/* Coerce anything that came out of storage into a well-formed years object.
   Everything persisted is untrusted: a cache written by an older version, a
   half-written value, or a hand-edited row must never be able to throw during
   render. It used to, and because that happened before the cloud load, the
   page could not repair itself on reload. */
function normalizeYears(raw) {
  const lane = v => {
    const arr = Array.isArray(v) ? v : [];
    return DEFAULT_BANDS.map((_, i) => {
      const cells = Array.isArray(arr[i]) ? arr[i] : [];
      return cells
        .filter(c => c && typeof c === 'object')
        .map(c => ({
          title: typeof c.title === 'string' ? c.title : '',
          items: (Array.isArray(c.items) ? c.items : [])
            .filter(it => it && typeof it === 'object')
            .map(it => ({
              text: typeof it.text === 'string' ? it.text : '',
              target: typeof it.target === 'string' ? it.target : ''
            }))
        }));
    });
  };
  const o = (raw && typeof raw === 'object') ? raw : {};
  return { prev: lane(o.prev), curr: lane(o.curr) };
}

/* ==========================================================================
   Supabase — one row per SBU, keyed by its code, holding both years.

   Writes are scoped to the SBU and year on screen: the row is re-read and
   only the selected year's lane is replaced. Writing the whole object back
   would let someone editing FY2027 overwrite FY2026 with whatever stale
   copy their browser happened to be holding.
   ========================================================================== */

const SB_URL = 'https://bshdkeuvovulcixupwys.supabase.co';
const SB_KEY = 'sb_publishable_-5B1hTP7hwIWW_5QkZ_Gvg_qtDXpsir';
const SB_REST = SB_URL + '/rest/v1/strategy_map';

const SBU = 'CORP';            // the row this page reads and writes
const LEGACY_ROW = 'default';  // pre-SBU row: migrated from once, then left alone

const sbHeaders = extra => Object.assign({
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json'
}, extra || {});

// a freshly seeded row starts as {} — that is "nothing stored yet", not data
const populated = y => !!y && Array.isArray(y.prev) && Array.isArray(y.curr);

function cloudGet(id) {
  return fetch(SB_REST + '?id=eq.' + encodeURIComponent(id) + '&select=years', { headers: sbHeaders() })
    .then(r => { if (!r.ok) throw new Error('load ' + r.status); return r.json(); })
    .then(rows => (rows.length ? rows[0].years : null));
}

function cloudPut(id, years) {
  return fetch(SB_REST + '?on_conflict=id', {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: id, years: years, updated_at: new Date().toISOString() })
  }).then(r => { if (!r.ok) throw new Error('save ' + r.status); });
}

/* { years, migrated } — or null when nothing is stored for this SBU yet. */
function cloudLoad() {
  return cloudGet(SBU).then(y => {
    if (populated(y)) return { years: normalizeYears(y), migrated: false };
    // first run on the SBU-keyed row: adopt the old shared row's contents.
    // The old row is left untouched so it stays available as a backup.
    return cloudGet(LEGACY_ROW).then(legacy =>
      populated(legacy) ? { years: normalizeYears(legacy), migrated: true } : null);
  });
}

/* Replace only `yearKey`, keeping whatever the server holds for the other. */
function cloudSaveYear(yearKey, lane) {
  return cloudGet(SBU).then(remote => {
    const merged = normalizeYears(populated(remote) ? remote : {});
    merged[yearKey] = clone(lane);
    return cloudPut(SBU, merged);
  });
}

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  years: emptyYears(),
  year: 'curr',        // year on screen: 'prev' (FY2026) | 'curr' (FY2027)
  syncState: 'idle',   // idle | loading | saving | synced | offline
  justSaved: false
};

const YEAR_OF = { prev: PREV_YEAR, curr: CURR_YEAR };

let cloudTimer = null;
let savedTimer = null;

function cacheLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.years)); } catch (e) {}
}

/* Write locally at once, push to the cloud on a debounce so a burst of
   keystrokes becomes a single request. The year is captured when the write
   is scheduled, so switching year mid-debounce still saves the lane that
   was actually edited. */
function persist() {
  cacheLocal();
  setSync('saving');
  clearTimeout(cloudTimer);
  const yearKey = state.year;
  cloudTimer = setTimeout(() => {
    cloudSaveYear(yearKey, state.years[yearKey])
      .then(() => setSync('synced'))
      .catch(() => setSync('offline'));
  }, 700);
}

function setSync(s) {
  state.syncState = s;
  paintToolbar();
}

/* Structural edits re-render; text edits pass rerender=false so the caret
   stays put while typing. */
function mutate(fn, rerender) {
  fn(state.years);
  persist();
  if (rerender !== false) render();
}

/* ==========================================================================
   DOM helper — text goes through text nodes and .value, so map content can
   never be interpreted as markup.
   ========================================================================== */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const key in (props || {})) {
    const v = props[key];
    if (v == null || v === false) continue;
    if (key === 'class') el.className = v;
    else if (key === 'value' || key === 'readOnly') el[key] = v;
    else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), v);
    else el.setAttribute(key, v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

/* ==========================================================================
   Render
   ========================================================================== */

const bandsEl = document.getElementById('bands');
const byId = id => document.getElementById(id);

/* Size a textarea to its content. Replaces CSS field-sizing:content, which
   Chrome supports and Safari/iOS does not — there a long initiative would be
   clipped by overflow:hidden rather than wrapping onto a second line.
   Must run after the node is in the document, or scrollHeight reads 0. */
function autogrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function render() {
  bandsEl.replaceChildren(...DEFAULT_BANDS.map((band, bi) => renderBand(band, bi)));
  bandsEl.querySelectorAll('textarea').forEach(autogrow);
  paintMeta();
  paintToolbar();
}

function renderBand(band, bi) {
  return h('section', { class: 'sm-bandrow' },
    h('div', { class: 'sm-band' },
      h('div', { class: 'sm-bandlabel' },
        h('h2', { class: 'sm-bandname' }, band.name)),
      h('div', { class: 'sm-lanes' }, renderLane(state.year, bi))
    )
  );
}

function renderLane(key, bi) {
  const cells = (state.years[key] || [])[bi] || [];
  // Only 2026 can be copied forward, and only when it has something in it.
  const canCopyAll = key === 'prev' && cells.length > 0;

  return h('div', { class: 'sm-lane' },
    h('div', { class: 'sm-lane-col' },
      // The head exists purely to hold the copy-forward action, so it is
      // omitted entirely rather than leaving an empty strip above the cards.
      canCopyAll && h('div', { class: 'sm-lane-head' },
        h('button', {
          type: 'button', class: 'sm-linkbtn sm-noprint',
          onclick: () => mutate(y => { y.prev[bi].forEach(c => y.curr[bi].push(clone(c))); })
        }, 'Copy all to ' + CURR_YEAR + ' →')
      ),
      h('div', { class: 'sm-cards' },
        cells.map((cell, ci) => renderCard(cell, key, bi, ci)),
        h('button', {
          type: 'button', class: 'sm-addslot sm-noprint',
          onclick: () => mutate(y => { y[key][bi].push({ title: '', items: [] }); })
        }, '+ Add objective')
      )
    )
  );
}

function renderCard(cell, key, bi, ci) {
  return h('article', { class: 'sm-card' },
    h('div', { class: 'sm-card-head' },
      h('textarea', {
        class: 'sm-in sm-title-in', rows: 1, placeholder: 'Objective',
        value: cell.title,
        oninput: e => {
          autogrow(e.target);
          const v = e.target.value;
          mutate(y => { y[key][bi][ci].title = v; }, false);
        }
      }),
      h('button', {
        type: 'button', class: 'sm-x sm-noprint',
        'aria-label': 'Delete objective', title: 'Delete objective',
        onclick: () => mutate(y => { y[key][bi].splice(ci, 1); })
      }, '×')
    ),

    cell.items.length > 0 && h('div', { class: 'sm-initiatives' },
      h('div', { class: 'sm-initiatives-label' }, 'Initiative'),
      cell.items.map((item, ii) => h('div', { class: 'sm-initiative' },
        h('textarea', {
          class: 'sm-in', rows: 1, placeholder: 'Initiative',
          value: item.text,
          oninput: e => {
            autogrow(e.target);
            const v = e.target.value;
            mutate(y => { y[key][bi][ci].items[ii].text = v; }, false);
          }
        }),
        h('button', {
          type: 'button', class: 'sm-x sm-x--sm sm-noprint',
          'aria-label': 'Delete initiative', title: 'Delete initiative',
          onclick: () => mutate(y => { y[key][bi][ci].items.splice(ii, 1); })
        }, '×')
      ))
    ),

    h('div', { class: 'sm-card-actions sm-noprint' },
      h('button', {
        type: 'button', class: 'sm-linkbtn sm-linkbtn--quiet',
        onclick: () => mutate(y => { y[key][bi][ci].items.push({ text: '', target: '' }); })
      }, '+ Initiative'),
      key === 'prev' && h('button', {
        type: 'button', class: 'sm-linkbtn', title: 'Copy this objective forward',
        onclick: () => mutate(y => { y.curr[bi].push(clone(y.prev[bi][ci])); })
      }, 'Copy to ' + CURR_YEAR + ' →')
    )
  );
}

/* Toolbar labels repaint on their own so a sync-state change mid-typing
   never triggers a full re-render (which would drop the caret). */
/* The Year dropdown is the switcher, so the heading and tab title follow it
   rather than sitting on a hard-coded year. SBU is written from the constant
   so the markup and the row key cannot drift apart. */
function paintMeta() {
  const year = YEAR_OF[state.year];
  byId('sbu').textContent = SBU;
  byId('year').value = state.year;
  byId('page-title').textContent = 'Strategy Map ' + year;
  document.title = 'Strategy Map ' + year + ' — Megawide';
}

function paintToolbar() {
  byId('btn-save').textContent =
    (state.syncState === 'saving' || state.syncState === 'loading') ? 'Syncing…' :
    state.syncState === 'offline' ? 'Offline — saved locally' :
    state.justSaved ? 'Saved to cloud ✓' : 'Save';
}

/* ==========================================================================
   Toolbar
   ========================================================================== */

// Switching year is a view change only — nothing is written.
byId('year').addEventListener('change', e => {
  state.year = e.target.value === 'prev' ? 'prev' : 'curr';
  render();
});

byId('btn-reset').addEventListener('click', () => {
  const year = YEAR_OF[state.year];
  if (!window.confirm('Reset FY' + year + ' to the starting template? Entries for FY' + year + ' will be lost.')) return;
  // Scoped to the selected year to match what Save writes. Clearing both
  // years would only persist half of it and leave the page out of step
  // with the stored row.
  state.years[state.year] = emptyYears()[state.year];
  persist();
  render();
});

// Save flushes past the debounce and writes immediately — still only the
// year and SBU currently selected.
byId('btn-save').addEventListener('click', () => {
  cacheLocal();
  clearTimeout(cloudTimer);
  setSync('saving');
  const yearKey = state.year;
  cloudSaveYear(yearKey, state.years[yearKey]).then(() => {
    state.justSaved = true;
    setSync('synced');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { state.justSaved = false; paintToolbar(); }, 1800);
  }).catch(() => setSync('offline'));
});

/* ==========================================================================
   Boot
   ========================================================================== */

(function init() {
  // 1. Paint from the local cache immediately so the map never flashes empty.
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      state.years = normalizeYears(JSON.parse(saved));
    } else {
      const v1 = localStorage.getItem('megawide-strategy-map-v1');
      if (v1) {
        const bands = JSON.parse(v1);
        state.years = normalizeYears({ prev: (bands || []).map(b => b && b.cells), curr: [] });
      }
    }
  } catch (e) {
    state.years = emptyYears();
  }

  // Never let the local paint stop step 2 — the cloud is what repairs a bad cache.
  try { render(); } catch (e) { console.error('initial render failed', e); }

  // 2. Reconcile against the cloud, which is the source of truth.
  setSync('loading');
  cloudLoad().then(res => {
    if (res) {
      state.years = res.years;
      cacheLocal();
      render();
      setSync('synced');
      // Finish the one-time move onto the SBU-keyed row.
      return res.migrated ? cloudPut(SBU, state.years) : null;
    }
    // Nothing stored for this SBU yet — seed it from whatever we have locally.
    return cloudPut(SBU, state.years).then(() => setSync('synced'));
  }).catch(() => setSync('offline'));
})();
