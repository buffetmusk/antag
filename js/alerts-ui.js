'use strict';

import { STATE } from './state.js';
import {
  saveAlertConfig, generateRuleId, testTelegramConnection,
} from './alerts.js';

export function showAlertsModal() {
  document.getElementById('alerts-modal').classList.add('open');
  renderAlertsModal();
}

export function closeAlertsModal() {
  document.getElementById('alerts-modal').classList.remove('open');
}

const TYPE_LABELS = {
  price_change: 'PRICE MOVE',
  funding_extreme: 'FUNDING',
  volume_spike: 'VOL SPIKE',
  new_launch: 'NEW LAUNCH',
};

const TYPE_CLASSES = {
  price_change: 'tag-chain',
  funding_extreme: 'tag-alpha',
  volume_spike: 'tag-launchpool',
  new_launch: 'tag-launchpad',
};

function ruleSummary(rule) {
  const p = rule.params;
  if (rule.type === 'price_change') {
    const sym = p.symbol || 'ALL';
    const dir = p.direction === 'up' ? '↑' : p.direction === 'down' ? '↓' : '↕';
    return `${sym} ${dir} ${p.threshold}% in ${p.timeframe.replace('p', '')}`;
  }
  if (rule.type === 'funding_extreme') {
    return `${p.symbol || 'ALL'} |funding| > ${p.threshold}%`;
  }
  if (rule.type === 'volume_spike') {
    return `${p.symbol || 'ALL'} vol > ${p.multiplier}x`;
  }
  if (rule.type === 'new_launch') {
    return `stages: ${(p.stages || []).join(', ') || 'all'}`;
  }
  return '';
}

function renderRuleCards() {
  const cfg = STATE.alerts.config;
  if (!cfg.rules.length) return '<div style="color:var(--text2);font-size:10px;padding:8px 0">No alert rules configured yet.</div>';
  return cfg.rules.map(r => `
    <div class="rule-card">
      <div class="rule-card-header">
        <span class="tag ${TYPE_CLASSES[r.type]}">${TYPE_LABELS[r.type]}</span>
        <span class="rule-summary">${ruleSummary(r)}</span>
        <span class="rule-cooldown">${r.cooldownMinutes}m cooldown</span>
        <label class="rule-toggle">
          <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="window._alertToggleRule('${r.id}', this.checked)">
          <span class="toggle-track"></span>
        </label>
        <button class="btn-sm rule-del" onclick="window._alertDeleteRule('${r.id}')">✕</button>
      </div>
    </div>
  `).join('');
}

function renderHistory() {
  const h = STATE.alerts.history;
  if (!h.length) return '<div style="color:var(--text2);font-size:10px;padding:8px 0">No alerts fired yet.</div>';
  return h.slice(0, 20).map(e => {
    const t = new Date(e.ts).toLocaleTimeString();
    const tag = TYPE_CLASSES[e.type] || 'tag-chain';
    return `<div class="alert-history-item">
      <span class="ah-time">${t}</span>
      <span class="tag ${tag}" style="font-size:8px">${TYPE_LABELS[e.type] || e.type}</span>
      <span class="ah-sym">${e.symbol}</span>
    </div>`;
  }).join('');
}

export function renderAlertsModal() {
  const cfg = STATE.alerts.config;
  if (!cfg) return;
  const tg = cfg.telegram;
  const el = document.getElementById('alerts-modal-content');

  el.innerHTML = `
    <div class="alerts-section">
      <div class="alerts-section-title">TELEGRAM CONNECTION</div>
      <div class="tg-creds">
        <div class="tg-field">
          <label class="filter-label">Bot Token</label>
          <input class="filter-input tg-input" id="tg-token" type="password" placeholder="123456:ABC-DEF..." value="${tg.botToken}">
        </div>
        <div class="tg-field">
          <label class="filter-label">Chat ID</label>
          <input class="filter-input tg-input" id="tg-chat" placeholder="-1001234567890" value="${tg.chatId}">
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <label class="binance-toggle">
            <input type="checkbox" id="tg-enabled" ${tg.enabled ? 'checked' : ''} onchange="window._alertSaveCreds()">
            <span class="toggle-track"></span>
            <span class="toggle-label">ALERTS ENABLED</span>
          </label>
          <button class="btn-sm" onclick="window._alertSaveCreds()">SAVE</button>
          <button class="btn-sm" onclick="window._alertTest()">TEST</button>
          <span class="tg-status" id="tg-status"></span>
        </div>
        <div style="font-size:9px;color:var(--text2);margin-top:4px">Your bot token is stored locally in this browser and never sent to our servers.</div>
      </div>
    </div>

    <div class="alerts-section">
      <div class="alerts-section-title">ALERT RULES <button class="btn-sm" style="float:right" onclick="window._alertShowAdd()">+ ADD RULE</button></div>
      <div id="alert-add-form"></div>
      <div id="alert-rules-list">${renderRuleCards()}</div>
    </div>

    <div class="alerts-section">
      <div class="alerts-section-title">RECENT ALERTS</div>
      <div id="alert-history" class="alert-history">${renderHistory()}</div>
    </div>
  `;
}

function saveCreds() {
  const cfg = STATE.alerts.config;
  cfg.telegram.botToken = document.getElementById('tg-token').value.trim();
  cfg.telegram.chatId = document.getElementById('tg-chat').value.trim();
  cfg.telegram.enabled = document.getElementById('tg-enabled').checked;
  saveAlertConfig(cfg);
  const st = document.getElementById('tg-status');
  if (st) { st.textContent = 'Saved'; st.className = 'tg-status tg-ok'; }
}

async function testConnection() {
  const st = document.getElementById('tg-status');
  saveCreds();
  const cfg = STATE.alerts.config;
  if (!cfg.telegram.botToken || !cfg.telegram.chatId) {
    if (st) { st.textContent = 'Enter token & chat ID'; st.className = 'tg-status tg-err'; }
    return;
  }
  if (st) { st.textContent = 'Sending...'; st.className = 'tg-status'; }
  const res = await testTelegramConnection(cfg.telegram.botToken, cfg.telegram.chatId);
  if (st) {
    st.textContent = res.ok ? 'Connected!' : `Error: ${res.description}`;
    st.className = 'tg-status ' + (res.ok ? 'tg-ok' : 'tg-err');
  }
}

function showAddForm() {
  const el = document.getElementById('alert-add-form');
  el.innerHTML = `
    <div class="alert-form">
      <div class="filter-group" style="padding:0">
        <div class="filter-label">Alert Type</div>
        <select class="filter-select" id="ar-type" onchange="window._alertTypeChanged()">
          <option value="price_change">Price Move</option>
          <option value="funding_extreme">Funding Rate Extreme</option>
          <option value="volume_spike">Volume Spike</option>
          <option value="new_launch">New Launch Token</option>
        </select>
      </div>
      <div id="ar-params">${priceChangeParams()}</div>
      <div class="filter-group" style="padding:0;margin-top:6px">
        <div class="filter-label">Cooldown (minutes)</div>
        <input class="filter-input" id="ar-cooldown" type="number" value="30" min="1" max="1440">
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn-sm" onclick="window._alertAddRule()">ADD</button>
        <button class="btn-sm" onclick="document.getElementById('alert-add-form').innerHTML=''">CANCEL</button>
      </div>
    </div>
  `;
}

function priceChangeParams() {
  return `
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Symbol (blank = all)</div>
      <input class="filter-input" id="ar-symbol" placeholder="BTC">
    </div>
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Timeframe</div>
      <select class="filter-select" id="ar-tf">
        <option value="p5m">5 min</option>
        <option value="p15m">15 min</option>
        <option value="p1h" selected>1 hour</option>
        <option value="p4h">4 hour</option>
        <option value="p24h">24 hour</option>
      </select>
    </div>
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Direction</div>
      <select class="filter-select" id="ar-dir">
        <option value="any">Any</option>
        <option value="up">Up only</option>
        <option value="down">Down only</option>
      </select>
    </div>
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Threshold (%)</div>
      <input class="filter-input" id="ar-threshold" type="number" value="5" min="0.1" step="0.1">
    </div>`;
}

function fundingParams() {
  return `
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Symbol (blank = all)</div>
      <input class="filter-input" id="ar-symbol" placeholder="BTC">
    </div>
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Threshold (abs %)</div>
      <input class="filter-input" id="ar-threshold" type="number" value="0.1" min="0.01" step="0.01">
    </div>`;
}

function volumeParams() {
  return `
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Symbol (blank = all)</div>
      <input class="filter-input" id="ar-symbol" placeholder="BTC">
    </div>
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Multiplier (x)</div>
      <input class="filter-input" id="ar-multiplier" type="number" value="3" min="1" step="0.5">
    </div>`;
}

function launchParams() {
  return `
    <div class="filter-group" style="padding:0;margin-top:6px">
      <div class="filter-label">Stages</div>
      <div class="chip-row">
        <label class="alert-cb"><input type="checkbox" value="alpha" checked> Alpha</label>
        <label class="alert-cb"><input type="checkbox" value="launchpad" checked> Launchpad</label>
        <label class="alert-cb"><input type="checkbox" value="launchpool" checked> Launchpool</label>
        <label class="alert-cb"><input type="checkbox" value="megadrop" checked> Megadrop</label>
      </div>
    </div>`;
}

function typeChanged() {
  const type = document.getElementById('ar-type').value;
  const el = document.getElementById('ar-params');
  if (type === 'price_change') el.innerHTML = priceChangeParams();
  else if (type === 'funding_extreme') el.innerHTML = fundingParams();
  else if (type === 'volume_spike') el.innerHTML = volumeParams();
  else if (type === 'new_launch') el.innerHTML = launchParams();
}

function addRule() {
  const type = document.getElementById('ar-type').value;
  const cooldown = parseInt(document.getElementById('ar-cooldown').value) || 30;
  let params = {};

  if (type === 'price_change') {
    params = {
      symbol: (document.getElementById('ar-symbol').value || '').trim().toUpperCase(),
      timeframe: document.getElementById('ar-tf').value,
      direction: document.getElementById('ar-dir').value,
      threshold: parseFloat(document.getElementById('ar-threshold').value) || 5,
    };
  } else if (type === 'funding_extreme') {
    params = {
      symbol: (document.getElementById('ar-symbol').value || '').trim().toUpperCase(),
      threshold: parseFloat(document.getElementById('ar-threshold').value) || 0.1,
    };
  } else if (type === 'volume_spike') {
    params = {
      symbol: (document.getElementById('ar-symbol').value || '').trim().toUpperCase(),
      multiplier: parseFloat(document.getElementById('ar-multiplier').value) || 3,
    };
  } else if (type === 'new_launch') {
    const checks = document.querySelectorAll('#ar-params .alert-cb input:checked');
    params = { stages: [...checks].map(c => c.value) };
  }

  const rule = {
    id: generateRuleId(),
    type,
    enabled: true,
    params,
    cooldownMinutes: cooldown,
    createdAt: Date.now(),
  };

  const cfg = STATE.alerts.config;
  cfg.rules.push(rule);
  saveAlertConfig(cfg);
  renderAlertsModal();
}

function deleteRule(ruleId) {
  const cfg = STATE.alerts.config;
  cfg.rules = cfg.rules.filter(r => r.id !== ruleId);
  saveAlertConfig(cfg);
  document.getElementById('alert-rules-list').innerHTML = renderRuleCards();
}

function toggleRule(ruleId, checked) {
  const cfg = STATE.alerts.config;
  const rule = cfg.rules.find(r => r.id === ruleId);
  if (rule) rule.enabled = checked;
  saveAlertConfig(cfg);
}

export function showAlertToast(message) {
  const container = document.getElementById('alert-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'alert-toast';
  const sym = message.symbol || '';
  const label = TYPE_LABELS[message.type] || 'ALERT';
  toast.innerHTML = `<span class="tag ${TYPE_CLASSES[message.type] || 'tag-chain'}" style="font-size:8px">${label}</span> <strong>${sym}</strong>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('leaving'); }, 3500);
  setTimeout(() => { toast.remove(); }, 4000);
}

// Expose handlers to window for inline onclick
window._alertSaveCreds = saveCreds;
window._alertTest = testConnection;
window._alertShowAdd = showAddForm;
window._alertTypeChanged = typeChanged;
window._alertAddRule = addRule;
window._alertDeleteRule = deleteRule;
window._alertToggleRule = toggleRule;
