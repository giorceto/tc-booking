// Тестове на Booking API без мрежа: измислени доставчици AAA (Sejour) и BBB (Sedna), истински HTTP сървър на случаен порт.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { SearchEngine } = require('../src/engine/search');
const { BookingStore } = require('../src/bookings/store');
const { createServer } = require('../src/api/app');

// Всичко, което не бива да стига до клиента: доставчици, кодовете им, нетни цени
const SECRETS = ['AAA', 'BBB', 'Aaa Travel', 'Bbb Tour', 'TP1', 'TESTP', 'OH1', 'KH1', 'STDCODE', 'FAMCODE'];

const future = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const DATE = future(60);

const offer = (hotelCode, room, roomCode, board, total, status = 'OK', extra = {}) => ({
  hotelCode, hotelName: `NAME ${hotelCode}`, room, roomType: room, roomCode, roomTypeCode: roomCode, board, boardName: board,
  total, currency: 'EUR', status, eb: 10, ...extra,
});

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-api-'));
  const catFile = path.join(dir, 'catalog.json');
  fs.writeFileSync(catFile, JSON.stringify({
    hotels: [
      { id: 'H1', name: 'TEST PALACE', area: 'SIDE', stars: 5, links: { AAA: { code: 'TP1', name: 'TEST PALACE', state: 'ok' }, BBB: { code: 'TESTP', name: 'TEST PALACE HOTEL', state: 'ok' } } },
      { id: 'H2', name: 'OTHER BEACH', area: 'SIDE', stars: 4, links: { AAA: { code: 'OH1', name: 'OTHER BEACH', state: 'ok' } } },
      { id: 'H3', name: 'KEMER GARDEN', area: 'KEMER', stars: 4, links: { AAA: { code: 'KH1', name: 'KEMER GARDEN', state: 'ok' } } },
      { id: 'H4', name: 'NOBODY INN', area: 'SIDE', links: { ZZZ: { code: 'NB1', name: 'NOBODY INN', state: 'ok' } } },
    ],
    blocked: [], nextId: 5,
  }));
  fs.writeFileSync(path.join(dir, 'hotels-BBB.json'), JSON.stringify([{ id: 7, code: 'TESTP', area: 'SIDE / KIZILOT' }]));

  const s = {
    calls: { AAA: 0, BBB: 0 },
    fail: {},
    bbbDelayMs: 0,
    aaa: {
      TP1: [offer('TP1', 'STANDARD ROOM', 'STDCODE', 'AI', 1200), offer('TP1', 'FAMILY ROOM', 'FAMCODE', 'AI', 1500, 'RQ')],
      OH1: [offer('OH1', 'STANDARD ROOM', 'STDCODE', 'HB', 700)],
      KH1: [offer('KH1', 'STANDARD ROOM', 'STDCODE', 'BB', 500)],
    },
    bbb: {
      TESTP: [offer('TESTP', 'STANDARD ROOM B BLOCK', 'STD', 'ALL INCLUSIVE', 1100, 'OK', { hotelId: 7 }), offer('TESTP', 'FAMILY ROOM', 'FAM', 'AI', 1400, 'OK', { hotelId: 7 })],
    },
  };
  const regionHotels = { SD: ['TP1', 'OH1'], KM: ['KH1'] };
  const guard = (op) => {
    s.calls[op]++;
    if (s.fail[op]) throw s.fail[op];
  };
  const suppliers = {
    AAA: {
      type: 'sejour',
      name: 'Aaa Travel',
      normalize: (o) => o,
      search: async ({ hotel }) => (guard('AAA'), { offers: s.aaa[hotel] || [] }),
      regions: async () => [{ Code: 'SD', Name: 'SIDE' }, { Code: 'KM', Name: 'KEMER' }],
      searchRegion: async ({ region }) => (guard('AAA'), regionHotels[region].flatMap((c) => s.aaa[c] || [])),
    },
    BBB: {
      type: 'sedna',
      name: 'Bbb Tour',
      normalize: (o) => o,
      search: async ({ hotel }) => {
        guard('BBB');
        await new Promise((r) => setTimeout(r, s.bbbDelayMs));
        return { offers: hotel === 7 || hotel === 'TESTP' ? s.bbb.TESTP : [] };
      },
      searchMany: async ({ hotelIds }) => {
        guard('BBB');
        await new Promise((r) => setTimeout(r, s.bbbDelayMs));
        return hotelIds.includes(7) ? s.bbb.TESTP : [];
      },
    },
  };
  const catalog = new Catalog(catFile);
  const engine = new SearchEngine({ catalog, suppliers, markupPct: 10, dataDir: dir });
  const bookings = new BookingStore(path.join(dir, 'bookings.json'));
  const logs = [];
  const log = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  return { s, dir, catalog, engine, bookings, logs, log };
}

async function start(w, opts = {}) {
  const high = [1000, 60000];
  const server = createServer({ engine: w.engine, catalog: w.catalog, bookings: w.bookings, log: w.log, streamThrottleMs: 0, limits: { catalog: high, search: high, recheck: high, booking: high }, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* SSE или празно */
    }
    return { status: r.status, headers: r.headers, text, json };
  };
  api.base = base;
  w.close = () => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  };
  return api;
}

const noLeaks = (text) => {
  for (const x of SECRETS) assert.ok(!text.includes(x), `към клиента изтича "${x}": ${text.slice(0, 300)}`);
};

function parseSse(text) {
  return text
    .split('\n\n')
    .filter((b) => b.trim() && !b.startsWith(':'))
    .map((b) => {
      const ev = {};
      for (const line of b.split('\n')) {
        if (line.startsWith('event: ')) ev.event = line.slice(7);
        if (line.startsWith('data: ')) ev.data = JSON.parse(line.slice(6));
      }
      return ev;
    });
}

const guests2 = [{ firstName: 'Иван', lastName: 'Петров' }, { firstName: 'Мария', lastName: 'Петрова' }];
const contact = { name: 'Иван Петров', email: 'ivan@example.com', phone: '+359 888 123 456' };

test('каталог: курорти и търсене на хотел по име, без кодове на доставчиците', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());

  assert.deepStrictEqual((await api('/api/health')).json, { ok: true });
  const areas = (await api('/api/areas')).json.areas;
  assert.deepStrictEqual(areas, [{ area: 'SIDE', hotels: 2 }, { area: 'KEMER', hotels: 1 }]); // H4 няма активен доставчик

  const r = await api('/api/hotels?q=palace');
  assert.deepStrictEqual(r.json.hotels.map((h) => h.hotelId), ['H1']);
  noLeaks(r.text);
  assert.deepStrictEqual((await api('/api/hotels?q=TP1')).json.hotels, [], 'по код при доставчика не се търси');
  assert.deepStrictEqual((await api('/api/hotels?q=garden&area=SIDE')).json.hotels, []);
  assert.strictEqual((await api('/api/hotels?q=a')).status, 400);
});

test('търсене по курорт (JSON): най-добра цена, без доставчика и грешките му', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());

  const r = await api(`/api/search?area=side&date=${DATE}&nights=7&adults=2`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.count, 2);
  assert.strictEqual(r.json.incomplete, false);
  assert.deepStrictEqual(r.json.hotels.map((h) => h.hotelId), ['H2', 'H1']); // подредени по „от … €“
  const h1 = r.json.hotels[1];
  assert.strictEqual(h1.fromPrice, 1210); // 1100 от BBB + 10%
  assert.strictEqual(h1.options.find((o) => o.roomGroup === 'Фамилна').price, 1540); // наличната 1400 бие RQ 1500
  assert.ok(!('errors' in r.json) && !('unlinked' in r.json));
  assert.ok(!r.text.includes('1100') && !r.text.includes('"total"'), 'нетната цена не се вижда');
  noLeaks(r.text);
});

test('грешка при доставчик: търсенето продължава, клиентът вижда само incomplete', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  w.s.fail.BBB = new Error('BBB is down (Bbb Tour)');

  const r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.incomplete, true);
  assert.strictEqual(r.json.hotels[0].fromPrice, 1320); // само AAA: 1200 + 10%
  noLeaks(r.text);
  assert.ok(w.logs.some((l) => l.includes('BBB is down')), 'грешката е в лога');
});

test('търсене със стрийминг (SSE): части по хотел, накрая същото като JSON', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  w.s.bbbDelayMs = 200; // BBB отговаря по-късно – H1 трябва да дойде два пъти (първо от AAA, после по-евтино от BBB)

  const r = await api(`/api/search?area=SIDE&date=${DATE}&nights=7&adults=2&stream=1`);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  noLeaks(r.text);
  const events = parseSse(r.text);
  const parts = events.filter((e) => e.event === 'part');
  assert.ok(parts.length >= 2, `очакват се поне 2 части, има ${parts.length}`);
  assert.deepStrictEqual(events.at(-1), { event: 'done', data: { count: 2, incomplete: false, promo: null } });

  const merged = new Map();
  for (const p of parts) for (const h of p.data.hotels) merged.set(h.hotelId, h);
  const h1parts = parts.filter((p) => p.data.hotels.some((h) => h.hotelId === 'H1'));
  assert.strictEqual(h1parts.length, 2, 'H1 се праща пак, когато се промени');
  assert.strictEqual(parts.filter((p) => p.data.hotels.some((h) => h.hotelId === 'H2')).length, 1, 'непроменен хотел не се праща пак');

  const json = (await api(`/api/search?area=SIDE&date=${DATE}&nights=7&adults=2`)).json;
  assert.deepStrictEqual(Object.fromEntries([...merged].map(([k, h]) => [k, h.fromPrice])), Object.fromEntries(json.hotels.map((h) => [h.hotelId, h.fromPrice])));
  // стабилни ключове: същата оферта има същия offerKey и в двете търсения
  assert.deepStrictEqual(merged.get('H1').options.map((o) => o.offerKey).sort(), json.hotels.find((h) => h.hotelId === 'H1').options.map((o) => o.offerKey).sort());
});

test('проверка на входа при търсене', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  const q = (s) => api(`/api/search?${s}`);
  assert.strictEqual((await q(`area=SIDE&date=2020-01-01`)).status, 400);
  assert.strictEqual((await q(`area=SIDE&date=${future(10)}&childAges=1,2,3,4`)).status, 400);
  assert.strictEqual((await q(`area=SIDE&date=${future(10)}&childAges=18`)).status, 400);
  assert.strictEqual((await q(`area=SIDE&hotel=H1&date=${future(10)}`)).status, 400);
  assert.strictEqual((await q(`date=${future(10)}`)).status, 400);
  assert.strictEqual((await q(`area=SIDE&date=${future(10)}&nights=0`)).status, 400);
  assert.strictEqual((await q(`hotel=H999&date=${future(10)}`)).status, 404);
  assert.strictEqual((await api('/api/nothing')).status, 404);
  assert.strictEqual((await api('/api/booking')).status, 405);
});

test('проверка на цената: промяна, изчезнала оферта, грешка при доставчика', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  const r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2`);
  const std = r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна'); // от BBB, 1100 нетна

  let c = await api(`/api/offer/${std.offerKey}/recheck`, { method: 'POST' });
  assert.deepStrictEqual(c.json, { offerKey: std.offerKey, price: 1210, previousPrice: 1210, changed: false, currency: 'EUR', available: true, onRequest: false, promo: null });

  w.s.bbb.TESTP[0] = { ...w.s.bbb.TESTP[0], total: 1150, status: 'RQ' };
  c = await api(`/api/offer/${std.offerKey}/recheck`, { method: 'POST' });
  assert.strictEqual(c.json.price, 1265);
  assert.strictEqual(c.json.previousPrice, 1210);
  assert.strictEqual(c.json.changed, true);
  assert.strictEqual(c.json.onRequest, true);
  noLeaks(c.text);

  w.s.fail.BBB = Object.assign(new Error('timeout at Bbb Tour'), { name: 'TimeoutError' });
  c = await api(`/api/offer/${std.offerKey}/recheck`, { method: 'POST' });
  assert.strictEqual(c.status, 502);
  noLeaks(c.text);
  delete w.s.fail.BBB;

  w.s.bbb.TESTP = w.s.bbb.TESTP.slice(1); // стаята вече я няма
  c = await api(`/api/offer/${std.offerKey}/recheck`, { method: 'POST' });
  assert.strictEqual(c.status, 410);
  assert.strictEqual(c.json.reason, 'gone');

  c = await api('/api/offer/AAAAAAAAAAAAAAAA/recheck', { method: 'POST' });
  assert.strictEqual(c.status, 410);
  assert.strictEqual(c.json.reason, 'expired');
});

test('резервация: проверка на цената, запис с доставчика само вътрешно, без дублиране', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  const r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2`);
  const std = r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна');
  const book = (extra) => api('/api/booking', { method: 'POST', body: { offerKey: std.offerKey, expectedPrice: std.price, contact, guests: guests2, ...extra } });

  assert.strictEqual((await book({ guests: guests2.slice(0, 1) })).status, 400, 'гостите трябва да са колкото хората в търсенето');
  assert.strictEqual((await book({ contact: { ...contact, email: 'не-е-имейл' } })).status, 400);
  assert.strictEqual((await api('/api/booking', { method: 'POST', body: { offerKey: 'nope-nope-nope', expectedPrice: 1 } })).status, 410);

  // цената се е вдигнала след търсенето -> 409 с новата цена, нищо не се записва
  w.s.bbb.TESTP[0] = { ...w.s.bbb.TESTP[0], total: 1180 };
  let b = await book();
  assert.strictEqual(b.status, 409);
  assert.strictEqual(b.json.reason, 'price_changed');
  assert.strictEqual(b.json.price, 1298);
  assert.strictEqual(w.bookings.list().length, 0);

  // клиентът приема новата цена
  b = await book({ expectedPrice: 1298 });
  assert.strictEqual(b.status, 201);
  noLeaks(b.text);
  assert.strictEqual(b.json.bookingId, 'TCB-000001');
  assert.strictEqual(b.json.status, 'pending');
  assert.strictEqual(b.json.price, 1298);
  assert.strictEqual(b.json.hotelName, 'TEST PALACE');
  assert.strictEqual(b.json.onRequest, false);

  // вътре (за служителите) – доставчикът, кодът и нетната цена
  const saved = new BookingStore(path.join(w.dir, 'bookings.json')).get('TCB-000001');
  assert.strictEqual(saved.internal.op, 'BBB');
  assert.strictEqual(saved.internal.opName, 'Bbb Tour');
  assert.strictEqual(saved.internal.hotelCode, 'TESTP');
  assert.strictEqual(saved.internal.net, 1180);
  assert.deepStrictEqual(saved.guests, guests2);

  // двоен клик – същата резервация
  b = await book({ expectedPrice: 1298 });
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.json.bookingId, 'TCB-000001');
  assert.strictEqual(b.json.duplicate, true);
  assert.strictEqual(w.bookings.list().length, 1);
});

test('резервация: стоп продажба -> 410', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  const r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2`);
  const std = r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна');
  w.s.bbb.TESTP[0] = { ...w.s.bbb.TESTP[0], status: 'STOP' };
  const b = await api('/api/booking', { method: 'POST', body: { offerKey: std.offerKey, expectedPrice: std.price, contact, guests: guests2 } });
  assert.strictEqual(b.status, 410);
  assert.strictEqual(b.json.reason, 'stop');
  assert.strictEqual(w.bookings.list().length, 0);
});

test('резервация: тялото трябва да е JSON и не много голямо', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  assert.strictEqual((await api('/api/booking', { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const big = await api('/api/booking', { method: 'POST', body: { note: 'x'.repeat(40000) } });
  assert.strictEqual(big.status, 413);
});

test('CORS само за разрешения адрес на сайта', async (t) => {
  const w = world();
  const api = await start(w, { corsOrigin: 'https://www.example.com' });
  t.after(() => w.close());
  const ok = await api('/api/health', { headers: { Origin: 'https://www.example.com' } });
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://www.example.com');
  const other = await api('/api/health', { headers: { Origin: 'https://evil.example.org' } });
  assert.strictEqual(other.headers.get('access-control-allow-origin'), null);
  const pre = await api('/api/booking', { method: 'OPTIONS', headers: { Origin: 'https://www.example.com' } });
  assert.strictEqual(pre.status, 204);
});

test('еднакви търсения, пуснати едновременно, отиват като една заявка към доставчика', async () => {
  const w = world();
  w.s.bbbDelayMs = 20;
  const p = { date: DATE, nights: 7, adults: 2, childAges: [] };
  const [a, b] = await Promise.all([w.engine.searchHotel('H1', p), w.engine.searchHotel('H1', p)]);
  assert.deepStrictEqual(w.s.calls, { AAA: 1, BBB: 1 });
  assert.deepStrictEqual(a.hotels[0].options.map((o) => o.offerKey), b.hotels[0].options.map((o) => o.offerKey));
});

test('от сайта до админа: клиентът резервира, служителят вижда доставчика и потвърждава', async (t) => {
  const { Users } = require('../src/auth');
  const { createAdmin } = require('../src/admin/routes');
  const w = world();
  const users = new Users(path.join(w.dir, 'users.json'));
  users.add('ana', 'много-тайна-парола');
  const api = await start(w, { admin: createAdmin({ bookings: w.bookings, users, log: w.log }) });
  t.after(() => w.close());

  const r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2`);
  const std = r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна');
  const b = await api('/api/booking', { method: 'POST', body: { offerKey: std.offerKey, expectedPrice: std.price, contact, guests: guests2 } });
  assert.strictEqual(b.status, 201);

  const login = await api('/admin/api/login', { method: 'POST', body: { user: 'ana', password: 'много-тайна-парола' } });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const list = await api('/admin/api/bookings?status=pending', { headers: { Cookie } });
  assert.strictEqual(list.json.bookings[0].id, b.json.bookingId);
  assert.strictEqual(list.json.bookings[0].opName, 'Bbb Tour');
  assert.strictEqual(list.json.bookings[0].margin, 110); // 1210 − 1100

  const d = await api(`/admin/api/bookings/${b.json.bookingId}`, { headers: { Cookie } });
  assert.match(d.json.portalText, /Хотел: NAME TESTP \[TESTP\]/);
  assert.match(d.json.portalText, /1\. PETROV IVAN/);
  const c = await api(`/admin/api/bookings/${b.json.bookingId}/status`, { method: 'POST', body: { status: 'confirmed', supplierRef: 'X-1' }, headers: { Cookie } });
  assert.strictEqual(c.json.status, 'confirmed');

  // публичното API не пуска към админа
  assert.strictEqual((await api('/admin/api/bookings')).status, 401);
});

test('лимит на заявките по IP (зад Caddy – по X-Forwarded-For)', async (t) => {
  const w = world();
  const api = await start(w, { limits: { search: [2, 60000], catalog: [1000, 60000], recheck: [1000, 60000], booking: [1000, 60000] } });
  t.after(() => w.close());
  const q = (ip) => api(`/api/search?hotel=H1&date=${DATE}`, { headers: { 'X-Forwarded-For': ip } });
  assert.strictEqual((await q('1.1.1.1')).status, 200);
  assert.strictEqual((await q('1.1.1.1')).status, 200);
  const r = await q('1.1.1.1');
  assert.strictEqual(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.strictEqual((await q('2.2.2.2')).status, 200, 'друг клиент не е засегнат');
  assert.strictEqual((await q('evil, 2.2.2.2')).status, 200, 'подправеното начало на X-Forwarded-For не се брои');
  assert.strictEqual((await api('/api/health', { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 200, 'health е без лимит');
});

test('страницата за търсене: относителни адреси, CSP, нищо за доставчиците', async (t) => {
  const w = world();
  const api = await start(w);
  t.after(() => w.close());
  const r = await api('/');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.ok(!/(src|href)="\//.test(r.text), 'само относителни адреси – работи под /book/');
  const js = await api('/site.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.ok(!/fetch\(['"`]\//.test(js.text), 'fetch само с относителни адреси');
  assert.ok(!/innerHTML/.test(js.text), 'данните се слагат само като текст');
  assert.strictEqual((await api('/site.css')).status, 200);
  const files = [r.text, js.text, (await api('/site.css')).text].join('\n');
  for (const x of ['SUMMER', 'Summer', 'ANEA', 'Anea', 'IRELS', 'Irels', 'SONAR', 'Sonar', 'AKAY', 'Akay', 'PENINSULA', 'Peninsula', 'admin/']) assert.ok(!files.includes(x), `страницата споменава "${x}"`);
});

test('промо код: задраскана цена, никога под нетната, проверка, резервация; изтекъл/спрян – без отстъпка', async (t) => {
  const { Settings } = require('../src/settings');
  const { parsePromo } = require('../src/promo');
  const w = world();
  const settings = new Settings(path.join(w.dir, 'settings.json'));
  settings.addPromo(parsePromo({ code: 'лято10', type: 'pct', value: 5 }));
  settings.addPromo(parsePromo({ code: 'BIG', type: 'pct', value: 50 }));
  settings.addPromo(parsePromo({ code: 'OLD', type: 'pct', value: 5, until: '01.01.2020' }));
  settings.addPromo({ ...parsePromo({ code: 'OFF', type: 'eur', value: 20 }), active: false });
  const api = await start(w, { settings });
  t.after(() => w.close());

  assert.deepStrictEqual((await api('/api/promo/%D0%9B%D0%AF%D0%A2%D0%9E10')).json, { code: 'ЛЯТО10', label: '−5%' });
  assert.deepStrictEqual((await api('/api/promo/' + encodeURIComponent('лято10'))).json.code, 'ЛЯТО10', 'малки/главни без значение');
  for (const bad of ['OLD', 'OFF', 'NOPE']) assert.strictEqual((await api(`/api/promo/${bad}`)).status, 404, bad);

  // търсене с промо код: H1 стандартна – нетна 1100, продажна 1210 (+10 %), −5 % = 1150 (1149.5 нагоре)
  let r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2&promo=${encodeURIComponent('лято10')}`);
  assert.deepStrictEqual(r.json.promo, { code: 'ЛЯТО10', label: '−5%' });
  const std = r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна');
  assert.deepStrictEqual([std.price, std.priceBefore], [1150, 1210]);
  assert.deepStrictEqual([r.json.hotels[0].fromPrice, r.json.hotels[0].fromPriceBefore], [1150, 1210]);
  // −50 % би било 605 – под нетната 1100 -> цената спира на нетната
  r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2&promo=BIG`);
  assert.strictEqual(r.json.hotels[0].options.find((o) => o.roomGroup === 'Стандартна').price, 1100);
  // изтекъл код – без отстъпка, promo: null
  r = await api(`/api/search?hotel=H1&date=${DATE}&nights=7&adults=2&promo=OLD`);
  assert.strictEqual(r.json.promo, null);
  assert.ok(!('priceBefore' in r.json.hotels[0].options[0]));

  // проверка на цената с промо код
  const c = await api(`/api/offer/${std.offerKey}/recheck?promo=${encodeURIComponent('лято10')}`, { method: 'POST' });
  assert.deepStrictEqual([c.json.price, c.json.priceBefore, c.json.changed], [1150, 1210, false]);

  // резервация с промо код
  const book = (extra) => api('/api/booking', { method: 'POST', body: { offerKey: std.offerKey, expectedPrice: 1150, contact, guests: guests2, promo: 'лято10', ...extra } });
  const b = await book();
  assert.strictEqual(b.status, 201);
  assert.deepStrictEqual([b.json.price, b.json.priceBefore, b.json.promo], [1150, 1210, { code: 'ЛЯТО10', label: '−5%' }]);
  noLeaks(b.text);
  const saved = w.bookings.get(b.json.bookingId);
  assert.deepStrictEqual(saved.internal.promo, { code: 'ЛЯТО10', type: 'pct', value: 5 });
  assert.strictEqual(saved.internal.sellBeforePromo, 1210);
  assert.strictEqual(saved.internal.net, 1100);

  // кодът е спрян преди изпращане -> 409, цената без отстъпка
  settings.updatePromo('ЛЯТО10', { active: false });
  const b2 = await book({ guests: [{ firstName: 'A', lastName: 'B' }, { firstName: 'C', lastName: 'D' }] });
  assert.strictEqual(b2.status, 409);
  assert.strictEqual(b2.json.reason, 'promo_invalid');
  assert.strictEqual(b2.json.price, 1210);
});

test('админ: промо кодове – добавяне, спиране, изтриване, брой ползвания', async (t) => {
  const { Settings } = require('../src/settings');
  const { Users } = require('../src/auth');
  const { createAdmin } = require('../src/admin/routes');
  const w = world();
  const settings = new Settings(path.join(w.dir, 'settings.json'));
  const users = new Users(path.join(w.dir, 'u.json'));
  users.add('ana', 'много-тайна-парола');
  const api = await start(w, { settings, admin: createAdmin({ bookings: w.bookings, users, settings, log: w.log }) });
  t.after(() => w.close());
  const login = await api('/admin/api/login', { method: 'POST', body: { user: 'ana', password: 'много-тайна-парола' } });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (p, body = {}) => api(p, { method: 'POST', body, headers: { Cookie } });

  let r = await post('/admin/api/promos', { code: 'summer26', type: 'eur', value: '50', until: '31.08.2027', note: 'бюлетин' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.promos.map((p) => [p.code, p.label, p.until, p.valid, p.uses, p.by]), [['SUMMER26', '−50 €', '2027-08-31', true, 0, 'ana']]);
  assert.strictEqual((await post('/admin/api/promos', { code: 'SUMMER26', type: 'pct', value: 5 })).status, 400, 'вече има');
  assert.strictEqual((await post('/admin/api/promos', { code: 'X', type: 'pct', value: 5 })).status, 400);
  assert.strictEqual((await post('/admin/api/promos', { code: 'MUCH', type: 'pct', value: 70 })).status, 400, 'над 50 %');
  assert.strictEqual((await post('/admin/api/promos', { code: 'BADDATE', type: 'pct', value: 5, until: '31.02.2027' })).status, 400);

  r = await post('/admin/api/promos/SUMMER26/off');
  assert.strictEqual(r.json.promos[0].valid, false);
  assert.strictEqual((await api('/api/promo/SUMMER26')).status, 404, 'спрян – не важи на сайта');
  r = await post('/admin/api/promos/SUMMER26/on');
  assert.strictEqual(r.json.promos[0].valid, true);
  assert.ok(w.logs.some((l) => /ana: нов промо код SUMMER26 −50 € до 2027-08-31/.test(l)));
  r = await post('/admin/api/promos/SUMMER26/delete');
  assert.deepStrictEqual(r.json.promos, []);
});

test('популярни хотели: подреждане от админа, на сайта само тези, които могат да се търсят', async (t) => {
  const { Settings } = require('../src/settings');
  const { Users } = require('../src/auth');
  const { createAdmin } = require('../src/admin/routes');
  const w = world();
  const settings = new Settings(path.join(w.dir, 'settings.json'));
  settings.setHidden('KEMER', true);
  const users = new Users(path.join(w.dir, 'u.json'));
  users.add('ana', 'много-тайна-парола');
  const api = await start(w, { settings, admin: createAdmin({ bookings: w.bookings, users, settings, catalog: w.catalog, log: w.log }) });
  t.after(() => w.close());

  assert.deepStrictEqual((await api('/api/popular')).json, { hotels: [] }, 'без популярни – празно');
  assert.strictEqual((await api('/admin/api/popular')).status, 401, 'админът – само с вход');

  const login = await api('/admin/api/login', { method: 'POST', body: { user: 'ana', password: 'много-тайна-парола' } });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (p, body = {}) => api(p, { method: 'POST', body, headers: { Cookie } });

  for (const id of ['H2', 'H1', 'H3', 'H4']) assert.strictEqual((await post('/admin/api/popular', { hotelId: id })).status, 200, id);
  assert.strictEqual((await post('/admin/api/popular', { hotelId: 'H1' })).status, 400, 'вече е там');
  assert.strictEqual((await post('/admin/api/popular', { hotelId: 'H99' })).status, 400, 'няма го в каталога');

  let r = await post('/admin/api/popular/H1/up');
  assert.deepStrictEqual(r.json.hotels.map((x) => x.hotelId), ['H1', 'H2', 'H3', 'H4']);
  assert.strictEqual(r.json.hotels[0].by, 'ana');
  assert.strictEqual(r.json.hotels.find((x) => x.hotelId === 'H3').problem, 'курортът е скрит');
  r = await post('/admin/api/popular/H1/up');
  assert.strictEqual(r.status, 200, 'първият нагоре – нищо не става');
  assert.deepStrictEqual(r.json.hotels.map((x) => x.hotelId), ['H1', 'H2', 'H3', 'H4']);

  // на сайта: H3 е в скрит курорт, H4 няма активен оператор -> не се показват
  r = await api('/api/popular');
  assert.deepStrictEqual(r.json.hotels.map((x) => [x.hotelId, x.name, x.area, x.stars]), [['H1', 'TEST PALACE', 'SIDE', 5], ['H2', 'OTHER BEACH', 'SIDE', 4]]);
  noLeaks(r.text);

  r = await post('/admin/api/popular/H2/delete');
  assert.deepStrictEqual(r.json.hotels.map((x) => x.hotelId), ['H1', 'H3', 'H4']);
  assert.deepStrictEqual((await api('/api/popular')).json.hotels.map((x) => x.hotelId), ['H1']);
  // запазено във файла – важи и след рестарт
  assert.deepStrictEqual(new Settings(path.join(w.dir, 'settings.json')).popular().map((x) => x.hotelId), ['H1', 'H3', 'H4']);
  assert.ok(w.logs.some((l) => /ana: популярен хотел \+ H1 TEST PALACE/.test(l)));
});
