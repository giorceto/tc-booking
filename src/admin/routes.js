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
//   GET  /admin/api/users                     потребители (само администратор)
//   POST /admin/api/users { name, password, role }        нов потребител (само администратор)
//   POST /admin/api/users/:name/password|role|delete     (само администратор)
//   POST /admin/api/password { current, password }       собствената парола (всеки)
//
// Страницата ползва само относителни адреси – работи и зад Caddy с handle_path (напр. /booking/admin/).
const fs = require('fs');
const path = require('path');
const { HttpError, sendJson, readJson, clientIp, isHttps, parseCookies } = require('../api/http');
const { Sessions, LoginGuard, ROLES } = require('../auth');
const { NEXT, STATUSES } = require('../bookings/store');
const { toLatin } = require('./translit');
const { parsePromo, promoLabel, promoValid } = require('../promo');

const COOKIE = 'tcb_sid';
const STATIC_DIR = path.join(__dirname, 'static');
const STATIC = {
  '/admin/': ['index.html', 'text/html; charset=utf-8'],
  '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const pageHeaders = (siteUrl) => ({
  'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:${siteUrl ? ` ${new URL(siteUrl).origin}` : ''}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
});

// content/catalog – по желание: преглед на снимките от сайта и връзките им с каталога
function createAdmin({ bookings, users, content, catalog, catalogJob, settings, rooms, opNames = {}, siteUrl = '', sessions = new Sessions(), guard = new LoginGuard(), log = console }) {
  const PAGE_HEADERS = pageHeaders(siteUrl);
  const files = Object.fromEntries(Object.entries(STATIC).map(([url, [f, type]]) => [url, { body: fs.readFileSync(path.join(STATIC_DIR, f)), type }]));

  const routes = [
    ['POST', /^\/admin\/api\/login$/, login, { public: true }],
    ['POST', /^\/admin\/api\/logout$/, logout, { public: true }],
    ['GET', /^\/admin\/api\/me$/, ({ user, role }) => ({ user, role })],
    ['POST', /^\/admin\/api\/password$/, ownPassword],
    ['GET', /^\/admin\/api\/users$/, userList, { admin: true }],
    ['POST', /^\/admin\/api\/users$/, userAdd, { admin: true }],
    ['POST', /^\/admin\/api\/users\/([a-z0-9._-]{2,32})\/(password|role|delete)$/, userAction, { admin: true }],
    ['GET', /^\/admin\/api\/bookings$/, list],
    ['GET', /^\/admin\/api\/bookings\/(TCB-\d+)$/, detail],
    ['POST', /^\/admin\/api\/bookings\/(TCB-\d+)\/status$/, setStatus],
    ['POST', /^\/admin\/api\/bookings\/(TCB-\d+)\/comment$/, comment],
    ['GET', /^\/admin\/api\/content$/, contentList],
    ['POST', /^\/admin\/api\/content\/(\d+)\/(confirm|unlink|link)$/, contentAction],
    ['GET', /^\/admin\/api\/catalog$/, catalogSearch],
    ['GET', /^\/admin\/api\/catalog\/review$/, catalogReview],
    ['GET', /^\/admin\/api\/rooms$/, roomsList],
    ['POST', /^\/admin\/api\/rooms\/(H\d+)\/(map|name|reviewed)$/, roomsAction],
    ['GET', /^\/admin\/api\/areas$/, areaList],
    ['POST', /^\/admin\/api\/markup$/, markupSet],
    ['GET', /^\/admin\/api\/promos$/, promoList],
    ['POST', /^\/admin\/api\/promos$/, promoAdd],
    ['POST', /^\/admin\/api\/promos\/([^/]{1,60})\/(on|off|delete)$/, promoAction],
    ['POST', /^\/admin\/api\/areas\/([A-Z ]{2,40})$/, areaSet],
    ['GET', /^\/admin\/api\/catalog\/refresh$/, refreshStatus],
    ['POST', /^\/admin\/api\/catalog\/refresh$/, refreshStart],
    ['POST', /^\/admin\/api\/catalog\/(H\d+)\/(confirm|split|move)$/, catalogAction],
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
      let wrongMethod = false;
      for (const [method, re, fn, opt = {}] of routes) {
        const m = url.pathname.match(re);
        if (!m) continue;
        if (req.method !== method) {
          wrongMethod = true; // същият адрес може да е по-долу с друг метод (GET и POST на /catalog/refresh)
          continue;
        }
        const token = parseCookies(req)[COOKIE];
        const s = sessions.get(token);
        // потребител, изтрит от data/users.json, излиза веднага; правата се четат при всяка заявка
        const me = s ? users.get(s.user) : null;
        const user = me ? me.name : null;
        const role = me ? me.role : null;
        if (!user && !opt.public) throw new HttpError(401, 'Влезте отново');
        if (opt.admin && role !== 'admin') throw new HttpError(403, 'Само за администратор');
        const body = method === 'POST' ? await readJson(req) : undefined;
        const out = await fn({ req, res, url, query: Object.fromEntries(url.searchParams), match: m, body, user, role, token });
        sendJson(res, 200, out);
        return;
      }
      throw wrongMethod ? new HttpError(405, 'Методът не е разрешен') : new HttpError(404, 'Няма такъв адрес');
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
    users.touch(user);
    log.info(`[admin] вход: ${user} от ${ip}`);
    return { user, role: users.get(user).role };
  }

  function logout({ res, token, user }) {
    sessions.destroy(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    if (user) log.info(`[admin] изход: ${user}`);
    return { ok: true };
  }

  // ---------- потребители ----------
  const asBad = (fn) => {
    try {
      return fn();
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  };

  function userList({ user }) {
    return { users: users.details().map((u) => ({ ...u, sessions: sessions.count(u.name), me: u.name === user })), roles: ROLES };
  }

  function userAdd({ body, user }) {
    const b = body || {};
    const u = asBad(() => users.create(b.name, b.password, b.role || 'staff', user));
    log.info(`[admin] ${user}: нов потребител ${u.name} (${u.role})`);
    return userList({ user });
  }

  function userAction({ match, body, user, token }) {
    const [, name, action] = match;
    const target = users.get(name);
    if (!target) throw new HttpError(404, 'Няма такъв потребител');
    const lastAdmin = target.role === 'admin' && users.admins().length === 1;
    const b = body || {};
    if (action === 'password') {
      asBad(() => users.setPassword(name, b.password));
      sessions.destroyUser(name, name === user ? token : null); // излиза навсякъде със старата парола
      log.info(`[admin] ${user}: нова парола на ${name}`);
    } else if (action === 'role') {
      if (name === user) throw new HttpError(400, 'Не можете да смените собствените си права');
      if (lastAdmin && b.role !== 'admin') throw new HttpError(400, 'Трябва да остане поне един администратор');
      asBad(() => users.setRole(name, b.role));
      log.info(`[admin] ${user}: права на ${name} -> ${b.role}`);
    } else if (action === 'delete') {
      if (name === user) throw new HttpError(400, 'Не можете да изтриете себе си');
      if (lastAdmin) throw new HttpError(400, 'Трябва да остане поне един администратор');
      users.remove(name);
      sessions.destroyUser(name);
      log.info(`[admin] ${user}: изтрит потребител ${name}`);
    }
    return userList({ user });
  }

  // собствената парола – със сегашната; грешните опити се броят като при входа
  function ownPassword({ req, body, user, token }) {
    const b = body || {};
    const keys = [`ip:${clientIp(req)}`, `user:${user}`];
    if (guard.blocked(...keys)) throw new HttpError(429, 'Много грешни опити. Опитайте пак след 15 минути.');
    if (!users.check(user, b.current)) {
      guard.fail(...keys);
      log.warn(`[admin] ${user}: грешна сегашна парола при смяна`);
      throw new HttpError(400, 'Грешна сегашна парола');
    }
    if (String(b.password || '') === String(b.current || '')) throw new HttpError(400, 'Новата парола е същата като старата');
    asBad(() => users.setPassword(user, b.password));
    sessions.destroyUser(user, token); // другите сесии излизат, тази остава
    log.info(`[admin] ${user}: смени паролата си`);
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

  // ---------- снимки от сайта ↔ каталог ----------
  const needContent = () => {
    if (!content || !catalog) throw new HttpError(404, 'Снимките от сайта не са включени');
  };
  const catHotel = (id) => {
    const h = catalog.get(id);
    return h ? { id: h.id, name: h.name, area: h.area, stars: h.stars || null, ops: Object.keys(h.links) } : null;
  };

  function contentList({ query }) {
    needContent();
    content.maybeReload();
    const state = ['check', 'none', 'linked'].includes(query.state) ? query.state : 'check';
    const all = content.list(state, query.q);
    return {
      counts: content.counts(),
      updatedAt: content.data.updatedAt,
      total: all.length,
      items: all.slice(0, 300).map(({ site: x, link, state: st }) => ({
        state: st,
        site: { siteId: x.siteId, name: x.name, stars: x.stars, locality: x.locality, url: x.url, thumb: x.photos[0] ? x.photos[0].thumb : null, photos: x.photos.length },
        link: link ? { ...link, hotel: catHotel(link.hotelId), why: whyText(link, x) } : null,
      })),
    };
  }

  // Защо връзката е за проверка – на човешки език
  function whyText(l, x) {
    if (l.state !== 'check' || !l.why) return '';
    if (l.why.startsWith('taken:')) {
      const o = content.data.site[l.why.slice(6)];
      return `Същият хотел от каталога вече е вързан с друга страница от сайта${o ? `: ${o.name} (${o.locality}, №${o.siteId})` : ''}. Изберете коя е вярната.`;
    }
    if (l.why === 'area') {
      const h = catalog.get(l.hotelId);
      return `Курортът е различен: на сайта ${x.locality}, в каталога ${h ? h.area : '?'}.`;
    }
    if (l.why === 'catalog') return 'Името съвпада само с непроверена връзка в каталога (при някой оператор) – възможно е и каталогът да е сбъркан.';
    return 'Имената са близки, но не еднакви.';
  }

  function contentAction({ match, body, user }) {
    needContent();
    const [, siteId, action] = match;
    try {
      if (action === 'confirm') content.confirm(siteId);
      else if (action === 'unlink') content.unlink(siteId);
      else {
        const hid = String((body && body.hotelId) || '').trim().toUpperCase();
        if (!catalog.get(hid)) throw new Error('Няма такъв хотел в каталога');
        content.link(siteId, hid);
      }
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: снимки ${siteId} ${action}${body && body.hotelId ? ` ${body.hotelId}` : ''}`);
    return { ok: true, counts: content.counts() };
  }

  function catalogSearch({ query }) {
    needContent();
    const q = String(query.q || '').trim();
    if (q.length < 2) return { hotels: [] };
    const list = /^H\d+$/i.test(q) ? [catalog.get(q.toUpperCase())].filter(Boolean) : catalog.search(q, 15);
    return { hotels: list.map((h) => catHotel(h.id)) };
  }

  // ---------- каталог: връзки към операторите ----------
  const needCatalog = () => {
    if (!catalog) throw new HttpError(404, 'Каталогът не е включен');
  };

  function linkWhy(h, op, l) {
    if (l.state !== 'check') return '';
    if (l.why && l.why.startsWith('chain:')) {
      const via = l.why.slice(6);
      return `Вързан автоматично през непроверената връзка на ${opNames[via] || via} – прегледайте ги заедно.`;
    }
    return `Името е подобно (${Math.round((l.score || 0) * 100)}%), но не е сигурно, че е същият хотел.`;
  }

  function reviewItem(h) {
    const c = content && content.card(h.id);
    // групи: първата непроверена връзка води; останалите от групата (верижни, същото име) – „заедно с“ нея
    const leaderOf = {};
    for (const [op, l] of Object.entries(h.links)) {
      if (l.state !== 'check' || leaderOf[op] || (l.why && l.why.startsWith('chain:'))) continue;
      for (const o of catalog.withChain(h.id, [op])) if (!leaderOf[o]) leaderOf[o] = op;
    }
    return {
      id: h.id,
      name: h.name,
      area: h.area,
      stars: h.stars || null,
      thumb: c ? c.image : null,
      siteUrl: c ? c.siteUrl : null,
      links: Object.entries(h.links).map(([op, l]) => ({
        op,
        opName: opNames[op] || op,
        code: l.code,
        name: l.name,
        area: l.area || '',
        category: l.category || '',
        state: l.state,
        score: l.score,
        chainOf: l.why && l.why.startsWith('chain:') ? l.why.slice(6) : null,
        leader: l.state === 'check' && (leaderOf[op] || op) === op,
        with: leaderOf[op] && leaderOf[op] !== op ? leaderOf[op] : null,
        why: linkWhy(h, op, l),
      })),
    };
  }

  // ---------- стаи: една и съща стая при различните оператори ----------
  function roomItem(id, t) {
    const h = catalog && catalog.get(id);
    const c = content && content.card(id);
    return {
      hotelId: id,
      name: h ? h.name : id,
      area: h ? h.area : '',
      thumb: c ? c.image : null,
      ops: t.ops.map((op) => ({ op, name: opNames[op] || op })),
      rows: t.rows,
      single: t.single,
      raw: t.raw,
      reviewedAt: t.reviewedAt,
    };
  }

  function roomsList({ query }) {
    if (!rooms) throw new HttpError(404, 'Няма данни за стаите');
    const q = String(query.q || '').trim();
    if (q.length >= 2) {
      const ids = /^H\d+$/i.test(q) ? [q.toUpperCase()] : catalog ? catalog.search(q, 20).map((h) => h.id) : [];
      const items = ids.map((id) => ({ id, t: rooms.table(id) })).filter((x) => x.t).map((x) => roomItem(x.id, x.t));
      return { counts: { todo: rooms.review({ state: 'todo' }).length, done: rooms.review({ state: 'done' }).length }, total: items.length, items };
    }
    const state = query.state === 'done' ? 'done' : 'todo';
    const list = rooms.review({ state });
    return {
      counts: { todo: state === 'todo' ? list.length : rooms.review({ state: 'todo' }).length, done: state === 'done' ? list.length : rooms.review({ state: 'done' }).length },
      total: list.length,
      items: list.slice(0, 60).map((x) => roomItem(x.hotelId, x)),
    };
  }

  function roomsAction({ match, body, user }) {
    if (!rooms) throw new HttpError(404, 'Няма данни за стаите');
    const [, id, action] = match;
    try {
      if (action === 'map') rooms.setMap(id, String(body.sig || ''), body.key ? String(body.key) : null);
      else if (action === 'name') rooms.setName(id, String(body.key || ''), body.name);
      else rooms.setReviewed(id);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: стаи ${id} ${action}${body.key ? ` -> ${body.key}` : ''}${body.name ? ` „${body.name}“` : ''}`);
    const t = rooms.table(id);
    return t ? roomItem(id, t) : { hotelId: id };
  }

  // ---------- курорти: кои се показват на сайта ----------
  function areaList() {
    if (!catalog || !settings) throw new HttpError(404, 'Няма настройки');
    const count = new Map();
    for (const h of catalog.data.hotels) if (h.area) count.set(h.area, (count.get(h.area) || 0) + 1);
    const list = [...count].filter(([area, n]) => n >= 3 || settings.isHidden(area)).map(([area, hotels]) => ({ area, hotels, hidden: settings.isHidden(area) }));
    return { areas: list.sort((x, y) => y.hotels - x.hotels), markupPct: settings.markupPct };
  }

  // ---------- промо кодове ----------
  function promoList() {
    if (!settings) throw new HttpError(404, 'Няма настройки');
    const uses = new Map();
    for (const b of bookings.list()) if (b.public.promo) uses.set(b.public.promo.code, (uses.get(b.public.promo.code) || 0) + 1);
    return {
      promos: settings.promos().map((p) => ({ ...p, label: promoLabel(p), valid: promoValid(p), uses: uses.get(p.code) || 0 })),
    };
  }

  function promoAdd({ body, user }) {
    if (!settings) throw new HttpError(404, 'Няма настройки');
    let p;
    try {
      p = parsePromo(body);
      settings.addPromo(p, user);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: нов промо код ${p.code} ${promoLabel(p)}${p.until ? ` до ${p.until}` : ''}`);
    return promoList();
  }

  function promoAction({ match, user }) {
    if (!settings) throw new HttpError(404, 'Няма настройки');
    const code = decodeURIComponent(match[1]);
    const action = match[2];
    try {
      if (action === 'delete') settings.removePromo(code);
      else settings.updatePromo(code, { active: action === 'on' });
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: промо код ${code} ${action === 'delete' ? 'изтрит' : action === 'on' ? 'пуснат' : 'спрян'}`);
    return promoList();
  }

  function markupSet({ body, user }) {
    if (!settings) throw new HttpError(404, 'Няма настройки');
    const before = settings.markupPct;
    let pct;
    try {
      pct = settings.setMarkup(body && body.markupPct);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    log.info(`[admin] ${user}: надценка ${before}% -> ${pct}%`);
    return { markupPct: pct };
  }

  function areaSet({ match, body, user }) {
    if (!settings) throw new HttpError(404, 'Няма настройки');
    const area = decodeURIComponent(match[1]);
    const hidden = Boolean(body && body.hidden);
    settings.setHidden(area, hidden);
    log.info(`[admin] ${user}: курорт ${area} ${hidden ? 'скрит' : 'показан'} на сайта`);
    return { area, hidden };
  }

  // Обновяване от операторите (нощно; оттук – на ръка). Върви във фона, страницата пита за състоянието.
  function refreshStatus() {
    if (!catalogJob) throw new HttpError(404, 'Няма обновяване');
    return { running: catalogJob.running, last: catalogJob.last };
  }

  function refreshStart({ user }) {
    if (!catalogJob) throw new HttpError(404, 'Няма обновяване');
    if (catalogJob.running) return { running: true, started: false };
    log.info(`[admin] ${user}: обнови каталога от операторите`);
    catalogJob.run();
    return { running: true, started: true };
  }

  // Без q – хотелите с връзки за проверка; с q – търсене в целия каталог (за поправки)
  function catalogReview({ query }) {
    needCatalog();
    const q = String(query.q || '').trim();
    const pending = catalog.data.hotels.filter((h) => Object.values(h.links).some((l) => l.state === 'check'));
    const counts = { hotels: pending.length, links: pending.reduce((n, h) => n + Object.values(h.links).filter((l) => l.state === 'check').length, 0) };
    let list;
    if (q.length >= 2) list = /^H\d+$/i.test(q) ? [catalog.get(q.toUpperCase())].filter(Boolean) : catalog.search(q, 30);
    else list = [...pending].sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));
    return { counts, total: list.length, items: list.slice(0, 150).map(reviewItem) };
  }

  function catalogAction({ match, body, user }) {
    needCatalog();
    const [, id, action] = match;
    // действието е за избраната връзка заедно с верижните, станали през нея
    const ops = catalog.withChain(id, Array.isArray(body && body.ops) ? body.ops.map(String) : []);
    const to = String((body && body.to) || '').trim().toUpperCase();
    let out = {};
    try {
      if (action === 'confirm') catalog.confirmMany(id, ops);
      else if (action === 'split') out = { newId: catalog.split(id, ops).id };
      else out = { toId: catalog.move(id, ops, to).id };
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const other = out.newId || out.toId;
    // снимките от сайта – наново за засегнатите хотели (напр. отделеният получава своите)
    if (content) content.match(catalog, { affected: [id, other].filter(Boolean) });
    log.info(`[admin] ${user}: каталог ${id} ${action} ${ops.join(',') || 'всички за проверка'}${other ? ` -> ${other}` : ''}`);
    const h = catalog.get(id);
    return { ok: true, ops, ...out, hotel: h ? reviewItem(h) : null, other: other ? reviewItem(catalog.get(other)) : null };
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
