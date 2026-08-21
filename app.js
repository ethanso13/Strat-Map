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

/* Strategic business units. Each one is its own row, keyed by this code, and
   holds its own FY2026 and FY2027 maps. */
const SBUS = ['CORP', 'MCC', 'PCS', 'PTX', 'C2W', 'PH1'];
const DEFAULT_SBU = 'CORP';
const SBU_KEY = 'megawide-strategy-map-sbu';

/* The four perspective bands, top to bottom. */
const BANDS = ['Finance', 'Business', 'Internal Business Process', 'Learning and Growth'];

const clone = v => JSON.parse(JSON.stringify(v));

/* A map with the four bands present but no objectives in them. Used for an
   SBU that has nothing stored yet, and by Reset. */
const blankYears = () => ({ prev: BANDS.map(() => []), curr: BANDS.map(() => []) });

/* Coerce anything that came out of storage into a well-formed years object.
   Everything persisted is untrusted: a cache written by an older version, a
   half-written value, or a hand-edited row must never be able to throw during
   render. It used to, and because that happened before the cloud load, the
   page could not repair itself on reload. */
function normalizeYears(raw) {
  const lane = v => {
    const arr = Array.isArray(v) ? v : [];
    return BANDS.map((_, i) => {
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

const LEGACY_ROW = 'default';  // pre-SBU row: CORP inherits from it once, then it is left alone

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
function cloudLoad(sbu) {
  return cloudGet(sbu).then(y => {
    if (populated(y)) return { years: normalizeYears(y), migrated: false };
    // Only CORP inherits the old shared row — the other SBUs start empty
    // rather than picking up CORP's objectives. The old row is left
    // untouched so it stays available as a backup.
    if (sbu !== DEFAULT_SBU) return null;
    return cloudGet(LEGACY_ROW).then(legacy =>
      populated(legacy) ? { years: normalizeYears(legacy), migrated: true } : null);
  });
}

/* Replace only `yearKey` on `sbu`, keeping whatever the server holds for the
   other year. */
function cloudSaveYear(sbu, yearKey, lane) {
  return cloudGet(sbu).then(remote => {
    const merged = normalizeYears(populated(remote) ? remote : {});
    merged[yearKey] = clone(lane);
    return cloudPut(sbu, merged);
  });
}

/* ==========================================================================
   State
   ========================================================================== */

const state = {
  sbu: DEFAULT_SBU,    // which SBU's map is on screen
  year: 'curr',        // year on screen: 'prev' (FY2026) | 'curr' (FY2027)
  years: blankYears(),
  syncState: 'idle',   // idle | loading | saving | synced | offline
  justSaved: false
};

const YEAR_OF = { prev: PREV_YEAR, curr: CURR_YEAR };

let cloudTimer = null;
let savedTimer = null;
let pendingWrite = null;   // queued scoped write, kept so it can be flushed early

const cacheKey = sbu => STORE_KEY + ':' + sbu;

function cacheLocal() {
  try { localStorage.setItem(cacheKey(state.sbu), JSON.stringify(state.years)); } catch (e) {}
}

function readCache(sbu) {
  try {
    let raw = localStorage.getItem(cacheKey(sbu));
    // the pre-SBU cache held CORP's map under the bare key
    if (!raw && sbu === DEFAULT_SBU) raw = localStorage.getItem(STORE_KEY);
    return raw ? normalizeYears(JSON.parse(raw)) : null;
  } catch (e) { return null; }
}

function schedule(fn) {
  pendingWrite = fn;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(runPending, 700);
}

/* Run a queued write now. Called by the debounce, and by anything that would
   otherwise strand it — switching SBU, or pressing Save. */
function runPending() {
  clearTimeout(cloudTimer);
  const fn = pendingWrite;
  pendingWrite = null;
  if (!fn) return Promise.resolve();
  return fn().then(() => setSync('synced')).catch(() => setSync('offline'));
}

/* Write locally at once, push to the cloud on a debounce so a burst of
   keystrokes becomes a single request.

   SBU, year and the lane are captured when the write is scheduled. The lane
   is held by reference, so later edits to the same map still ride along, but
   switching SBU replaces state.years wholesale — which leaves a queued write
   still pointing at the map it was actually made against. */
function persist() {
  const sbu = state.sbu;
  const yearKey = state.year;
  const lane = state.years[yearKey];
  cacheLocal();
  setSync('saving');
  schedule(() => cloudSaveYear(sbu, yearKey, lane));
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
  bandsEl.replaceChildren(...BANDS.map((name, bi) => renderBand(name, bi)));
  bandsEl.querySelectorAll('textarea').forEach(autogrow);
  paintMeta();
  paintToolbar();
}

function renderBand(name, bi) {
  return h('section', { class: 'sm-bandrow' },
    h('div', { class: 'sm-band' },
      h('div', { class: 'sm-bandlabel' },
        h('h2', { class: 'sm-bandname' }, name)),
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
        onclick: () => {
          const name = (cell.title || '').trim();
          const n = cell.items.length;
          confirmAction({
            title: 'Delete objective?',
            body: (name ? '“' + name + '”' : 'This untitled objective')
                + (n ? ' and its ' + n + ' initiative' + (n === 1 ? '' : 's') : '')
                + ' will be removed from FY' + YEAR_OF[key] + '. This cannot be undone.',
            confirmLabel: 'Delete'
          }).then(ok => {
            if (ok) mutate(y => { y[key][bi].splice(ci, 1); });
          });
        }
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
   rather than sitting on a hard-coded year. The tab title carries the SBU too,
   so several SBUs open at once stay tellable apart. */
function paintMeta() {
  const year = YEAR_OF[state.year];
  byId('sbu').value = state.sbu;
  byId('year').value = state.year;
  byId('page-title').textContent = 'Strategy Map ' + year;
  document.title = state.sbu + ' Strategy Map ' + year + ' — Megawide';
}

function paintToolbar() {
  byId('btn-save').textContent =
    (state.syncState === 'saving' || state.syncState === 'loading') ? 'Syncing…' :
    state.syncState === 'offline' ? 'Offline — saved locally' :
    state.justSaved ? 'Saved to cloud ✓' : 'Save';
}

/* ==========================================================================
   Confirmation modal
   ========================================================================== */

/* Resolves true only when the confirm button is pressed; Cancel, Esc and a
   backdrop click all resolve false. Uses the platform <dialog>, so focus
   trapping and Esc handling are not reimplemented here. */
function confirmAction(opts) {
  return new Promise(resolve => {
    const dlg = byId('confirm');
    const ok = byId('confirm-ok');
    const cancel = byId('confirm-cancel');

    byId('confirm-title').textContent = opts.title;
    byId('confirm-body').textContent = opts.body;
    ok.textContent = opts.confirmLabel;

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      dlg.removeEventListener('click', onBackdrop);
      dlg.removeEventListener('keydown', onKeydown);
      if (dlg.open) dlg.close();
      resolve(value);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onClose() { finish(false); }
    // The dialog itself carries no padding and its content lives in
    // .sm-dialog-inner, so a click whose target is the dialog is a click
    // that landed on the backdrop.
    function onBackdrop(e) { if (e.target === dlg) finish(false); }
    // Esc is normally dismissed by the UA, which fires `cancel` then `close`.
    // Handling it directly too means dismissal does not depend on that: some
    // embedded webviews deliver the keydown without running the UA behaviour.
    // finish() is idempotent, so both routes firing is harmless.
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('click', onBackdrop);
    dlg.addEventListener('keydown', onKeydown);

    dlg.showModal();
    cancel.focus();   // never make the destructive button the default
  });
}

/* ==========================================================================
   Toolbar
   ========================================================================== */

// Options come from SBUS so the markup cannot drift from the storage keys.
byId('sbu').replaceChildren(...SBUS.map(code => h('option', { value: code }, code)));

// Switching SBU loads a different row. Flush anything queued first, so an
// edit to the SBU being left behind is not stranded by the debounce.
byId('sbu').addEventListener('change', e => {
  const next = SBUS.indexOf(e.target.value) >= 0 ? e.target.value : DEFAULT_SBU;
  if (next === state.sbu) return;
  runPending();
  state.sbu = next;
  try { localStorage.setItem(SBU_KEY, next); } catch (err) {}
  loadSbu();
});

// Switching year is a view change only — nothing is written.
byId('year').addEventListener('change', e => {
  state.year = e.target.value === 'prev' ? 'prev' : 'curr';
  render();
});

byId('btn-reset').addEventListener('click', () => {
  const year = YEAR_OF[state.year];
  confirmAction({
    title: 'Reset ' + state.sbu + ' FY' + year + '?',
    body: 'Every objective and initiative in ' + state.sbu + ' FY' + year
        + ' will be cleared. The other year and the other SBUs are not affected. '
        + 'This cannot be undone.',
    confirmLabel: 'Reset'
  }).then(ok => {
    if (!ok) return;
    // Scoped to the selected year to match what Save writes. Clearing both
    // years would only persist half of it and leave the page out of step
    // with the stored row.
    state.years[state.year] = blankYears()[state.year];
    persist();
    render();
  });
});

// Save flushes past the debounce and writes immediately — still only the
// year and SBU currently selected.
byId('btn-save').addEventListener('click', () => {
  const sbu = state.sbu;
  const yearKey = state.year;
  const lane = state.years[yearKey];
  cacheLocal();
  pendingWrite = null;
  clearTimeout(cloudTimer);
  setSync('saving');
  cloudSaveYear(sbu, yearKey, lane).then(() => {
    state.justSaved = true;
    setSync('synced');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { state.justSaved = false; paintToolbar(); }, 1800);
  }).catch(() => setSync('offline'));
});

/* ==========================================================================
   Boot
   ========================================================================== */

/* Show the selected SBU: paint its cached copy at once so the map never
   flashes empty, then reconcile against its row. */
function loadSbu() {
  const sbu = state.sbu;

  state.years = readCache(sbu) || blankYears();
  // Never let a bad cache stop the load below, which is what repairs it.
  try { render(); } catch (e) { console.error('render failed', e); }

  setSync('loading');
  cloudLoad(sbu).then(res => {
    if (state.sbu !== sbu) return;   // switched again while this was in flight
    if (res) {
      state.years = res.years;
      cacheLocal();
      render();
      setSync('synced');
      // Finish the one-time move onto the SBU-keyed row.
      return res.migrated ? cloudPut(sbu, state.years) : null;
    }
    // No row for this SBU yet. Show it blank and leave the row uncreated —
    // it appears on the first edit, so browsing SBUs writes nothing.
    state.years = blankYears();
    cacheLocal();
    render();
    setSync('synced');
  }).catch(() => { if (state.sbu === sbu) setSync('offline'); });
}

(function init() {
  try {
    const saved = localStorage.getItem(SBU_KEY);
    if (SBUS.indexOf(saved) >= 0) state.sbu = saved;
  } catch (e) {}
  loadSbu();
})();
