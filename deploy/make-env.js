// Прави .env за сървъра от .env.example (само ако .env още го няма).
// Потребителите и паролите на операторите се вземат от .env на TC Prices на същия сървър –
// не минават през git, чат или екрана (показват се само имената на ключовете).
//
//   node deploy/make-env.js <app-dir> <port> [tc-prices/.env]
const fs = require('fs');
const path = require('path');

const [appDir, port, tcpEnv] = process.argv.slice(2);
if (!appDir || !port) {
  console.error('Употреба: node deploy/make-env.js <app-dir> <port> [tc-prices/.env]');
  process.exit(2);
}
const out = path.join(appDir, '.env');
if (fs.existsSync(out)) {
  console.log('  .env вече го има – не го пипам');
  process.exit(0);
}

const parse = (file) => {
  const m = {};
  if (!file || !fs.existsSync(file)) return m;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const x = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (x) m[x[1]] = x[2];
  }
  return m;
};
const src = parse(tcpEnv);

const copied = [];
const set = { PORT: port, HOST: '127.0.0.1', SUMMER_RATE_PER_MIN: '2' };
const lines = fs.readFileSync(path.join(appDir, '.env.example'), 'utf8').split(/\r?\n/).map((line) => {
  const x = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!x) return line;
  const key = x[1];
  if (key in set) return `${key}=${set[key]}`;
  if (/_(USER|PASS)$/.test(key) && src[key]) {
    copied.push(key);
    return `${key}=${src[key]}`;
  }
  return line;
});
// лимитът на Summer Tour (10/мин) е общ с TC Prices, която ползва 8 – оставаме на 2
const i = lines.findIndex((l) => l.startsWith('SUMMER_RATE_PER_MIN='));
if (i >= 0) lines.splice(i, 0, '# лимитът на Summer Tour (10/мин) е общ с TC Prices (8/мин) – тук остават 2');

fs.writeFileSync(out, lines.join('\n'), { mode: 0o600 });
console.log(`  .env е създаден (PORT=${port})`);
if (copied.length) console.log(`  взети от TC Prices: ${copied.join(', ')}`);
else console.log(`  ! пароли на операторите не са намерени${tcpEnv ? ` в ${tcpEnv}` : ''} – попълнете *_USER и *_PASS в ${out}`);
