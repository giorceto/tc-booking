// Booking API за сайта (без външни пакети – само node:http).
//
//   GET  /api/health
//   GET  /api/areas                         курорти с брой хотели
//   GET  /api/hotels?q=...&area=...         търсене на хотел по име (за полето за търсене)
//   GET  /api/search?area=SIDE|hotel=H1&date=2027-06-15&nights=7&adults=2&childAges=5,9
//        JSON, или SSE при Accept: text/event-stream / &stream=1 (виж docs/api.md)
//   POST /api/offer/:offerKey/recheck        нова проверка на цената при доставчика
//   POST /api/booking                        заявка за резервация (статус „за потвърждение“)
//
// Нищо в отговорите към клиента не издава доставчика: няма име/код на доставчика,
// код на хотела при него, нетна цена или грешките по доставчици. Те отиват само в лога.
const http = require('http');
const { parseSearch, parseBooking } = require('./params');
const { HttpError, sendJson, readJson } = require('./http');

const DUPLICATE_MS = 10 * 60 * 1000; // повторно изпратена резервация (двоен клик) в този срок връща същата

// admin – handler за /admin/... (src/admin/routes.js); без него админът не е включен
function createApp({ engine, catalog, bookings, admin, corsOrigin = '', log = console, streamThrottleMs = 300, heartbeatMs = 15000 }) {
  const allowed = new Set(String(corsOrigin).split(',').map((s) => s.trim()).filter(Boolean));

  // Хотел, който може да се търси: има връзка към поне един активен доставчик
  const searchable = (h) => engine.activeOps().some((op) => h.links[op]);
  const publicHotel = (h) => ({ hotelId: h.id, name: h.name, area: h.area, stars: h.stars || null });

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/areas$/, areas],
    ['GET', /^\/api\/hotels$/, hotels],
    ['GET', /^\/api\/search$/, search],
    ['POST', /^\/api\/offer\/([A-Za-z0-9_-]{8,64})\/recheck$/, recheck],
    ['POST', /^\/api\/booking$/, booking],
  ];

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (admin && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return admin(req, res, url);
    setCorsHeaders(req, res); // CORS само за API-то на сайта, никога за админа
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    try {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        if (req.method !== method) throw new HttpError(405, 'Методът не е разрешен');
        const out = await fn({ req, res, url, query: Object.fromEntries(url.searchParams), match: m });
        if (out !== undefined) sendJson(res, out.status || 200, out.body !== undefined ? out.body : out);
        return;
      }
      throw new HttpError(404, 'Няма такъв адрес');
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
      else {
        log.error(`[api] ${req.method} ${url.pathname}:`, e);
        sendJson(res, 500, { error: 'Вътрешна грешка. Опитайте отново.' });
      }
    }
  }

  function setCorsHeaders(req, res) {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  // ---------- каталог ----------
  function areas() {
    const count = new Map();
    for (const h of catalog.data.hotels) if (h.area && searchable(h)) count.set(h.area, (count.get(h.area) || 0) + 1);
    return { areas: [...count].map(([area, hotels]) => ({ area, hotels })).sort((a, b) => b.hotels - a.hotels) };
  }

  function hotels({ query }) {
    const q = String(query.q || '').trim();
    if (q.length < 2) throw new HttpError(400, 'Напишете поне 2 букви');
    const area = String(query.area || '').trim().toUpperCase();
    const list = catalog
      .search(q, 200, { codes: false })
      .filter((h) => searchable(h) && (!area || h.area === area))
      .slice(0, 20)
      .map(publicHotel);
    return { hotels: list };
  }

  // ---------- търсене ----------
  async function search({ req, res, query }) {
    const { area, hotel, params } = parseSearch(query);
    if (hotel && !catalog.get(hotel)) throw new HttpError(404, 'Няма такъв хотел');
    const stream = query.stream === '1' || /text\/event-stream/.test(req.headers.accept || '');
    const run = (opts) => (hotel ? engine.searchHotel(hotel, params, opts) : engine.searchArea(area, params, opts));
    const t0 = Date.now();
    const done = (r) => {
      const errs = Object.keys(r.errors || {});
      log.info(`[search] ${hotel || area} ${params.date}/${params.nights}н/${params.adults}+${params.childAges.length}: ${r.count} хотела, ${Date.now() - t0} ms` +
        `${r.unlinked ? `, ${r.unlinked} оферти извън каталога` : ''}${errs.length ? `, грешки: ${JSON.stringify(r.errors)}` : ''}`);
      return { count: r.count, incomplete: errs.length > 0 };
    };

    if (!stream) {
      const r = await run({});
      const { count, incomplete } = done(r);
      return { params: r.params, count, incomplete, hotels: r.hotels };
    }

    // SSE: събитие "part" при всеки нов отговор (само хотелите, които са нови или са се променили),
    // "done" накрая. Сайтът обединява хотелите по hotelId.
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let closed = false;
    res.on('close', () => (closed = true));
    const send = (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write(': start\n\n');
    const sent = new Map(); // hotelId -> JSON, изпратен последно
    const sendDelta = (r) => {
      const changed = r.hotels.filter((h) => {
        const j = JSON.stringify(h);
        if (sent.get(h.hotelId) === j) return false;
        sent.set(h.hotelId, j);
        return true;
      });
      if (changed.length) send('part', { count: r.count, hotels: changed });
    };
    let latest = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (latest) sendDelta(latest);
      latest = null;
    };
    const beat = setInterval(() => !closed && res.write(': ping\n\n'), heartbeatMs);
    try {
      const r = await run({
        onPart: (p) => {
          latest = p;
          if (!timer) timer = setTimeout(flush, streamThrottleMs);
        },
      });
      clearTimeout(timer);
      sendDelta(r);
      send('done', done(r));
    } catch (e) {
      clearTimeout(timer);
      log.error('[search] грешка:', e);
      send('error', { error: 'Търсенето не успя. Опитайте отново.' });
    } finally {
      clearInterval(beat);
      res.end();
    }
    return undefined;
  }

  // ---------- проверка на цената ----------
  // Връща { r, pub } или хвърля HttpError, ако офертата не може да се продаде
  async function freshOffer(offerKey) {
    let r;
    try {
      r = await engine.recheck(offerKey);
    } catch (e) {
      const x = engine.resolveOffer(offerKey);
      log.warn(`[recheck] ${x ? x.op : '?'} ${x ? x.hotelCode : ''}: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`);
      throw new HttpError(502, 'Не успяхме да проверим цената. Опитайте отново след малко.');
    }
    if (!r.found) {
      if (r.reason === 'expired') throw new HttpError(410, 'Офертата е изтекла. Моля, потърсете отново.', { reason: 'expired' });
      throw new HttpError(410, 'Тази оферта вече не е налична. Моля, изберете друга.', { reason: 'gone' });
    }
    if (r.status === 'STOP') throw new HttpError(410, 'Няма свободни места за тази оферта. Моля, изберете друга.', { reason: 'stop' });
    const h = catalog.get(r.entry.hotelId);
    if (!h) throw new HttpError(410, 'Тази оферта вече не е налична. Моля, изберете друга.', { reason: 'gone' });
    return { r, h, pub: engine.publicView(r.offer, r.entry.params) };
  }

  async function recheck({ match }) {
    const offerKey = match[1];
    const { r, pub } = await freshOffer(offerKey);
    log.info(`[recheck] ${r.entry.op} ${r.entry.hotelCode}: ${r.previousPrice} -> ${r.price} ${pub.currency}, ${r.status}`);
    return {
      offerKey: pub.offerKey,
      price: r.price,
      previousPrice: r.previousPrice,
      changed: r.price !== r.previousPrice,
      currency: pub.currency,
      available: r.available,
      onRequest: !r.available,
    };
  }

  // ---------- резервация ----------
  async function booking({ req }) {
    const body = await readJson(req);
    const offerKey = String((body && body.offerKey) || '');
    const x = offerKey && engine.resolveOffer(offerKey);
    if (!x) throw new HttpError(410, 'Офертата е изтекла. Моля, потърсете отново.', { reason: 'expired' });
    const input = parseBooking(body, { adults: x.params.adults, children: (x.params.childAges || []).length });

    // двоен клик / повторно изпращане – връщаме вече направената заявка
    const sig = JSON.stringify([offerKey, input.contact.email.toLowerCase(), input.guests]);
    const dup = bookings.list({ status: 'pending' }).find((b) => b.internal.sig === sig && Date.now() - Date.parse(b.createdAt) < DUPLICATE_MS);
    if (dup) return { status: 200, body: { ...bookingView(dup), duplicate: true } };

    const { r, h, pub } = await freshOffer(offerKey);
    if (r.price !== input.expectedPrice) {
      log.info(`[booking] цената се промени ${r.entry.op} ${r.entry.hotelCode}: ${input.expectedPrice} -> ${r.price}`);
      throw new HttpError(409, 'Цената се промени. Моля, потвърдете новата цена.', {
        reason: 'price_changed',
        offerKey: pub.offerKey,
        price: r.price,
        previousPrice: input.expectedPrice,
        currency: pub.currency,
        available: r.available,
      });
    }
    const o = r.offer;
    const supplier = engine.suppliers[r.entry.op] || {};
    const b = bookings.create({
      public: {
        offerKey: pub.offerKey,
        hotelId: h.id,
        hotelName: h.name,
        area: h.area,
        stars: h.stars || null,
        room: pub.room,
        roomGroup: pub.roomGroup,
        seaView: pub.seaView,
        board: pub.board,
        boardLabel: pub.boardLabel,
        checkIn: pub.checkIn,
        nights: pub.nights,
        adults: r.entry.params.adults,
        childAges: r.entry.params.childAges || [],
        price: pub.price,
        currency: pub.currency,
        onRequest: !r.available,
      },
      contact: input.contact,
      guests: input.guests,
      note: input.note,
      internal: {
        op: r.entry.op,
        opName: supplier.name || r.entry.op,
        hotelCode: r.entry.hotelCode,
        supplierHotelId: o.hotelId ?? null,
        supplierHotelName: o.hotelName || '',
        room: o.room,
        roomCode: o.roomCode,
        roomType: o.roomType,
        roomTypeCode: o.roomTypeCode,
        board: o.board,
        boardName: o.boardName,
        net: o.total,
        currency: o.currency || 'EUR',
        eb: o.eb || 0,
        supplierStatus: o.status,
        supplierStatusText: o.statusText || '',
        markupPct: engine.markupPct,
        checkedAt: r.entry.checkedAt,
        sig,
      },
    });
    log.info(`[booking] ${b.id}: ${h.id} ${h.name} при ${r.entry.op} ${r.entry.hotelCode}, нетна ${o.total}, продажна ${pub.price} ${pub.currency}${r.available ? '' : ', по запитване'}`);
    return { status: 201, body: bookingView(b) };
  }

  // Какво вижда клиентът за резервацията
  const bookingView = (b) => {
    const { offerKey, ...pub } = b.public;
    return { bookingId: b.id, status: b.status, createdAt: b.createdAt, ...pub };
  };

  return handler;
}

function createServer(opts) {
  const handler = createApp(opts);
  return http.createServer((req, res) => {
    handler(req, res);
  });
}

module.exports = { createApp, createServer };
