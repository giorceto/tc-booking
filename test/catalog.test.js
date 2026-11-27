// Каталог: верижни връзки, отделяне в нов хотел, преглед в админа (без мрежа)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { ContentStore } = require('../src/content/store');
const { BookingStore } = require('../src/bookings/store');
const { Users } = require('../src/auth');
const { createAdmin } = require('../src/admin/routes');
const { createServer } = require('../src/api/app');

// Като в истинския каталог: AQI PEGASOS ROYAL е слят с AQI PEGASOS RESORT (друг хотел) –
// IRELS е „за проверка“, а ANEA и SONAR са станали „автоматични“ през името на IRELS
function pegasos(dir) {
  const f = path.join(dir, 'catalog.json');
  fs.writeFileSync(f, JSON.stringify({
    hotels: [
      { id: 'H1', name: 'AQI PEGASOS ROYAL', area: 'ALANYA', links: {
        SUMMER: { code: 'PEGROY', name: 'AQI PEGASOS ROYAL', state: 'ok' },
        IRELS: { code: 'PEGRES', name: 'AQI PEGASOS RESORT', state: 'check', score: 0.9 },
        ANEA: { code: 'AQIRES', name: 'AQI PEGASOS RESORT', state: 'auto', score: 1 },
        SONAR: { code: 'PEGARE', name: 'AQI PEGASOS RESORT', state: 'auto', score: 1 },
        AKAY: { code: 'AQIR', name: 'AQI PEGASOS ROYAL HOTEL', state: 'auto', score: 1 },
      } },
      { id: 'H2', name: 'ARIN RESORT BODRUM', area: 'BODRUM', links: {
        SUMMER: { code: 'ARIN', name: 'ARIN RESORT BODRUM', state: 'ok' },
        IRELS: { code: 'SUND', name: 'ARIN RESORT (EX. SUNDANCE RESORT HOTEL)', state: 'check', score: 0.9 },
      } },
    ],
    blocked: [], nextId: 3,
  }));
  return f;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-cat-'));

test('верижни връзки -> за проверка (само те), второ пускане не променя нищо', () => {
  const c = new Catalog(pegasos(tmp()));
  assert.strictEqual(c.markChains(), 2);
  const L = c.get('H1').links;
  assert.deepStrictEqual([L.ANEA.state, L.ANEA.why, L.SONAR.why], ['check', 'chain:IRELS', 'chain:IRELS']);
  assert.strictEqual(L.AKAY.state, 'auto', 'прилича на основното име – не е верига');
  assert.strictEqual(c.markChains(), 0);
});

test('отделяне: избраните връзки -> един нов хотел, блокирани за старата двойка', () => {
  const c = new Catalog(pegasos(tmp()));
  c.markChains();
  const n = c.split('H1', ['IRELS', 'ANEA', 'SONAR']);
  assert.strictEqual(n.name, 'AQI PEGASOS RESORT');
  assert.deepStrictEqual(Object.keys(n.links).sort(), ['ANEA', 'IRELS', 'SONAR']);
  assert.ok(Object.values(n.links).every((l) => l.state === 'ok' && !l.why));
  assert.deepStrictEqual(Object.keys(c.get('H1').links).sort(), ['AKAY', 'SUMMER']);
  assert.ok(c.data.blocked.includes('ANEA:AQIRES|H1'));
  assert.strictEqual(c.byLink.get('SONAR:PEGARE').id, n.id);
  assert.throws(() => c.split('H1', ['SUMMER', 'AKAY']), /Всички връзки/);
  c.confirmMany('H2');
  assert.strictEqual(c.get('H2').links.IRELS.state, 'ok');
});

test('build: нов оператор не се връзва „автоматично“ през непроверено име', () => {
  const dir = tmp();
  const c = new Catalog(pegasos(dir));
  c.split('H1', ['ANEA', 'SONAR']); // махаме старите вериги, остава IRELS (check) с името RESORT
  const st = c.build({ PENINSULA: [{ code: 'PRES', name: 'AQI PEGASOS RESORT', area: 'ALANYA' }] });
  const h = c.byLink.get('PENINSULA:PRES');
  // най-близкият е новият хотел от отделянето (там RESORT е проверено) – не H1 през IRELS
  assert.notStrictEqual(h.id, 'H1');
  assert.strictEqual(st.PENINSULA.auto, 1);
});

test('админ: преглед, потвърждаване, отделяне – снимките от сайта отиват при новия хотел', async (t) => {
  const dir = tmp();
  const catalog = new Catalog(pegasos(dir));
  catalog.markChains();
  const content = new ContentStore(path.join(dir, 'content.json'));
  const site = (siteId, name) => ({ siteId, name, stars: 5, country: 'Турция', locality: 'Алания', url: `https://x/h/${siteId}`, photos: [{ big: 'b', thumb: `t${siteId}` }], sections: [], rating: null, reviews: 0 });
  content.put(site('10', 'AQI PEGASOS ROYAL'));
  content.put(site('11', 'AQI PEGASOS RESORT'));
  content.match(catalog);
  assert.strictEqual(content.data.links['11'].state, 'check', 'преди: RESORT няма свой хотел');

  const users = new Users(path.join(dir, 'u.json'));
  users.add('ana', 'много-тайна-парола');
  const quiet = { info() {}, warn() {}, error() {} };
  const admin = createAdmin({ bookings: new BookingStore(path.join(dir, 'b.json')), users, content, catalog, opNames: { IRELS: 'Irels Travel', ANEA: 'Anea Travel' }, log: quiet });
  const server = createServer({ engine: { activeOps: () => [] }, catalog, bookings: null, admin, content, log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'ana', password: 'много-тайна-парола' }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(base + p, { headers: { Cookie } })).json();
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() };
  };

  let j = await get('/admin/api/catalog/review');
  assert.deepStrictEqual(j.counts, { hotels: 2, links: 4 });
  const h1 = j.items.find((x) => x.id === 'H1');
  const anea = h1.links.find((l) => l.op === 'ANEA');
  assert.strictEqual(anea.chainOf, 'IRELS');
  assert.match(anea.why, /през непроверената връзка на Irels Travel/);

  let r = await post('/admin/api/catalog/H1/split', { ops: ['IRELS'] }); // верижните ANEA и SONAR тръгват с нея
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.j.ops.sort(), ['ANEA', 'IRELS', 'SONAR']);
  assert.ok(/^H\d+$/.test(r.j.newId));
  assert.strictEqual(content.data.links['11'].hotelId, r.j.newId, 'страницата на RESORT вече сочи новия хотел');
  assert.strictEqual(content.data.links['11'].state, 'auto');
  assert.strictEqual(content.data.links['10'].hotelId, 'H1');

  r = await post('/admin/api/catalog/H2/confirm', {});
  assert.strictEqual(catalog.get('H2').links.IRELS.state, 'ok');
  j = await get('/admin/api/catalog/review');
  assert.deepStrictEqual(j.counts, { hotels: 0, links: 0 });
  j = await get('/admin/api/catalog/review?q=pegasos');
  assert.strictEqual(j.items.length, 2, 'търсене в целия каталог');
  assert.strictEqual((await post('/admin/api/catalog/H1/split', { ops: ['NOPE'] })).status, 400);
  assert.strictEqual((await fetch(base + '/admin/api/catalog/review')).status, 401);
});

test('преместване към друг хотел: ROYAL, вързан по грешка към WORLD -> към ROYAL; конфликт – грешка', () => {
  const dir = tmp();
  const f = path.join(dir, 'catalog.json');
  fs.writeFileSync(f, JSON.stringify({
    hotels: [
      { id: 'H1', name: 'AQI PEGASOS ROYAL', area: 'ALANYA', links: { SUMMER: { code: 'PR', name: 'AQI PEGASOS ROYAL', state: 'ok' } } },
      { id: 'H2', name: 'AQI PEGASOS WORLD', area: 'SIDE', links: {
        AKAY: { code: 'PW', name: 'AQI PEGASOS WORLD', state: 'ok' },
        IRELS: { code: 'IR', name: 'AQI PEGASOS ROYAL', state: 'check', score: 0.85 },
        ANEA: { code: 'AR', name: 'AQI PEGASOS ROYAL', state: 'check', why: 'chain:IRELS' },
        SONAR: { code: 'SO', name: 'AQI PEGASOS ROYAL', state: 'check', score: 0.85 }, // същото име – с групата
        SUMMER: { code: 'SR', name: 'AQI PEGASOS RESORT', state: 'check', score: 0.75 },
      } },
    ],
    blocked: [], nextId: 3,
  }));
  const c = new Catalog(f);
  const ops = c.withChain('H2', ['IRELS']);
  assert.deepStrictEqual(ops.sort(), ['ANEA', 'IRELS', 'SONAR']);
  c.move('H2', ops, 'H1');
  assert.deepStrictEqual(Object.keys(c.get('H1').links).sort(), ['ANEA', 'IRELS', 'SONAR', 'SUMMER']);
  assert.strictEqual(c.get('H1').links.ANEA.state, 'ok');
  assert.ok(!c.get('H1').links.ANEA.why);
  assert.strictEqual(c.byLink.get('IRELS:IR').id, 'H1');
  assert.throws(() => c.move('H2', ['SUMMER'], 'H1'), /вече има връзка към SUMMER/);
  assert.strictEqual(c.get('H2').links.SUMMER.state, 'check', 'при грешка нищо не се мести');
});
