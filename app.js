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

/* ==========================================================================
   Supabase — one row (id = 'default') holds the whole map
   ========================================================================== */

const SB_URL = 'https://bshdkeuvovulcixupwys.supabase.co';
const SB_KEY = 'sb_publishable_-5B1hTP7hwIWW_5QkZ_Gvg_qtDXpsir';
const SB_REST = SB_URL + '/rest/v1/strategy_map';
const SB_ROW = 'default';

const sbHeaders = extra => Object.assign({
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json'
}, extra || {});

function cloudLoad() {
  return fetch(SB_REST + '?id=eq.' + SB_ROW + '&select=years', { headers: sbHeaders() })
    .then(r => { if (!r.ok) throw new Error('load ' + r.status); return r.json(); })
    .then(rows => {
      if (!rows.length) return null;
      const y = rows[0].years;
      // the seeded row starts as {} — treat that as "nothing stored yet"
      return (y && Array.isArray(y.prev) && Array.isArray(y.curr)) ? y : null;
    });
}

function cloudSave(years) {
  return fetch(SB_REST + '?on_conflict=id', {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: SB_ROW, years: years, updated_at: new Date().toISOString() })
  }).then(r => { if (!r.ok) throw new Error('save ' + r.status); });
}

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  years: emptyYears(),
  showPrev: false,     // 2026 starts hidden; the toggle is view-only
  syncState: 'idle',   // idle | loading | saving | synced | offline
  justSaved: false
};

/* Eye / eye-off for the 2026 toggle. Static markup, no user data. */
const ICON_EYE =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path>' +
  '<circle cx="12" cy="12" r="3"></circle></svg>';

const ICON_EYE_OFF =
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"></path>' +
  '<path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 4.24-1.02"></path>' +
  '<path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"></path>' +
  '<line x1="2" y1="2" x2="22" y2="22"></line></svg>';

let cloudTimer = null;
let savedTimer = null;

function cacheLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.years)); } catch (e) {}
}

/* Write locally at once, push to the cloud on a debounce so a burst of
   keystrokes becomes a single request. */
function persist() {
  cacheLocal();
  setSync('saving');
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    cloudSave(state.years)
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

function render() {
  bandsEl.replaceChildren(...DEFAULT_BANDS.map((band, bi) => renderBand(band, bi)));
  paintToolbar();
}

function renderBand(band, bi) {
  const laneKeys = state.showPrev ? ['prev', 'curr'] : ['curr'];
  return h('section', { class: 'sm-bandrow' },
    h('div', { class: 'sm-band' },
      h('div', { class: 'sm-bandlabel' },
        h('h2', { class: 'sm-bandname' }, band.name)),
      h('div', { class: 'sm-lanes' }, laneKeys.map(key => renderLane(key, bi)))
    )
  );
}

function renderLane(key, bi) {
  const isPrev = key === 'prev';
  const cells = state.years[key][bi] || [];
  const canCopyAll = isPrev && cells.length > 0;

  return h('div', { class: 'sm-lane' },
    h('div', { class: 'sm-lane-col' },
      h('div', { class: 'sm-lane-head' },
        h('span', { class: 'sm-lane-label' },
          isPrev ? PREV_YEAR + ' — previous' : CURR_YEAR + ' — current'),
        canCopyAll && h('button', {
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
    ),
    isPrev && h('div', { class: 'sm-lane-sep' })
  );
}

function renderCard(cell, key, bi, ci) {
  return h('article', { class: 'sm-card' },
    h('div', { class: 'sm-card-head' },
      h('textarea', {
        class: 'sm-in sm-title-in', rows: 2, placeholder: 'Objective',
        value: cell.title,
        oninput: e => {
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

    cell.items.length > 0 && h('div', { class: 'sm-measures' },
      h('div', { class: 'sm-measures-label' }, 'Measure'),
      cell.items.map((item, ii) => h('div', { class: 'sm-measure' },
        h('textarea', {
          class: 'sm-in', rows: 1, placeholder: 'Measure',
          value: item.text,
          oninput: e => {
            const v = e.target.value;
            mutate(y => { y[key][bi][ci].items[ii].text = v; }, false);
          }
        }),
        h('button', {
          type: 'button', class: 'sm-x sm-x--sm sm-noprint',
          'aria-label': 'Delete measure', title: 'Delete measure',
          onclick: () => mutate(y => { y[key][bi][ci].items.splice(ii, 1); })
        }, '×')
      ))
    ),

    h('div', { class: 'sm-card-actions sm-noprint' },
      h('button', {
        type: 'button', class: 'sm-linkbtn sm-linkbtn--quiet',
        onclick: () => mutate(y => { y[key][bi][ci].items.push({ text: '', target: '' }); })
      }, '+ Measure'),
      key === 'prev' && h('button', {
        type: 'button', class: 'sm-linkbtn', title: 'Copy this objective forward',
        onclick: () => mutate(y => { y.curr[bi].push(clone(y.prev[bi][ci])); })
      }, 'Copy to ' + CURR_YEAR + ' →')
    )
  );
}

/* Toolbar labels repaint on their own so a sync-state change mid-typing
   never triggers a full re-render (which would drop the caret). */
function paintToolbar() {
  const eye = byId('btn-toggle-prev');
  const eyeLabel = (state.showPrev ? 'Hide ' : 'Show ') + PREV_YEAR;
  eye.innerHTML = state.showPrev ? ICON_EYE_OFF : ICON_EYE;
  eye.setAttribute('aria-label', eyeLabel);
  eye.setAttribute('title', eyeLabel);

  byId('btn-save').textContent =
    (state.syncState === 'saving' || state.syncState === 'loading') ? 'Syncing…' :
    state.syncState === 'offline' ? 'Offline — saved locally' :
    state.justSaved ? 'Saved to cloud ✓' : 'Save';
}

/* ==========================================================================
   Toolbar
   ========================================================================== */

byId('btn-toggle-prev').addEventListener('click', () => {
  state.showPrev = !state.showPrev;
  render();
});

byId('btn-reset').addEventListener('click', () => {
  if (!window.confirm('Reset the map to the starting template? Your entries will be lost.')) return;
  state.years = emptyYears();
  persist();
  render();
});

// Save flushes past the debounce and writes immediately.
byId('btn-save').addEventListener('click', () => {
  cacheLocal();
  clearTimeout(cloudTimer);
  setSync('saving');
  cloudSave(state.years).then(() => {
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
      state.years = JSON.parse(saved);
    } else {
      const v1 = localStorage.getItem('megawide-strategy-map-v1');
      if (v1) {
        const bands = JSON.parse(v1);
        state.years = { prev: bands.map(b => b.cells || []), curr: bands.map(() => []) };
      }
    }
  } catch (e) {}
  render();

  // 2. Reconcile against the cloud, which is the source of truth.
  setSync('loading');
  cloudLoad().then(years => {
    if (years) {
      state.years = years;
      cacheLocal();
      render();
      setSync('synced');
    } else {
      // Nothing stored remotely yet — seed it from whatever we have locally.
      return cloudSave(state.years).then(() => setSync('synced'));
    }
  }).catch(() => setSync('offline'));
})();
