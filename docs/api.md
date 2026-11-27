# Booking API – за сайта

Пуска се с `npm start` (`src/server.js`). Слуша на `HOST:PORT` от `.env` (по подразбиране `127.0.0.1:3000`, зад Caddy).
Ако сайтът вика API-то от браузъра от друг адрес, той се записва в `CORS_ORIGIN`. Може и няколко, разделени със запетая.

**Правило:** нищо в отговорите не издава доставчика. Няма име или код на доставчика, няма кода на хотела при него, няма нетна цена и няма грешки по доставчици. Тези неща отиват само в лога на сървъра. Тестът `test/api.test.js` проверява това за всеки адрес.

Всички грешки са JSON `{ "error": "текст за клиента", "reason"?: "..." }` с подходящ HTTP код.

## Каталог

### `GET /api/areas`
Курортите с брой хотели. Хотелите са само тези, които имат поне един активен доставчик.
```json
{ "areas": [{ "area": "ALANYA", "hotels": 312 }, { "area": "SIDE", "hotels": 205 }] }
```

### `GET /api/hotels?q=utopia[&area=ALANYA]`
Търсене на хотел по име, най-много 20 резултата, `q` е поне 2 букви. Не търси по кодовете при доставчиците.
```json
{ "hotels": [{ "hotelId": "H1", "name": "A GOOD LIFE UTOPIA FAMILY RESORT", "area": "ALANYA", "stars": 4 }] }
```
`hotelId` (`H<id>`) е ключът към описанието и снимките на сайта.

## Търсене

### `GET /api/search`

| Параметър | |
|---|---|
| `area` **или** `hotel` | курорт (`SIDE`, `ALANYA`…, малки или главни букви) или хотел `H1` |
| `date` | настаняване `ГГГГ-ММ-ДД`, не в миналото, до 2 години напред |
| `nights` | 1–30, по подразбиране 7 |
| `adults` | 1–6, по подразбиране 2 |
| `childAges` | възрасти на децата `5,9` (0–17, най-много 3 деца) |
| `stream=1` | стрийминг (SSE), същото като `Accept: text/event-stream` |

**JSON** (без `stream`) връща отговор, след като отговорят всички доставчици:
```json
{
  "params": { "date": "2027-06-15", "nights": 7, "adults": 2, "childAges": [5] },
  "count": 1,
  "incomplete": false,
  "hotels": [{
    "hotelId": "H1", "name": "…", "area": "SIDE", "stars": 5, "fromPrice": 1210, "currency": "EUR",
    "options": [{
      "offerKey": "Zm9vYmFyYmF6cXV4", "room": "STANDARD ROOM", "roomGroup": "Стандартна", "seaView": false,
      "board": "AI", "boardLabel": "All Inclusive", "price": 1210, "currency": "EUR",
      "available": true, "eb": 10, "checkIn": "2027-06-15", "nights": 7
    }]
  }]
}
```
- `price` е продажната цена за целия престой в стаята. EB вече е включен, а `eb` е само за надпис („ранно записване −10%“).
- `available: false` значи „по запитване“.
- `incomplete: true` значи, че поне един доставчик не е отговорил и резултатите може да не са пълни.
- Хотелите са подредени по `fromPrice`.

**SSE** (`stream=1`): първите хотели идват след около 1 сек, вместо да се чака най-бавният доставчик.
```
event: part
data: {"count":12,"hotels":[ …само новите или променените хотели… ]}

event: part
data: {"count":15,"hotels":[ … ]}

event: done
data: {"count":15,"incomplete":false}
```
- Сайтът пази хотелите по `hotelId`. Всеки хотел от `part` **заменя** предишния със същия `hotelId`. След това сайтът подрежда по `fromPrice`.
- При грешка идва `event: error` с `{ "error": "…" }`.
- На всеки 15 сек идва ред `: ping`, за да не прекъсне връзката.
- Пример в браузъра:
  ```js
  const es = new EventSource(`/api/search?area=SIDE&date=2027-06-15&nights=7&adults=2&stream=1`);
  const hotels = new Map();
  es.addEventListener('part', (e) => { for (const h of JSON.parse(e.data).hotels) hotels.set(h.hotelId, h); render([...hotels.values()]); });
  es.addEventListener('done', () => es.close());
  es.addEventListener('error', () => es.close());
  ```

**`offerKey`** важи 30 минути от последното търсене, в което се е появил. Една и съща оферта има един и същ ключ при повторно търсене. След рестарт на сървъра ключовете не важат и клиентът трябва да потърси отново.

## Проверка на цената

### `POST /api/offer/:offerKey/recheck`
Търси наново при същия доставчик, без кеш. Подходящо е при отваряне на формата за резервация.
```json
{ "offerKey": "…", "price": 1265, "previousPrice": 1210, "changed": true, "currency": "EUR", "available": false, "onRequest": true }
```
| Код | Кога |
|---|---|
| 410 `reason: expired` | ключът е изтекъл; трябва ново търсене |
| 410 `reason: gone` | офертата вече я няма при доставчика |
| 410 `reason: stop` | стоп продажба |
| 502 | доставчикът не отговаря; клиентът може да опита пак |

При Summer Tour всяка проверка влиза в лимита от 10 търсения в минута.

## Резервация

### `POST /api/booking`
```json
{
  "offerKey": "…",
  "expectedPrice": 1210,
  "contact": { "name": "Иван Петров", "email": "ivan@example.com", "phone": "+359 888 123 456" },
  "guests": [
    { "firstName": "Ivan", "lastName": "Petrov" },
    { "firstName": "Maria", "lastName": "Petrova" },
    { "firstName": "Petar", "lastName": "Petrov", "birthDate": "2021-03-02" }
  ],
  "note": "по възможност висок етаж"
}
```
- `expectedPrice` е цената, която клиентът е видял. Сървърът проверява цената наново при доставчика. Ако е различна, връща **409** `reason: price_changed` с новата `price` и не записва нищо. Сайтът показва новата цена и изпраща заявката пак с нея.
- `guests` трябва да са колкото са хората в търсенето (възрастни + деца).
- **201** означава, че резервацията е записана със статус `pending` („за потвърждение“). Служител я прави в портала на доставчика.
  ```json
  { "bookingId": "TCB-000001", "status": "pending", "hotelId": "H1", "hotelName": "…", "room": "…", "boardLabel": "All Inclusive",
    "checkIn": "2027-06-15", "nights": 7, "adults": 2, "childAges": [5], "price": 1210, "currency": "EUR", "onRequest": false, … }
  ```
- `onRequest: true` значи, че офертата е по запитване. Клиентът трябва да разбере, че ще получи потвърждение по-късно.
- Ако същата заявка (същата оферта, имейл и гости) дойде пак до 10 минути, например при двоен клик, сървърът връща същата резервация с код **200** и `duplicate: true`.
- Грешки: 400 при невалидни данни, 410 при изтекла, изчезнала или спряна оферта, 502 когато доставчикът не отговаря.

Резервациите са в `data/bookings.json` (не се качва в git, защото има лични данни). Във всеки запис има `public` (каквото е видял клиентът) и `internal` (доставчик, код на хотела, нетна цена, EB, кога е проверена цената). Статуси: `pending` → `confirmed` / `rejected` / `cancelled` (`BookingStore.setStatus`).
