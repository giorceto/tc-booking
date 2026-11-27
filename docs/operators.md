# Доставчици (турски incoming оператори)

Паролите **не са в git**. Пазят се само в `.env` на сървъра (`/root/tc-prices/.env` при TC Prices) и на компютъра (`D:\Projects\TC-Prices\.env`).

| ID в .env | Оператор | Система | API адрес | База (DB) | B2B портал |
|---|---|---|---|---|---|
| `SUMMER` | Summer Tour | Sedna | `http://online.summertour.com/AgencyApi/Api` | – (OperatorId 1107 идва от входа) | – |
| `ANEA` | Anea Travel | Sejour | `http://b2b.aneatravel.com.tr/webapi/api` | `ANEA` | http://b2b.aneatravel.com.tr/b2b/ |
| `IRELS` | Irels Travel | Sejour | `http://88.248.55.246/webapi/api` | `IRELS2022` | http://88.248.55.246/b2b/ |
| `SONAR` | Sonar Tour | Sejour | `http://31.7.38.61/webapi/api` | `SONARTURIZM2020` | http://31.7.38.61/b2b/ |
| `AKAY` | Akay Tour | Sejour | `https://b2b.akaytour.com/webapi/api` | `AKAYSEJOUR2021` | https://b2b.akaytour.com/b2b/ |
| `PENINSULA` | Peninsula | Sejour | `https://b2b.peninsula.com.tr/webapi/api` | `SEJOUR` | https://b2b.peninsula.com.tr/b2b/ |

## Как се намира адресът на Sejour API

При всички Sejour оператори правилото е едно и също: **адресът на B2B портала + `/webapi/api`**.

- Портал `http://b2b.aneatravel.com.tr/b2b/` → API `http://b2b.aneatravel.com.tr/webapi/api`.
- Името на базата (DB) се взима от оператора или се вижда в портала.
- Някои оператори са само на **http**, не на https (Anea, Irels, Sonar). Не сменяйте протокола.
- Документация: http://docs.santsg.com/sejour/v2/

## Достъп и ограничения

- **IP адрес.** Всички оператори работят от Contabo VPS 173.212.220.227 (busrent.eu) и от офис компютъра. Не е потвърдено дали някой ограничава достъпа по IP. Ако при нов сървър входът „не отговаря“, първо попитайте оператора дали трябва да разреши новото IP.
- **Summer Tour:**
  - `HotelPriceSearch` е ограничено до **10 заявки в минута**; ние пазим 8 (`SUMMER_RATE_PER_MIN=8`).
  - В писмото си те го описват като метод „за проверка на цената при резервация“. При масово търсене на сайт ще трябва да договорим по-висок лимит с тях. Виж [booking-architecture.md](booking-architecture.md).
  - Документация: http://test.kodsedna.com/AgencyDoc/
- **Sejour:** няма обявен лимит. Търсене на цял курорт отнема около 0.7 сек на регион.
- **Peninsula:** връща грешка `10000020 – Domain cannot be linked. Please Check SanApi settings.`. Това е настройка от тяхна страна (SanApi). Трябва да им се пише да включат API-то за нашия потребител/домейн (имаме готова чернова на писмото).

## Какво е разрешено

- Сега ползваме API-тата само за **цени и наличност**.
- **Резервации и анулации директно към операторите засега не правим.** Резервира се ръчно в техния портал. Виж [booking-architecture.md](booking-architecture.md).

## Проверка на достъпа

```bash
npm run selftest
```

Влиза при всички настроени оператори и показва `OK`, грешка или „не отговаря“. „Не отговаря“ най-често значи, че IP-то не е разрешено.
