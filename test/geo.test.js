// Картата: къде е хотелът (наш сайт -> списък хотели при оператор), какво отива към сайта – без мрежа
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { Geo, point } = require('../src/catalog/geo');
const { SearchEngine } = require('../src/engine/search');
const { createServer } = require('../src/api/app');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-geo-'));
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function setup() {
  const dir = tmp();
  const f = path.join(dir, 'catalog.json');
  fs.writeFileSync(f, JSON.stringify({ blocked: [], nextId: 5, hotels: [
    { id: 'H1', name: 'SITE PALACE', area: 'SIDE', links: { AAA: { code: 'SP', name: 'SITE PALACE', state: 'ok' }, BBB: { code: '11', name: 'SITE PALACE', state: 'ok' } } },
    { id: 'H2', name: 'OPERATOR BEACH', area: 'SIDE', links: { BBB: { code: '12', name: 'OPERATOR BEACH', state: 'auto' } } },
    { id: 'H3', name: 'UNSURE HOTEL', area: 'SIDE', links: { BBB: { code: '13', name: 'UNSURE', state: 'check' } } },
    { id: 'H4', name: 'NOWHERE HOTEL', area: 'SIDE', links: { BBB: { code: '14', name: 'NOWHERE', state: 'ok' } } },
  ] }));
  const catalog = new Catalog(f);
  // списъкът хотели на BBB (както Summer: lat/lng като текст)
  const lists = { BBB: [
    { code: '11', id: 11, lat: '36.70', lng: '31.50' },
    { code: '12', id: 12, lat: '36.7765', lng: '31.3872' },
    { code: '13', id: 13, lat: '36.80', lng: '31.40' },
    { code: '14', id: 14, lat: '0', lng: '0' }, // няма координати
  ] };
  const content = { geo: (id) => (id === 'H1' ? { lat: 36.7601, lon: 31.3912 } : null), card: () => null, full: () => null };
  const offer = (code, total) => ({ hotelCode: code, room: 'STANDARD ROOM', roomType: 'STANDARD ROOM', roomCode: 'STD', roomTypeCode: 'STD', board: 'AI', boardName: 'ALL INCLUSIVE', total, currency: 'EUR', status: 'OK' });
  const suppliers = { BBB: { type: 'sedna', search: async ({ hotel }) => ({ offers: [offer(String(hotel), 1000)] }) } };
  const engine = new SearchEngine({ catalog, suppliers, dataDir: dir });
  const geo = new Geo({ catalog, content, hotelsOf: (op) => lists[op] || [], trusted: (l) => engine.trusted(l) });
  return { dir, catalog, engine, geo, content };
}

test('координати: първо нашият сайт, после операторът по проверена връзка; само в Турция', () => {
  const { geo } = setup();
  assert.deepStrictEqual(geo.get('H1'), { lat: 36.7601, lon: 31.3912 }, 'сайтът бие оператора');
  assert.deepStrictEqual(geo.get('H2'), { lat: 36.7765, lon: 31.3872 }, 'от списъка на оператора');
  assert.strictEqual(geo.get('H3'), null, 'непроверена връзка – може да е друг хотел');
  assert.strictEqual(geo.get('H4'), null, '0,0 не е в Турция');
  assert.deepStrictEqual(geo.stats(), { hotels: 4, withGeo: 2, bySrc: { site: 1, BBB: 1 } });
  assert.strictEqual(point('48.85', '2.35'), null, 'Париж – не');
  assert.strictEqual(point('', ''), null);
});

test('API: lat/lon в резултатите и на страницата на хотела; плочките на картата в CSP', async (t) => {
  const { catalog, engine, geo, content } = setup();
  const quiet = { info() {}, warn() {}, error() {} };
  const server = createServer({ engine, catalog, bookings: null, content, geo, mapTiles: TILES, mapAttribution: '© OpenStreetMap', siteUrl: 'https://www.example.com', log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let j = await (await fetch(`${base}/api/search?hotel=H2&date=2027-06-15&nights=7&adults=2`)).json();
  assert.deepStrictEqual([j.hotels[0].lat, j.hotels[0].lon], [36.7765, 31.3872]);
  j = await (await fetch(`${base}/api/hotel/H1`)).json();
  assert.deepStrictEqual([j.lat, j.lon], [36.7601, 31.3912]);
  j = await (await fetch(`${base}/api/hotel/H3`)).json();
  assert.deepStrictEqual([j.lat, j.lon], [null, null]);

  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/www\.example\.com https:\/\/tile\.openstreetmap\.org;/);
  const html = await page.text();
  assert.ok(html.includes(`<meta name="map-tiles" content="${TILES}">`));
  assert.ok(html.includes('<meta name="map-attribution" content="© OpenStreetMap">'));
});

test('без карта (MAP_TILES=off): няма плочки в CSP и няма адрес в страницата', async (t) => {
  const { catalog, engine } = setup();
  const server = createServer({ engine, catalog, bookings: null, log: { info() {}, warn() {}, error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const page = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.ok(!/tile/.test(page.headers.get('content-security-policy')));
  assert.ok(!(await page.text()).includes('map-tiles'));
});
