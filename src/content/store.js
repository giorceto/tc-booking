// Снимки и описания на хотелите от нашия сайт, вързани към каталога (H<id>).
// data/content.json:
//   site:  { <siteId>: { siteId, name, stars, locality, url, photos, sections, lat, lon, rating, reviews, fetchedAt } }
//   other: { <siteId>: 'държава' }  – хотели извън Турция (не се теглят пак всеки път)
//   links: { <siteId>: { hotelId, state: 'auto'|'check'|'ok', score } }  – 'ok' е потвърдено от човек
//   blocked: ["<siteId>|H123", …]  – разкачени от човек, не се връзват пак автоматично
const fs = require('fs');
const path = require('path');
const { fingerprint, nameScore, normArea, cleanName } = require('../catalog/normalize');
const { toLatin } = require('../admin/translit');

// сходство на пълните имена (с общите думи) – за равенства: CRYSTAL BOUTIQUE ≠ CRYSTAL FAMILY COMFORT COLLECTION
function fullSimilarity(a, b) {
  const tri = (x) => {
    const t = ` ${cleanName(x)} `;
    const out = new Set();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const A = tri(a);
  const B = tri(b);
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return A.size + B.size ? (2 * n) / (A.size + B.size) : 0;
}

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
// Съседни курорти – границите при операторите и при сайта не съвпадат (Кушадасъ е в провинция Айдън,
// при някои оператори IZMIR; Raymar и Alarcha са в Сиде на сайта, но ALANYA в каталога и т.н.)
const NEAR = [['KUSADASI', 'IZMIR'], ['KUSADASI', 'AYDIN'], ['KUSADASI', 'DIDIM'], ['IZMIR', 'CESME'], ['SIDE', 'ALANYA'], ['SIDE', 'BELEK'], ['BELEK', 'ANTALYA'], ['ANTALYA', 'KEMER'], ['MARMARIS', 'DALAMAN'], ['DALAMAN', 'FETHIYE'], ['AYVALIK', 'EDREMIT']];
const near = new Set(NEAR.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
const areaPenalty = (a, b) => (!a || !b || a === b ? 0 : near.has(`${a}|${b}`) ? 0.05 : 0.15);

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
  // affected – само за тези хотели от каталога (след действие в админа): наново се връзват страниците,
  // които сочат към тях, и несигурните/невързаните; останалите пазят връзките си (иначе е ~4 сек)
  match(catalog, { affected } = {}) {
    // каталогът е сменен (напр. хотел е отделен) – връзки към несъществуващ хотел се махат
    for (const [sid, l] of Object.entries(this.data.links)) if (!catalog.get(l.hotelId)) delete this.data.links[sid];
    const only = affected
      ? new Set(Object.values(this.data.site).map((x) => x.siteId).filter((sid) => {
          const l = this.data.links[sid];
          return !l || l.state === 'check' || affected.includes(l.hotelId);
        }))
      : null;
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
    for (const [siteId, l] of Object.entries(this.data.links)) {
      if (l.state === 'ok' || (only && !only.has(siteId) && l.state === 'auto')) taken.set(l.hotelId, { siteId, score: 2 });
    }

    const found = [];
    for (const s of Object.values(this.data.site)) {
      if (only && !only.has(s.siteId)) continue;
      const cur = this.data.links[s.siteId];
      if (cur && cur.state === 'ok') {
        stats.ok++;
        continue;
      }
      const f = fingerprint(s.name);
      const area = siteArea(s.locality);
      let best = null;
      let bestScore = 0;
      let why = '';
      for (const h of catalog.data.hotels) {
        if (blocked.has(`${s.siteId}|${h.id}`)) continue;
        const scores = fp.get(h.id).map((x) => {
          const raw = nameScore(f, x.f);
          return { raw, sc: Math.min(x.max, raw) };
        });
        let sc = Math.max(...scores.map((x) => x.sc));
        if (sc < CHECK - 0.15) continue;
        const pen = areaPenalty(area, h.area);
        sc -= pen;
        if (sc > bestScore) {
          bestScore = sc;
          best = h;
          // защо не е сигурно (за прегледа в админа)
          why = Math.max(...scores.map((x) => x.raw)) - pen >= AUTO && Math.max(...scores.map((x) => x.raw)) > sc + pen ? 'catalog' : pen ? 'area' : 'name';
        }
      }
      // колко прилича на основното име на хотела в каталога – при равен резултат печели по-близкото
      // (иначе AQI PEGASOS RESORT взима H „AQI PEGASOS ROYAL“ заради име от връзка към друг хотел)
      const main = best ? nameScore(f, fp.get(best.id)[0].f) : 0;
      const full = best ? fullSimilarity(s.name, best.name) : 0;
      found.push({ s, best, score: Math.round(bestScore * 100) / 100, main, full, why });
    }
    // по-сигурните първи – ако два хотела от сайта сочат един и същ от каталога, вторият отива за проверка
    found.sort((a, b) => b.score - a.score || b.main - a.main || b.full - a.full);
    for (const { s, best, score, why } of found) {
      if (!best || score < CHECK) {
        delete this.data.links[s.siteId];
        stats.none++;
        continue;
      }
      let state = score >= AUTO ? 'auto' : 'check';
      let reason = state === 'check' ? why : '';
      if (state === 'auto' && taken.has(best.id)) {
        state = 'check';
        reason = `taken:${taken.get(best.id).siteId}`; // друга страница от сайта вече е вързана към същия хотел
      }
      if (state === 'auto') taken.set(best.id, { siteId: s.siteId, score });
      this.data.links[s.siteId] = { hotelId: best.id, state, score, ...(reason ? { why: reason } : {}) };
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
    for (const [sid, x] of Object.entries(this.data.links)) if (sid !== siteId && x.hotelId === l.hotelId && x.state !== 'check') this.data.links[sid] = { ...x, state: 'check', why: `taken:${siteId}` };
    l.state = 'ok';
    delete l.why;
    this.save();
  }

  link(siteId, hotelId) {
    if (!this.data.site[siteId]) throw new Error('Няма такъв хотел от сайта');
    for (const [sid, x] of Object.entries(this.data.links)) if (sid !== siteId && x.hotelId === hotelId && x.state !== 'check') this.data.links[sid] = { ...x, state: 'check', why: `taken:${siteId}` };
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
