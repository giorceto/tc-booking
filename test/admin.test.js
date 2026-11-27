// Тестове на админа без мрежа: вход, сесии, защита от налучкване, списък и смяна на статуса.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BookingStore } = require('../src/bookings/store');
const { Users, Sessions, LoginGuard } = require('../src/auth');
const { createAdmin } = require('../src/admin/routes');
const { createServer } = require('../src/api/app');
const { toLatin } = require('../src/admin/translit');

const PASS = 'много-тайна-парола';

function sample(bookings, over = {}) {
  return bookings.create({
    public: { offerKey: 'k1', hotelId: 'H1', hotelName: 'TEST PALACE', area: 'SIDE', stars: 5, room: 'STANDARD ROOM', roomGroup: 'Стандартна', seaView: false, board: 'AI', boardLabel: 'All Inclusive', checkIn: '2027-06-15', nights: 7, adults: 2, childAges: [5], price: 1320, currency: 'EUR', onRequest: false, ...over.public },
    contact: { name: 'Иван Петров', email: 'ivan@example.com', phone: '+359 888 123 456' },
    guests: [{ firstName: 'Иван', lastName: 'Петров' }, { firstName: 'Мария', lastName: 'Петрова' }, { firstName: 'Петър', lastName: 'Петров', birthDate: '2021-03-02' }],
    note: '<script>alert(1)</script>',
    internal: { op: 'BBB', opName: 'Bbb Tour', hotelCode: 'TESTP', supplierHotelId: 7, supplierHotelName: 'TEST PALACE HOTEL', room: 'STANDARD ROOM B BLOCK', roomCode: 'STD', board: 'AI', boardName: 'ALL INCLUSIVE', net: 1200, currency: 'EUR', eb: 10, supplierStatus: 'OK', markupPct: 10, checkedAt: new Date().toISOString(), sig: 'secret-sig', ...over.internal },
  });
}

async function setup({ corsOrigin = '', guard } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-admin-'));
  const bookings = new BookingStore(path.join(dir, 'bookings.json'));
  const users = new Users(path.join(dir, 'users.json'));
  users.add('ana', PASS);
  const logs = [];
  const log = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const admin = createAdmin({ bookings, users, sessions: new Sessions(), guard: guard || new LoginGuard(), log });
  const engine = { activeOps: () => [] };
  const server = createServer({ engine, catalog: { data: { hotels: [] } }, bookings, admin, corsOrigin, log });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const api = async (p, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const r = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML/JS */
    }
    return { status: r.status, headers: r.headers, text, json };
  };
  const login = async (user = 'ana', password = PASS, headers) => {
    const r = await api('/admin/api/login', { method: 'POST', body: { user, password }, headers });
    const sc = r.headers.get('set-cookie');
    if (r.status === 200) cookie = sc.split(';')[0];
    return r;
  };
  const close = () => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  };
  return { dir, bookings, users, logs, api, login, close, setCookie: (c) => (cookie = c) };
}

test('страницата: пренасочване, заглавки за сигурност, без CORS', async (t) => {
  const s = await setup({ corsOrigin: 'https://www.example.com' });
  t.after(s.close);
  const r0 = await s.api('/admin');
  assert.strictEqual(r0.status, 301);
  assert.strictEqual(r0.headers.get('location'), 'admin/', 'относително – работи и зад Caddy с префикс');

  const r = await s.api('/admin/', { headers: { Origin: 'https://www.example.com' } });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), null, 'админът никога не е достъпен от сайта');
  assert.ok(!/src="\//.test(r.text) && !/href="\//.test(r.text), 'само относителни адреси');

  const js = await s.api('/admin/app.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.ok(!/fetch\(['"`]\//.test(js.text), 'fetch само с относителни адреси');
  assert.ok(!/innerHTML/.test(js.text), 'данните от клиентите не се слагат като HTML');
  assert.strictEqual((await s.api('/admin/style.css')).status, 200);
  assert.strictEqual((await s.api('/admin/nothing')).status, 404);
});

test('вход и изход', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.strictEqual((await s.api('/admin/api/bookings')).status, 401);
  assert.strictEqual((await s.api('/admin/api/me')).status, 401);

  let r = await s.login('ana', 'грешна');
  assert.strictEqual(r.status, 401);
  assert.strictEqual((await s.login('nobody', PASS)).status, 401);

  r = await s.login('ANA', PASS); // името не зависи от главни/малки
  assert.strictEqual(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /^tcb_sid=[\w-]{40,};/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.ok(!/Secure/.test(sc), 'по http без Secure');
  assert.deepStrictEqual((await s.api('/admin/api/me')).json, { user: 'ana' });

  await s.api('/admin/api/logout', { method: 'POST', body: {} });
  assert.strictEqual((await s.api('/admin/api/me')).status, 401, 'след изход сесията не важи');

  r = await s.login('ana', PASS, { 'X-Forwarded-Proto': 'https' });
  assert.match(r.headers.get('set-cookie'), /Secure/, 'зад Caddy с https – Secure');

  s.users.remove('ana');
  assert.strictEqual((await s.api('/admin/api/me')).status, 401, 'изтрит потребител излиза веднага');
  assert.strictEqual((await s.api('/admin/api/bookings')).status, 401);
});

test('много грешни пароли -> временно спиране, дори с вярна парола', async (t) => {
  const s = await setup({ guard: new LoginGuard({ max: 3, windowMs: 60000 }) });
  t.after(s.close);
  for (let i = 0; i < 3; i++) assert.strictEqual((await s.login('ana', 'грешна')).status, 401);
  assert.strictEqual((await s.login('ana', PASS)).status, 429);
  assert.ok(s.logs.some((l) => /много грешни опити/.test(l)));
});

test('резервации: списък с доставчика и печалбата, детайл, текст за портала', async (t) => {
  const s = await setup();
  t.after(s.close);
  sample(s.bookings);
  sample(s.bookings, { public: { hotelName: 'OTHER BEACH', price: 800, onRequest: true }, internal: { op: 'AAA', opName: 'Aaa Travel', net: 700 } });
  await s.login();

  let r = await s.api('/admin/api/bookings?status=pending');
  assert.deepStrictEqual(r.json.counts, { pending: 2, confirmed: 0, rejected: 0, cancelled: 0 });
  assert.deepStrictEqual(r.json.bookings.map((b) => b.id), ['TCB-000002', 'TCB-000001'], 'най-новите първи');
  const b1 = r.json.bookings[1];
  assert.strictEqual(b1.opName, 'Bbb Tour');
  assert.strictEqual(b1.net, 1200);
  assert.strictEqual(b1.margin, 120);
  assert.strictEqual(b1.guest, 'Иван Петров');
  assert.strictEqual(r.json.bookings[0].onRequest, true);

  r = await s.api('/admin/api/bookings?q=петрова');
  assert.strictEqual(r.json.total, 2, 'търсене по име на гост');
  r = await s.api('/admin/api/bookings?q=other');
  assert.deepStrictEqual(r.json.bookings.map((b) => b.id), ['TCB-000002']);

  r = await s.api('/admin/api/bookings/TCB-000001');
  assert.strictEqual(r.json.internal.hotelCode, 'TESTP');
  assert.ok(!('sig' in r.json.internal));
  assert.deepStrictEqual(r.json.next, ['confirmed', 'rejected', 'cancelled']);
  const pt = r.json.portalText;
  assert.match(pt, /Хотел: TEST PALACE HOTEL \[TESTP\]/);
  assert.match(pt, /Стая: STANDARD ROOM B BLOCK \[STD\]/);
  assert.match(pt, /Настаняване: 2027-06-15 – 2027-06-22, 7 нощ\./);
  assert.match(pt, /1\. PETROV IVAN\n {2}2\. PETROVA MARIA\n {2}3\. PETROV PETAR – 2021-03-02/);
  assert.match(pt, /Нетна цена при проверката: 1200 EUR \(EB 10%\)/);

  assert.strictEqual((await s.api('/admin/api/bookings/TCB-999999')).status, 404);
});

test('смяна на статуса: номер при доставчика, разрешени преходи, история, бележки', async (t) => {
  const s = await setup();
  t.after(s.close);
  sample(s.bookings);
  await s.login();
  const post = (p, body) => s.api(`/admin/api/bookings/TCB-000001/${p}`, { method: 'POST', body });

  let r = await post('status', { status: 'confirmed' });
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /номера на резервацията при доставчика/);

  r = await post('status', { status: 'confirmed', supplierRef: ' SUM-123456 ', comment: 'потвърдена по телефона' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'confirmed');
  assert.strictEqual(r.json.internal.supplierRef, 'SUM-123456');
  assert.deepStrictEqual(r.json.next, ['cancelled']);
  const last = r.json.history.at(-1);
  assert.strictEqual(last.by, 'ana');
  assert.strictEqual(last.comment, 'потвърдена по телефона');

  r = await post('status', { status: 'pending' });
  assert.strictEqual(r.status, 400, 'потвърдена не може да се върне за потвърждение');
  assert.match(r.json.error, /„потвърдена“ и не може да стане „за потвърждение“/);
  assert.strictEqual((await post('status', { status: 'xxx' })).status, 400);

  r = await post('comment', { comment: 'клиентът пита за трансфер' });
  assert.strictEqual(r.json.history.at(-1).comment, 'клиентът пита за трансфер');
  assert.strictEqual(r.json.status, 'confirmed');
  assert.strictEqual((await post('comment', { comment: '  ' })).status, 400);

  // записано на диска
  const saved = new BookingStore(path.join(s.dir, 'bookings.json')).get('TCB-000001');
  assert.strictEqual(saved.status, 'confirmed');
  assert.strictEqual(saved.history.length, 3);
  assert.ok(s.logs.some((l) => l.includes('ana: TCB-000001 -> confirmed (SUM-123456)')));
});

test('админ POST само с JSON (защита от CSRF)', async (t) => {
  const s = await setup();
  t.after(s.close);
  sample(s.bookings);
  await s.login();
  const r = await s.api('/admin/api/bookings/TCB-000001/status', { method: 'POST', body: 'status=cancelled', raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.strictEqual(r.status, 415);
  assert.strictEqual(s.bookings.get('TCB-000001').status, 'pending');
  assert.strictEqual((await s.api('/admin/api/bookings', { method: 'POST', body: {} })).status, 405);
});

test('паролата е поне 10 знака, името – латиница', () => {
  const u = new Users(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-u-')), 'users.json'));
  assert.throws(() => u.add('ana', 'кратка'), /поне 10/);
  assert.throws(() => u.add('ана', PASS), /латински/);
  assert.strictEqual(u.add('ana', PASS), 'added');
  assert.strictEqual(u.add('ana', PASS + '2'), 'changed');
  assert.strictEqual(u.check('ana', PASS), null, 'старата парола не важи');
  assert.ok(!fs.readFileSync(u.file, 'utf8').includes(PASS), 'паролата не се пази');
});

test('кирилица -> латиница като в паспортите', () => {
  assert.strictEqual(toLatin('Мария Щерева'), 'Maria Shtereva');
  assert.strictEqual(toLatin('Юлия Цветкова'), 'Yulia Tsvetkova');
  assert.strictEqual(toLatin('Илияна Ъгълова'), 'Iliyana Agalova');
  assert.strictEqual(toLatin('ЖИВКО'), 'ZHIVKO');
  assert.strictEqual(toLatin('John Smith'), 'John Smith');
});
