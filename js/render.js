'use strict';

import { STATE, CFG, F, escHtml, isSafeImageUrl } from './state.js';

// ── RENDERING ──
export function setTickerPct(id, price, pct) {
  if (typeof price !== 'number' || !isFinite(price)) return;
  if (typeof pct !== 'number' || !isFinite(pct)) return;
  const el = document.getElementById(id);
  if (!el) return;
  const pStr = price >= 1000 ? '$' + price.toLocaleString(undefined, {maximumFractionDigits:0})
             : price >= 1 ? '$' + price.toFixed(2) : '$' + price.toFixed(4);
  const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  el.textContent = pStr + ' ';
  const span = document.createElement('span');
  span.className = pct >= 0 ? 'ticker-up' : 'ticker-dn';
  span.textContent = pctStr;
  el.appendChild(span);
}

export function pctCell(v) { return F.pct(v); }

export function exchangeBadges(sym) {
  const exchs = CFG.EXCHANGES[sym] || ['Binance'];
  const map = { Binance:'eb-bnb', Bybit:'eb-byb', OKX:'eb-okx', 'Gate.io':'eb-gte' };
  const short = { Binance:'BNB', Bybit:'BYB', OKX:'OKX', 'Gate.io':'GATE' };
  return `<div class="exch-row">${exchs.map(e =>
    `<span class="ebadge ${map[e]||'eb-okx'}">${short[e]||e}</span>`
  ).join('')}</div>`;
}

function launchTag(stage) {
  if (!stage) return '';
  const map = { alpha:'tag-alpha', launchpad:'tag-launchpad', launchpool:'tag-launchpool', megadrop:'tag-megadrop' };
  const label = { alpha:'ALPHA', launchpad:'PAD', launchpool:'POOL', megadrop:'MEGA' };
  return `<span class="tag ${map[stage]}">${label[stage]}</span>`;
}

export function drawSpark(canvas, prices, color) {
  if (!canvas || !prices || prices.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const mn = Math.min(...prices), mx = Math.max(...prices), range = mx - mn || 1;
  const pts = prices.map((p, i) => ({
    x: i / (prices.length - 1) * w,
    y: h - (p - mn) / range * h * 0.82 - h * 0.09,
  }));
  const c = color || (prices[prices.length-1] >= prices[0] ? '#00c851' : '#ff4444');
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
}

export function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  const coins = [...STATE.coins].sort((a, b) => b.mcap - a.mcap).slice(0, 60);
  if (!coins.length) return;

  const maxMcap = Math.max(...coins.map(c => c.mcap));
  const maxVol = Math.max(...coins.map(c => c.vol));

  const cells = coins.map(c => {
    const sizeRef = STATE.hsize === 'vol' ? c.vol / maxVol : c.mcap / maxMcap;
    const baseSize = 44 + sizeRef * 80;
    const pct = STATE.htf === '7d' ? c.p7d : STATE.htf === '30d' ? c.p30d : c.p24h;
    const intensity = Math.min(Math.abs(pct || 0) / 10, 1);
    const isPos = (pct || 0) >= 0;
    const bg = isPos
      ? `rgba(0,200,81,${0.08 + intensity * 0.35})`
      : `rgba(255,68,68,${0.08 + intensity * 0.35})`;
    const border = isPos
      ? `rgba(0,200,81,${0.2 + intensity * 0.5})`
      : `rgba(255,68,68,${0.2 + intensity * 0.5})`;
    const col = isPos ? '#00c851' : '#ff4444';
    const pctStr = pct !== null && pct !== undefined ? (pct > 0 ? '+' : '') + pct.toFixed(2) + '%' : '—';
    return `<div style="
      width:${baseSize}px; height:${baseSize}px;
      background:${bg};
      border:1px solid ${border};
      border-radius:3px;
      display:inline-flex; flex-direction:column;
      align-items:center; justify-content:center;
      margin:2px; cursor:pointer;
      transition:transform 0.15s;
      flex-shrink:0;
    " onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform=''">
      <div style="font-size:${Math.max(9,Math.min(13,baseSize/6))}px;font-weight:500;color:var(--text0);font-family:var(--mono)">${escHtml(c.sym)}</div>
      <div style="font-size:${Math.max(8,Math.min(11,baseSize/7))}px;color:${col};font-family:var(--mono)">${pctStr}</div>
    </div>`;
  });

  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;align-content:flex-start">${cells.join('')}</div>`;
}

export function applyFilters() {
  const search = document.getElementById('s-search').value.trim().toUpperCase();
  const minMcap = parseFloat(document.getElementById('s-mcap').value) * 1e6;
  const maxMcapRaw = document.getElementById('s-mcap-max').value;
  const maxMcap = maxMcapRaw ? parseFloat(maxMcapRaw) * 1e6 : Infinity;
  const chain = document.getElementById('s-chain').value;
  const sector = document.getElementById('s-sector').value;
  const fund = document.getElementById('s-fund').value;
  const volMin = parseFloat(document.getElementById('s-vol').value) || 0;

  STATE.filtered = STATE.coins.filter(c => {
    if (search && !c.sym.includes(search) && !c.name.toUpperCase().includes(search)) return false;
    if (c.mcap < minMcap) return false;
    if (c.mcap > maxMcap) return false;
    if (chain && c.chain !== chain) return false;
    if (sector && c.sector !== sector) return false;
    if (STATE.selectedExch !== 'all' && !(CFG.EXCHANGES[c.sym] || []).includes(STATE.selectedExch)) return false;
    if (STATE.selectedLaunch !== 'all' && c.launchStage !== STATE.selectedLaunch) return false;
    if (fund === 'positive' && c.funding <= 0) return false;
    if (fund === 'negative' && c.funding >= 0) return false;
    if (fund === 'extreme' && Math.abs(c.funding) <= 0.1) return false;
    if (volMin && c.volRatio < volMin) return false;
    return true;
  });

  sortFiltered();
  renderScreener();
  document.getElementById('showing-count').textContent = STATE.filtered.length;
  document.getElementById('total-count').textContent = STATE.coins.length;
  document.getElementById('nb-screener').textContent = STATE.filtered.length;
}


export function sortFiltered() {
  const key = STATE.sortKey, dir = STATE.sortDir;
  STATE.filtered.sort((a, b) => {
    let av, bv;
    if (key === 'name') return dir * a.sym.localeCompare(b.sym);
    if (key === 'price') { av = a.price; bv = b.price; }
    else if (key === 'mcap') { av = a.mcap; bv = b.mcap; }
    else if (key === 'vol') { av = a.vol; bv = b.vol; }
    else if (key === 'p5m') { av = a.p5m; bv = b.p5m; }
    else if (key === 'p15m') { av = a.p15m; bv = b.p15m; }
    else if (key === 'p1h') { av = a.p1h; bv = b.p1h; }
    else if (key === 'p4h') { av = a.p4h; bv = b.p4h; }
    else if (key === 'fund') { av = a.funding; bv = b.funding; }
    else if (key === 'oi') { av = a.oiChange; bv = b.oiChange; }
    else { av = a.mcap; bv = b.mcap; }
    return dir * (bv - av);
  });
}

export function renderScreener() {
  const tbody = document.getElementById('screener-body');
  if (!STATE.filtered.length) {
    if (!STATE.marketLoaded) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="13">
        <div class="empty-state-box">
          <div class="empty-icon">◌</div>
          <div class="empty-title">CONNECTING TO MARKET FEEDS<span class="empty-dots"></span></div>
          <div class="empty-desc">Fetching data from CoinGecko and Binance. This takes 1-2 minutes on first load — the platform is working.</div>
        </div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="13">
        <div class="empty-state-box">
          <div class="empty-title">NO COINS MATCH CURRENT FILTERS</div>
          <div class="empty-desc">Try adjusting market cap range, exchange, or search query.</div>
        </div></td></tr>`;
    }
    return;
  }

  tbody.innerHTML = STATE.filtered.map((c, i) => {
    const volW = Math.min(100, (c.volRatio / 4) * 100);
    const fCls = c.funding > 0.05 ? 'fund-pos' : c.funding < -0.05 ? 'fund-neg' : '';
    const hiCls = Math.abs(c.funding) > 0.1 ? 'fund-hi' : fCls;
    const oiCls = c.oiChange > 0 ? 'pup' : 'pdn';
    const canvasId = `sp_${escHtml(c.sym)}`;
    const imgSrc = isSafeImageUrl(c.image);
    return `<tr>
      <td class="c-coin">
        <div class="coin-cell">
          ${imgSrc ? `<img class="coin-img" src="${imgSrc}" onerror="this.style.display='none'">` : ''}
          <div class="coin-names">
            <div class="coin-sym">${escHtml(c.sym)} ${c.launchStage ? launchTag(c.launchStage) : ''}</div>
            <div class="coin-full">${escHtml(c.name)}</div>
          </div>
        </div>
      </td>
      <td><span class="tag tag-chain">${escHtml((c.chain||'—').replace(' Chain','').replace(' Ledger',''))}</span></td>
      <td style="font-size:11px;color:var(--text1)">${F.price(c.price)}</td>
      <td style="font-size:10px;color:var(--text1)">${F.mcap(c.mcap)}</td>
      <td>
        <div class="vol-cell">
          <div class="vol-num">${F.vol(c.vol)}</div>
          <div class="vol-bar"><div class="vol-fill" style="width:${volW}%"></div></div>
          ${c.volRatio >= 2 ? `<div class="vol-spike-label">${c.volRatio.toFixed(1)}x ↑</div>` : ''}
        </div>
      </td>
      <td>${pctCell(c.p5m)}</td>
      <td>${pctCell(c.p15m)}</td>
      <td>${pctCell(c.p1h)}</td>
      <td>${pctCell(c.p4h)}</td>
      <td><span class="${hiCls}">${c.funding >= 0 ? '+' : ''}${c.funding.toFixed(4)}%</span></td>
      <td><span class="${oiCls}">${c.oiChange > 0 ? '+' : ''}${c.oiChange.toFixed(1)}%</span></td>
      <td><canvas id="${canvasId}" class="spark" width="80" height="28"></canvas></td>
      <td>${exchangeBadges(c.sym)}</td>
    </tr>`;
  }).join('');

  requestAnimationFrame(() => {
    STATE.filtered.forEach(c => {
      const cvs = document.getElementById(`sp_${c.sym}`);
      if (cvs) drawSpark(cvs, c.spark);
    });
  });
}

export function renderLaunchTable() {
  const stage = STATE.pipeStage;
  let coins = [];
  if (stage === 'all') {
    coins = Object.values(STATE.launchData).flat();
    // deduplicate
    const seen = new Set();
    coins = coins.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
  } else {
    coins = STATE.launchData[stage] || [];
  }

  // Binance listing stats
  const notListed = coins.filter(c => c._onBinance === false).length;
  const countEl = document.getElementById('binance-count');
  if (countEl) countEl.textContent = notListed ? `${notListed} not on Binance` : '';

  if (STATE.launchBinanceOnly) {
    coins = coins.filter(c => c._onBinance === true);
  }

  // sort
  coins.sort((a, b) => {
    const dir = STATE.lSortDir;
    if (STATE.lSort === 'name') return dir * ((a.symbol||'').localeCompare(b.symbol||''));
    if (STATE.lSort === 'price') return dir * ((b.current_price||0) - (a.current_price||0));
    if (STATE.lSort === 'mcap') return dir * ((b.market_cap||0) - (a.market_cap||0));
    if (STATE.lSort === 'vol') return dir * ((b.total_volume||0) - (a.total_volume||0));
    if (STATE.lSort === 'p5m') return dir * ((b._p5m||0) - (a._p5m||0));
    if (STATE.lSort === 'p15m') return dir * ((b._p15m||0) - (a._p15m||0));
    if (STATE.lSort === 'p1h') return dir * ((b._p1h||0) - (a._p1h||0));
    if (STATE.lSort === 'pct24h') return dir * ((b.price_change_percentage_24h||0) - (a.price_change_percentage_24h||0));
    if (STATE.lSort === 'pct7d') return dir * ((b.price_change_percentage_7d_in_currency||0) - (a.price_change_percentage_7d_in_currency||0));
    if (STATE.lSort === 'pct30d') return dir * ((b.price_change_percentage_30d_in_currency||0) - (a.price_change_percentage_30d_in_currency||0));
    if (STATE.lSort === 'ath') return dir * ((a._fromAth||0) - (b._fromAth||0));
    if (STATE.lSort === 'roi') return dir * ((b._roi||0) - (a._roi||0));
    if (STATE.lSort === 'new') return dir * ((a._daysSince||9999) - (b._daysSince||9999));
    return 0;
  });

  document.getElementById('launch-status').textContent = `${coins.length} tokens in ${stage === 'all' ? 'all stages' : stage}`;

  const tbody = document.getElementById('launch-body');
  if (!coins.length) {
    if (!STATE.launchLoaded) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="15">
        <div class="empty-state-box">
          <div class="empty-icon">◌</div>
          <div class="empty-title">SCANNING LAUNCH PIPELINE<span class="empty-dots"></span></div>
          <div class="empty-desc">Gathering Alpha, Launchpad, Launchpool &amp; Megadrop data. First load takes 1-2 minutes — auto-refreshes every 120s.</div>
        </div></td></tr>`;
    } else {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="15">
        <div class="empty-state-box">
          <div class="empty-title">NO TOKENS IN THIS STAGE</div>
          <div class="empty-desc">Try selecting a different pipeline stage or "All Stages".</div>
        </div></td></tr>`;
    }
    return;
  }

  const stageMap = { alpha:'tag-alpha', launchpad:'tag-launchpad', launchpool:'tag-launchpool', megadrop:'tag-megadrop' };
  const stageLabel = { alpha:'ALPHA', launchpad:'LAUNCHPAD', launchpool:'LAUNCHPOOL', megadrop:'MEGADROP' };

  tbody.innerHTML = coins.map((c, i) => {
    const sym = escHtml((c.symbol || '').toUpperCase());
    const isNew = c._daysSince !== null && c._daysSince < 21;
    const roiStr = c._roi !== null ? `<span class="${c._roi > 0 ? 'pup' : 'pdn'}">${c._roi > 0 ? '+' : ''}${c._roi.toFixed(0)}%</span>` : '—';
    const athStr = c._fromAth !== null ? `<span class="${c._fromAth > -15 ? 'pup' : 'pdn'}">${c._fromAth.toFixed(1)}%</span>` : '—';
    const imgSrc = isSafeImageUrl(c.image);
    const cvsId = `ls_${i}_${sym}`;
    return `<tr>
      <td class="c-coin">
        <div class="coin-cell">
          ${imgSrc ? `<img class="coin-img" src="${imgSrc}" onerror="this.style.display='none'">` : ''}
          <div class="coin-names">
            <div class="coin-sym">${sym} ${isNew ? '<span class="tag tag-new">NEW</span>' : ''}</div>
            <div class="coin-full">${escHtml(c.name)}</div>
          </div>
        </div>
      </td>
      <td><span class="tag ${stageMap[c._stage] || 'tag-chain'}">${escHtml(stageLabel[c._stage] || c._stage)}</span>${c._onBinance === false ? ' <span class="tag-nolisting">UNLISTED</span>' : ''}</td>
      <td style="font-size:11px;color:var(--text1)">${F.price(c.current_price)}</td>
      <td style="font-size:10px;color:var(--text1)">${F.mcap(c.market_cap)}</td>
      <td style="font-size:10px;color:var(--text1)">${F.vol(c.total_volume)}</td>
      <td>${F.pct(c._p5m)}</td>
      <td>${F.pct(c._p15m)}</td>
      <td>${F.pct(c._p1h)}</td>
      <td>${F.pct(c.price_change_percentage_24h)}</td>
      <td>${F.pct(c.price_change_percentage_7d_in_currency)}</td>
      <td>${F.pct(c.price_change_percentage_30d_in_currency)}</td>
      <td>${athStr}</td>
      <td>${roiStr}</td>
      <td><canvas id="${cvsId}" class="spark" width="80" height="28"></canvas></td>
      <td style="color:var(--text2);font-size:10px">${F.age(c.atl_date)}</td>
    </tr>`;
  }).join('');

  requestAnimationFrame(() => {
    coins.forEach((c, i) => {
      const sym = (c.symbol || '').toUpperCase();
      const cvs = document.getElementById(`ls_${i}_${sym}`);
      if (cvs) drawSpark(cvs, c._spark);
    });
  });
}
