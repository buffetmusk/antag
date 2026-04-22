'use strict';

import { STATE, CFG, F, escHtml, fetchWithRetry } from './state.js';
import { setTickerPct } from './render.js';

// ── PRICE ENGINE ──
// Fetches 1-minute klines from Binance, computes real 5m/15m/1h/4h deltas.
// Single source of truth for short-timeframe price changes across all panels.
export const PriceEngine = {
  cache: {},        // symbol -> { p5m, p15m, p1h, p4h, price, ts }
  noBinance: new Set(),  // symbols confirmed not on Binance
  queue: [],
  running: false,
  BATCH_DELAY: 80,  // ms between requests (Binance allows 1200 req/min)
  STALE_MS: 25000,  // consider stale after 25s

  isFresh(sym) {
    const entry = this.cache[sym];
    return entry && (Date.now() - entry.ts) < this.STALE_MS;
  },

  get(sym) {
    return this.cache[sym] || null;
  },

  computeDeltas(candles) {
    if (!candles || candles.length < 2) return null;
    const now = candles[candles.length - 1];
    const currentPrice = now.c;
    const findPriceAtMinutesAgo = (mins) => {
      const target = now.t - mins * 60 * 1000;
      let closest = candles[0];
      for (const c of candles) {
        if (c.t <= target) closest = c;
        else break;
      }
      return closest.o;
    };
    const pct = (cur, prev) => prev ? ((cur - prev) / prev) * 100 : 0;
    return {
      price: currentPrice,
      p5m:  pct(currentPrice, findPriceAtMinutesAgo(5)),
      p15m: pct(currentPrice, findPriceAtMinutesAgo(15)),
      p1h:  pct(currentPrice, findPriceAtMinutesAgo(60)),
      p4h:  candles.length >= 240 ? pct(currentPrice, findPriceAtMinutesAgo(240)) : null,
      ts: Date.now(),
    };
  },

  async fetchOne(sym) {
    if (this.noBinance.has(sym)) return null;
    const pair = sym.replace('/','') + 'USDT';
    try {
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1m&limit=241`
      );
      if (!r.ok) {
        if (r.status === 400) this.noBinance.add(sym);
        return null;
      }
      const raw = await r.json();
      if (!Array.isArray(raw) || raw.length < 2) return null;
      const candles = raw.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      const deltas = this.computeDeltas(candles);
      if (deltas) this.cache[sym] = deltas;
      return deltas;
    } catch {
      return null;
    }
  },

  async refreshSymbols(symbols) {
    const toFetch = symbols.filter(s => !this.isFresh(s));
    if (!toFetch.length) return;
    for (const sym of toFetch) {
      await this.fetchOne(sym);
      await new Promise(r => setTimeout(r, this.BATCH_DELAY));
    }
  },

  applyToScreener() {
    STATE.coins.forEach(c => {
      const d = this.cache[c.sym];
      if (d) {
        c.p5m = d.p5m;
        c.p15m = d.p15m;
        c.p1h = d.p1h;
        if (d.p4h !== null) c.p4h = d.p4h;
      }
    });
  },

  applyToLaunch() {
    Object.values(STATE.launchData).flat().forEach(c => {
      const sym = (c.symbol || '').toUpperCase();
      const d = this.cache[sym];
      if (d) {
        c._p5m = d.p5m;
        c._p15m = d.p15m;
        c._p1h = d.p1h;
        c._onBinance = true;
      } else if (this.noBinance.has(sym)) {
        c._onBinance = false;
      }
    });
  },

  collectAllSymbols() {
    const syms = new Set();
    STATE.coins.forEach(c => syms.add(c.sym));
    Object.values(STATE.launchData).flat().forEach(c => {
      if (c.symbol) syms.add(c.symbol.toUpperCase());
    });
    return [...syms];
  },

  async refreshAll() {
    const all = this.collectAllSymbols();
    // Prioritize: visible screener tokens first, then launch tokens
    const screenerSyms = STATE.filtered.slice(0, 30).map(c => c.sym);
    const launchSyms = all.filter(s => !screenerSyms.includes(s));
    const ordered = [...screenerSyms, ...launchSyms];

    await this.refreshSymbols(ordered);
    this.applyToScreener();
    this.applyToLaunch();
  },
};

// ── INDEXEDDB ──
export async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CFG.DB_NAME, CFG.DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('ohlc')) {
        const store = db.createObjectStore('ohlc', { keyPath: 'key' });
        store.createIndex('symbol', 'symbol', { unique: false });
        store.createIndex('ts', 'ts', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { STATE.db = e.target.result; resolve(e.target.result); };
    req.onerror = e => reject(e);
  });
}

async function storeCandles(symbol, exchange, tf, candles) {
  if (!STATE.db || !candles.length) return;
  const cutoff = Date.now() - CFG.OHLC_DAYS * 24 * 60 * 60 * 1000;
  const tx = STATE.db.transaction('ohlc', 'readwrite');
  const store = tx.objectStore('ohlc');
  for (const c of candles) {
    if (c.t < cutoff) continue; // evict old
    store.put({ key: `${symbol}_${exchange}_${tf}_${c.t}`, symbol, exchange, tf, ts: c.t, o:c.o, h:c.h, l:c.l, c:c.c, v:c.v });
  }
  // Evict candles older than 14 days
  const idx = store.index('ts');
  const range = IDBKeyRange.upperBound(cutoff);
  idx.openCursor(range).onsuccess = e => {
    const cursor = e.target.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };
  return new Promise(r => { tx.oncomplete = r; });
}

export async function getOHLCCandles(symbol, exchange, tf) {
  if (!STATE.db) return [];
  const prefix = `${symbol}_${exchange}_${tf}_`;
  const cutoff = Date.now() - CFG.OHLC_DAYS * 24 * 60 * 60 * 1000;
  return new Promise(resolve => {
    const tx = STATE.db.transaction('ohlc', 'readonly');
    const store = tx.objectStore('ohlc');
    const results = [];
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    store.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.ts >= cutoff) results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results.sort((a,b) => a.ts - b.ts));
      }
    };
  });
}

export function storeOHLCCandles(symbol, exchange, tf, candles) {
  return storeCandles(symbol, exchange, tf, candles);
}

export async function getAllCacheStats() {
  if (!STATE.db) return [];
  return new Promise(resolve => {
    const tx = STATE.db.transaction('ohlc', 'readonly');
    const store = tx.objectStore('ohlc');
    const stats = {};
    store.openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const { symbol, exchange, tf, ts } = cursor.value;
        const k = `${symbol}_${exchange}_${tf}`;
        if (!stats[k]) stats[k] = { symbol, exchange, tf, count:0, minTs:ts, maxTs:ts };
        stats[k].count++;
        if (ts < stats[k].minTs) stats[k].minTs = ts;
        if (ts > stats[k].maxTs) stats[k].maxTs = ts;
        cursor.continue();
      } else {
        resolve(Object.values(stats));
      }
    };
  });
}

// ── API CALLS ──
// Note: These functions return data but do NOT call render functions directly.
// main.js is responsible for calling render functions after awaiting these fetches.

export async function fetchGlobal() {
  try {
    const r = await fetchWithRetry('https://api.coingecko.com/api/v3/global');
    const d = await r.json();
    const g = d.data;
    setSyncStatus('live');
    setTicker('t-dom', (g.market_cap_percentage?.btc || 0).toFixed(1) + '%');
    setTicker('t-mcap', F.mcap(g.total_market_cap?.usd));
  } catch(e) {}
}

export async function fetchFearGreed() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const d = await r.json();
    const val = d.data[0];
    const el = document.getElementById('t-fg');
    el.textContent = val.value + ' / ' + val.value_classification;
    const v = parseInt(val.value);
    el.className = 'ticker-price ' + (v >= 60 ? 'ticker-up' : v <= 40 ? 'ticker-dn' : '');
  } catch(e) {}
}

export async function fetchMarketData() {
  setSyncStatus('syncing');
  const knownSyms = Object.keys(CFG.EXCHANGES);
  try {
    const r = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d`
    );
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error('invalid response');

    STATE.coins = data
      .filter(c => c && typeof c.symbol === 'string' && typeof c.name === 'string' && typeof c.current_price === 'number')
      .filter(c => c.market_cap >= CFG.MCAP_MIN && knownSyms.includes(c.symbol.toUpperCase()))
      .map(c => {
        const sym = c.symbol.toUpperCase();
        const spark7d = c.sparkline_in_7d?.price || [];
        const p1h = c.price_change_percentage_1h_in_currency || 0;
        const existing = STATE.coins.find(x => x.sym === sym);
        const cached = PriceEngine.get(sym);
        return {
          id: c.id, sym, name: c.name,
          price: c.current_price,
          mcap: c.market_cap || 0,
          vol: c.total_volume || 0,
          p5m:  cached ? cached.p5m  : (existing ? existing.p5m : null),
          p15m: cached ? cached.p15m : (existing ? existing.p15m : null),
          p1h:  cached ? cached.p1h  : p1h,
          p4h:  cached ? cached.p4h  : (existing ? existing.p4h : null),
          p24h: c.price_change_percentage_24h || 0,
          p7d: c.price_change_percentage_7d_in_currency || 0,
          p30d: c.price_change_percentage_30d_in_currency || 0,
          funding: existing ? existing.funding : 0,
          oiChange: existing ? existing.oiChange : 0,
          volRatio: c.total_volume && c.market_cap ? (c.total_volume / c.market_cap * 10) : 0,
          chain: CFG.CHAIN[sym] || 'Ethereum',
          sector: CFG.SECTOR[sym] || 'Other',
          image: c.image,
          ath: c.ath, atl: c.atl,
          atl_date: c.atl_date,
          spark: spark7d,
          launchStage: null,
        };
      });

    // Update tickers
    const btc = STATE.coins.find(c => c.sym === 'BTC');
    const eth = STATE.coins.find(c => c.sym === 'ETH');
    const sol = STATE.coins.find(c => c.sym === 'SOL');
    const bnb = STATE.coins.find(c => c.sym === 'BNB');
    if (btc) setTickerPct('t-btc', btc.price, btc.p24h);
    if (eth) setTickerPct('t-eth', eth.price, eth.p24h);
    if (sol) setTickerPct('t-sol', sol.price, sol.p24h);
    if (bnb) setTickerPct('t-bnb', bnb.price, bnb.p24h);

    if (STATE.coins.length) STATE.marketLoaded = true;
    STATE.lastSync = new Date();
    document.getElementById('ss-sync').textContent = STATE.lastSync.toLocaleTimeString();
    document.getElementById('ss-count').textContent = STATE.coins.length;
    const gainers = STATE.coins.filter(c => c.p24h > 0).length;
    const losers = STATE.coins.filter(c => c.p24h < 0).length;
    document.getElementById('ss-gainers').textContent = gainers;
    document.getElementById('ss-losers').textContent = losers;

    setSyncStatus('live');
    // NOTE: main.js calls applyFilters() and renderHeatmap() after this returns

  } catch(e) {
    setSyncStatus('error');
    console.warn('Market fetch failed:', e.message);
  }
}

export async function fetchLaunchData() {
  const cats = [
    ['alpha', 'binance-alpha-spotlight'],
    ['launchpad', 'binance-launchpad'],
    ['launchpool', 'binance-launchpool'],
    ['megadrop', 'binance-megadrop'],
  ];

  const results = await Promise.allSettled(cats.map(async ([key, catId]) => {
    const r = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${catId}&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d`
    );
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error('invalid response');
    return [key, data.filter(c => c && typeof c.symbol === 'string' && typeof c.name === 'string')];
  }));

  results.forEach(r => {
    if (r.status === 'fulfilled') {
      const [key, data] = r.value;
      STATE.launchData[key] = data.map(c => {
        const sym = (c.symbol || '').toUpperCase();
        const cached = PriceEngine.get(sym);
        const p1h = c.price_change_percentage_1h_in_currency || 0;
        const onBinance = cached ? true : (PriceEngine.noBinance.has(sym) ? false : null);
        return {
          ...c,
          _stage: key,
          _spark: c.sparkline_in_7d?.price || [],
          _p5m:  cached ? cached.p5m  : null,
          _p15m: cached ? cached.p15m : null,
          _p1h:  cached ? cached.p1h  : p1h,
          _onBinance: onBinance,
          _fromAth: c.ath ? ((c.current_price - c.ath) / c.ath * 100) : null,
          _roi: c.atl ? ((c.current_price - c.atl) / (c.atl || 1) * 100) : null,
          _daysSince: c.atl_date ? Math.floor((Date.now() - new Date(c.atl_date).getTime()) / 86400000) : null,
        };
      });
    }
  });

  // Update pipeline counts + mcap
  const stageInfo = (key) => {
    const d = STATE.launchData[key];
    return {
      count: d.length,
      mcap: d.reduce((s, c) => s + (c.market_cap || 0), 0),
    };
  };

  ['alpha','launchpad','launchpool','megadrop'].forEach(k => {
    const info = stageInfo(k);
    const shortKey = { alpha:'alpha', launchpad:'lp', launchpool:'lpol', megadrop:'mega' }[k];
    const el = document.getElementById(`pp-${shortKey}`);
    const mel = document.getElementById(`pm-${shortKey}`);
    if (el) el.textContent = info.count;
    if (mel) mel.textContent = 'mcap ' + F.mcap(info.mcap);
  });

  const total = Object.values(STATE.launchData).reduce((s,a) => s + a.length, 0);
  if (total) STATE.launchLoaded = true;
  const totalMcap = Object.values(STATE.launchData).reduce((s,a) => s + a.reduce((ss,c) => ss + (c.market_cap||0), 0), 0);
  const allEl = document.getElementById('pp-all');
  const allMel = document.getElementById('pm-all');
  if (allEl) allEl.textContent = total;
  if (allMel) allMel.textContent = 'total mcap ' + F.mcap(totalMcap);

  document.getElementById('nb-launch').textContent = total;

  // Tag launch coins in screener
  const allLaunch = {};
  Object.entries(STATE.launchData).forEach(([stage, coins]) => {
    coins.forEach(c => { allLaunch[c.symbol?.toUpperCase()] = stage; });
  });
  STATE.coins.forEach(c => { c.launchStage = allLaunch[c.sym] || null; });

  // NOTE: main.js calls renderLaunchTable() after this returns
}

// ── OHLC FETCH (Binance public REST) ──
export async function fetchOHLC(symbol, tf) {
  const binanceTf = { '5m':'5m', '15m':'15m', '1h':'1h', '4h':'4h' }[tf] || '15m';
  const limit = { '5m': 4032, '15m': 1344, '1h': 336, '4h': 84 }[tf] || 1344; // 14 days
  try {
    const sym = symbol.replace('/','') + 'USDT';
    const r = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${binanceTf}&limit=${limit}`
    );
    if (!r.ok) throw new Error('binance failed');
    const raw = await r.json();
    const candles = raw.map(k => ({ t:k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5] }));
    await storeCandles(symbol, 'Binance', tf, candles);
    return candles;
  } catch(e) {
    return [];
  }
}

export async function syncOHLCForVisible() {
  const tfs = ['5m','15m','1h'];
  const syms = STATE.filtered.slice(0, 20).map(c => c.sym); // top 20 visible
  for (const sym of syms) {
    for (const tf of tfs) {
      await fetchOHLC(sym, tf);
      await new Promise(r => setTimeout(r, 200)); // rate limit courtesy
    }
  }
  // NOTE: main.js calls updateOHLCCachePanel() and updateCacheStatusBar() after this returns
}

// ── DOM HELPERS (used by fetch functions above) ──
function setSyncStatus(status) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'error' ? ' error' : '');
  label.textContent = status.toUpperCase();
}

function setTicker(id, text, cls) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; if (cls) el.className = 'ticker-price ' + cls; }
}

export async function updateCacheStatusBar() {
  const stats = await getAllCacheStats();
  const totalCandles = stats.reduce((s, r) => s + r.count, 0);
  document.getElementById('cache-size').textContent = totalCandles.toLocaleString() + ' candles';
}

export async function updateOHLCCachePanel() {
  const stats = await getAllCacheStats();
  document.getElementById('nb-ohlc').textContent = stats.length;

  let totalCandles = 0;
  stats.forEach(s => { totalCandles += s.count; });
  document.getElementById('total-candles').textContent = totalCandles.toLocaleString();
  document.getElementById('total-kb').textContent = (totalCandles * 0.05).toFixed(1) + ' KB est.';
  document.getElementById('ss-ohlcdays').textContent = CFG.OHLC_DAYS + 'd';

  const tbody = document.getElementById('ohlc-body');
  if (!stats.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9">NO OHLC DATA CACHED YET — SYNC TO POPULATE</td></tr>';
    return;
  }

  tbody.innerHTML = stats.map(s => {
    const spanDays = ((s.maxTs - s.minTs) / 86400000).toFixed(1);
    const isOld = (Date.now() - s.maxTs) > 600000; // > 10 min
    return `<tr>
      <td><div class="coin-names"><div class="coin-sym">${escHtml(s.symbol)}</div></div></td>
      <td style="color:var(--text1)">${escHtml(s.exchange)}</td>
      <td><span class="tag tag-chain">${escHtml(s.tf.toUpperCase())}</span></td>
      <td style="color:var(--acid)">${s.count.toLocaleString()}</td>
      <td style="font-size:10px;color:var(--text2)">${new Date(s.minTs).toLocaleString()}</td>
      <td style="font-size:10px;color:var(--text1)">${new Date(s.maxTs).toLocaleString()}</td>
      <td style="color:var(--acid)">${spanDays}d</td>
      <td style="color:var(--text2)">${(s.count * 0.05).toFixed(1)} KB</td>
      <td><span class="tag ${isOld ? 'tag-new' : 'tag-alpha'}">${isOld ? 'STALE' : 'FRESH'}</span></td>
    </tr>`;
  }).join('');
}
