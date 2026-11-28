// Внос на снимки и описания от нашия сайт и връзване с каталога (H<id>):  npm run import-site
//   --limit N        само първите N хотела от sitemap (за проба)
//   --all            тегли наново и хотелите извън Турция (иначе се проверяват веднъж на 30 дни)
// Пуска се всяка нощ от tc-booking-import.timer (deploy/install.sh). Сървърът сам вижда новия data/content.json.
const fs = require('fs');
const path = require('path');
const Catalog = require('../src/catalog/catalog');
const { ContentStore } = require('../src/content/store');
const { parseHotelPage, parseSitemap, hotelUrl } = require('../src/content/tcsite');
const { ROOT, SITE_URL } = require('../src/config');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const LIMIT = Number(opt('--limit', 0)) || 0;
const ALL = args.includes('--all');
const CONCURRENCY = 2;
const DELAY_MS = 400; // пауза между заявките на всеки поток – да не товарим сайта
const OTHER_DAYS = 30;
const UA = 'tc-booking-import/1.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(2000 * i);
    }
  }
}

(async () => {
  const t0 = Date.now();
  const store = new ContentStore(path.join(ROOT, 'data', 'content.json'));
  const dataCat = path.join(ROOT, 'data', 'catalog.json');
  const catalog = new Catalog(fs.existsSync(dataCat) ? dataCat : path.join(ROOT, 'data', 'seed', 'catalog.json'));

  console.log(`Сайт: ${SITE_URL}`);
  const xml = await get(`${SITE_URL}/sitemap.xml`);
  if (!xml) throw new Error('няма sitemap.xml');
  let list = parseSitemap(xml);
  console.log(`  в sitemap: ${list.length} хотела`);
  const known = Object.keys(store.data.site).length + Object.keys(store.data.other).length;
  if (known > 100 && list.length < known * 0.5) throw new Error(`sitemap има само ${list.length} хотела, а досега бяха ${known} – спирам, за да не изтрия нищо по грешка`);
  if (LIMIT) list = list.slice(0, LIMIT);

  const now = Date.now();
  const todo = list.filter((x) => {
    const o = store.data.other[x.siteId];
    return ALL || !o || now - Date.parse(o.at) > OTHER_DAYS * 86400000;
  });
  console.log(`  за теглене: ${todo.length} (хотели извън Турция се проверяват веднъж на ${OTHER_DAYS} дни)`);

  let done = 0;
  let turkey = 0;
  let failed = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let x = queue.shift(); x; x = queue.shift()) {
        try {
          const html = await get(hotelUrl(SITE_URL, x));
          const rec = html && parseHotelPage(html, SITE_URL);
          if (!rec) store.data.other[x.siteId] = { country: '?', at: new Date().toISOString() };
          else if (rec.country !== 'Турция') store.data.other[x.siteId] = { country: rec.country, at: new Date().toISOString() };
          else {
            store.put({ ...rec, slug: x.slug, fetchedAt: new Date().toISOString() });
            turkey++;
          }
        } catch (e) {
          failed++;
          console.warn(`  ! ${x.siteId} ${x.slug}: ${e.message}`);
        }
        if (++done % 50 === 0) console.log(`  … ${done}/${todo.length}`);
        await sleep(DELAY_MS);
      }
    })
  );

  // хотели, които вече ги няма в sitemap
  if (!LIMIT) {
    const inMap = new Set(list.map((x) => x.siteId));
    for (const id of Object.keys(store.data.site)) {
      if (inMap.has(id)) continue;
      console.log(`  - махнат от сайта: ${id} ${store.data.site[id].name}`);
      delete store.data.site[id];
      delete store.data.links[id];
    }
  }

  const st = store.match(catalog);
  const total = Object.keys(store.data.site).length;
  console.log(`\nГотово за ${Math.round((Date.now() - t0) / 1000)} сек.`);
  console.log(`  изтеглени: ${done}, от тях в Турция: ${turkey}${failed ? `, грешки: ${failed}` : ''}`);
  console.log(`  хотели от сайта в Турция: ${total}`);
  console.log(`  вързани автоматично: ${st.auto}, потвърдени: ${st.ok}, за проверка: ${st.check}, без връзка: ${st.none}`);
  if (st.check) console.log('  Прегледайте „за проверка“ в админа → Снимки от сайта.');
  if (failed && failed === todo.length) process.exit(1);
})().catch((e) => {
  console.error('Грешка:', e.message);
  process.exit(1);
});
