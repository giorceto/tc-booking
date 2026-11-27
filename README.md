# TC Booking – хотелски резервации за Турция

Вътрешен проект на Tours Club: система тип „букинг“, която търси **в реално време** цени на хотели в Турция по **курорт** или **хотел** при турските incoming оператори и показва **най-добрата цена**, без клиентът да разбира от коя фирма е. Описанията и снимките идват от нашия сайт.

Този клон (`turkey-integration`) съдържа всичко научено от интеграцията в **TC Prices** (busrent.eu/prices):

- документация на API-тата;
- работещите модули за връзка;
- каталога с вързаните хотели;
- нов модул за търсене, който крие доставчика.

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
  engine/
    search.js            търсене по хотел/курорт, най-добра цена, скрит доставчик
  export/
    pricexml.js          договор Summer Tour → XML (формат IRE-SEAMAR)
    contracts.js         имена на договорите: S27 окончателен, C27/R27 roll-over
scripts/
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
| [docs/pricing-rules.md](docs/pricing-rules.md) | какво е цената, EB, деца, наличност, избор на най-добра |
| [docs/booking-architecture.md](docs/booking-architecture.md) | предложение за резервационната система |
| [docs/lessons-learned.md](docs/lessons-learned.md) | капани и грешки, които вече сме минали |
