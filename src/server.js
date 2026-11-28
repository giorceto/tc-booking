// Пуска Booking API:  npm start
// Каталог: data/catalog.json (ако го има – копие от сървъра на TC Prices), иначе data/seed/catalog.json.
// Резервации: data/bookings.json, служители: data/users.json (не се качват в git).
const fs = require('fs');
const path = require('path');
const Catalog = require('./catalog/catalog');
const { createSuppliers } = require('./suppliers');
const { SearchEngine } = require('./engine/search');
const { BookingStore } = require('./bookings/store');
const { createServer } = require('./api/app');
const { createAdmin } = require('./admin/routes');
const { Users } = require('./auth');
const { ContentStore } = require('./content/store');
const { refreshCatalog, scheduleDaily } = require('./catalog/refresh');
const { Settings } = require('./settings');
const { RoomStore } = require('./catalog/roomstore');
const { ROOT, PORT, HOST, CORS_ORIGIN, CACHE_MIN, SITE_URL, HERO_IMAGE, CATALOG_TIME, operators } = require('./config');

// Каталогът се пази в data/catalog.json (там се записват и решенията от админа) – никога в data/seed (в git)
const catalogFile = path.join(ROOT, 'data', 'catalog.json');
if (!fs.existsSync(catalogFile)) {
  fs.mkdirSync(path.dirname(catalogFile), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'data', 'seed', 'catalog.json'), catalogFile);
}
const catalog = new Catalog(catalogFile);
// автоматични връзки, станали през непроверено име – за проверка, докато човек не ги прегледа
const chains = catalog.markChains();
const suppliers = createSuppliers();
// скрити курорти и надценка – от админа (data/settings.json), важат веднага
const settings = new Settings(path.join(ROOT, 'data', 'settings.json'));
// стаите: наблюдавани в търсенията + ръчните връзки от админа (data/rooms.json)
const rooms = new RoomStore(path.join(ROOT, 'data', 'rooms.json'));
const engine = new SearchEngine({ catalog, suppliers, markupPct: settings.markupPct, cacheMin: CACHE_MIN, rooms });
settings.onChange = () => (engine.markupPct = settings.markupPct);
const bookings = new BookingStore(path.join(ROOT, 'data', 'bookings.json'));
const content = new ContentStore(path.join(ROOT, 'data', 'content.json')); // npm run import-site

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Sofia' });
const log = {
  info: (...a) => console.log(stamp(), ...a),
  warn: (...a) => console.warn(stamp(), ...a),
  error: (...a) => console.error(stamp(), ...a),
};

const users = new Users(path.join(ROOT, 'data', 'users.json'));
// Нощно обновяване на каталога – в сървъра (един пишещ: админът и обновяването не си презаписват файла)
const lastFile = path.join(ROOT, 'data', 'catalog-refresh.json');
const catalogJob = {
  running: false,
  last: fs.existsSync(lastFile) ? JSON.parse(fs.readFileSync(lastFile, 'utf8')) : null,
  async run() {
    if (this.running) return false;
    this.running = true;
    try {
      this.last = await refreshCatalog({ catalog, suppliers, dataDir: path.join(ROOT, 'data'), content, log });
    } catch (e) {
      log.error('[каталог] обновяването не успя:', e);
      this.last = { at: new Date().toISOString(), error: e.message };
    } finally {
      this.running = false;
      fs.writeFileSync(lastFile, JSON.stringify(this.last));
    }
    return true;
  },
};
scheduleDaily(CATALOG_TIME, () => catalogJob.run());

const opNames = Object.fromEntries(operators.map((o) => [o.id, o.name]));
const admin = createAdmin({ bookings, users, content, catalog, catalogJob, settings, rooms, opNames, siteUrl: SITE_URL, log });

const server = createServer({ engine, catalog, bookings, admin, content, settings, siteUrl: SITE_URL, heroImage: HERO_IMAGE, corsOrigin: CORS_ORIGIN, log });
server.listen(PORT, HOST, () => {
  log.info(`TC Booking API: http://${HOST}:${PORT}/api/health`);
  log.info(`  каталог: ${path.relative(ROOT, catalogFile)} (${catalog.data.hotels.length} хотела, ${catalog.review().length} връзки за проверка – не се ползват за цени)`);
  if (chains) log.info(`  каталог: ${chains} верижни връзки станаха „за проверка“ (админ → Каталог)`);
  log.info(`  каталог: обновяване от операторите всяка нощ в ${CATALOG_TIME}${catalogJob.last ? `, последно ${catalogJob.last.at}` : ''}`);
  log.info(`  доставчици: ${Object.keys(suppliers).join(', ') || 'няма – попълнете .env'}`);
  log.info(`  надценка ${settings.markupPct}% (админ → Настройки), кеш ${CACHE_MIN} мин${CORS_ORIGIN ? `, CORS: ${CORS_ORIGIN}` : ''}`);
  if (settings.hidden.size) log.info(`  скрити курорти (админ → Курорти): ${[...settings.hidden].join(', ')}`);
  const cc = content.counts();
  log.info(`  снимки от сайта: ${cc.linked} хотела${cc.check ? `, ${cc.check} за проверка` : ''}${cc.linked + cc.check + cc.none ? '' : ' – npm run import-site'}`);
  const n = users.list().length;
  log.info(`  админ: http://${HOST}:${PORT}/admin/ (${n ? `${n} потребител${n > 1 ? 'я' : ''}` : 'няма потребители – node src/auth.js add <име>'})`);
});

// при спиране (systemctl restart/stop) наблюдаваните стаи се записват, за да не се губят
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try {
      rooms.save();
    } finally {
      process.exit(0);
    }
  });
}
