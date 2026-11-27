#!/usr/bin/env bash
# Инсталира или обновява TC Booking на сървъра (Contabo VPS, busrent.eu) – пуска се като root:
#
#   първи път:
#     git clone -b <клон> https://github.com/giorceto/tc-booking.git /root/tc-booking
#     bash /root/tc-booking/deploy/install.sh
#   обновяване:
#     git -C /root/tc-booking pull --ff-only && bash /root/tc-booking/deploy/install.sh
#
# Какво прави (виж docs/deploy.md):
#   1. проверява Node 20+;
#   2. .env – само ако го няма (паролите на операторите се вземат от .env на TC Prices); портът да е свободен;
#   3. каталога и списъците хотели – от TC Prices, ако тук още ги няма;
#   4. тестовете (без мрежа) – при грешка спира, преди да пипне услугата и Caddy;
#   5. systemd услуга tc-booking (Restart=always, TZ=Europe/Sofia);
#   6. Caddy: ДОБАВЯ блок за /book в съществуващия busrent.eu { ... } – не пише файла отначало.
#      Пази копие, проверява с `caddy validate`, след презареждане проверява, че /prices работи
#      както преди; ако нещо се счупи – връща старото копие.
#
# Настройки (по желание): APP_DIR PORT PREFIX SITE CADDYFILE TCP_DIR UNIT_DIR
set -euo pipefail

APP_DIR="${APP_DIR:-/root/tc-booking}"
PORT="${PORT:-3100}"
PREFIX="${PREFIX:-/book}"
SITE="${SITE:-busrent.eu}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
TCP_DIR="${TCP_DIR:-/root/tc-prices}"
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"
SERVICE=tc-booking

ok() { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
die() { printf '  \033[31mXX\033[0m  %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || die "пуснете като root"
[ -f "$APP_DIR/src/server.js" ] || die "няма $APP_DIR/src/server.js – първо git clone (виж началото на този файл)"
cd "$APP_DIR"

# ---------- 1. проверки ----------
step "1. Проверки"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || die "няма Node.js"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $("$NODE" -v) – трябва 20 или по-нов"
ok "Node $("$NODE" -v) ($NODE)"

# ---------- 2. .env ----------
step "2. Настройки (.env)"
"$NODE" deploy/make-env.js "$APP_DIR" "$PORT" "$TCP_DIR/.env"
chmod 600 .env
ENV_PORT="$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
if [ -n "$ENV_PORT" ] && [ "$ENV_PORT" != "$PORT" ]; then
  warn "в .env е PORT=$ENV_PORT – ползвам него"
  PORT="$ENV_PORT"
fi

# портът: свободен или вече е на нашата услуга (без ss – само bash и curl)
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  HEALTH="$(curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)" # не през | grep -q – с pipefail дава грешка
  if systemctl is-active --quiet "$SERVICE" && [[ "$HEALTH" == *'"ok":true'* ]]; then
    ok "порт $PORT – нашата услуга (ще се рестартира)"
  else
    die "порт $PORT е зает от друга програма – сменете PORT в $APP_DIR/.env (и в Caddyfile, ако блокът вече е добавен)"
  fi
else
  ok "порт $PORT е свободен"
fi

# ---------- 3. данни ----------
step "3. Каталог"
mkdir -p data
chmod 700 data
if [ -f data/catalog.json ]; then
  ok "data/catalog.json вече го има"
elif [ -f "$TCP_DIR/data/catalog.json" ]; then
  cp "$TCP_DIR/data/catalog.json" data/catalog.json
  ok "каталогът е копиран от $TCP_DIR/data/catalog.json (по-нов от този в git)"
else
  warn "ползва се data/seed/catalog.json (от 28.10.2026)"
fi
for f in "$TCP_DIR"/data/hotels-*.json; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"
  if [ ! -f "data/$b" ]; then cp "$f" "data/$b" && ok "data/$b – от TC Prices"; fi
done

# ---------- 4. тестове ----------
step "4. Тестове (без мрежа)"
if "$NODE" --test >/tmp/tc-booking-test.log 2>&1; then
  ok "$(grep -oE '^# pass [0-9]+' /tmp/tc-booking-test.log | grep -oE '[0-9]+' || true) теста минаха"
else
  tail -40 /tmp/tc-booking-test.log >&2
  die "тестовете не минават – нищо не е променено по услугата и Caddy (лог: /tmp/tc-booking-test.log)"
fi

# ---------- 5. услуга ----------
step "5. Услуга $SERVICE"
UNIT="$UNIT_DIR/$SERVICE.service"
NEW_UNIT="$(cat <<EOF
[Unit]
Description=TC Booking – търсене и резервации (API + админ)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$NODE src/server.js
Restart=always
RestartSec=3
Environment=TZ=Europe/Sofia
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
)"
if [ ! -f "$UNIT" ] || [ "$(cat "$UNIT")" != "$NEW_UNIT" ]; then
  printf '%s\n' "$NEW_UNIT" >"$UNIT"
  systemctl daemon-reload
  ok "$UNIT записан"
fi
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"
for _ in $(seq 1 20); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || { journalctl -u "$SERVICE" -n 30 --no-pager >&2; die "услугата не отговаря на 127.0.0.1:$PORT"; }
ok "работи на 127.0.0.1:$PORT (логове: journalctl -u $SERVICE -n 60)"

# ---------- 6. Caddy ----------
step "6. Caddy: $SITE$PREFIX"
caddy_manual() {
  warn "$1"
  cat <<EOF

  Добавете РЪЧНО в блока на $SITE в $CADDYFILE (не пишете файла отначало):

	redir $PREFIX $PREFIX/ 308
	handle_path $PREFIX/* {
		reverse_proxy 127.0.0.1:$PORT
	}

  после:  caddy validate --config $CADDYFILE --adapter caddyfile && systemctl reload caddy
EOF
}
# статус на адрес от сървъра през самия Caddy (без да зависи от DNS)
status() { curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE$1" || true; }

if ! command -v caddy >/dev/null || [ ! -f "$CADDYFILE" ]; then
  caddy_manual "няма caddy или $CADDYFILE"
elif grep -qE "handle_path[[:space:]]+$PREFIX/\*" "$CADDYFILE"; then
  ok "блокът за $PREFIX вече е в $CADDYFILE – не го пипам"
else
  # Намира блока на сайта на най-горно ниво (адресите преди „{“ включват $SITE)
  FIND_SITE='
    function is_site(line,   head, n, parts, i, a) {
      head = line; sub(/\{[ \t]*$/, "", head)
      n = split(head, parts, /[ \t,]+/)
      for (i = 1; i <= n; i++) { a = parts[i]; sub(/^[a-z]+:\/\//, "", a); sub(/:[0-9]+$/, "", a); if (a == ENVIRON["SITE"]) return 1 }
      return 0
    }
    {
      code = $0; sub(/#.*/, "", code)
      site = (depth == 0 && code ~ /\{[ \t]*$/ && is_site(code))
      depth += gsub(/\{/, "{", code) - gsub(/\}/, "}", code)
      if (site) hits++
      if (MODE == "insert") { print; if (site && !done) { print ENVIRON["SNIP"]; done = 1 } }
    }
    END { if (MODE == "count") print hits + 0 }'
  export SITE
  HITS="$(awk -v MODE=count "$FIND_SITE" "$CADDYFILE")"
  if [ "$HITS" != 1 ]; then
    caddy_manual "блокове за $SITE в $CADDYFILE: $HITS (очаква се точно 1) – не пипам файла"
  else
    BEFORE_PRICES="$(status /prices/)"
    BACKUP="$CADDYFILE.bak-tc-booking-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$BACKUP"
    SNIP="$(printf '\t# TC Booking (добавено от %s/deploy/install.sh на %s)\n\tredir %s %s/ 308\n\thandle_path %s/* {\n\t\treverse_proxy 127.0.0.1:%s\n\t}' "$APP_DIR" "$(date +%F)" "$PREFIX" "$PREFIX" "$PREFIX" "$PORT")"
    export SNIP
    awk -v MODE=insert "$FIND_SITE" "$BACKUP" >"$CADDYFILE.tmp-tc-booking"
    restore() {
      cp -p "$BACKUP" "$CADDYFILE"
      rm -f "$CADDYFILE.tmp-tc-booking"
      systemctl reload caddy || true
      die "$1 – върнато е старото копие ($BACKUP)"
    }
    caddy validate --config "$CADDYFILE.tmp-tc-booking" --adapter caddyfile >/tmp/tc-booking-caddy.log 2>&1 || { cat /tmp/tc-booking-caddy.log >&2; rm -f "$CADDYFILE.tmp-tc-booking"; die "новият Caddyfile не минава caddy validate – $CADDYFILE не е променен"; }
    cat "$CADDYFILE.tmp-tc-booking" >"$CADDYFILE" # запазва собственика и правата на файла
    rm -f "$CADDYFILE.tmp-tc-booking"
    systemctl reload caddy || restore "caddy не се презареди"
    sleep 1
    AFTER_PRICES="$(status /prices/)"
    [ "$AFTER_PRICES" = "$BEFORE_PRICES" ] || restore "/prices отговаря с $AFTER_PRICES, а преди беше $BEFORE_PRICES"
    ok "блокът е добавен; копие на стария файл: $BACKUP"
    ok "/prices/ отговаря както преди ($AFTER_PRICES)"
  fi
fi

BOOK_HEALTH="$(status "$PREFIX/api/health")"
if [ "$BOOK_HEALTH" = 200 ]; then ok "https://$SITE$PREFIX/api/health – 200"; else warn "https://$SITE$PREFIX/api/health отговаря с $BOOK_HEALTH"; fi

# ---------- готово ----------
step "Готово"
echo "  админ:  https://$SITE$PREFIX/admin/"
echo "  API:    https://$SITE$PREFIX/api/health"
if [ -z "$("$NODE" src/auth.js list 2>/dev/null | grep -v '^(няма')" ]; then
  echo
  warn "няма служители – добавете поне един:  node $APP_DIR/src/auth.js add <име>"
fi
echo "  проверка на операторите:  cd $APP_DIR && npm run selftest"
