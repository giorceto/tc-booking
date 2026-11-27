// Снимки и описания от нашия сайт: четене на страницата, връзване с каталога, API и преглед в админа (без мрежа)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { ContentStore } = require('../src/content/store');
const { parseHotelPage, parseSitemap, hotelUrl } = require('../src/content/tcsite');
const { SearchEngine } = require('../src/engine/search');
const { BookingStore } = require('../src/bookings/store');
const { Users } = require('../src/auth');
const { createAdmin } = require('../src/admin/routes');
const { createServer } = require('../src/api/app');

const SITE = 'https://www.example.com';
const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'tc-hotel.html'), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-content-'));

test('страница от сайта: име, звезди, курорт, снимки само на хотела, описание до картата', () => {
  const r = parseHotelPage(html, SITE);
  assert.strictEqual(r.siteId, '1234');
  assert.strictEqual(r.name, 'TEST PALACE & SPA');
  assert.strictEqual(r.stars, 5);
  assert.strictEqual(r.country, 'Турция');
  assert.strictEqual(r.locality, 'Сиде');
  assert.deepStrictEqual(r.photos.map((p) => p.big), [`${SITE}/img/OBEKTI/BIG_IMG_16000000001234.jpg`, `${SITE}/img/OBEKTI/BIG_POOL-1920w_16000000001234.jpg`], 'главната първа, без чужди снимки');
  assert.strictEqual(r.photos[0].thumb, `${SITE}/img/OBEKTI/IMG_16000000001234.jpg`);
  assert.deepStrictEqual(r.sections.map((s) => s.title), ['Разположение', 'Хранене', 'Плаж']);
  assert.strictEqual(r.sections[0].text, 'На 50 м от плажа & на 3 км от Сиде.\n\nРемонтиран през 2020 г.');
  assert.strictEqual(r.sections[2].text, 'Пясъчен.');
  assert.deepStrictEqual([r.lat, r.lon, r.rating, r.reviews], [36.76, 31.39, 4.6, 12]);
  assert.strictEqual(parseHotelPage('<html>няма JSON-LD</html>', SITE), null);
});

test('sitemap: един хотел веднъж, без счупените адреси', () => {
  const xml = ['хотел/test-palace-5*/98/1234/', 'хотел/test-palace-5*/100/1234/', 'хотел//237//', 'почивки/турция/сиде_7_18', 'хотел/other-4*/5/77/']
    .map((u) => `<url><loc>${SITE}/${encodeURI(u)}</loc></url>`).join('');
  const list = parseSitemap(xml);
  assert.deepStrictEqual(list, [{ siteId: '1234', slug: 'test-palace-5*' }, { siteId: '77', slug: 'other-4*' }]);
  assert.strictEqual(hotelUrl(SITE, list[0]), `${SITE}/h/1234/test-palace-5*.html`);
});

function catalogFile(dir) {
  const f = path.join(dir, 'catalog.json');
  fs.writeFileSync(f, JSON.stringify({
    hotels: [
      { id: 'H1', name: 'TEST PALACE', area: 'SIDE', stars: 5, links: { AAA: { code: 'TP1', name: 'TEST PALACE HOTEL & SPA', state: 'ok' } } },
      { id: 'H2', name: 'GARDEN RESORT', area: 'ALANYA', links: { AAA: { code: 'GR', name: 'GARDEN RESORT', state: 'ok' }, BBB: { code: 'SG', name: 'SUNNY GARDEN CLUB', state: 'check' } } },
      { id: 'H3', name: 'TEST PALACE', area: 'KEMER', links: { AAA: { code: 'TPK', name: 'TEST PALACE', state: 'ok' } } },
    ],
    blocked: [], nextId: 4,
  }));
  return new Catalog(f);
}
const rec = (siteId, name, locality) => ({ siteId, name, stars: 5, country: 'Турция', locality, url: `${SITE}/h/${siteId}/x.html`, photos: [{ big: `${SITE}/img/OBEKTI/BIG_${siteId}.jpg`, thumb: `${SITE}/img/OBEKTI/${siteId}.jpg` }], sections: [{ title: 'Плаж', text: 'Пясъчен' }], lat: null, lon: null, rating: 4.5, reviews: 3 });

test('връзване: по име и курорт, непроверена връзка в каталога -> за проверка, един към един, ръчните решения остават', () => {
  const dir = tmp();
  const catalog = catalogFile(dir);
  const store = new ContentStore(path.join(dir, 'content.json'));
  store.put(rec('1', 'TEST PALACE & SPA', 'Сиде')); // -> H1 (курортът Сиде, не H3 в Кемер), но №3 е по-точното име -> check
  store.put(rec('2', 'SUNNY GARDEN CLUB', 'Алания')); // съвпада само с непроверено име в каталога -> check
  store.put(rec('3', 'TEST PALACE', 'Сиде')); // точно основното име на H1 -> auto
  store.put(rec('4', 'COMPLETELY DIFFERENT', 'Бодрум'));
  const st = store.match(catalog);
  assert.deepStrictEqual(st, { auto: 1, check: 2, none: 1, ok: 0 });
  assert.deepStrictEqual(store.data.links['3'], { hotelId: 'H1', state: 'auto', score: 1 });
  assert.strictEqual(store.data.links['2'].state, 'check');
  assert.strictEqual(store.data.links['2'].why, 'catalog', 'причина: само непроверено име в каталога');
  assert.strictEqual(store.data.links['1'].state, 'check');
  assert.strictEqual(store.data.links['1'].why, 'taken:3', 'причина: H1 вече е вързан с №3');
  assert.ok(!store.data.links['4']);
  assert.ok(store.card('H1') && !store.card('H2'), 'на клиента се показва само вързаното (auto/ok)');

  store.link('4', 'H3'); // ръчно
  store.unlink('2'); // ръчно разкачен – не се връзва пак
  store.match(catalog);
  assert.deepStrictEqual(store.data.links['4'], { hotelId: 'H3', state: 'ok', score: 1 });
  assert.ok(!store.data.links['2'], 'разкаченият не се връзва пак');
  store.confirm('1'); // човекът казва: H1 е №1 (с SPA), не №3
  assert.strictEqual(store.data.links['1'].state, 'ok');
  assert.strictEqual(store.data.links['3'].state, 'check', 'другият към същия хотел отива за проверка');
  assert.strictEqual(store.data.links['3'].why, 'taken:1');
  assert.strictEqual(store.card('H1').siteUrl, `${SITE}/h/1/x.html`);

  const again = new ContentStore(path.join(dir, 'content.json')); // записано на диска
  assert.strictEqual(again.data.links['1'].state, 'ok');
  assert.deepStrictEqual(again.counts(), { linked: 2, check: 1, none: 1 });
});

test('API и страницата: снимка в резултатите, /api/hotel, CSP пуска снимки само от сайта; админ – преглед и ръчно връзване', async (t) => {
  const dir = tmp();
  const catalog = catalogFile(dir);
  const content = new ContentStore(path.join(dir, 'content.json'));
  content.put(rec('1', 'TEST PALACE & SPA', 'Сиде'));
  content.put(rec('2', 'SUNNY GARDEN CLUB', 'Алания'));
  content.match(catalog);
  const date = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const offer = { hotelCode: 'TP1', room: 'STANDARD ROOM', roomCode: 'STD', board: 'AI', boardName: 'AI', total: 1000, currency: 'EUR', status: 'OK' };
  const engine = new SearchEngine({ catalog, suppliers: { AAA: { type: 'sejour', search: async () => ({ offers: [offer] }) } }, dataDir: dir });
  const bookings = new BookingStore(path.join(dir, 'b.json'));
  const users = new Users(path.join(dir, 'u.json'));
  users.add('ana', 'много-тайна-парола');
  const quiet = { info() {}, warn() {}, error() {} };
  const admin = createAdmin({ bookings, users, content, catalog, siteUrl: SITE, log: quiet });
  const server = createServer({ engine, catalog, bookings, admin, content, siteUrl: SITE, log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers) => {
    const r = await fetch(base + p, { headers });
    return { r, j: await r.json().catch(() => null) };
  };

  let { j } = await get(`/api/search?hotel=H1&date=${date}`);
  assert.strictEqual(j.hotels[0].image, `${SITE}/img/OBEKTI/1.jpg`);
  assert.strictEqual(j.hotels[0].siteUrl, `${SITE}/h/1/x.html`);
  assert.strictEqual(j.hotels[0].rating, 4.5);

  ({ j } = await get('/api/hotel/H1'));
  assert.deepStrictEqual(j.sections, [{ title: 'Плаж', text: 'Пясъчен' }]);
  assert.strictEqual(j.photos.length, 1);
  ({ j } = await get('/api/hotel/H2'));
  assert.deepStrictEqual([j.name, j.photos, j.sections], ['GARDEN RESORT', [], []], 'за проверка – не се показва');
  assert.strictEqual((await get('/api/hotel/H99')).r.status, 404);

  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/www\.example\.com;/);

  // админ
  const login = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'ana', password: 'много-тайна-парола' }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  ({ j } = await get('/admin/api/content?state=check', { Cookie }));
  assert.deepStrictEqual(j.counts, { linked: 1, check: 1, none: 0 });
  assert.strictEqual(j.items[0].site.siteId, '2');
  assert.strictEqual(j.items[0].link.hotel.id, 'H2');
  assert.match(j.items[0].link.why, /непроверена връзка в каталога/);
  ({ j } = await get('/admin/api/catalog?q=h3', { Cookie }));
  assert.deepStrictEqual(j.hotels.map((x) => x.id), ['H3']);
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body || {}) });
  assert.strictEqual((await post('/admin/api/content/2/link', { hotelId: 'H404' })).status, 400);
  assert.strictEqual((await post('/admin/api/content/2/confirm')).status, 200);
  ({ j } = await get('/api/hotel/H2'));
  assert.strictEqual(j.photos.length, 1, 'след потвърждение се показва');
  assert.strictEqual((await fetch(base + '/admin/api/content?state=check')).status, 401, 'без вход – не');
  const admin2 = await fetch(base + '/admin/', { headers: { Cookie } });
  assert.match(admin2.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/www\.example\.com;/);
});

test('имена: апострофи и слято/разделено писане', () => {
  const { fingerprint, nameScore } = require('../src/catalog/normalize');
  const sc = (a, b) => nameScore(fingerprint(a), fingerprint(b));
  assert.strictEqual(sc("CITY'S HILL HOTEL", 'CITYS HILL HOTEL'), 1);
  assert.strictEqual(sc("L'OCEANICA BEACH RESORT", 'LOCEANICA BEACH RESORT'), 1);
  assert.ok(sc('MERT SEASIDE HOTEL', 'MERT SEA SIDE HOTEL') >= 0.92);
  assert.ok(sc('MAR-BAS SELECT BEACH', 'MARBAS SELECT BEACH') >= 0.92);
  assert.ok(sc('MY DREAM HOTEL', 'MY DREAM ISTANBUL HOTEL') < 0.92, 'различни хотели остават различни');
});

test('при равен резултат печели страницата с основното име на хотела, не с име от връзка', () => {
  const dir = tmp();
  const f = path.join(dir, 'catalog.json');
  // каталогът е слял два хотела: при AAA е ROYAL, при BBB е RESORT (грешка в каталога)
  fs.writeFileSync(f, JSON.stringify({ hotels: [{ id: 'H1', name: 'AQI PEGASOS ROYAL', area: 'ALANYA', links: { AAA: { code: 'R', name: 'AQI PEGASOS ROYAL', state: 'ok' }, BBB: { code: 'S', name: 'AQI PEGASOS RESORT', state: 'auto' } } }], blocked: [], nextId: 2 }));
  const store = new ContentStore(path.join(dir, 'content.json'));
  store.put(rec('10', 'AQI PEGASOS RESORT', 'Алания'));
  store.put(rec('11', 'AQI PEGASOS ROYAL', 'Алания'));
  store.match(new Catalog(f));
  assert.strictEqual(store.data.links['11'].state, 'auto');
  assert.strictEqual(store.data.links['10'].state, 'check');
  assert.strictEqual(store.data.links['10'].why, 'taken:11');
});
