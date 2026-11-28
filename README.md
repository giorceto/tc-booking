# TC Booking – хотелски резервации за Турция

Вътрешен проект на Tours Club: система тип „букинг“, която търси **в реално време** цени на хотели в Турция по **курорт** или **хотел** при турските incoming оператори и показва **най-добрата цена**, без клиентът да разбира от коя фирма е. Описанията и снимките идват от нашия сайт.

Този клон (`turkey-integration`) съдържа всичко научено от интеграцията в **TC Prices** (busrent.eu/prices):

- документация на API-тата;
- работещите модули за връзка;
- каталога с вързаните хотели;
- нов модул за търсене, който крие доставчика;
- Booking API за сайта: търсене (и стрийминг), проверка на цената, заявка за резервация;
- админ за служителите: резервации с доставчика и нетната цена, потвърждаване;
- страница за търсене и резервация за клиенти (`busrent.eu/book/`).

## Доставчици

| Оператор | Система | Статус |
|---|---|---|
| Summer Tour | Sedna Agency API | работи (лимит 10 търсения/мин) |
| Anea Travel | Sejour REST v2 (SAN TSG) | работи |
| Irels Travel | Sejour REST v2 | работи |
| Sonar Tour | Sejour REST v2 | работи |
| Akay Tour | Sejour REST v2 | работи |
| Peninsula | Sejour REST v2 | грешка 10000020 – чакаме да включат API-то |

Подробно: [docs/operators.md](docs/operators.md).

## Структура

```
src/
  config.js              зарежда .env, описва доставчиците
  suppliers/             връзка с операторите (общ интерфейс)
    sejour.js            Sejour REST v2 – Anea, Irels, Sonar, Akay, Peninsula
    sedna.js             Sedna Agency API – Summer Tour
    limiter.js           лимит заявки/мин (Summer Tour)
    jsonref.js           разплита $id/$ref от Json.NET (Sedna)
    index.js             createSuppliers() – клиент за всеки настроен оператор
  catalog/
    catalog.js           общ каталог: наш хотел ↔ код при всеки оператор
    normalize.js         имена, курорти, изхранване, стаи, звезди
    rooms.js             стаята по характеристики (вид, ниво, изглед) -> ключ и наше име
    roomstore.js         стаите при операторите и ръчните връзки (data/rooms.json, админ → Стаи)
    geo.js               къде е хотелът (наш сайт -> списък хотели при оператор) – за картата
  engine/
    search.js            търсене по хотел/курорт, най-добра цена, скрит доставчик, recheck()
  api/
    app.js               Booking API (node:http): /api/search (SSE), /api/offer/:key/recheck, /api/booking
    params.js            проверка на входа от сайта
  bookings/
    store.js             резервации в data/bookings.json (за потвърждение -> потвърдена/отказана)
  admin/
    routes.js            админ на /admin/: вход, резервации, статус, текст за портала на доставчика
    static/              страницата (HTML/JS/CSS без библиотеки)
    translit.js          кирилица -> латиница (паспортния закон) за имената на гостите
  site/static/           страницата за търсене и резервация (HTML/JS/CSS без библиотеки; map.js – картата)
  content/
    tcsite.js            чете хотел от нашия сайт: снимки, описание, курорт, оценка
    store.js             data/content.json, връзване с каталога (H<id>), преглед в админа
  auth.js                служители: node src/auth.js add <име>
  server.js              npm start
  export/
    pricexml.js          договор Summer Tour → XML (формат IRE-SEAMAR)
    contracts.js         имена на договорите: S27 окончателен, C27/R27 roll-over
deploy/
  install.sh             качване/обновяване на сървъра (systemd + блок в Caddy), виж docs/deploy.md
scripts/
  import-site.js         внос на снимки и описания от сайта (всяка нощ на сървъра)
  selftest.js            проверка на входа при всички оператори
  search.js              пробно търсене от командния ред
test/                    тестове без мрежа (npm test)
data/seed/               каталог (1459 хотела) и списъци хотели по оператор към 28.10.2026
docs/                    документация
```

## Започване

```bash
cp .env.example .env      # попълнете USER/PASS – .env не се качва в git
npm test                  # тестове без мрежа
npm run selftest          # вход при всички оператори
node src/auth.js add ana  # служител за админа (пита за паролата)
npm start                 # търсене: http://127.0.0.1:3100/, админ: http://127.0.0.1:3100/admin/
node scripts/search.js hotel H1 2027-06-15 7 2
node scripts/search.js area SIDE 2027-06-15 7 2 --internal   # --internal показва и доставчика
```

Изисква само Node.js 20+, без външни пакети.

**Важно:** ако на нов сървър входът при оператор „не отговаря“, проверете при него дали трябва да разреши новото IP (виж [docs/operators.md](docs/operators.md)).

## Документация

| Файл | Съдържание |
|---|---|
| [docs/operators.md](docs/operators.md) | адреси, бази, достъп, лимити, контакти |
| [docs/sejour-api.md](docs/sejour-api.md) | Sejour REST v2 – вход, търсене, хотели, договори, EB |
| [docs/sedna-api.md](docs/sedna-api.md) | Sedna (Summer Tour) – вход, търсене, договори, пакети/EB |
| [docs/hotel-catalog.md](docs/hotel-catalog.md) | как връзваме един хотел при всички оператори |
| [docs/rooms.md](docs/rooms.md) | една и съща стая при различните оператори, админ → Стаи |
| [docs/pricing-rules.md](docs/pricing-rules.md) | какво е цената, EB, деца, наличност, избор на най-добра |
| [docs/booking-architecture.md](docs/booking-architecture.md) | предложение за резервационната система |
| [docs/api.md](docs/api.md) | Booking API за сайта – адреси, параметри, отговори, грешки |
| [docs/admin.md](docs/admin.md) | админ – потребители, работа с резервация, сигурност, Caddy |
| [docs/deploy.md](docs/deploy.md) | качване на busrent.eu/book (`deploy/install.sh`) |
| [docs/site-content.md](docs/site-content.md) | снимки и описания от нашия сайт, връзване с каталога |
| [docs/lessons-learned.md](docs/lessons-learned.md) | капани и грешки, които вече сме минали |
