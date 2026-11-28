// Нощно обновяване на каталога от операторите (всяка нощ в сървъра – виж server.js, и бутон в админа).
// Върви ВЪТРЕ в сървъра: каталогът се пипа и от админа (потвърждаване, преместване), а един пишещ
// значи, че решенията на служителите не се губят при обновяването.
//
//   1. списъците с хотели от всеки оператор (hotels());
//   2. data/hotels-OP.json – нужни за търсене по курорт при Sedna (по HotelId);
//   3. catalog.build() – нови хотели и връзки (нищо не се трие; новите несигурни са „за проверка“);
//   4. markChains() – за всеки случай;
//   5. снимките от сайта – наново (новите хотели получават своите).
const fs = require('fs');
const path = require('path');

const SHRINK = 0.5; // ако операторът върне под половината от хотелите от миналия път – не му вярваме днес

function readList(dataDir, op) {
  for (const f of [path.join(dataDir, `hotels-${op}.json`), path.join(dataDir, 'seed', `hotels-${op}.json`)]) {
    try {
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      /* повреден файл – като че ли го няма */
    }
  }
  return null;
}

function writeList(dataDir, op, list) {
  const f = path.join(dataDir, `hotels-${op}.json`);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(list));
  fs.renameSync(f + '.tmp', f);
}

/**
 * @returns {Promise<{ at, ms, ops: { [op]: { hotels, already, auto, check, created } | { error } | { skipped } }, chains, content }>}
 */
async function refreshCatalog({ catalog, suppliers, dataDir, content, log = console }) {
  const t0 = Date.now();
  const lists = {};
  const ops = {};
  for (const [op, c] of Object.entries(suppliers)) {
    try {
      const list = (await c.hotels()).filter((h) => h && h.code && h.name);
      const prev = readList(dataDir, op);
      if (prev && prev.length > 20 && list.length < prev.length * SHRINK) {
        ops[op] = { skipped: `върна ${list.length} хотела, а миналия път бяха ${prev.length}` };
        log.warn(`[каталог] ${op}: ${ops[op].skipped} – пропускам`);
        continue;
      }
      writeList(dataDir, op, list);
      lists[op] = list.map((h) => ({ code: h.code, name: h.name, area: h.area || '', category: h.category || '' }));
    } catch (e) {
      ops[op] = { error: e.name === 'TimeoutError' ? 'не отговаря' : e.message };
      log.warn(`[каталог] ${op}: ${ops[op].error}`);
    }
  }
  if (Object.keys(lists).length) {
    const st = catalog.build(lists); // записва catalog.json
    for (const [op, s] of Object.entries(st)) ops[op] = { hotels: s.total, already: s.already, auto: s.auto, check: s.check, created: s.created };
  }
  const chains = catalog.markChains();
  let contentStats = null;
  if (content) contentStats = content.match(catalog);
  const out = { at: new Date().toISOString(), ms: Date.now() - t0, ops, chains, content: contentStats };
  const summary = Object.entries(ops)
    .map(([op, s]) => (s.error ? `${op}: грешка` : s.skipped ? `${op}: пропуснат` : `${op}: ${s.hotels} (+${s.created} нови, ${s.check} за проверка)`))
    .join('; ');
  log.info(`[каталог] обновен за ${Math.round(out.ms / 1000)} сек: ${summary || 'няма оператори'}${chains ? `; ${chains} верижни` : ''}`);
  return out;
}

// Пуска fn всеки ден в hh:mm местно време (услугата е с TZ=Europe/Sofia)
function scheduleDaily(hhmm, fn) {
  const [hh, mm] = String(hhmm).split(':').map(Number);
  const next = () => {
    const now = new Date();
    const t = new Date(now);
    t.setHours(hh, mm, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t - now;
  };
  const tick = async () => {
    try {
      await fn();
    } finally {
      setTimeout(tick, next()).unref();
    }
  };
  setTimeout(tick, next()).unref();
}

module.exports = { refreshCatalog, scheduleDaily };
