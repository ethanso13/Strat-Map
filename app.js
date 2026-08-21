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
  year: 'curr',        // horizon on screen: 'prev' (2026) | 'curr' (2027)
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
  paintHorizon();
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
  const cells = state.years[key][bi] || [];
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

    cell.items.length > 0 && h('div', { class: 'sm-initiatives' },
      h('div', { class: 'sm-initiatives-label' }, 'Initiative'),
      cell.items.map((item, ii) => h('div', { class: 'sm-initiative' },
        h('textarea', {
          class: 'sm-in', rows: 1, placeholder: 'Initiative',
          value: item.text,
          oninput: e => {
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
/* The Horizon dropdown is the year switcher, so the heading and tab title
   follow it rather than sitting on a hard-coded year. */
function paintHorizon() {
  const year = YEAR_OF[state.year];
  byId('horizon').value = state.year;
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

// Switching horizon is a view change only — nothing is written.
byId('horizon').addEventListener('change', e => {
  state.year = e.target.value === 'prev' ? 'prev' : 'curr';
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
