// Booking API за сайта (без външни пакети – само node:http).
//
//   GET  /api/health
//   GET  /api/areas                         курорти с брой хотели
//   GET  /api/hotels?q=...&area=...         търсене на хотел по име (за полето за търсене)
//   GET  /api/search?area=SIDE|hotel=H1&date=2027-06-15&nights=7&adults=2&childAges=5,9
//        JSON, или SSE при Accept: text/event-stream / &stream=1 (виж docs/api.md)
//   POST /api/offer/:offerKey/recheck        нова проверка на цената при доставчика
//   POST /api/booking                        заявка за резервация (статус „за потвърждение“)
//   GET  /api/hotel/H1                       снимки и описание от нашия сайт
//   GET  /                                   страницата за търсене (src/site/static)
//
// Нищо в отговорите към клиента не издава доставчика: няма име/код на доставчика,
// код на хотела при него, нетна цена или грешките по доставчици. Те отиват само в лога.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { parseSearch, parseBooking } = require('./params');
const { HttpError, sendJson, readJson, clientIp, RateLimit } = require('./http');
const { normArea } = require('../catalog/normalize');
const { promoPrice, promoLabel } = require('../promo');

// Страницата за търсене и резервация: / (busrent.eu/book/), само относителни адреси
const SITE_DIR = path.join(__dirname, '..', 'site', 'static');
const SITE_FILES = [['/', 'index.html', 'text/html; charset=utf-8'], ['/site.js', 'site.js', 'text/javascript; charset=utf-8'], ['/site.css', 'site.css', 'text/css; charset=utf-8']]
  .map(([url, f, type]) => [url, { text: fs.readFileSync(path.join(SITE_DIR, f), 'utf8'), type }]);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Страницата с логото и голямата снимка от нашия сайт (ако е зададен) – попълва се веднъж при старт.
// Логото води към logoUrl; по подразбиране './' – началото на търсачката (на сървъра busrent.eu/book/).
function sitePages(siteUrl, heroImage, logoUrl = './') {
  const logo = siteUrl
    ? `<a class="logo" href="${escAttr(logoUrl)}"><img src="${escAttr(siteUrl)}/img/logo.png" alt="Tours Club" width="158" height="41"></a>`
    : `<a class="logo brand" href="${escAttr(logoUrl)}">Tours Club</a>`;
  const hero = heroImage ? `<img class="hero-img" src="${escAttr(heroImage)}" alt="" fetchpriority="high">` : '';
  return Object.fromEntries(
    SITE_FILES.map(([url, f]) => [url, { type: f.type, body: Buffer.from(url === '/' ? f.text.replace('<!--LOGO-->', logo).replace('<!--HERO-->', hero) : f.text) }])
  );
}
// снимките идват направо от нашия сайт (siteUrl) – само оттам
const siteHeaders = (siteUrl) => ({
  'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:${siteUrl ? ` ${new URL(siteUrl).origin}` : ''}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
});

const DUPLICATE_MS = 10 * 60 * 1000; // повторно изпратена резервация (двоен клик) в този срок връща същата

// Лимит на заявките от едно IP – API-то е публично, а лимитът на Summer Tour е общ с TC Prices.
// [брой, за колко ms]
const LIMITS = {
  catalog: [120, 60000],
  promo: [10, 60000], // проверка на промо код – срещу налучкване
  search: [20, 60000],
  recheck: [20, 60000],
  booking: [5, 10 * 60000],
};

// admin – handler за /admin/... (src/admin/routes.js); без него админът не е включен
// content – снимки и описания от сайта (src/content/store.js); siteUrl – адресът на сайта (за CSP)
// settings – скрити курорти (src/settings.js): не се показват и не се търсят при операторите
function createApp({ engine, catalog, bookings, admin, content, settings, siteUrl = '', heroImage, logoUrl, corsOrigin = '', log = console, streamThrottleMs = 300, heartbeatMs = 15000, limits = {} }) {
  const SITE_HEADERS = siteHeaders(siteUrl);
  const SITE = sitePages(siteUrl, heroImage === undefined ? (siteUrl ? `${siteUrl}/img/SNIMKI/home_header_171255752436.jpg` : '') : heroImage, logoUrl || './');
  // снимка, оценка и адрес на страницата на хотела в сайта – към всеки хотел в резултатите
  const withContent = (h) => {
    const c = content && content.card(h.hotelId);
    return c ? { ...h, ...c } : h;
  };
  const allowed = new Set(String(corsOrigin).split(',').map((s) => s.trim()).filter(Boolean));
  const limiters = Object.fromEntries(Object.entries({ ...LIMITS, ...limits }).map(([k, [max, ms]]) => [k, new RateLimit(max, ms)]));

  // Хотел, който може да се търси: има връзка към поне един активен доставчик
  const hiddenArea = (a) => Boolean(settings) && settings.isHidden(a);
  // Промо код: цените се смятат тук (на сървъра), никога под нетната цена на оператора
  const findPromo = (code) => (settings && code ? settings.findPromo(code) : null);
  const promoInfo = (p) => (p ? { code: p.code, label: promoLabel(p) } : null);
  const withPromo = (promo) => (hotel) => {
    if (!promo) return hotel;
    const options = hotel.options
      .map((o) => {
        const x = engine.resolveOffer(o.offerKey);
        const price = x ? promoPrice(o.price, x.offer.total, promo) : o.price;
        return price < o.price ? { ...o, price, priceBefore: o.price } : o;
      })
      .sort((a, b) => a.price - b.price);
    const best = options.find((o) => o.available) || options[0];
    return { ...hotel, options, fromPrice: best ? best.price : hotel.fromPrice, fromPriceBefore: best && best.priceBefore ? best.priceBefore : undefined };
  };
  const searchable = (h) => !hiddenArea(h.area) && engine.activeOps().some((op) => engine.trusted(h.links[op]));
  const publicHotel = (h) => ({ hotelId: h.id, name: h.name, area: h.area, stars: h.stars || null });

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/areas$/, areas, 'catalog'],
    ['GET', /^\/api\/hotels$/, hotels, 'catalog'],
    ['GET', /^\/api\/search$/, search, 'search'],
    ['POST', /^\/api\/offer\/([A-Za-z0-9_-]{8,64})\/recheck$/, recheck, 'recheck'],
    ['POST', /^\/api\/booking$/, booking, 'booking'],
    ['GET', /^\/api\/hotel\/(H\d+)$/, hotelInfo, 'catalog'],
    ['GET', /^\/api\/promo\/([^/]{1,40})$/, promoCheck, 'promo'],
  ];

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (admin && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return admin(req, res, url);
    const page = SITE[url.pathname];
    if (page && (req.method === 'GET' || req.method === 'HEAD')) {
      // страницата за търсене (src/site/static) – за клиенти, без нищо от доставчиците
      res.writeHead(200, { 'Content-Type': page.type, 'Content-Length': page.body.length, ...SITE_HEADERS });
      res.end(req.method === 'HEAD' ? undefined : page.body);
      return;
    }
    setCorsHeaders(req, res); // CORS само за API-то на сайта, никога за админа
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    try {
      for (const [method, re, fn, limit] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        if (req.method !== method) throw new HttpError(405, 'Методът не е разрешен');
        const wait = limit ? limiters[limit].hit(clientIp(req)) : 0;
        if (wait) {
          res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
          throw new HttpError(429, 'Твърде много заявки. Опитайте отново след малко.');
        }
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

  // Проверка на промо код от сайта: { code, label } или 404
  function promoCheck({ match }) {
    let code = '';
    try {
      code = decodeURIComponent(match[1]);
    } catch {
      /* лош адрес */
    }
    const p = findPromo(code);
    if (!p) throw new HttpError(404, 'Невалиден или изтекъл промо код');
    return promoInfo(p);
  }

  // Снимки и описание на хотел (от нашия сайт). Без съдържание – само името.
  function hotelInfo({ match }) {
    const h = catalog.get(match[1]);
    if (!h || hiddenArea(h.area)) throw new HttpError(404, 'Няма такъв хотел');
    const c = content && content.full(h.id);
    return { ...publicHotel(h), photos: [], sections: [], ...(c || {}) };
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
    if (hotel && (!catalog.get(hotel) || hiddenArea(catalog.get(hotel).area))) throw new HttpError(404, 'Няма такъв хотел');
    // скрит курорт – и без заявки към операторите
    if (area && hiddenArea(normArea(area))) throw new HttpError(404, 'Няма такъв курорт');
    const stream = query.stream === '1' || /text\/event-stream/.test(req.headers.accept || '');
    const run = (opts) => (hotel ? engine.searchHotel(hotel, params, opts) : engine.searchArea(area, params, opts));
    const promo = findPromo(query.promo);
    const decorate = (h) => withPromo(promo)(withContent(h));
    const t0 = Date.now();
    const done = (r) => {
      const errs = Object.keys(r.errors || {});
      log.info(`[search] ${hotel || area} ${params.date}/${params.nights}н/${params.adults}+${params.childAges.length}: ${r.count} хотела, ${Date.now() - t0} ms` +
        `${r.unlinked ? `, ${r.unlinked} оферти извън каталога` : ''}${errs.length ? `, грешки: ${JSON.stringify(r.errors)}` : ''}`);
      return { count: r.count, incomplete: errs.length > 0, promo: promoInfo(promo) };
    };

    if (!stream) {
      const r = await run({});
      const { count, incomplete } = done(r);
      return { params: r.params, count, incomplete, promo: promoInfo(promo), hotels: r.hotels.map(decorate) };
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
      const changed = r.hotels.map(decorate).filter((h) => {
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
    if (!h || hiddenArea(h.area)) throw new HttpError(410, 'Тази оферта вече не е налична. Моля, изберете друга.', { reason: 'gone' });
    return { r, h, pub: engine.publicView(r.offer, r.entry.params, h.id) };
  }

  async function recheck({ match, query }) {
    const offerKey = match[1];
    const promo = findPromo(query.promo);
    const { r, pub } = await freshOffer(offerKey);
    const price = promo ? promoPrice(r.price, r.net, promo) : r.price;
    const previousPrice = promo ? promoPrice(r.previousPrice, r.previousNet, promo) : r.previousPrice;
    log.info(`[recheck] ${r.entry.op} ${r.entry.hotelCode}: ${previousPrice} -> ${price} ${pub.currency}, ${r.status}${promo ? `, промо ${promo.code}` : ''}`);
    return {
      offerKey: pub.offerKey,
      price,
      ...(price < r.price ? { priceBefore: r.price } : {}),
      previousPrice,
      changed: price !== previousPrice,
      currency: pub.currency,
      available: r.available,
      onRequest: !r.available,
      promo: promoInfo(promo),
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
    // промо кодът – наново тук; ако вече не важи, клиентът вижда цената без него и потвърждава
    const promoCode = String((body && body.promo) || '').trim();
    const promo = findPromo(promoCode);
    const price = promo ? promoPrice(r.price, r.net, promo) : r.price;
    if (price !== input.expectedPrice) {
      log.info(`[booking] цената се промени ${r.entry.op} ${r.entry.hotelCode}: ${input.expectedPrice} -> ${price}${promoCode && !promo ? ` (промо ${promoCode} не важи)` : ''}`);
      throw new HttpError(409, promoCode && !promo ? 'Промо кодът вече не важи. Моля, потвърдете цената без отстъпка.' : 'Цената се промени. Моля, потвърдете новата цена.', {
        reason: promoCode && !promo ? 'promo_invalid' : 'price_changed',
        offerKey: pub.offerKey,
        price,
        ...(price < r.price ? { priceBefore: r.price } : {}),
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
        price,
        ...(price < r.price ? { priceBefore: r.price, promo: promoInfo(promo) } : {}),
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
        ...(promo ? { promo: { code: promo.code, type: promo.type, value: promo.value }, sellBeforePromo: r.price } : {}),
        checkedAt: r.entry.checkedAt,
        sig,
      },
    });
    log.info(`[booking] ${b.id}: ${h.id} ${h.name} при ${r.entry.op} ${r.entry.hotelCode}, нетна ${o.total}, продажна ${price} ${pub.currency}${promo ? ` (промо ${promo.code}, без него ${r.price})` : ''}${r.available ? '' : ', по запитване'}`);
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
