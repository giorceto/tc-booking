// Търсачката за резервационната система.
// Търси паралелно при всички доставчици, обединява офертите по хотел от общия каталог
// и връща към клиента само най-добрата цена за всяка стая/изхранване – БЕЗ да показва доставчика.
// Кой доставчик стои зад офертата се пази само на сървъра (offerKey -> вътрешни данни).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { boardGroup, boardKeys, BOARD_LABEL, roomGroup, seaView, normArea, parseStars } = require('../catalog/normalize');
const { roomInfo } = require('../catalog/rooms');

const OFFER_TTL_MS = 30 * 60 * 1000; // колко време важи offerKey (после клиентът търси наново)

class SearchEngine {
  /**
   * @param {object} o
   * @param {import('../catalog/catalog')} o.catalog   общ каталог (hotels + links към кодовете при всеки оператор)
   * @param {object} o.suppliers                       { OP: client } от createSuppliers()
   * @param {number} [o.markupPct]                     надценка върху нетната цена
   * @param {number} [o.cacheMin]                      кеш на търсенията при доставчика (мин.)
   * @param {string} [o.dataDir]                       папка с hotels-OP.json (за търсене по курорт при Sedna)
   * @param {(op:string)=>boolean} [o.isActive]        изключване на доставчик без рестарт
   * @param {boolean} [o.useUnverified]                ползва и непроверените връзки от каталога (state 'check') – по подразбиране не
   * @param {import('../catalog/roomstore').RoomStore} [o.rooms]  стаите: ръчни връзки от админа и наблюдавани стаи
   */
  constructor({ catalog, suppliers, markupPct = 0, cacheMin = 15, dataDir, isActive = () => true, useUnverified = false, rooms = null }) {
    this.useUnverified = useUnverified;
    this.rooms = rooms;
    this.catalog = catalog;
    this.suppliers = suppliers;
    this.markupPct = markupPct;
    this.cacheMs = cacheMin * 60000;
    this.dataDir = dataDir || path.join(__dirname, '..', '..', 'data');
    this.isActive = isActive;
    this.cache = new Map(); // ключ -> { at, offers }
    this.inflight = new Map(); // ключ -> Promise – еднакви заявки, пуснати едновременно, отиват като една
    this.offers = new Map(); // offerKey -> { at, op, hotelCode, offer, params }
    // Тайна за offerKey: ключът е стабилен за една и съща оферта (важи и при стрийминг на части),
    // но не може да се отгатне отвън. Сменя се при рестарт – тогава и офертите в паметта се губят.
    this.keySecret = crypto.randomBytes(32);
    this.regionCache = new Map();
    setInterval(() => this.cleanup(), 5 * 60000).unref();
  }

  // Връзката от каталога може да се ползва за цени: непроверените (check) – не, докато човек не ги потвърди.
  // Грешна връзка = цена на друг хотел на сайта (виж docs/hotel-catalog.md).
  trusted(link) {
    return Boolean(link) && (this.useUnverified || link.state !== 'check');
  }

  // Стаята на офертата: еднакъв ключ за една и съща стая при различните оператори и наше име.
  // Ръчната връзка от админа (Стаи) бие автоматичното разпознаване.
  roomOf(hotelId, o) {
    if (this.rooms) return this.rooms.roomOf(hotelId, o);
    const r = roomInfo(o.room, o.roomType);
    return { key: r.key, label: r.label };
  }

  activeOps() {
    return Object.keys(this.suppliers).filter((op) => this.isActive(op));
  }

  // ---------- търсене по хотел ----------
  // onPart(publicResult) се вика всеки път, когато дойде отговор от доставчик (за стрийминг към сайта)
  async searchHotel(hotelId, params, { force = false, onPart } = {}) {
    const h = this.catalog.get(hotelId);
    if (!h) throw new Error('Няма такъв хотел');
    const all = [];
    const errors = {};
    await Promise.all(
      Object.entries(h.links)
        .filter(([op, link]) => this.suppliers[op] && this.isActive(op) && this.trusted(link))
        .map(async ([op, link]) => {
          try {
            const list = await this.cached(['H', op, link.code, params], force, async () => (await this.suppliers[op].search({ ...params, hotel: link.code })).offers);
            all.push(...list.map((o) => ({ ...o, op })));
            if (onPart) onPart(this.toPublic(all, params));
          } catch (e) {
            errors[op] = e.name === 'TimeoutError' ? 'timeout' : e.message;
          }
        })
    );
    return { ...this.toPublic(all, params), errors }; // errors е само за лога/админа, не за клиента
  }

  // ---------- търсене по курорт ----------
  async searchArea(area, params, { force = false, onPart } = {}) {
    area = normArea(area);
    if (!area) throw new Error('Изберете курорт');
    const all = [];
    const errors = {};
    const push = (op, list) => {
      all.push(...list.map((o) => ({ ...o, op })));
      if (onPart) onPart(this.toPublic(all, params));
    };
    await Promise.all(
      this.activeOps().map(async (op) => {
        const c = this.suppliers[op];
        try {
          if (c.type === 'sejour') {
            const regs = (await this.regions(op)).filter((r) => normArea(r.Name) === area);
            await Promise.all(
              regs.map(async (r) => {
                const list = await this.cached(['R', op, r.Code, params], force, async () => (await c.searchRegion({ region: r.Code, ...params })).map(c.normalize));
                push(op, list);
              })
            );
          } else if (c.type === 'sedna') {
            const ids = this.supplierHotels(op).filter((x) => normArea(x.area) === area).map((x) => x.id).filter(Boolean);
            const chunks = [];
            for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30)); // HotelList: ~7 сек за 30-40 хотела
            await Promise.all(
              chunks.map(async (ch) => {
                const list = await this.cached(['M', op, ch.join(','), params], force, async () =>
                  (await c.searchMany({ hotelIds: ch, ...params })).map((o) => c.normalize(o, params.date, params.nights))
                );
                push(op, list);
              })
            );
          }
        } catch (e) {
          errors[op] = e.name === 'TimeoutError' ? 'timeout' : e.message;
        }
      })
    );
    return { ...this.toPublic(all, params), errors };
  }

  // ---------- от сурови оферти към това, което вижда клиентът ----------
  toPublic(rawOffers, params) {
    const byHotel = new Map();
    let unlinked = 0;
    for (const o of rawOffers) {
      const h = this.catalog.byLink.get(`${o.op}:${o.hotelCode}`);
      if (!h) {
        unlinked++; // хотел, който още не е в каталога – не го показваме (няма описание/снимки и издава кода на доставчика)
        continue;
      }
      if (!this.trusted(h.links[o.op])) {
        unlinked++; // непроверена връзка – може да е друг хотел
        continue;
      }
      if (o.total == null || !(o.total > 0)) continue;
      if (this.rooms) this.rooms.observe(h.id, o);
      if (!byHotel.has(h.id)) byHotel.set(h.id, { hotel: h, offers: [] });
      byHotel.get(h.id).offers.push(o);
    }
    const hotels = [];
    for (const { hotel: h, offers } of byHotel.values()) {
      // една и съща стая (по характеристики, не по името при оператора) + изхранване (концепциите – виж boardKeys)
      const boards = boardKeys(offers);
      const groups = new Map();
      for (const o of offers) {
        const key = `${this.roomOf(h.id, o).key}|${boards.get(o).boardKey}`;
        const cur = groups.get(key);
        if (!cur || better(o, cur)) groups.set(key, o);
      }
      const options = [...groups.values()].map((o) => this.publicOffer(h, o, params, boards.get(o))).sort((a, b) => a.price - b.price);
      const bestAvail = options.find((x) => x.available) || options[0];
      hotels.push({
        hotelId: h.id,
        name: h.name,
        area: h.area,
        stars: h.stars || parseStars(h.cat).stars || null,
        fromPrice: bestAvail ? bestAvail.price : null,
        currency: bestAvail ? bestAvail.currency : null,
        options,
      });
    }
    hotels.sort((a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity));
    return { params, count: hotels.length, hotels, unlinked };
  }

  // Офертата, каквато я вижда клиентът; запомня offerKey -> вътрешни данни (за resolveOffer)
  publicOffer(h, o, params, board) {
    const view = this.publicView(o, params, h.id, board);
    this.offers.set(view.offerKey, { at: Date.now(), op: o.op, hotelId: h.id, hotelCode: o.hotelCode, offer: o, params, board });
    return view;
  }

  // Само изгледът за клиента, без да се записва нищо. board – изхранването от търсенето (boardKeys), ако е известно
  publicView(o, params, hotelId, board) {
    const bg = boardGroup(o.board, o.boardName);
    const generic = BOARD_LABEL[bg] || o.boardName || bg;
    const b = board || { board: bg, boardKey: bg, boardLabel: generic, boardGroupLabel: generic };
    const room = this.roomOf(hotelId, o);
    return {
      offerKey: this.offerKey(o, params),
      room: room.label, // нашето име – името при оператора е характерно и издава кой е
      roomKey: room.key,
      roomGroup: roomGroup(o.room, o.roomType),
      seaView: seaView(o.room, o.roomType, o.roomTypeCode),
      board: b.board, // група: UAI, AI, HB… (за филтъра)
      boardKey: b.boardKey, // = board, или board~КОНЦЕПЦИЯ, когато хотелът има няколко (TITANIC DELUXE)
      boardLabel: b.boardLabel,
      boardGroupLabel: b.boardGroupLabel,
      price: this.sellPrice(o.total),
      currency: o.currency || 'EUR',
      available: o.status === 'OK',
      eb: o.eb || 0,
      checkIn: o.checkIn || params.date,
      nights: o.nights || params.nights,
    };
  }

  // Продажна цена: нетна + надценка, закръглена нагоре до цяло евро.
  // Първо до центове – иначе 1400 × 1.1 = 1540.0000000000002 и Math.ceil дава 1541.
  sellPrice(net) {
    return Math.ceil(Math.round(net * (1 + this.markupPct / 100) * 100) / 100);
  }

  // Стабилен ключ за офертата: еднаква оферта (доставчик, хотел, стая, изхранване, дати, хора) -> еднакъв ключ
  offerKey(o, params) {
    const id = [offerIdentity(o), params.date, params.nights, params.adults, (params.childAges || []).join('-')].join('|');
    return crypto.createHmac('sha256', this.keySecret).update(id).digest('base64url').slice(0, 16);
  }

  // Само за сървъра (резервация / админ): кой доставчик и кой код стоят зад офертата
  resolveOffer(offerKey) {
    const x = this.offers.get(offerKey);
    if (!x || Date.now() - x.at > OFFER_TTL_MS) return null;
    return x;
  }

  // Проверява цената наново при същия доставчик, без кеш (преди резервация/плащане).
  // Връща { found:false, reason } или { found:true, entry, offer, net, price, previousPrice, available, status }.
  // reason: 'expired' – ключът е изтекъл/непознат; 'supplier' – доставчикът е изключен; 'gone' – офертата я няма вече.
  // Грешка от доставчика (timeout и др.) се хвърля нагоре.
  async recheck(offerKey) {
    const x = this.resolveOffer(offerKey);
    if (!x) return { found: false, reason: 'expired' };
    const c = this.suppliers[x.op];
    if (!c || !this.isActive(x.op)) return { found: false, reason: 'supplier' };
    // Sedna търси по числово HotelId – ако го имаме от офертата, не теглим списъка с хотели
    const hotel = c.type === 'sedna' && x.offer.hotelId ? x.offer.hotelId : x.hotelCode;
    const { date, nights, adults, childAges = [] } = x.params;
    const { offers } = await c.search({ hotel, date, nights, adults, childAges });
    const id = offerIdentity(x.offer);
    let best = null;
    for (const o of offers) {
      const oo = { ...o, op: x.op };
      if (oo.total > 0 && offerIdentity(oo) === id && (!best || better(oo, best))) best = oo;
    }
    if (!best) return { found: false, reason: 'gone', entry: x };
    const previousPrice = this.sellPrice(x.offer.total);
    const previousNet = x.offer.total;
    // офертата в паметта става новата – резервацията след проверката ползва точно нея
    Object.assign(x, { at: Date.now(), offer: best, checkedAt: new Date().toISOString() });
    return {
      found: true,
      entry: x,
      offer: best,
      net: best.total,
      price: this.sellPrice(best.total),
      previousPrice,
      previousNet,
      available: best.status === 'OK',
      status: best.status,
    };
  }

  // ---------- помощни ----------
  async cached(parts, force, fn) {
    const [kind, op, code, p] = parts;
    const key = [kind, op, code, p.date, p.nights, p.adults, (p.childAges || []).join('-')].join('|');
    const hit = this.cache.get(key);
    if (!force && hit && Date.now() - hit.at < this.cacheMs) return hit.offers;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p2 = (async () => {
      const offers = await fn();
      this.cache.set(key, { at: Date.now(), offers });
      return offers;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p2);
    return p2;
  }

  async regions(op) {
    const c = this.regionCache.get(op);
    if (c && Date.now() - c.at < 6 * 3600 * 1000) return c.list;
    const list = await this.suppliers[op].regions();
    this.regionCache.set(op, { at: Date.now(), list });
    return list;
  }

  supplierHotels(op) {
    for (const dir of [this.dataDir, path.join(this.dataDir, 'seed')]) {
      const f = path.join(dir, `hotels-${op}.json`);
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    return [];
  }

  cleanup() {
    const now = Date.now();
    for (const [k, v] of this.cache) if (now - v.at > this.cacheMs) this.cache.delete(k);
    for (const [k, v] of this.offers) if (now - v.at > OFFER_TTL_MS) this.offers.delete(k);
  }
}

// Коя е офертата: доставчик + хотел + стая + изхранване (без цена и наличност – те се менят)
function offerIdentity(o) {
  return [o.op, o.hotelCode, o.roomCode, o.roomTypeCode, o.board, o.room].map((x) => (x == null ? '' : String(x))).join('|');
}

// Налична оферта бие "по запитване"; при равни – по-евтината
function better(a, b) {
  const av = a.status === 'OK', bv = b.status === 'OK';
  if (av !== bv) return av;
  return a.total < b.total;
}

module.exports = { SearchEngine };
