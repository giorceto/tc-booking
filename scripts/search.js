// Пробно търсене от командния ред – показва това, което ще види клиентът (без доставчика).
//   node scripts/search.js hotel H1 2027-06-15 7 2 [възрасти на деца, напр. 5,9]
//   node scripts/search.js area SIDE 2027-06-15 7 2
//   добавете --internal, за да видите и кой доставчик стои зад всяка оферта (само за проверка)
const path = require('path');
const fs = require('fs');
const Catalog = require('../src/catalog/catalog');
const { createSuppliers } = require('../src/suppliers');
const { SearchEngine } = require('../src/engine/search');
const { ROOT, CACHE_MIN } = require('../src/config');
const { Settings } = require('../src/settings');

const args = process.argv.slice(2).filter((a) => a !== '--internal');
const internal = process.argv.includes('--internal');
const [mode, target, date, nights = '7', adults = '2', kids = ''] = args;
if (!['hotel', 'area'].includes(mode) || !target || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
  console.log('Употреба: node scripts/search.js hotel H1 2027-06-15 7 2 [5,9]\n          node scripts/search.js area SIDE 2027-06-15 7 2');
  process.exit(1);
}
const dataFile = path.join(ROOT, 'data', 'catalog.json');
const catalog = new Catalog(fs.existsSync(dataFile) ? dataFile : path.join(ROOT, 'data', 'seed', 'catalog.json'));
const engine = new SearchEngine({ catalog, suppliers: createSuppliers(), markupPct: new Settings(path.join(ROOT, 'data', 'settings.json')).markupPct, cacheMin: CACHE_MIN });
const params = { date, nights: Number(nights), adults: Number(adults), childAges: kids ? kids.split(',').map(Number) : [] };

(async () => {
  const t0 = Date.now();
  const r = mode === 'hotel' ? await engine.searchHotel(target, params) : await engine.searchArea(target, params);
  console.log(`\n${r.count} хотела за ${((Date.now() - t0) / 1000).toFixed(1)} сек.${r.unlinked ? `  (${r.unlinked} оферти от хотели извън каталога – скрити)` : ''}`);
  for (const h of r.hotels.slice(0, 20)) {
    console.log(`\n${h.name}${h.stars ? ' ' + h.stars + '*' : ''} – ${h.area}  от ${h.fromPrice} ${h.currency}`);
    for (const o of h.options) {
      const who = internal ? '  ← ' + engine.resolveOffer(o.offerKey).op : '';
      console.log(`   ${String(o.price).padStart(6)} ${o.currency}  ${o.boardLabel.padEnd(20)} ${o.room}${o.available ? '' : '  (по запитване)'}${o.eb ? `  EB ${o.eb}%` : ''}${who}`);
    }
  }
  if (Object.keys(r.errors).length) console.log('\nГрешки при доставчици:', r.errors);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
