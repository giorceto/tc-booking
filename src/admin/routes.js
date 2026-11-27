// Админ за служителите: резервации с доставчика и нетната цена, смяна на статуса.
//
//   GET  /admin/                              страницата (src/admin/static)
//   POST /admin/api/login  { user, password }  вход – бисквитка tcb_sid (HttpOnly, SameSite=Strict)
//   POST /admin/api/logout
//   GET  /admin/api/me
//   GET  /admin/api/bookings?status=pending&q=…
//   GET  /admin/api/bookings/:id
//   POST /admin/api/bookings/:id/status  { status, supplierRef?, comment? }
//   POST /admin/api/bookings/:id/comment { comment }
//
// Страницата ползва само относителни адреси – работи и зад Caddy с handle_path (напр. /booking/admin/).
const fs = require('fs');
const path = require('path');
const { HttpError, sendJson, readJson, clientIp, isHttps, parseCookies } = require('../api/http');
const { Sessions, LoginGuard } = require('../auth');
const { NEXT, STATUSES } = require('../bookings/store');
const { toLatin } = require('./translit');

const COOKIE = 'tcb_sid';
const STATIC_DIR = path.join(__dirname, 'static');
const STATIC = {
  '/admin/': ['index.html', 'text/html; charset=utf-8'],
  '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const PAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function createAdmin({ bookings, users, sessions = new Sessions(), guard = new LoginGuard(), log = console }) {
  const files = Object.fromEntries(Object.entries(STATIC).map(([url, [f, type]]) => [url, { body: fs.readFileSync(path.join(STATIC_DIR, f)), type }]));

  const routes = [
    ['POST', /^\/admin\/api\/login$/, login, { public: true }],
    ['POST', /^\/admin\/api\/logout$/, logout, { public: true }],
    ['GET', /^\/admin\/api\/me$/, ({ user }) => ({ user })],
    ['GET', /^\/admin\/api\/bookings$/, list],
    ['GET', /^\/admin\/api\/bookings\/(TCB-\d+)$/, detail],
    ['POST', /^\/admin\/api\/bookings\/(TCB-\d+)\/status$/, setStatus],
    ['POST', /^\/admin\/api\/bookings\/(TCB-\d+)\/comment$/, comment],
  ];

  async function admin(req, res, url) {
    try {
      if (url.pathname === '/admin') {
        // относително – запазва префикса на Caddy (/booking/admin -> /booking/admin/)
        res.writeHead(301, { Location: 'admin/' }).end();
        return;
      }
      const f = files[url.pathname];
      if (f) {
        if (req.method !== 'GET') throw new HttpError(405, 'Методът не е разрешен');
        res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.body.length, ...PAGE_HEADERS });
        res.end(f.body);
        return;
      }
      for (const [method, re, fn, opt = {}] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        if (req.method !== method) throw new HttpError(405, 'Методът не е разрешен');
        const token = parseCookies(req)[COOKIE];
        const s = sessions.get(token);
        // потребител, изтрит от data/users.json, излиза веднага
        const user = s && users.list().includes(s.user) ? s.user : null;
        if (!user && !opt.public) throw new HttpError(401, 'Влезте отново');
        const body = method === 'POST' ? await readJson(req) : undefined;
        const out = await fn({ req, res, url, query: Object.fromEntries(url.searchParams), match: m, body, user, token });
        sendJson(res, 200, out);
        return;
      }
      throw new HttpError(404, 'Няма такъв адрес');
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
      else {
        log.error(`[admin] ${req.method} ${url.pathname}:`, e);
        sendJson(res, 500, { error: 'Вътрешна грешка' });
      }
    }
  }

  // ---------- вход ----------
  async function login({ req, res, body }) {
    const name = String((body && body.user) || '').trim().toLowerCase();
    const ip = clientIp(req);
    const keys = [`ip:${ip}`, `user:${name}`];
    if (guard.blocked(...keys)) {
      log.warn(`[admin] вход спрян за ${name} от ${ip} – много грешни опити`);
      throw new HttpError(429, 'Много грешни опити. Опитайте пак след 15 минути.');
    }
    const user = users.check(name, body && body.password);
    if (!user) {
      guard.fail(...keys);
      log.warn(`[admin] грешна парола за ${name} от ${ip}`);
      throw new HttpError(401, 'Грешно име или парола');
    }
    guard.reset(...keys);
    const token = sessions.create(user);
    const cookie = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=604800'];
    if (isHttps(req)) cookie.push('Secure');
    res.setHeader('Set-Cookie', cookie.join('; '));
    log.info(`[admin] вход: ${user} от ${ip}`);
    return { user };
  }

  function logout({ res, token, user }) {
    sessions.destroy(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    if (user) log.info(`[admin] изход: ${user}`);
    return { ok: true };
  }

  // ---------- резервации ----------
  function list({ query }) {
    const status = STATUSES.includes(query.status) ? query.status : undefined;
    const all = bookings.list({ status, q: query.q });
    return { counts: bookings.counts(), total: all.length, bookings: all.slice(0, 500).map(summary) };
  }

  const get = (id) => {
    const b = bookings.get(id);
    if (!b) throw new HttpError(404, 'Няма такава резервация');
    return b;
  };

  function detail({ match }) {
    return full(get(match[1]));
  }

  function setStatus({ match, body, user }) {
    const b = get(match[1]);
    const status = String(body.status || '');
    try {
      bookings.setStatus(b.id, status, { by: user, supplierRef: body.supplierRef, comment: body.comment ? String(body.comment).slice(0, 2000) : '' });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: ${b.id} -> ${status}${b.internal.supplierRef ? ` (${b.internal.supplierRef})` : ''}`);
    return full(b);
  }

  function comment({ match, body, user }) {
    const b = get(match[1]);
    try {
      bookings.addComment(b.id, String(body.comment || '').slice(0, 2000), { by: user });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    return full(b);
  }

  return admin;
}

// ---------- изгледи ----------
const margin = (b) => (b.internal.currency === b.public.currency && b.internal.net != null ? Math.round((b.public.price - b.internal.net) * 100) / 100 : null);

function summary(b) {
  const g = b.guests[0] || {};
  return {
    id: b.id,
    createdAt: b.createdAt,
    status: b.status,
    hotelName: b.public.hotelName,
    area: b.public.area,
    checkIn: b.public.checkIn,
    nights: b.public.nights,
    adults: b.public.adults,
    children: (b.public.childAges || []).length,
    guest: [g.firstName, g.lastName].filter(Boolean).join(' '),
    contactName: b.contact.name,
    price: b.public.price,
    currency: b.public.currency,
    net: b.internal.net,
    netCurrency: b.internal.currency,
    margin: margin(b),
    op: b.internal.op,
    opName: b.internal.opName,
    onRequest: b.public.onRequest,
    supplierRef: b.internal.supplierRef || '',
  };
}

function full(b) {
  const { sig, ...internal } = b.internal;
  return { ...b, internal, margin: margin(b), next: NEXT[b.status], portalText: portalText(b) };
}

const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Текст за служителя – какво да въведе в портала на доставчика. Имената на гостите – на латиница, главни букви.
function portalText(b) {
  const p = b.public;
  const i = b.internal;
  const ages = p.childAges || [];
  const pax = `${p.adults} възр.${ages.length ? ` + ${ages.length} дете/деца (${ages.join(', ')} г.)` : ''}`;
  return [
    `Доставчик: ${i.opName} (${i.op})`,
    `Хотел: ${i.supplierHotelName || p.hotelName} [${i.hotelCode}]`,
    `Стая: ${i.room || ''}${i.roomCode ? ` [${i.roomCode}]` : ''}`,
    `Изхранване: ${i.boardName || i.board || ''}${i.board ? ` [${i.board}]` : ''}`,
    `Настаняване: ${p.checkIn} – ${addDays(p.checkIn, p.nights)}, ${p.nights} нощ.`,
    `Гости: ${pax}`,
    ...b.guests.map((g, n) => `  ${n + 1}. ${toLatin(g.lastName).toUpperCase()} ${toLatin(g.firstName).toUpperCase()}${g.birthDate ? ` – ${g.birthDate}` : ''}`),
    `Нетна цена при проверката: ${i.net} ${i.currency}${i.eb ? ` (EB ${i.eb}%)` : ''}${p.onRequest ? ', по запитване' : ''}`,
    `Наш номер: ${b.id}`,
  ].join('\n');
}

module.exports = { createAdmin, portalText };
