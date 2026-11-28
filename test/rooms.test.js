// Стаи: една и съща стая при различните оператори (разпознаване, ръчни връзки, админ) – без мрежа
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { roomInfo } = require('../src/catalog/rooms');
const { RoomStore } = require('../src/catalog/roomstore');
const Catalog = require('../src/catalog/catalog');
const { SearchEngine } = require('../src/engine/search');
const { BookingStore } = require('../src/bookings/store');
const { Users } = require('../src/auth');
const { createAdmin } = require('../src/admin/routes');
const { createServer } = require('../src/api/app');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcb-rooms-'));

test('разпознаване: Sejour (стая + тип) и Summer (едно име) -> един ключ; марките остават отделни', () => {
  const k = (...a) => roomInfo(...a).key;
  assert.strictEqual(k('DOUBLE ROOM', 'SUPERIOR SEA VIEW'), k('SUPERIOR ROOM SEA VIEW'));
  assert.strictEqual(k('DBL', 'SUP SV'), k('SUPERIOR ROOM SEA VIEW'));
  assert.notStrictEqual(k('DOUBLE ROOM', 'SUPERIOR'), k('DOUBLE ROOM', 'SUPERIOR SEA VIEW'), 'изгледът е различна стая');
  assert.notStrictEqual(k('DOUBLE ROOM', 'SUPERIOR'), k('DOUBLE ROOM', 'STANDARD'));
  assert.notStrictEqual(k('STANDARD ROOM SEA VIEW'), k('STANDARD ROOM SIDE SEA VIEW'), 'страничен изглед ≠ изглед към морето');
  assert.notStrictEqual(k('SUPERIOR ROOM'), k('SUPERIOR PLUS ROOM'));
  assert.notStrictEqual(k('FAMILY ROOM'), k('FAMILY SUITE'));
  assert.strictEqual(roomInfo('DOUBLE ROOM', 'SUPERIOR SEA VIEW').label, 'Супериорна стая с изглед към морето');
  assert.strictEqual(roomInfo('FAMILY DUBLEX ROOM').label, 'Фамилна стая, на две нива');
  assert.strictEqual(roomInfo('GRAND FAMILY SUITE').label, 'Гранд фамилен суит');
  const brand = roomInfo('PLATINUM SELECT ROOM');
  assert.strictEqual(brand.known, false, 'непознати думи – отделна стая');
  assert.ok(brand.key.startsWith('raw|'));
  // непозната стая: едно и също име в двете полета (Summer) = „DOUBLE ROOM“ + вида (Sejour)
  assert.strictEqual(roomInfo('COLONEL SUITE', 'COLONEL SUITE').label, 'COLONEL SUITE');
  assert.strictEqual(k('COLONEL SUITE', 'COLONEL SUITE'), k('DOUBLE ROOM', 'COLONEL SUITE'));
  assert.strictEqual(roomInfo('DOUBLE ROOM', 'COLONEL SUITE').label, 'COLONEL SUITE');
  assert.strictEqual(k('STANDARD ROOM', 'STANDARD ROOM'), k('STANDARD ROOM'));
});

function setup() {
  const dir = tmp();
  const f = path.join(dir, 'catalog.json');
  fs.writeFileSync(f, JSON.stringify({ hotels: [{ id: 'H1', name: 'SEA PALACE', area: 'SIDE', links: { AAA: { code: 'SP1', name: 'SEA PALACE', state: 'ok' }, BBB: { code: 'SPX', name: 'SEA PALACE', state: 'ok' } } }], blocked: [], nextId: 2 }));
  const catalog = new Catalog(f);
  const off = (code, room, roomType, rc, board, total) => ({ hotelCode: code, room, roomType, roomCode: rc, roomTypeCode: rc, board, boardName: board, total, currency: 'EUR', status: 'OK' });
  // AAA (Sejour): „DOUBLE ROOM“ + тип; BBB (Summer): едно име; „STANDARD“ при AAA и „STANDARD ROOM LAND VIEW“ при BBB
  const suppliers = {
    AAA: { type: 'sejour', search: async () => ({ offers: [
      off('SP1', 'DOUBLE ROOM', 'SUPERIOR', 'SUP', 'AI', 1000),
      off('SP1', 'DOUBLE ROOM', 'SUPERIOR SEA VIEW', 'SUPSV', 'AI', 1100),
      off('SP1', 'DOUBLE ROOM', 'STANDARD', 'STD', 'AI', 900),
    ] }) },
    BBB: { type: 'sedna', search: async () => ({ offers: [
      off('SPX', 'SUPERIOR ROOM SEA VIEW', 'DBL', 'SUPSV', 'AI', 1050),
      off('SPX', 'STANDARD ROOM LAND VIEW', 'DBL', 'STDLV', 'AI', 850),
    ] }) },
  };
  const rooms = new RoomStore(path.join(dir, 'rooms.json'), { saveDelayMs: 10 });
  const engine = new SearchEngine({ catalog, suppliers, dataDir: dir, rooms });
  return { dir, catalog, engine, rooms };
}
const P = { date: '2027-06-15', nights: 7, adults: 2, childAges: [] };
const opts = async (e) => (await e.searchHotel('H1', P, { force: true })).hotels[0].options.map((o) => [o.room, o.price]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);

test('търсене: една и съща стая при двама оператори – една с най-добрата цена; различните – отделно', async () => {
  const { engine } = setup();
  assert.deepStrictEqual(await opts(engine), [
    ['Стандартна стая', 900],
    ['Стандартна стая с изглед към сушата', 850],
    ['Супериорна стая', 1000],
    ['Супериорна стая с изглед към морето', 1050], // BBB 1050 бие AAA 1100
  ]);
});

test('ръчно: „Стандартна“ при AAA е същата като „… изглед към сушата“ при BBB; преименуване; преглед', async () => {
  const { engine, rooms, dir } = setup();
  await opts(engine); // наблюдава стаите
  let t = rooms.table('H1');
  assert.deepStrictEqual(t.ops, ['AAA', 'BBB']);
  assert.strictEqual(t.single, 3, '3 стаи само при един оператор');
  assert.strictEqual(rooms.review().length, 1);
  const std = t.rows.find((r) => r.label === 'Стандартна стая').cells.AAA[0];
  const land = t.rows.find((r) => r.label === 'Стандартна стая с изглед към сушата');
  rooms.setMap('H1', std.sig, land.key);
  rooms.setName('H1', land.key, 'Стандартна стая (основна сграда)');
  assert.deepStrictEqual(await opts(engine), [
    ['Стандартна стая (основна сграда)', 850], // BBB 850 бие AAA 900 – вече една стая
    ['Супериорна стая', 1000],
    ['Супериорна стая с изглед към морето', 1050],
  ]);
  rooms.setReviewed('H1');
  assert.strictEqual(rooms.review({ state: 'todo' }).length, 0);
  assert.strictEqual(rooms.review({ state: 'done' }).length, 1);
  const again = new RoomStore(path.join(dir, 'rooms.json'));
  assert.strictEqual(again.roomOf('H1', { op: 'AAA', room: 'DOUBLE ROOM', roomType: 'STANDARD', roomCode: 'STD', roomTypeCode: 'STD' }).label, 'Стандартна стая (основна сграда)', 'записано');
  // връщане към разпознаването
  rooms.setMap('H1', std.sig, null);
  assert.strictEqual((await opts(engine)).length, 4);
});

test('админ: Стаи – списък за преглед, „същата като“, име, прегледано', async (t) => {
  const { engine, rooms, catalog, dir } = setup();
  await opts(engine);
  const users = new Users(path.join(dir, 'u.json'));
  users.add('ana', 'много-тайна-парола');
  const quiet = { info() {}, warn() {}, error() {} };
  const admin = createAdmin({ bookings: new BookingStore(path.join(dir, 'b.json')), users, catalog, rooms, opNames: { AAA: 'Aaa Travel', BBB: 'Bbb Tour' }, log: quiet });
  const server = createServer({ engine, catalog, bookings: null, admin, log: quiet });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'ana', password: 'много-тайна-парола' }) });
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async (p) => (await fetch(base + p, { headers: { Cookie } })).json();
  const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body) })).json();

  let j = await get('/admin/api/rooms');
  assert.deepStrictEqual(j.counts, { todo: 1, done: 0 });
  const item = j.items[0];
  assert.deepStrictEqual(item.ops, [{ op: 'AAA', name: 'Aaa Travel' }, { op: 'BBB', name: 'Bbb Tour' }]);
  const sup = item.rows.find((r) => r.label === 'Супериорна стая с изглед към морето');
  assert.deepStrictEqual(Object.keys(sup.cells), ['AAA', 'BBB'], 'вързана автоматично между двамата');
  const std = item.rows.find((r) => r.label === 'Стандартна стая');
  const land = item.rows.find((r) => r.label === 'Стандартна стая с изглед към сушата');
  j = await post('/admin/api/rooms/H1/map', { sig: std.cells.AAA[0].sig, key: land.key });
  assert.ok(j.rows.find((r) => r.key === land.key).cells.AAA[0].manual);
  j = await post('/admin/api/rooms/H1/name', { key: land.key, name: 'Стандартна стая' });
  assert.ok(j.rows.find((r) => r.key === land.key).custom);
  await post('/admin/api/rooms/H1/reviewed', {});
  j = await get('/admin/api/rooms');
  assert.deepStrictEqual(j.counts, { todo: 0, done: 1 });
  j = await get('/admin/api/rooms?q=H1');
  assert.strictEqual(j.items.length, 1, 'търсене по H-номер');
  assert.strictEqual((await fetch(base + '/admin/api/rooms')).status, 401);
});

test('изхранване: концепцията на хотела и съкращението ѝ са едно и също (EXCELLENCE INCLUSIVE = EXAI)', async () => {
  const { boardGroup } = require('../src/catalog/normalize');
  const g = (code, name) => boardGroup(code, name);
  assert.strictEqual(g('EXI', 'EXCELLENCE INCLUSIVE'), 'AI');
  assert.strictEqual(g('EXAI', 'EXAI'), 'AI');
  assert.strictEqual(g('73', 'EXCELLENCE ALL INCLUSIVE'), 'AI');
  assert.strictEqual(g('LAI', ''), 'AI');
  assert.strictEqual(g('AI+', 'ALL INCLUSIVE PLUS'), 'AI');
  assert.strictEqual(g('UAI', 'ULTRA ALL INCLUSIVE'), 'UAI', 'ултра остава ултра');
  assert.strictEqual(g('ULAI', ''), 'UAI');
  assert.strictEqual(g('HB', 'HALF BOARD INCLUSIVE DRINKS'), 'HB', 'полупансион с напитки не е all inclusive');
  assert.strictEqual(g('BB', 'BED AND BREAKFAST'), 'BB');
  assert.strictEqual(g('', 'UNBOUND LUXURY EXPERIENCE'), '?', 'непознатото остава отделно');

  const { engine } = setup();
  const off = (code, board, boardName, total) => ({ hotelCode: code, room: 'DOUBLE ROOM', roomType: 'SUPERIOR', roomCode: 'SUP', roomTypeCode: 'SUP', board, boardName, total, currency: 'EUR', status: 'OK' });
  engine.suppliers.AAA.search = async () => ({ offers: [off('SP1', 'EXI', 'EXCELLENCE INCLUSIVE', 2270)] });
  engine.suppliers.BBB.search = async () => ({ offers: [off('SPX', 'EXAI', 'EXAI', 2345)] });
  const o = (await engine.searchHotel('H1', P, { force: true })).hotels[0].options;
  assert.deepStrictEqual(o.map((x) => [x.room, x.boardLabel, x.price]), [['Супериорна стая', 'All Inclusive', 2270]], 'една стая, едно изхранване, по-евтината цена');
});

test('изхранване: хотел с две концепции в една група (TITANIC DELUXE) – два реда; иначе концепциите се сливат', async () => {
  const { engine } = setup();
  const off = (code, board, boardName, total) => ({ hotelCode: code, room: 'DOUBLE ROOM', roomType: 'STANDARD', roomCode: 'STD', roomTypeCode: 'STD', board, boardName, total, currency: 'EUR', status: 'OK' });
  // AAA дава и двете концепции -> групата UAI се дели; BBB пише делукса по друг начин
  engine.suppliers.AAA.search = async () => ({ offers: [off('SP1', 'UAI', 'ULTRA ALL INCLUSIVE', 2000), off('SP1', 'DAI', 'DELUXE ALL INCLUSIVE', 2600), off('SP1', 'HB', 'HALF BOARD', 1500)] });
  engine.suppliers.BBB.search = async () => ({ offers: [off('SPX', '11', 'ULTRA ALL INCLUSIVE', 1950), off('SPX', '12', 'DELUXE ULTRA ALL INCLUSIVE', 2550)] });
  let r = await engine.searchHotel('H1', P, { force: true });
  let o = r.hotels[0].options;
  assert.deepStrictEqual(o.map((x) => [x.boardLabel, x.board, x.boardGroupLabel, x.price]), [
    ['Half Board', 'HB', 'Half Board', 1500],
    ['Ultra All Inclusive', 'UAI', 'Ultra All Inclusive', 1950], // BBB по-евтин
    ['Deluxe Ultra All Inclusive', 'UAI', 'Ultra All Inclusive', 2550], // отделен ред, BBB по-евтин
  ]);
  assert.notStrictEqual(o[1].boardKey, o[2].boardKey);
  // проверката на цената и резервацията пазят името на концепцията
  assert.strictEqual(engine.resolveOffer(o[2].offerKey).board.boardLabel, 'Deluxe Ultra All Inclusive');

  // никой оператор не дава две концепции -> едно изхранване (EXCELLENCE = ALL INCLUSIVE)
  engine.suppliers.AAA.search = async () => ({ offers: [off('SP1', 'EXI', 'EXCELLENCE INCLUSIVE', 2300)] });
  engine.suppliers.BBB.search = async () => ({ offers: [off('SPX', 'AI', 'ALL INCLUSIVE', 2250)] });
  r = await engine.searchHotel('H1', P, { force: true });
  o = r.hotels[0].options;
  assert.deepStrictEqual(o.map((x) => [x.boardLabel, x.boardKey, x.price]), [['All Inclusive', 'AI', 2250]]);
});

test('стаи: стар data/rooms.json – ключовете на непознатите стаи минават към новия вид', () => {
  const dir = tmp();
  const f = path.join(dir, 'rooms.json');
  const sig = 'AAA|CS|CS|DOUBLE ROOM|COLONEL SUITE';
  fs.writeFileSync(f, JSON.stringify({ hotels: { H1: {
    obs: { [sig]: { op: 'AAA', room: 'DOUBLE ROOM', roomType: 'COLONEL SUITE', auto: { key: 'raw|DOUBLE ROOM COLONEL SUITE', label: 'DOUBLE ROOM COLONEL SUITE' }, first: '2026-11-28', seen: '2026-11-28' } },
    map: { 'BBB|X|X|ECONOMY|ECONOMY': 'raw|DOUBLE ROOM COLONEL SUITE' },
    names: { 'raw|DOUBLE ROOM COLONEL SUITE': 'Полковнически суит' },
  } } }));
  const rs = new RoomStore(f);
  const hm = rs.data.hotels.H1;
  assert.deepStrictEqual(hm.obs[sig].auto, { key: 'raw|COLONEL SUITE', label: 'COLONEL SUITE' });
  assert.strictEqual(hm.map['BBB|X|X|ECONOMY|ECONOMY'], 'raw|COLONEL SUITE');
  assert.strictEqual(rs.roomOf('H1', { op: 'BBB', room: 'COLONEL SUITE', roomType: 'COLONEL SUITE' }).label, 'Полковнически суит', 'името остава');
});
