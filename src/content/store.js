// Снимки и описания на хотелите от нашия сайт, вързани към каталога (H<id>).
// data/content.json:
//   site:  { <siteId>: { siteId, name, stars, locality, url, photos, sections, lat, lon, rating, reviews, fetchedAt } }
//   other: { <siteId>: 'държава' }  – хотели извън Турция (не се теглят пак всеки път)
//   links: { <siteId>: { hotelId, state: 'auto'|'check'|'ok', score } }  – 'ok' е потвърдено от човек
//   blocked: ["<siteId>|H123", …]  – разкачени от човек, не се връзват пак автоматично
const fs = require('fs');
const path = require('path');
const { fingerprint, nameScore, normArea } = require('../catalog/normalize');
const { toLatin } = require('../admin/translit');

const AUTO = 0.92;
const CHECK = 0.74;

// Курортите на сайта (на кирилица) -> курортите в каталога
const AREA_BG = {
  алания: 'ALANYA', аланя: 'ALANYA', сиде: 'SIDE', белек: 'BELEK', анталия: 'ANTALYA', лара: 'ANTALYA', кемер: 'KEMER',
  кушадасъ: 'KUSADASI', кушадаси: 'KUSADASI', дидим: 'DIDIM', бодрум: 'BODRUM', мармарис: 'MARMARIS', ичмелер: 'MARMARIS',
  фетие: 'FETHIYE', олюдениз: 'FETHIYE', даламан: 'DALAMAN', саригерме: 'DALAMAN', чешме: 'CESME', измир: 'IZMIR',
  айвалък: 'AYVALIK', едремит: 'EDREMIT', чанаккале: 'CANAKKALE', сеферихисар: 'SEFERIHISAR', кападокия: 'KAPADOKYA',
  истанбул: 'ISTANBUL', чорлу: 'CORLU', текирдаг: 'TEKIRDAG', манавгат: 'SIDE', конаклъ: 'ALANYA', авсалар: 'ALANYA',
};
function siteArea(locality) {
  const s = String(locality || '').trim().toLowerCase();
  if (AREA_BG[s]) return AREA_BG[s];
  for (const w of s.split(/[\s,/-]+/)) if (AREA_BG[w]) return AREA_BG[w];
  return normArea(toLatin(locality));
}

class ContentStore {
  constructor(file) {
    this.file = file;
    this.mtime = 0;
    this.checkedAt = 0;
    this.load();
  }

  load() {
    this.data = { updatedAt: null, site: {}, other: {}, links: {}, blocked: [] };
    if (fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      this.mtime = fs.statSync(this.file).mtimeMs;
    }
    this.index();
  }

  // Вносът върви като отделен процес – сървърът поглежда за нов файл най-много веднъж на минута
  maybeReload() {
    const now = Date.now();
    if (now - this.checkedAt < 60000) return;
    this.checkedAt = now;
    try {
      if (fs.statSync(this.file).mtimeMs !== this.mtime) this.load();
    } catch {
      /* още няма файл */
    }
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    fs.renameSync(this.file + '.tmp', this.file);
    this.mtime = fs.statSync(this.file).mtimeMs;
    this.index();
  }

  index() {
    this.byHotel = new Map(); // H<id> -> запис от сайта (само показваните: auto и ok)
    for (const [siteId, l] of Object.entries(this.data.links)) {
      const s = this.data.site[siteId];
      if (s && (l.state === 'auto' || l.state === 'ok')) this.byHotel.set(l.hotelId, s);
    }
  }

  // ---------- за API-то ----------
  // Малкото за картата в резултатите
  card(hotelId) {
    this.maybeReload();
    const s = this.byHotel.get(hotelId);
    if (!s) return null;
    return { image: s.photos[0] ? s.photos[0].thumb : null, photos: s.photos.length, rating: s.rating, reviews: s.reviews, siteUrl: s.url };
  }

  // Всичко за страницата/прозореца на хотела
  full(hotelId) {
    this.maybeReload();
    const s = this.byHotel.get(hotelId);
    if (!s) return null;
    return { photos: s.photos, sections: s.sections, rating: s.rating, reviews: s.reviews, siteUrl: s.url, lat: s.lat, lon: s.lon };
  }

  // ---------- внос ----------
  put(rec) {
    this.data.site[rec.siteId] = rec;
    delete this.data.other[rec.siteId];
  }

  // Връзва хотелите от сайта с каталога. Ръчните решения (ok, blocked) не се пипат.
  match(catalog) {
    // имената от непроверени връзки в каталога (state 'check') дават най-много „за проверка“ –
    // иначе грешка в каталога става „сигурна“ връзка и тук
    const fp = new Map(
      catalog.data.hotels.map((h) => [
        h.id,
        [{ f: fingerprint(h.name), max: 1 }, ...Object.values(h.links).map((l) => ({ f: fingerprint(l.name), max: l.state === 'check' ? AUTO - 0.01 : 1 }))],
      ])
    );
    const blocked = new Set(this.data.blocked);
    const stats = { auto: 0, check: 0, none: 0, ok: 0 };
    const taken = new Map(); // H -> siteId с най-висок резултат (един хотел от каталога – един от сайта)
    for (const [siteId, l] of Object.entries(this.data.links)) if (l.state === 'ok') taken.set(l.hotelId, { siteId, score: 2 });

    const found = [];
    for (const s of Object.values(this.data.site)) {
      const cur = this.data.links[s.siteId];
      if (cur && cur.state === 'ok') {
        stats.ok++;
        continue;
      }
      const f = fingerprint(s.name);
      const area = siteArea(s.locality);
      let best = null;
      let bestScore = 0;
      for (const h of catalog.data.hotels) {
        if (blocked.has(`${s.siteId}|${h.id}`)) continue;
        let sc = Math.max(...fp.get(h.id).map((x) => Math.min(x.max, nameScore(f, x.f))));
        if (sc < CHECK - 0.15) continue;
        if (area && h.area && area !== h.area) sc -= 0.15;
        if (sc > bestScore) {
          bestScore = sc;
          best = h;
        }
      }
      found.push({ s, best, score: Math.round(bestScore * 100) / 100 });
    }
    // по-сигурните първи – ако два хотела от сайта сочат един и същ от каталога, вторият отива за проверка
    found.sort((a, b) => b.score - a.score);
    for (const { s, best, score } of found) {
      if (!best || score < CHECK) {
        delete this.data.links[s.siteId];
        stats.none++;
        continue;
      }
      let state = score >= AUTO ? 'auto' : 'check';
      if (state === 'auto' && taken.has(best.id)) state = 'check';
      if (state === 'auto') taken.set(best.id, { siteId: s.siteId, score });
      this.data.links[s.siteId] = { hotelId: best.id, state, score };
      stats[state]++;
    }
    this.save();
    return stats;
  }

  // ---------- за админа ----------
  confirm(siteId) {
    const l = this.data.links[siteId];
    if (!l) throw new Error('Няма такава връзка');
    // друг хотел от сайта, вързан към същия H, се разкача
    for (const [sid, x] of Object.entries(this.data.links)) if (sid !== siteId && x.hotelId === l.hotelId && x.state !== 'check') this.data.links[sid] = { ...x, state: 'check' };
    l.state = 'ok';
    this.save();
  }

  link(siteId, hotelId) {
    if (!this.data.site[siteId]) throw new Error('Няма такъв хотел от сайта');
    for (const [sid, x] of Object.entries(this.data.links)) if (sid !== siteId && x.hotelId === hotelId && x.state !== 'check') this.data.links[sid] = { ...x, state: 'check' };
    this.data.blocked = this.data.blocked.filter((b) => b !== `${siteId}|${hotelId}`);
    this.data.links[siteId] = { hotelId, state: 'ok', score: 1 };
    this.save();
  }

  unlink(siteId) {
    const l = this.data.links[siteId];
    if (!l) throw new Error('Няма такава връзка');
    this.data.blocked.push(`${siteId}|${l.hotelId}`);
    delete this.data.links[siteId];
    this.save();
  }

  // Списък за преглед: state = check | none | linked
  list(state, q = '') {
    const s = String(q).trim().toLowerCase();
    const out = [];
    for (const x of Object.values(this.data.site)) {
      const l = this.data.links[x.siteId];
      const st = !l ? 'none' : l.state === 'check' ? 'check' : 'linked';
      if (state && st !== state) continue;
      if (s && !`${x.name} ${x.locality} ${x.siteId} ${l ? l.hotelId : ''}`.toLowerCase().includes(s)) continue;
      out.push({ site: x, link: l || null, state: st });
    }
    return out.sort((a, b) => (b.link ? b.link.score : 0) - (a.link ? a.link.score : 0) || a.site.name.localeCompare(b.site.name));
  }

  counts() {
    const c = { linked: 0, check: 0, none: 0 };
    for (const x of Object.values(this.data.site)) {
      const l = this.data.links[x.siteId];
      c[!l ? 'none' : l.state === 'check' ? 'check' : 'linked']++;
    }
    return c;
  }
}

module.exports = { ContentStore, siteArea, AUTO, CHECK };
