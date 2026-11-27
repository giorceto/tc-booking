// Тест без мрежа: двама измислени доставчици за един и същ хотел от каталога.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { SearchEngine } = require('../src/engine/search');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-'));
  const file = path.join(dir, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify({
    hotels: [{ id: 'H1', name: 'TEST PALACE', area: 'SIDE', stars: 5, links: { AAA: { code: 'TP1', name: 'TEST PALACE', state: 'ok' }, BBB: { code: 'TESTP', name: 'TEST PALACE HOTEL', state: 'ok' } } }],
    blocked: [], nextId: 2,
  }));
  const offer = (code, room, board, total, status = 'OK') => ({ hotelCode: code, room, roomType: room, board, boardName: board, total, currency: 'EUR', status, eb: 10 });
  const suppliers = {
    AAA: { type: 'sejour', search: async () => ({ offers: [offer('TP1', 'STANDARD ROOM', 'AI', 1200), offer('TP1', 'FAMILY ROOM', 'AI', 1500, 'RQ')] }) },
    BBB: { type: 'sedna', search: async () => ({ offers: [offer('TESTP', 'STANDARD ROOM B BLOCK', 'ALL INCLUSIVE', 1100), offer('TESTP', 'FAMILY ROOM', 'AI', 1400)] }) },
  };
  return new SearchEngine({ catalog: new Catalog(file), suppliers, markupPct: 10 });
}

test('най-добра цена по стая/изхранване, без да се вижда доставчикът', async () => {
  const e = setup();
  const r = await e.searchHotel('H1', { date: '2027-06-15', nights: 7, adults: 2, childAges: [] });
  assert.strictEqual(r.count, 1);
  const h = r.hotels[0];
  assert.strictEqual(h.options.length, 2);
  const std = h.options.find((o) => o.roomGroup === 'Стандартна');
  assert.strictEqual(std.price, 1210); // 1100 + 10%
  assert.strictEqual(std.room, 'STANDARD ROOM B BLOCK');
  const fam = h.options.find((o) => o.roomGroup === 'Фамилна');
  assert.strictEqual(fam.available, true); // наличната 1400 бие "по запитване" 1500
  const json = JSON.stringify(r.hotels);
  for (const leak of ['AAA', 'BBB', 'TP1', 'TESTP']) assert.ok(!json.includes(leak), `изтича ${leak}`);
  assert.strictEqual(e.resolveOffer(std.offerKey).op, 'BBB');
});

test('грешка при един доставчик не спира търсенето', async () => {
  const e = setup();
  e.suppliers.AAA.search = async () => { throw new Error('down'); };
  const r = await e.searchHotel('H1', { date: '2027-06-15', nights: 7, adults: 2, childAges: [] });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.errors.AAA, 'down');
});

test('продажна цена: надценка без грешки от закръгляне', () => {
  const e = setup(); // надценка 10%
  assert.strictEqual(e.sellPrice(1400), 1540); // 1400 × 1.1 = 1540.0000000000002 в JS
  assert.strictEqual(e.sellPrice(1100), 1210);
  assert.strictEqual(e.sellPrice(1234.56), 1359); // 1358.016 -> нагоре
  assert.strictEqual(e.sellPrice(1000.01), 1101); // 1100.011 -> нагоре
});

test('непроверени връзки (check) не дават цени, докато не се потвърдят', async () => {
  const e = setup();
  e.catalog.get('H1').links.BBB.state = 'check'; // BBB е по-евтиният – ако е друг хотел, цената е грешна
  const p = { date: '2027-06-15', nights: 7, adults: 2, childAges: [] };
  let r = await e.searchHotel('H1', p);
  assert.strictEqual(r.hotels[0].options.find((o) => o.roomGroup === 'Стандартна').price, 1320, 'само AAA: 1200 + 10%');
  e.catalog.get('H1').links.BBB.state = 'ok';
  r = await e.searchHotel('H1', p, { force: true });
  assert.strictEqual(r.hotels[0].options.find((o) => o.roomGroup === 'Стандартна').price, 1210);
});
