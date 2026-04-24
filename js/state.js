'use strict';

// ── SECURITY HELPERS ──
export function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

export function isSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && (u.hostname.endsWith('coingecko.com') || u.hostname.endsWith('gecko.com'))) return escHtml(url);
  } catch {}
  return '';
}

export function csvCell(val) {
  const s = String(val == null ? '' : val);
  const safe = s.replace(/^[=+\-@\t\r]/, "'$&");
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) return '"' + safe.replace(/"/g, '""') + '"';
  return safe;
}

// ── FETCH WITH RETRY ──
export async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      if (r.status === 429 && i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs * (i + 1)));
        continue;
      }
      throw new Error(`HTTP ${r.status}`);
    } catch(e) {
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delayMs * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// ── CONFIG ──
export const CFG = {
  WORKER_BASE: 'https://antag-api.srikanthbluemoon.workers.dev',
  OHLC_DAYS: 14,           // Rolling window
  RT_INTERVAL: 30000,      // 30s real-time price engine
  SYNC_INTERVAL: 60000,    // 1 min CoinGecko refresh
  OHLC_SYNC_INTERVAL: 300000, // 5 min OHLC sync
  MCAP_MIN: 20e6,
  DB_NAME: 'antag',
  DB_VERSION: 2,
  EXCHANGES: {
    BTC: ['Binance','Bybit','OKX','Gate.io'],
    ETH: ['Binance','Bybit','OKX','Gate.io'],
    SOL: ['Binance','Bybit','OKX','Gate.io'],
    BNB: ['Binance','Gate.io'],
    XRP: ['Binance','Bybit','OKX','Gate.io'],
    ADA: ['Binance','Bybit','OKX'],
    AVAX: ['Binance','Bybit','OKX','Gate.io'],
    DOT: ['Binance','Bybit','OKX'],
    LINK: ['Binance','Bybit','OKX','Gate.io'],
    UNI: ['Binance','Bybit','OKX'],
    AAVE: ['Binance','Bybit','OKX'],
    DOGE: ['Binance','Bybit','OKX','Gate.io'],
    SHIB: ['Binance','Bybit','Gate.io'],
    MATIC: ['Binance','Bybit','OKX'],
    LTC: ['Binance','Bybit','OKX','Gate.io'],
    ARB: ['Bybit','OKX','Gate.io'],
    OP: ['Bybit','OKX','Gate.io'],
    INJ: ['Binance','Bybit','OKX'],
    SUI: ['Bybit','OKX','Gate.io'],
    APT: ['Binance','Bybit','OKX'],
    TIA: ['Bybit','OKX','Gate.io'],
    SEI: ['Bybit','OKX','Gate.io'],
    WLD: ['Bybit','OKX'],
    FET: ['Binance','Bybit','OKX'],
    RENDER: ['Bybit','OKX','Gate.io'],
    JUP: ['Bybit','OKX','Gate.io'],
    W: ['Binance','Bybit','OKX'],
    ENA: ['Binance','Bybit','OKX'],
    PENDLE: ['Binance','Bybit','OKX'],
    BONK: ['Bybit','OKX','Gate.io'],
  },
  CHAIN: {
    BTC:'Bitcoin',ETH:'Ethereum',SOL:'Solana',BNB:'BNB Chain',XRP:'XRP',
    ADA:'Cardano',AVAX:'Avalanche',DOT:'Polkadot',LINK:'Ethereum',UNI:'Ethereum',
    AAVE:'Ethereum',DOGE:'Dogecoin',SHIB:'Ethereum',MATIC:'Polygon',LTC:'Litecoin',
    ARB:'Arbitrum',OP:'Optimism',INJ:'Injective',SUI:'Sui',APT:'Aptos',
    TIA:'Celestia',SEI:'Sei',WLD:'Optimism',FET:'Ethereum',RENDER:'Ethereum',
    JUP:'Solana',W:'Wormhole',ENA:'Ethereum',PENDLE:'Ethereum',BONK:'Solana',
  },
  SECTOR: {
    BTC:'L1',ETH:'L1',SOL:'L1',BNB:'L1',XRP:'L1',ADA:'L1',AVAX:'L1',DOT:'L1',
    LINK:'DeFi',UNI:'DeFi',AAVE:'DeFi',DOGE:'Meme',SHIB:'Meme',MATIC:'L2',
    LTC:'L1',ARB:'L2',OP:'L2',INJ:'DeFi',SUI:'L1',APT:'L1',TIA:'L1',SEI:'L1',
    WLD:'AI',FET:'AI',RENDER:'AI',JUP:'DeFi',W:'Infra',ENA:'DeFi',PENDLE:'DeFi',BONK:'Meme',
  },
};

// ── STATE ──
export const STATE = {
  coins: [],
  filtered: [],
  launchData: { alpha:[], launchpad:[], launchpool:[], megadrop:[] },
  sortKey: 'mcap',
  sortDir: -1,
  selectedExch: 'all',
  selectedLaunch: 'all',
  pipeStage: 'all',
  lSort: 'mcap',
  lSortDir: -1,
  htf: '24h',
  hsize: 'mcap',
  db: null,
  bootedAt: 0,
  marketLoaded: false,
  launchLoaded: false,
  launchBinanceOnly: false,
  page: 1,
  pageSize: 50,
  exchangeListings: {},
  syncing: false,
  lastSync: null,
  alerts: {
    config: null,
    lastFired: {},
    history: [],
    knownLaunchIds: new Set(),
    sending: false,
  },
};

// ── FORMATTING ──
export const F = {
  mcap: n => {
    if (!n) return '—';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
    return '$' + (n/1e3).toFixed(0) + 'K';
  },
  vol: n => {
    if (!n) return '—';
    if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    return (n/1e3).toFixed(0) + 'K';
  },
  price: n => {
    if (!n) return '—';
    if (n >= 1000) return '$' + n.toLocaleString(undefined, {maximumFractionDigits:0});
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(6);
  },
  pct: v => {
    if (v === null || v === undefined) return '<span class="pnu">—</span>';
    const cls = v > 0.3 ? 'pup' : v < -0.3 ? 'pdn' : 'pnu';
    return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
  },
  date: ts => ts ? new Date(ts).toLocaleDateString() : '—',
  age: ts => {
    if (!ts) return '—';
    const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
    return d + 'd ago';
  },
};
