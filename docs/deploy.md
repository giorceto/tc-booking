# Качване на busrent.eu/book

TC Booking върви на същия Contabo VPS (busrent.eu) като TC Prices, като отделна услуга `tc-booking` на порт **3100**. Порт 3000 е на TC Prices. Caddy пренасочва към нея `https://busrent.eu/book/…`.

| Адрес | Какво |
|---|---|
| `https://busrent.eu/book/admin/` | админ за служителите |
| `https://busrent.eu/book/api/…` | API за сайта ([api.md](api.md)) |
| `https://busrent.eu/book/` | засега пренасочва към админа |

## Първо качване

На сървъра, като root:

```bash
git clone -b <клон> https://github.com/giorceto/tc-booking.git /root/tc-booking
bash /root/tc-booking/deploy/install.sh
node /root/tc-booking/src/auth.js add <име>
```

Името на папката е с малки букви, `tc-booking` (виж [lessons-learned.md](lessons-learned.md)).

`deploy/install.sh` прави следното:

1. Проверява Node 20+.
2. Прави `.env`, само ако го няма. Паролите на операторите (`*_USER`, `*_PASS`) ги взема от `/root/tc-prices/.env`, така че не минават през git или чат. На екрана се показват само имената на ключовете. Ако не намери някоя парола, я попълвате ръчно в `/root/tc-booking/.env`. Проверява и че порт 3100 е свободен.
3. Копира `catalog.json` и `hotels-*.json` от `/root/tc-prices/data/`, ако тук ги няма. Те са по-нови от тези в git.
4. Пуска тестовете. Ако не минат, спира, преди да е пипнал услугата и Caddy.
5. Прави услугата `/etc/systemd/system/tc-booking.service` (`Restart=always`, `TZ=Europe/Sofia`) и я пуска.
6. **Добавя** в Caddyfile, в блока на `busrent.eu`, следното:
   ```
   redir /book /book/ 308
   handle_path /book/* {
       reverse_proxy 127.0.0.1:3100
   }
   ```
   - Не пише файла отначало (виж урока с `/root/comp/install.sh`).
   - Пази копие `Caddyfile.bak-tc-booking-<дата>`.
   - Проверява новия файл с `caddy validate`, преди да го запише.
   - След `systemctl reload caddy` проверява, че `/prices/` отговаря както преди. Ако не отговаря, връща копието.
   - Ако не намери точно един блок за `busrent.eu`, не пипа нищо и показва какво да се добави ръчно.

## Обновяване

```bash
git -C /root/tc-booking pull --ff-only && bash /root/tc-booking/deploy/install.sh
```

Скриптът може да се пуска многократно. `.env`, `data/` (резервации, служители, каталог) и блокът в Caddy не се пипат втори път.

## Проверка

```bash
systemctl status tc-booking
journalctl -u tc-booking -n 60
cd /root/tc-booking && npm run selftest
curl -s https://busrent.eu/book/api/health
```

`npm run selftest` влиза при операторите. От този сървър IP-то вече е разрешено, защото TC Prices работи оттук.

## Важно

- **Лимитът на Summer Tour (10 търсения/мин) е общ с TC Prices.** TC Prices ползва 8, затова тук `SUMMER_RATE_PER_MIN=2`. За публичен сайт ще трябва по-висок лимит от Summer (виж [booking-architecture.md](booking-architecture.md)).
- **API-то е публично**, с лимит по IP: търсене 20/мин, резервация 5 за 10 мин. Вижда се в `src/api/app.js` (`LIMITS`). Докато няма сайт, никой не би трябвало да го вика освен вас.
- Резервациите и служителите са в `/root/tc-booking/data/`. Тази папка трябва да влиза в бекъпа на сървъра.

## Връщане назад

```bash
systemctl disable --now tc-booking
cp /etc/caddy/Caddyfile.bak-tc-booking-<дата> /etc/caddy/Caddyfile && systemctl reload caddy
```
