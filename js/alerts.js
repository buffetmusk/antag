'use strict';

import { STATE, F } from './state.js';

const STORAGE_KEY = 'antag-alerts-config';
const COOLDOWN_KEY = 'antag-alerts-cooldowns';
const MAX_HISTORY = 50;
const MAX_PER_BATCH = 10;
const SEND_DELAY_MS = 500;

export function createDefaultConfig() {
  return {
    version: 1,
    telegram: { botToken: '', chatId: '', enabled: false },
    rules: [],
  };
}

export function generateRuleId() {
  return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
}

export function loadAlertConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        STATE.alerts.config = parsed;
        return parsed;
      }
    }
  } catch {}
  const def = createDefaultConfig();
  STATE.alerts.config = def;
  return def;
}

export function saveAlertConfig(config) {
  STATE.alerts.config = config;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadCooldowns() {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (raw) STATE.alerts.lastFired = JSON.parse(raw);
  } catch {}
}

function saveCooldowns() {
  localStorage.setItem(COOLDOWN_KEY, JSON.stringify(STATE.alerts.lastFired));
}

function isOnCooldown(ruleId, symbol, cooldownMinutes) {
  const key = ruleId + '::' + symbol;
  const last = STATE.alerts.lastFired[key];
  if (!last) return false;
  return (Date.now() - last) < cooldownMinutes * 60 * 1000;
}

function markFired(ruleId, symbol) {
  STATE.alerts.lastFired[ruleId + '::' + symbol] = Date.now();
  saveCooldowns();
}

function addToHistory(entry) {
  STATE.alerts.history.unshift(entry);
  if (STATE.alerts.history.length > MAX_HISTORY) STATE.alerts.history.length = MAX_HISTORY;
}

export async function sendTelegramMessage(botToken, chatId, text) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data = await r.json();
    return { ok: data.ok, description: data.description || '' };
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

export async function testTelegramConnection(botToken, chatId) {
  return sendTelegramMessage(botToken, chatId, '✅ <b>antag</b> alert connection verified.');
}

function formatAlertMessage(type, coin, detail) {
  const sym = coin.sym || (coin.symbol || '').toUpperCase();
  const price = F.price(coin.price || coin.current_price);
  const mcap = F.mcap(coin.mcap || coin.market_cap);

  if (type === 'price_change') {
    const arrow = detail.value > 0 ? '\u{1F4C8}' : '\u{1F4C9}';
    const sign = detail.value > 0 ? '+' : '';
    return `${arrow} <b>${sym}</b> moved <b>${sign}${detail.value.toFixed(2)}%</b> in ${detail.tf}\nPrice: ${price} | MCap: ${mcap}`;
  }
  if (type === 'funding_extreme') {
    const sign = detail.value > 0 ? '+' : '';
    return `⚠️ <b>${sym}</b> extreme funding: <b>${sign}${detail.value.toFixed(4)}%</b>\nPrice: ${price}`;
  }
  if (type === 'volume_spike') {
    return `\u{1F4CA} <b>${sym}</b> volume spike: <b>${detail.value.toFixed(1)}x</b>\nVol: ${F.vol(coin.vol || coin.total_volume)} | Price: ${price}`;
  }
  if (type === 'new_launch') {
    return `\u{1F680} New launch token: <b>${sym}</b> (${(detail.stage || '').toUpperCase()})\nPrice: ${price} | MCap: ${mcap}`;
  }
  return `\u{1F514} <b>${sym}</b>: ${detail.text || 'alert triggered'}`;
}

const TF_LABELS = { p5m: '5m', p15m: '15m', p1h: '1h', p4h: '4h', p24h: '24h' };

function evaluateScreenerAlerts() {
  const cfg = STATE.alerts.config;
  if (!cfg || !cfg.telegram.enabled || !cfg.rules.length) return [];
  const messages = [];

  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;

    if (rule.type === 'price_change') {
      for (const c of STATE.coins) {
        if (rule.params.symbol && c.sym !== rule.params.symbol.toUpperCase()) continue;
        const val = c[rule.params.timeframe];
        if (val === null || val === undefined) continue;
        const absVal = Math.abs(val);
        if (rule.params.direction === 'up' && val < rule.params.threshold) continue;
        if (rule.params.direction === 'down' && val > -rule.params.threshold) continue;
        if (rule.params.direction === 'any' && absVal < rule.params.threshold) continue;
        if (isOnCooldown(rule.id, c.sym, rule.cooldownMinutes)) continue;
        const msg = formatAlertMessage('price_change', c, { value: val, tf: TF_LABELS[rule.params.timeframe] || rule.params.timeframe });
        messages.push({ ruleId: rule.id, symbol: c.sym, type: 'price_change', text: msg });
        markFired(rule.id, c.sym);
        addToHistory({ ts: Date.now(), ruleId: rule.id, type: 'price_change', symbol: c.sym, message: msg });
        if (messages.length >= MAX_PER_BATCH) return messages;
      }
    }

    if (rule.type === 'funding_extreme') {
      for (const c of STATE.coins) {
        if (rule.params.symbol && c.sym !== rule.params.symbol.toUpperCase()) continue;
        if (Math.abs(c.funding) < rule.params.threshold) continue;
        if (isOnCooldown(rule.id, c.sym, rule.cooldownMinutes)) continue;
        const msg = formatAlertMessage('funding_extreme', c, { value: c.funding });
        messages.push({ ruleId: rule.id, symbol: c.sym, type: 'funding_extreme', text: msg });
        markFired(rule.id, c.sym);
        addToHistory({ ts: Date.now(), ruleId: rule.id, type: 'funding_extreme', symbol: c.sym, message: msg });
        if (messages.length >= MAX_PER_BATCH) return messages;
      }
    }

    if (rule.type === 'volume_spike') {
      for (const c of STATE.coins) {
        if (rule.params.symbol && c.sym !== rule.params.symbol.toUpperCase()) continue;
        if (c.volRatio < rule.params.multiplier) continue;
        if (isOnCooldown(rule.id, c.sym, rule.cooldownMinutes)) continue;
        const msg = formatAlertMessage('volume_spike', c, { value: c.volRatio });
        messages.push({ ruleId: rule.id, symbol: c.sym, type: 'volume_spike', text: msg });
        markFired(rule.id, c.sym);
        addToHistory({ ts: Date.now(), ruleId: rule.id, type: 'volume_spike', symbol: c.sym, message: msg });
        if (messages.length >= MAX_PER_BATCH) return messages;
      }
    }
  }
  return messages;
}

function evaluateLaunchAlerts() {
  const cfg = STATE.alerts.config;
  if (!cfg || !cfg.telegram.enabled || !cfg.rules.length) return [];
  const messages = [];

  const launchRules = cfg.rules.filter(r => r.enabled && r.type === 'new_launch');
  if (!launchRules.length) return [];

  const allTokens = Object.entries(STATE.launchData).flatMap(([stage, coins]) =>
    coins.map(c => ({ ...c, _stage: stage }))
  );

  for (const token of allTokens) {
    if (STATE.alerts.knownLaunchIds.has(token.id)) continue;
    STATE.alerts.knownLaunchIds.add(token.id);

    for (const rule of launchRules) {
      const stages = rule.params.stages || [];
      if (stages.length && !stages.includes(token._stage)) continue;
      if (isOnCooldown(rule.id, token.id, rule.cooldownMinutes)) continue;

      const msg = formatAlertMessage('new_launch', token, { stage: token._stage });
      messages.push({ ruleId: rule.id, symbol: (token.symbol || '').toUpperCase(), type: 'new_launch', text: msg });
      markFired(rule.id, token.id);
      addToHistory({ ts: Date.now(), ruleId: rule.id, type: 'new_launch', symbol: (token.symbol || '').toUpperCase(), message: msg });
      if (messages.length >= MAX_PER_BATCH) return messages;
    }
  }
  return messages;
}

async function processQueue(messages) {
  if (!messages.length || STATE.alerts.sending) return;
  const cfg = STATE.alerts.config;
  if (!cfg || !cfg.telegram.botToken || !cfg.telegram.chatId) return;

  STATE.alerts.sending = true;
  try {
    for (const m of messages) {
      await sendTelegramMessage(cfg.telegram.botToken, cfg.telegram.chatId, m.text);
      if (typeof window._onAlertFired === 'function') window._onAlertFired(m);
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
  } finally {
    STATE.alerts.sending = false;
  }
}

export function runScreenerCheck() {
  const cfg = STATE.alerts.config;
  if (!cfg || !cfg.telegram.enabled) return;
  const msgs = evaluateScreenerAlerts();
  if (msgs.length) processQueue(msgs);
}

export function runLaunchCheck() {
  const cfg = STATE.alerts.config;
  if (!cfg || !cfg.telegram.enabled) return;
  const msgs = evaluateLaunchAlerts();
  if (msgs.length) processQueue(msgs);
}

export function initAlerts() {
  loadAlertConfig();
  loadCooldowns();
  Object.values(STATE.launchData).flat().forEach(c => {
    if (c.id) STATE.alerts.knownLaunchIds.add(c.id);
  });
}
