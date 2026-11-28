// Къде е хотелът (за картата на сайта).
// 1) нашият сайт (tours-club.com) – координатите от картата на страницата на хотела;
// 2) списъкът хотели при оператор (Summer Tour дава Latitude/Longitude) – само по проверена връзка.
// Приемат се само точки в Турция. Изчислява се наново най-много веднъж на ttlMs (каталогът и списъците се менят нощем).
const TURKEY = { lat: [35.7, 42.3], lon: [25.5, 45] };

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
function point(lat, lon) {
  const a = num(lat);
  const b = num(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < TURKEY.lat[0] || a > TURKEY.lat[1] || b < TURKEY.lon[0] || b > TURKEY.lon[1]) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lon: Math.round(b * 1e6) / 1e6 };
}

class Geo {
  /**
   * @param catalog   каталогът (hotels, links)
   * @param content   ContentStore (по желание) – geo(hotelId) от нашия сайт
   * @param hotelsOf  (op) => списъкът хотели при оператора [{ code, id?, lat|latitude, lng|lon|longitude }]
   * @param trusted   (link) => дали връзката е проверена (непроверената може да е друг хотел)
   */
  constructor({ catalog, content = null, hotelsOf = () => [], trusted = () => true, ttlMs = 10 * 60000 }) {
    Object.assign(this, { catalog, content, hotelsOf, trusted, ttlMs });
    this.map = null;
    this.at = 0;
  }

  build() {
    const lists = new Map(); // op -> Map(code -> точка)
    const listOf = (op) => {
      if (!lists.has(op)) {
        const m = new Map();
        for (const x of this.hotelsOf(op) || []) {
          const p = point(x.lat ?? x.latitude, x.lng ?? x.lon ?? x.longitude);
          if (!p) continue;
          if (x.code != null) m.set(String(x.code), p);
          if (x.id != null) m.set(String(x.id), p);
        }
        lists.set(op, m);
      }
      return lists.get(op);
    };
    const map = new Map();
    for (const h of this.catalog.data.hotels) {
      const c = this.content && this.content.geo(h.id);
      let p = c ? point(c.lat, c.lon) : null;
      if (p) p.src = 'site';
      for (const [op, l] of Object.entries(h.links || {})) {
        if (p) break;
        if (!l || !this.trusted(l)) continue;
        const q = listOf(op).get(String(l.code));
        if (q) p = { ...q, src: op };
      }
      if (p) map.set(h.id, p);
    }
    this.map = map;
    this.at = Date.now();
    return map;
  }

  /** { lat, lon, src } или null */
  get(hotelId) {
    if (!this.map || Date.now() - this.at > this.ttlMs) this.build();
    const p = this.map.get(hotelId);
    return p ? { lat: p.lat, lon: p.lon } : null;
  }

  stats() {
    if (!this.map) this.build();
    const bySrc = {};
    for (const p of this.map.values()) bySrc[p.src] = (bySrc[p.src] || 0) + 1;
    return { hotels: this.catalog.data.hotels.length, withGeo: this.map.size, bySrc };
  }
}

module.exports = { Geo, point };
