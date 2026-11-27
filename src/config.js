// Зарежда .env и описва доставчиците (турските incoming оператори).
// Всеки оператор е група ключове с общ префикс, напр. ANEA_TYPE, ANEA_URL, ANEA_USER...
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv(path.join(ROOT, '.env'));

function operators() {
  const ops = [];
  for (const key of Object.keys(env)) {
    const m = key.match(/^([A-Z0-9]+)_TYPE$/);
    if (!m) continue;
    const id = m[1];
    const g = (k, d = '') => env[`${id}_${k}`] ?? d;
    const op = {
      id,
      name: g('NAME', id),
      type: g('TYPE').toLowerCase(),
      url: g('URL').replace(/\/+$/, ''),
      db: g('DB'),
      user: g('USER'),
      pass: g('PASS'),
      ratePerMin: Number(g('RATE_PER_MIN', '0')) || 0,
      timeoutMs: Number(g('TIMEOUT_MS', '20000')) || 20000,
      remote: g('REMOTE', id.slice(0, 3)), // код на оператора в XML експорта (Remote="...")
    };
    op.missing = ['url', 'user', 'pass'].filter((k) => !op[k]);
    if (op.type === 'sejour' && !op.db) op.missing.push('db');
    op.enabled = op.missing.length === 0;
    ops.push(op);
  }
  return ops;
}

module.exports = {
  ROOT,
  PORT: Number(env.PORT || 3100), // 3000 е на TC Prices
  // На сървъра приложението е зад Caddy, затова слуша само локално
  HOST: env.HOST || '127.0.0.1',
  // От кой адрес (сайта) може да се вика API-то от браузъра, напр. https://www.example.com; празно = само от същия адрес
  CORS_ORIGIN: env.CORS_ORIGIN || '',
  // Надценка върху нетната цена на доставчика (%), докато няма правила по хотел/сезон
  MARKUP_PCT: Number(env.MARKUP_PCT || 0),
  // Колко минути пазим резултат от търсене при доставчик
  CACHE_MIN: Number(env.CACHE_MIN || 15),
  operators: operators(),
};
