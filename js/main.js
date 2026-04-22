'use strict';

import { STATE, CFG, csvCell } from './state.js';
import {
  initDB, fetchGlobal, fetchFearGreed, fetchMarketData, fetchLaunchData,
  fetchExchangeListings, syncOHLCForVisible, PriceEngine,
  getAllCacheStats, updateCacheStatusBar, updateOHLCCachePanel,
} from './api.js';
import { applyFilters, renderHeatmap, renderLaunchTable, renderScreener } from './render.js';

// ── THEME ──
function toggleTheme() {
  const body = document.body;
  const next = body.dataset.theme === 'dark' ? 'light' : 'dark';
  body.dataset.theme = next;
  localStorage.setItem('antag-theme', next);
}

(function restoreTheme() {
  const saved = localStorage.getItem('antag-theme');
  if (saved === 'light' || saved === 'dark') document.body.dataset.theme = saved;
})();

// ── BOOT OVERLAY ──
const BOOT_STEPS = ['bs-db','bs-exch','bs-market','bs-global','bs-sentiment','bs-launch','bs-rt','bs-ohlc'];
let bootDone = 0;

function bootStep(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active','done');
  el.classList.add(status);
  if (status === 'done') {
    bootDone++;
    const pct = Math.round((bootDone / BOOT_STEPS.length) * 100);
    const bar = document.getElementById('boot-progress');
    if (bar) bar.style.width = pct + '%';
    if (bootDone >= BOOT_STEPS.length) {
      setTimeout(() => {
        document.getElementById('boot-overlay').classList.add('done');
      }, 400);
    }
  }
}

// ── REAL-TIME REFRESH LOOP ──
// Runs every 30s: fetches fresh 1m klines from Binance for visible tokens,
// patches both screener and launch data in-place, re-renders without flicker.
async function realTimeRefresh() {
  try {
    await PriceEngine.refreshAll();
    PriceEngine.applyToScreener();
    PriceEngine.applyToLaunch();
    applyFilters();
    renderLaunchTable();
  } catch(e) {
    console.warn('RT refresh:', e.message);
  }
}

function showWarmupBanner() {
  const banner = document.getElementById('warmup-banner');
  const timer = document.getElementById('warmup-timer');
  if (!banner) return;
  setTimeout(() => banner.classList.add('visible'), 300);
  const iv = setInterval(() => {
    if (STATE.marketLoaded && STATE.launchLoaded) {
      banner.classList.add('hidden');
      clearInterval(iv);
      return;
    }
    const elapsed = Math.round((Date.now() - STATE.bootedAt) / 1000);
    if (elapsed > 180) {
      banner.classList.add('hidden');
      clearInterval(iv);
      return;
    }
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, '0');
    if (timer) timer.textContent = `${m}:${s}`;
  }, 1000);
}

// ── UI CONTROLS ──
function switchTab(el) {
  const name = el.dataset.tab;
  document.querySelectorAll('.navtab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'ohlc') updateOHLCCachePanel();
}

function colSort(key) {
  if (STATE.sortKey === key) STATE.sortDir *= -1; else { STATE.sortKey = key; STATE.sortDir = -1; }
  applyFilters();
}

function toggleExch(el) {
  document.querySelectorAll('[data-exch]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  STATE.selectedExch = el.dataset.exch;
  applyFilters();
}

function toggleLaunch(el) {
  document.querySelectorAll('[data-launch]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  STATE.selectedLaunch = el.dataset.launch;
  STATE.pipeStage = el.dataset.launch;
  document.querySelectorAll('.pipe-stage').forEach(s => s.classList.remove('active'));
  const matching = document.querySelector(`.pipe-stage[data-stage="${el.dataset.launch}"]`);
  if (matching) matching.classList.add('active');
  applyFilters();
  renderLaunchTable();
}

function setPipeStage(el) {
  document.querySelectorAll('.pipe-stage').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  STATE.pipeStage = el.dataset.stage;
  STATE.selectedLaunch = el.dataset.stage;
  document.querySelectorAll('[data-launch]').forEach(c => c.classList.remove('on'));
  const matching = document.querySelector(`[data-launch="${el.dataset.stage}"]`);
  if (matching) matching.classList.add('on');
  applyFilters();
  renderLaunchTable();
}

function toggleBinanceOnly(checked) {
  STATE.launchBinanceOnly = checked;
  renderLaunchTable();
}

function launchColSort(key) {
  if (STATE.lSort === key) STATE.lSortDir *= -1; else { STATE.lSort = key; STATE.lSortDir = -1; }
  renderLaunchTable();
}

function setHtf(el) {
  document.querySelectorAll('[data-htf]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  STATE.htf = el.dataset.htf;
  renderHeatmap();
}

function setHsize(el) {
  document.querySelectorAll('[data-hsize]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  STATE.hsize = el.dataset.hsize;
  renderHeatmap();
}

async function triggerSync() {
  setSyncStatus('syncing');
  await fetchMarketData();
  applyFilters();
  renderHeatmap();
  await fetchGlobal();
  await fetchFearGreed();
  await fetchLaunchData();
  renderLaunchTable();
  await syncOHLCForVisible();
  await updateOHLCCachePanel();
  await updateCacheStatusBar();
  setSyncStatus('live');
}

async function clearOHLCCache() {
  if (!STATE.db) return;
  const tx = STATE.db.transaction('ohlc', 'readwrite');
  tx.objectStore('ohlc').clear();
  await new Promise(r => { tx.oncomplete = r; });
  updateOHLCCachePanel();
  updateCacheStatusBar();
}

function showStorageModal() {
  document.getElementById('storage-modal').classList.add('open');
  getAllCacheStats().then(stats => {
    const total = stats.reduce((s, r) => s + r.count, 0);
    const mc = document.getElementById('modal-content');
    mc.innerHTML = `
      <div class="modal-row"><span class="modal-key">Total candles</span><span class="modal-val" style="color:var(--acid)">${total.toLocaleString()}</span></div>
      <div class="modal-row"><span class="modal-key">Unique pairs tracked</span><span class="modal-val">${stats.length}</span></div>
      <div class="modal-row"><span class="modal-key">Rolling window</span><span class="modal-val">${CFG.OHLC_DAYS} days</span></div>
      <div class="modal-row"><span class="modal-key">Storage engine</span><span class="modal-val">IndexedDB (browser)</span></div>
      <div class="modal-row"><span class="modal-key">Estimated size</span><span class="modal-val">${(total * 0.05).toFixed(1)} KB</span></div>
      <div class="modal-row"><span class="modal-key">Eviction policy</span><span class="modal-val">Auto on Day ${CFG.OHLC_DAYS + 1}</span></div>
      <div class="modal-row"><span class="modal-key">Computing cost</span><span class="modal-val" style="color:var(--acid)">$0.00 / server-side</span></div>
    `;
  });
}

function closeStorageModal() {
  document.getElementById('storage-modal').classList.remove('open');
}

function exportCSV() {
  const rows = [['Symbol','Name','Chain','Sector','Price','MCap','Vol24h','P5m','P15m','P1h','P4h','Funding','OI_Change']];
  STATE.filtered.forEach(c => {
    rows.push([c.sym, c.name, c.chain, c.sector, c.price, c.mcap, c.vol,
      (c.p5m ?? 0).toFixed(2), (c.p15m ?? 0).toFixed(2), (c.p1h ?? 0).toFixed(2), (c.p4h ?? 0).toFixed(2),
      c.funding.toFixed(4), c.oiChange.toFixed(2)]);
  });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = `antag_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── DOM HELPER (used locally in triggerSync) ──
function setSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'error' ? ' error' : '');
  label.textContent = status.toUpperCase();
}

// ── PAGINATION ──
function prevPage() {
  if (STATE.page > 1) { STATE.page--; renderScreener(); }
}
function nextPage() {
  const totalPages = Math.ceil(STATE.filtered.length / STATE.pageSize) || 1;
  if (STATE.page < totalPages) { STATE.page++; renderScreener(); }
}

// ── KEYBOARD SEARCH ──
function initKeyboardSearch() {
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const search = document.getElementById('s-search');
    if (!search) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); return; }
    if (e.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); return; }
    if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
      search.focus();
    }
  });
}

// ── EXPOSE TO HTML onclick ATTRIBUTES ──
window.switchTab = switchTab;
window.colSort = colSort;
window.toggleExch = toggleExch;
window.toggleLaunch = toggleLaunch;
window.setPipeStage = setPipeStage;
window.toggleBinanceOnly = toggleBinanceOnly;
window.launchColSort = launchColSort;
window.setHtf = setHtf;
window.setHsize = setHsize;
window.triggerSync = triggerSync;
window.clearOHLCCache = clearOHLCCache;
window.showStorageModal = showStorageModal;
window.closeStorageModal = closeStorageModal;
window.exportCSV = exportCSV;
window.toggleTheme = toggleTheme;
window.applyFilters = applyFilters;
window.prevPage = prevPage;
window.nextPage = nextPage;

// ── BOOT ──
async function boot() {
  bootStep('bs-db', 'active');
  await initDB();
  await updateCacheStatusBar();
  bootStep('bs-db', 'done');

  bootStep('bs-exch', 'active');
  await fetchExchangeListings();
  bootStep('bs-exch', 'done');

  bootStep('bs-market', 'active');
  await fetchMarketData();
  applyFilters();
  renderHeatmap();
  bootStep('bs-market', 'done');

  bootStep('bs-global', 'active');
  await fetchGlobal();
  bootStep('bs-global', 'done');

  bootStep('bs-sentiment', 'active');
  await fetchFearGreed();
  bootStep('bs-sentiment', 'done');

  bootStep('bs-launch', 'active');
  await fetchLaunchData();
  renderLaunchTable();
  bootStep('bs-launch', 'done');

  bootStep('bs-rt', 'active');
  await PriceEngine.refreshAll();
  PriceEngine.applyToScreener();
  PriceEngine.applyToLaunch();
  applyFilters();
  renderLaunchTable();
  bootStep('bs-rt', 'done');

  bootStep('bs-ohlc', 'active');
  await syncOHLCForVisible();
  await updateOHLCCachePanel();
  await updateCacheStatusBar();
  bootStep('bs-ohlc', 'done');

  STATE.bootedAt = Date.now();
  showWarmupBanner();
  initKeyboardSearch();

  // Auto-refresh layers:
  // Layer 1: Real-time price engine — every 30s, Binance 1m klines
  setInterval(realTimeRefresh, 30000);
  // Layer 2: CoinGecko market data — every 60s (mcap, vol, sparklines, 24h/7d/30d)
  setInterval(async () => { await fetchMarketData(); applyFilters(); renderHeatmap(); }, CFG.SYNC_INTERVAL);
  // Layer 3: Launch intel — every 120s
  setInterval(async () => { await fetchLaunchData(); renderLaunchTable(); }, CFG.SYNC_INTERVAL * 2);
  // Layer 4: OHLC cache — every 5 min
  setInterval(async () => { await syncOHLCForVisible(); await updateOHLCCachePanel(); await updateCacheStatusBar(); }, CFG.OHLC_SYNC_INTERVAL);
  // Layer 5: Global indices — every 60s
  setInterval(fetchGlobal, CFG.SYNC_INTERVAL);
}

boot();
