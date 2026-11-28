// Админ – резервации. Без библиотеки. Всички адреси са относителни (работи и зад Caddy с префикс).
// Данните от клиентите се слагат само като текст (textContent), никога като HTML.
'use strict';

const STATUS = { pending: 'За потвърждение', confirmed: 'Потвърдена', rejected: 'Отказана', cancelled: 'Анулирана' };
const TABS = [['pending', 'За потвърждение'], ['confirmed', 'Потвърдени'], ['rejected', 'Отказани'], ['cancelled', 'Анулирани'], ['', 'Всички']];
const REFRESH_MS = 60000;

const state = { view: 'bookings', user: null, role: null, status: 'pending', q: '', list: [], counts: {}, total: 0, selected: null, detail: null, timer: null };
const $app = document.getElementById('app');

// ---------- помощни ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

const money = (n, cur) => {
  if (n == null) return '–';
  const d = Number.isInteger(Number(n)) ? 0 : 2; // 2227.5 -> 2227,50; 1980 -> 1980
  return `${Number(n).toLocaleString('bg-BG', { minimumFractionDigits: d, maximumFractionDigits: d })} ${cur || ''}`.trim();
};
const day = (d) => (d ? d.split('-').reverse().join('.') : '');
const when = (iso) => new Date(iso).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' г.,', ',');
const pax = (adults, children) => `${adults} възр.${children ? ` + ${children} дете${children > 1 ? 'ца' : ''}` : ''}`;
const badge = (status) => h('span', { class: `badge s-${status}` }, STATUS[status] || status);

async function api(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, { credentials: 'same-origin', ...opt });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'api/login') {
    stopRefresh();
    state.user = null;
    renderLogin('Сесията изтече – влезте отново.');
    throw new Error('401');
  }
  if (!r.ok) throw new Error(data.error || `Грешка ${r.status}`);
  return data;
}

function toast(msg, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) document.body.append((box = h('div', { class: 'toasts', 'aria-live': 'polite' })));
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- вход ----------
function renderLogin(message) {
  const err = h('p', { class: 'error', 'aria-live': 'polite' }, message || '');
  const user = h('input', { name: 'user', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { type: 'submit', class: 'primary' }, 'Вход');
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await api('api/login', { user: user.value, password: pass.value });
      state.user = r.user;
      state.role = r.role;
      renderMain();
    } catch (x) {
      err.textContent = x.message;
      pass.value = '';
      pass.focus();
    } finally {
      btn.disabled = false;
    }
  } },
  h('h1', null, 'TC Booking'),
  h('p', { class: 'muted' }, 'Вход за служителите'),
  h('label', null, 'Потребител', user),
  h('label', null, 'Парола', pass),
  btn,
  err);
  $app.replaceChildren(form);
  user.focus();
}

// ---------- основен изглед ----------
let $tabs, $list, $detail, $search;

function header() {
  const nav = (v, label) => h('button', { class: `view${state.view === v ? ' on' : ''}`, 'aria-current': state.view === v ? 'page' : null, onclick: () => {
    if (state.view === v) return;
    state.view = v;
    renderMain();
  } }, label);
  return h('header', { class: 'top' },
    h('strong', null, 'TC Booking'),
    h('nav', { class: 'views' }, nav('bookings', 'Резервации'), nav('catalog', 'Каталог'), nav('content', 'Снимки от сайта'), nav('rooms', 'Стаи'), nav('areas', 'Настройки'),
      state.role === 'admin' ? nav('users', 'Потребители') : null),
    h('span', { class: 'spacer' }),
    h('button', { class: `link me${state.view === 'me' ? ' on' : ''}`, title: 'Смяна на паролата', onclick: () => {
      state.view = 'me';
      renderMain();
    } }, state.user),
    h('button', { class: 'link', onclick: logout }, 'Изход'));
}

function renderMain() {
  stopRefresh();
  if (state.view === 'content') return renderContentView();
  if (state.view === 'catalog') return renderCatalogView();
  if (state.view === 'areas') return renderAreasView();
  if (state.view === 'rooms') return renderRoomsView();
  if (state.view === 'users') return renderUsersView();
  if (state.view === 'me') return renderMeView();
  $tabs = h('nav', { class: 'tabs', 'aria-label': 'Статус' });
  $search = h('input', { type: 'search', placeholder: 'Търсене: номер, име, имейл, хотел…', value: state.q, oninput: debounce(() => {
    state.q = $search.value;
    loadList();
  }, 300) });
  $list = h('section', { class: 'list' });
  $detail = h('section', { class: 'detail' }, h('p', { class: 'muted empty' }, 'Изберете резервация от списъка.'));
  $app.replaceChildren(
    header(),
    h('div', { class: 'toolbar' }, $tabs, $search),
    h('main', { class: 'grid' }, $list, $detail));
  loadList();
  startRefresh();
}

function renderTabs() {
  const all = Object.values(state.counts).reduce((a, b) => a + b, 0);
  $tabs.replaceChildren(...TABS.map(([s, label]) => {
    const n = s ? state.counts[s] || 0 : all;
    return h('button', { class: `tab${state.status === s ? ' active' : ''}${s === 'pending' && n ? ' attention' : ''}`, 'aria-pressed': String(state.status === s), onclick: () => {
      state.status = s;
      loadList();
    } }, label, h('span', { class: 'count' }, n));
  }));
  const pending = state.counts.pending || 0;
  document.title = `${pending ? `(${pending}) ` : ''}TC Booking · Резервации`;
}

async function loadList() {
  if (state.view !== 'bookings') return;
  try {
    const qs = new URLSearchParams();
    if (state.status) qs.set('status', state.status);
    if (state.q.trim()) qs.set('q', state.q.trim());
    const r = await api(`api/bookings?${qs}`);
    Object.assign(state, { list: r.bookings, counts: r.counts, total: r.total });
    renderTabs();
    renderList();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

function renderList() {
  if (!state.list.length) {
    $list.replaceChildren(h('p', { class: 'muted empty' }, state.q ? 'Няма резервации, които да отговарят на търсенето.' : 'Няма резервации тук.'));
    return;
  }
  const rows = state.list.map((b) => h('tr', { class: b.id === state.selected ? 'sel' : '', tabindex: '0', onclick: () => select(b.id), onkeydown: (e) => e.key === 'Enter' && select(b.id) },
    h('td', { class: 'nowrap' }, h('div', { class: 'mono' }, b.id), h('div', { class: 'muted small' }, when(b.createdAt))),
    h('td', null, h('div', null, b.hotelName), h('div', { class: 'muted small' }, b.area)),
    h('td', null, h('div', null, day(b.checkIn)), h('div', { class: 'muted small' }, `${b.nights} нощ. · ${pax(b.adults, b.children)}`)),
    h('td', null, h('div', null, b.guest || b.contactName)),
    h('td', { class: 'num' }, h('div', null, money(b.price, b.currency)), h('div', { class: 'muted small' }, `нетна ${money(b.net, b.netCurrency)}`),
      b.margin == null ? null : h('div', { class: 'small margin' }, `+${money(b.margin, b.currency)}`)),
    h('td', null, b.opName, b.supplierRef ? h('div', { class: 'muted small mono nowrap' }, b.supplierRef) : null),
    h('td', null, badge(b.status), b.onRequest ? h('div', { class: 'flag' }, 'по запитване') : null)));
  const more = state.total > state.list.length ? [h('p', { class: 'muted small more' }, `Показани са първите ${state.list.length} от ${state.total}.`)] : [];
  $list.replaceChildren(
    h('table', null,
      h('thead', null, h('tr', null, ...['Номер', 'Хотел', 'Настаняване', 'Гост', 'Цена / нетна / печалба', 'Доставчик', 'Статус'].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))),
      h('tbody', null, rows)),
    ...more);
}

async function select(id) {
  state.selected = id;
  renderList();
  try {
    state.detail = await api(`api/bookings/${encodeURIComponent(id)}`);
    renderDetail();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

// ---------- детайл ----------
function renderDetail() {
  const b = state.detail;
  const p = b.public;
  const i = b.internal;
  const dl = (pairs) => h('dl', null, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));

  const portal = h('pre', { class: 'portal' }, b.portalText);
  const copy = h('button', { class: 'small-btn', onclick: () => copyText(b.portalText) }, 'Копирай');

  const ref = h('input', { placeholder: 'Номер при доставчика', value: i.supplierRef || '', 'aria-label': 'Номер на резервацията при доставчика' });
  const note = h('textarea', { rows: '2', placeholder: 'Бележка (по желание – записва се в историята)', 'aria-label': 'Бележка' });
  const act = async (status) => {
    if (status === 'cancelled' && !confirm(`Да анулирам ли ${b.id}?`)) return;
    if (status === 'rejected' && !note.value.trim() && !confirm('Без бележка защо е отказана?')) return;
    try {
      state.detail = await api(`api/bookings/${encodeURIComponent(b.id)}/status`, { status, supplierRef: ref.value, comment: note.value });
      toast(`${b.id}: ${STATUS[status]}`);
      renderDetail();
      loadList();
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const addNote = async () => {
    try {
      state.detail = await api(`api/bookings/${encodeURIComponent(b.id)}/comment`, { comment: note.value });
      toast('Бележката е записана');
      renderDetail();
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const buttons = {
    confirmed: h('button', { class: 'primary', onclick: () => act('confirmed') }, 'Потвърдена'),
    rejected: h('button', { class: 'warn', onclick: () => act('rejected') }, 'Отказана'),
    cancelled: h('button', { class: 'danger', onclick: () => act('cancelled') }, 'Анулирай'),
    pending: h('button', { onclick: () => act('pending') }, 'Върни за потвърждение'),
  };

  $detail.replaceChildren(
    h('div', { class: 'd-head' }, h('h2', { class: 'mono' }, b.id), badge(b.status), p.onRequest ? h('span', { class: 'flag' }, 'по запитване') : null),
    h('p', { class: 'muted small' }, `Получена ${when(b.createdAt)}`),

    h('div', { class: 'cards' },
      h('div', { class: 'card' }, h('h3', null, 'Клиент'), dl([
        ['Име', b.contact.name],
        ['Имейл', h('a', { href: `mailto:${b.contact.email}` }, b.contact.email)],
        ['Телефон', h('a', { href: `tel:${b.contact.phone.replace(/[^\d+]/g, '')}` }, b.contact.phone)],
        b.note ? ['Бележка', h('span', { class: 'pre' }, b.note)] : null,
      ])),
      h('div', { class: 'card' }, h('h3', null, 'Цена'), dl([
        ['Продажна', h('strong', null, money(p.price, p.currency))],
        p.promo ? ['Промо код', `${p.promo.code} ${p.promo.label} (без него ${money(p.priceBefore, p.currency)})`] : null,
        ['Нетна', money(i.net, i.currency)],
        ['Печалба', b.margin == null ? '– (различна валута)' : money(b.margin, p.currency)],
        ['Надценка', `${i.markupPct || 0}%`],
        i.eb ? ['EB', `${i.eb}% (включено)`] : null,
        ['Проверена', i.checkedAt ? when(i.checkedAt) : '–'],
      ]))),

    h('div', { class: 'card' }, h('h3', null, 'Какво е видял клиентът'), dl([
      ['Хотел', `${p.hotelName}${p.stars ? ` ${p.stars}*` : ''} · ${p.area} (${p.hotelId})`],
      ['Стая', p.room],
      ['Изхранване', p.boardLabel],
      ['Настаняване', `${day(p.checkIn)}, ${p.nights} нощ.`],
      ['Гости', `${pax(p.adults, (p.childAges || []).length)}${(p.childAges || []).length ? ` (${p.childAges.join(', ')} г.)` : ''}`],
    ])),

    h('div', { class: 'card' }, h('h3', null, 'Гости'), h('ol', { class: 'guests' }, b.guests.map((g) => h('li', null, `${g.firstName} ${g.lastName}`, g.birthDate ? h('span', { class: 'muted' }, ` · ${day(g.birthDate)}`) : null)))),

    h('div', { class: 'card internal' }, h('div', { class: 'card-head' }, h('h3', null, 'За портала на доставчика'), copy), portal),

    b.next.length ? h('div', { class: 'card' }, h('h3', null, 'Действия'),
      b.next.includes('confirmed') ? ref : null,
      note,
      h('div', { class: 'actions' }, b.next.map((s) => buttons[s]), h('span', { class: 'spacer' }), h('button', { class: 'link', onclick: addNote }, 'Само бележка'))) :
      h('div', { class: 'card' }, h('h3', null, 'Бележка'), note, h('div', { class: 'actions' }, h('button', { onclick: addNote }, 'Добави бележка'))),

    h('div', { class: 'card' }, h('h3', null, 'История'), h('ul', { class: 'history' }, [...b.history].reverse().map((x) => h('li', null,
      h('span', { class: 'muted small' }, when(x.at)), ' ',
      h('strong', null, x.by || '–'), ' ',
      x.status ? badge(x.status) : null,
      x.supplierRef ? h('span', { class: 'mono small' }, ` № ${x.supplierRef}`) : null,
      x.comment ? h('div', { class: 'pre' }, x.comment) : null)))));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h('textarea', { class: 'offscreen' });
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast('Копирано');
}

// ---------- снимки от сайта ↔ каталог ----------
const CTABS = [['check', 'За проверка'], ['none', 'Без връзка'], ['linked', 'Вързани']];
const cs = { state: 'check', q: '', items: [], counts: {}, total: 0, updatedAt: null, picker: null };
let $ctabs, $clist;

function renderContentView() {
  $ctabs = h('nav', { class: 'tabs', 'aria-label': 'Връзки' });
  const search = h('input', { type: 'search', placeholder: 'Търсене: име, курорт, H-номер…', value: cs.q, oninput: debounce(() => {
    cs.q = search.value;
    loadContent();
  }, 300) });
  $clist = h('section', { class: 'clist' });
  $app.replaceChildren(header(),
    h('div', { class: 'toolbar' }, $ctabs, search),
    h('p', { class: 'muted small hint' }, 'Снимките и описанията идват от нашия сайт (npm run import-site, всяка нощ). Показват се на клиентите само при вързаните хотели. „За проверка“ са несигурни съвпадения – потвърдете или разкачете.'),
    $clist);
  loadContent();
}

async function loadContent() {
  try {
    const qs = new URLSearchParams({ state: cs.state });
    if (cs.q.trim()) qs.set('q', cs.q.trim());
    const r = await api(`api/content?${qs}`);
    Object.assign(cs, { items: r.items, counts: r.counts, total: r.total, updatedAt: r.updatedAt });
    renderContent();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

async function contentAction(siteId, action, body = {}) {
  try {
    await api(`api/content/${siteId}/${action}`, body);
    cs.picker = null;
    toast(action === 'unlink' ? 'Разкачено' : 'Записано');
    loadContent();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

function renderContent() {
  $ctabs.replaceChildren(...CTABS.map(([s, label]) => h('button', { class: `tab${cs.state === s ? ' active' : ''}${s === 'check' && cs.counts.check ? ' attention' : ''}`, 'aria-pressed': String(cs.state === s), onclick: () => {
    cs.state = s;
    cs.picker = null;
    loadContent();
  } }, label, h('span', { class: 'count' }, cs.counts[s] || 0))));
  if (!cs.items.length) {
    $clist.replaceChildren(h('p', { class: 'muted empty' }, cs.updatedAt ? 'Няма нищо тук.' : 'Още няма внос от сайта – на сървъра: npm run import-site'));
    return;
  }
  const stars = (n) => (n ? ` ${'★'.repeat(n)}` : '');
  $clist.replaceChildren(...cs.items.map((it) => {
    const s = it.site;
    const l = it.link;
    const hot = l && l.hotel;
    const actions = [];
    if (it.state === 'check') actions.push(h('button', { class: 'primary', onclick: () => contentAction(s.siteId, 'confirm') }, 'Потвърди'));
    if (l) actions.push(h('button', { class: 'warn', onclick: () => contentAction(s.siteId, 'unlink') }, 'Разкачи'));
    actions.push(h('button', { onclick: () => {
      cs.picker = cs.picker === s.siteId ? null : s.siteId;
      renderContent();
    } }, l ? 'Свържи с друг…' : 'Свържи с…'));
    return h('article', { class: `crow s-${it.state}` },
      s.thumb ? h('img', { class: 'cthumb', src: s.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'cthumb' }),
      h('div', { class: 'cside' },
        h('div', { class: 'small muted' }, 'На сайта'),
        h('strong', null, s.name, stars(s.stars)),
        h('div', { class: 'muted small' }, `${s.locality} · ${s.photos} снимки · `, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, 'страницата ↗'))),
      h('div', { class: 'carrow', 'aria-hidden': 'true' }, '→'),
      h('div', { class: 'cside' },
        h('div', { class: 'small muted' }, 'В каталога'),
        hot ? [h('strong', null, hot.name, stars(hot.stars)), h('div', { class: 'muted small' }, `${hot.area} · ${hot.id} · ${hot.ops.length} оператора · съвпадение ${Math.round(l.score * 100)}%`)] : h('span', { class: 'muted' }, '— няма —')),
      h('div', { class: 'cactions' }, actions),
      l && l.why ? h('div', { class: 'cwhy small' }, l.why) : null,
      cs.picker === s.siteId ? picker(s) : null);
  }), ...(cs.total > cs.items.length ? [h('p', { class: 'muted small' }, `Показани са първите ${cs.items.length} от ${cs.total}.`)] : []));
}

// Избор на хотел от каталога (по име или H-номер)
function picker(s) {
  const results = h('div', { class: 'presults' });
  const input = h('input', { type: 'search', placeholder: 'Хотел от каталога: име или H-номер', value: s.name, oninput: debounce(find, 250) });
  async function find() {
    try {
      const r = await api(`api/catalog?q=${encodeURIComponent(input.value)}`);
      results.replaceChildren(...(r.hotels.length ? r.hotels.map((x) => h('button', { class: 'pick', onclick: () => contentAction(s.siteId, 'link', { hotelId: x.id }) },
        h('strong', null, x.name), ` ${x.stars ? '★'.repeat(x.stars) : ''} · ${x.area} · ${x.id} · ${x.ops.length} опер.`)) : [h('span', { class: 'muted small' }, 'Няма такъв хотел в каталога.')]));
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  }
  setTimeout(() => {
    input.focus();
    find();
  });
  return h('div', { class: 'picker' }, input, results);
}

// ---------- каталог: връзки към операторите ----------
const kat = { q: '', items: [], counts: {}, total: 0, picker: null }; // picker: 'H:OP' – отворен избор „Премести към…“
let $klist, $kcount;
const LINK_STATE = { ok: 'проверена', auto: 'автоматична', check: 'за проверка' };

let $krefresh;
function refreshText(st) {
  const l = st.last;
  if (st.running) return 'Обновяване от операторите… (1–3 мин)';
  if (!l) return 'От операторите: още не е обновяван';
  if (l.error) return `От операторите: грешка ${when(l.at)} – ${l.error}`;
  const ops = Object.entries(l.ops || {});
  const created = ops.reduce((n, [, s]) => n + (s.created || 0), 0);
  const bad = ops.filter(([, s]) => s.error || s.skipped).map(([op]) => op);
  return `От операторите: ${when(l.at)} · +${created} нови хотела${bad.length ? ` · без ${bad.join(', ')}` : ''}`;
}
async function loadRefresh(poll = false) {
  try {
    const st = await api('api/catalog/refresh');
    if (!$krefresh || !document.body.contains($krefresh)) return;
    $krefresh.querySelector('span').textContent = refreshText(st);
    $krefresh.querySelector('button').disabled = st.running;
    if (st.running) setTimeout(() => loadRefresh(true), 3000);
    else if (poll) {
      toast('Каталогът е обновен');
      loadCatalog();
    }
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

function renderCatalogView() {
  $kcount = h('span', { class: 'muted' });
  $krefresh = h('div', { class: 'krefresh muted small' }, h('span', null, ''), h('button', { class: 'small-btn', onclick: async () => {
    try {
      await api('api/catalog/refresh', {});
      loadRefresh(true);
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  } }, 'Обнови сега'));
  const search = h('input', { type: 'search', placeholder: 'Търсене в целия каталог: име, код, H-номер…', value: kat.q, oninput: debounce(() => {
    kat.q = search.value;
    loadCatalog();
  }, 300) });
  $klist = h('section', { class: 'clist' });
  $app.replaceChildren(header(),
    h('div', { class: 'toolbar' }, $kcount, search, h('span', { class: 'spacer' }), $krefresh),
    h('p', { class: 'muted small hint' },
      'Връзките „за проверка“ НЕ се ползват за цени, докато не ги потвърдите. Ако операторът продава друг хотел – „Премести към…“ (ако хотелът вече е в каталога) или „Отдели в нов хотел“. ',
      'Верижните връзки следват връзката, през която са станали.'),
    $klist);
  loadCatalog();
  loadRefresh();
}

async function loadCatalog() {
  try {
    const r = await api(`api/catalog/review${kat.q.trim() ? `?q=${encodeURIComponent(kat.q.trim())}` : ''}`);
    Object.assign(kat, { items: r.items, counts: r.counts, total: r.total });
    renderCatalog();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

function renderCatalog() {
  $kcount.textContent = `За проверка: ${kat.counts.hotels || 0} хотела, ${kat.counts.links || 0} връзки`;
  if (!kat.items.length) {
    $klist.replaceChildren(h('p', { class: 'muted empty' }, kat.q ? 'Няма такъв хотел в каталога.' : 'Няма връзки за проверка. 👍'));
    return;
  }
  $klist.replaceChildren(...kat.items.map(catalogCard), ...(kat.total > kat.items.length ? [h('p', { class: 'muted small' }, `Показани са първите ${kat.items.length} от ${kat.total}.`)] : []));
}

function catalogCard(x) {
  const act = async (action, ops, extra = {}) => {
    if (action === 'split' && !confirm('Да отделя ли тази връзка (и верижните през нея) в нов хотел?')) return;
    try {
      const r = await api(`api/catalog/${x.id}/${action}`, { ops, ...extra });
      toast(action === 'split' ? `Отделено в нов хотел ${r.newId}: ${r.other.name}` : action === 'move' ? `Преместено към ${r.toId}: ${r.other.name}` : `Потвърдено (${r.ops.length})`);
      kat.picker = null;
      loadCatalog(); // списъкът и броячите – наново от сървъра (прегледаният хотел изчезва от „за проверка“)
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const opName = (op) => x.links.find((y) => y.op === op)?.opName || op;
  const rows = x.links.map((l) => {
    const followers = x.links.filter((y) => y.with === l.op).map((y) => y.opName);
    const isPicker = kat.picker === `${x.id}:${l.op}`;
    const buttons = l.leader
      ? h('div', { class: 'kbtns' },
          h('button', { class: 'primary', onclick: () => act('confirm', [l.op]) }, 'Потвърди'),
          h('button', { onclick: () => { kat.picker = isPicker ? null : `${x.id}:${l.op}`; renderCatalog(); } }, 'Премести към…'),
          h('button', { class: 'warn', onclick: () => act('split', [l.op]) }, 'Отдели в нов хотел'))
      : null;
    return [
      h('tr', { class: l.state === 'check' ? 'kcheck' : '' },
        h('td', null, h('strong', null, l.opName), h('div', { class: 'muted small mono' }, l.code)),
        h('td', null, l.name, h('div', { class: 'muted small' }, [l.area, l.category].filter(Boolean).join(' · '))),
        h('td', null,
          h('span', { class: `lstate l-${l.with ? 'chain' : l.state}` }, l.chainOf ? `верижна ← ${opName(l.chainOf)}` : l.with ? `заедно с ${opName(l.with)}` : LINK_STATE[l.state] || l.state),
          l.why ? h('div', { class: 'muted small' }, l.why) : null,
          followers.length ? h('div', { class: 'muted small' }, `Заедно с нея: ${followers.join(', ')}`) : null),
        h('td', null, buttons)),
      isPicker ? h('tr', null, h('td', { colspan: '4' }, movePicker(x, l, (to) => act('move', [l.op], { to })))) : null,
    ];
  });
  const checks = x.links.filter((l) => l.leader);
  return h('article', { class: 'kcard' },
    h('div', { class: 'khead' },
      x.thumb ? h('img', { class: 'cthumb', src: x.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'cthumb' }),
      h('div', null,
        h('strong', null, x.name, x.stars ? ` ${'★'.repeat(x.stars)}` : ''),
        h('div', { class: 'muted small' }, `${x.id} · ${x.area}`, x.siteUrl ? [' · ', h('a', { href: x.siteUrl, target: '_blank', rel: 'noopener' }, 'на сайта ↗')] : null)),
      h('span', { class: 'spacer' }),
      checks.length > 1 ? h('button', { onclick: () => confirm('Всички връзки за проверка в този хотел са верни?') && act('confirm', checks.map((l) => l.op)) }, 'Всички са верни') : null),
    h('table', { class: 'ktable' }, h('tbody', null, rows)));
}

// Избор на хотел от каталога, към който да се премести връзката
function movePicker(x, l, onPick) {
  const results = h('div', { class: 'presults' });
  const input = h('input', { type: 'search', placeholder: 'Към кой хотел: име или H-номер', value: l.name, oninput: debounce(find, 250) });
  async function find() {
    try {
      const r = await api(`api/catalog?q=${encodeURIComponent(input.value)}`);
      const list = r.hotels.filter((y) => y.id !== x.id);
      results.replaceChildren(...(list.length ? list.map((y) => h('button', { class: 'pick', onclick: () => onPick(y.id) },
        h('strong', null, y.name), ` ${y.stars ? '★'.repeat(y.stars) : ''} · ${y.area} · ${y.id} · ${y.ops.join(', ')}`)) : [h('span', { class: 'muted small' }, 'Няма такъв хотел.')]));
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  }
  setTimeout(() => {
    input.focus();
    find();
  });
  return h('div', { class: 'picker' }, input, results);
}

// ---------- стаи: една и съща стая при различните оператори ----------
const rm = { state: 'todo', q: '', items: [], counts: {}, total: 0 };
let $rtabs, $rlist;

function renderRoomsView() {
  $rtabs = h('nav', { class: 'tabs', 'aria-label': 'Стаи' });
  const search = h('input', { type: 'search', placeholder: 'Хотел: име или H-номер…', value: rm.q, oninput: debounce(() => {
    rm.q = search.value;
    loadRooms();
  }, 300) });
  $rlist = h('section', { class: 'clist' });
  $app.replaceChildren(header(),
    h('div', { class: 'toolbar' }, $rtabs, search),
    h('p', { class: 'muted small hint' },
      'Стаите се разпознават по характеристики (вид, ниво, изглед) и еднаквите при различните оператори се показват на сайта като една стая с най-добрата цена. ',
      'Тук са хотелите, при които операторите описват стаите различно. Ако две имена са една и съща стая – изберете „Същата като…“. Списъкът се пълни от търсенията на сайта.'),
    $rlist);
  loadRooms();
}

async function loadRooms() {
  try {
    const qs = new URLSearchParams({ state: rm.state });
    if (rm.q.trim()) qs.set('q', rm.q.trim());
    const r = await api(`api/rooms?${qs}`);
    Object.assign(rm, { items: r.items, counts: r.counts, total: r.total });
    renderRooms();
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

function renderRooms() {
  $rtabs.replaceChildren(...[['todo', 'За преглед'], ['done', 'Прегледани']].map(([s, label]) => h('button', {
    class: `tab${rm.state === s && !rm.q ? ' active' : ''}${s === 'todo' && rm.counts.todo ? ' attention' : ''}`,
    onclick: () => { rm.state = s; loadRooms(); },
  }, label, h('span', { class: 'count' }, rm.counts[s] || 0))));
  if (!rm.items.length) {
    $rlist.replaceChildren(h('p', { class: 'muted empty' }, rm.q ? 'Няма данни за стаите на този хотел – още не е търсен на сайта.' : 'Няма хотели за преглед.'));
    return;
  }
  $rlist.replaceChildren(...rm.items.map(roomCard), ...(rm.total > rm.items.length ? [h('p', { class: 'muted small' }, `Показани са първите ${rm.items.length} от ${rm.total}.`)] : []));
}

function roomCard(x) {
  const act = async (action, body) => {
    try {
      const r = await api(`api/rooms/${x.hotelId}/${action}`, body);
      const i = rm.items.findIndex((y) => y.hotelId === x.hotelId);
      if (action === 'reviewed' && !rm.q) {
        rm.items.splice(i, 1);
        rm.counts.todo = Math.max(0, (rm.counts.todo || 1) - 1);
        rm.counts.done = (rm.counts.done || 0) + 1;
        toast('Отбелязан като прегледан');
      } else rm.items[i] = r;
      renderRooms();
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const rowsByKey = x.rows.map((r) => [r.key, r.label]);
  const cell = (r, op) => (r.cells[op] || []).map((c) => {
    const type = c.roomType && c.roomType !== c.room ? c.roomType : ''; // при Summer името често е и в двете полета
    const sel = h('select', { 'aria-label': `Стая „${c.room}${type ? ` / ${type}` : ''}“ – същата като`, onchange: () => act('map', { sig: c.sig, key: sel.value === '__auto' ? null : sel.value }) },
      h('option', { value: '__auto' }, c.manual ? '↩ по разпознаването' : 'Същата като…'),
      rowsByKey.filter(([k]) => k !== r.key).map(([k, l]) => h('option', { value: k }, l)));
    return h('div', { class: `rc${c.isNew ? ' new' : ''}` },
      h('span', { class: 'rname' }, c.room, type ? h('span', { class: 'muted' }, ` / ${type}`) : null),
      c.manual ? h('span', { class: 'lstate l-ok' }, 'ръчно') : null,
      sel);
  });
  return h('article', { class: 'kcard' },
    h('div', { class: 'khead' },
      x.thumb ? h('img', { class: 'cthumb', src: x.thumb, alt: '', loading: 'lazy' }) : h('div', { class: 'cthumb' }),
      h('div', null, h('strong', null, x.name), h('div', { class: 'muted small' }, `${x.hotelId} · ${x.area} · ${x.ops.length} оператора · ${x.single} стаи само при един оператор${x.raw ? ` · ${x.raw} неразпознати` : ''}`)),
      h('span', { class: 'spacer' }),
      h('button', { onclick: () => act('reviewed', {}) }, 'Прегледано')),
    h('table', { class: 'rtable' },
      h('thead', null, h('tr', null, h('th', null, 'Наша стая (на сайта)'), x.ops.map((o) => h('th', null, o.name)))),
      h('tbody', null, x.rows.map((r) => h('tr', { class: Object.keys(r.cells).length === 1 ? 'one' : '' },
        h('td', null, h('strong', null, r.label), r.custom ? h('span', { class: 'muted small' }, ' (наше име)') : null,
          h('div', null, h('button', { class: 'link small', onclick: () => {
            const n = prompt('Име на стаята на сайта (празно – автоматичното):', r.custom ? r.label : '');
            if (n !== null) act('name', { key: r.key, name: n });
          } }, 'Преименувай'))),
        x.ops.map((o) => h('td', null, cell(r, o.op))))))));
}

// ---------- курорти: кои се показват на сайта ----------
const AREA_BG = { ANTALYA: 'Анталия', BELEK: 'Белек', SIDE: 'Сиде', ALANYA: 'Алания', KEMER: 'Кемер', BODRUM: 'Бодрум', MARMARIS: 'Мармарис', FETHIYE: 'Фетие', DALAMAN: 'Даламан', KUSADASI: 'Кушадасъ', DIDIM: 'Дидим', CESME: 'Чешме', IZMIR: 'Измир', AYVALIK: 'Айвалък', ISTANBUL: 'Истанбул', KAPADOKYA: 'Кападокия', CANAKKALE: 'Чанаккале', EDREMIT: 'Едремит', SEFERIHISAR: 'Сеферихисар', TEKIRDAG: 'Текирдаг', CORLU: 'Чорлу' };

async function renderAreasView() {
  const list = h('section', { class: 'clist' }, h('p', { class: 'muted empty' }, 'Зареждане…'));
  const markup = h('section', { class: 'markup-box' });
  const promoBox = h('section', { class: 'markup-box' });
  $app.replaceChildren(header(),
    markup,
    promoBox,
    h('h2', { class: 'set-title' }, 'Курорти'),
    h('p', { class: 'muted small hint top-hint' }, 'Скритите курорти не се показват на сайта и за тях не се пращат заявки към операторите. Промяната важи веднага.'),
    list);
  try {
    const r = await api('api/areas');
    const inp = h('input', { type: 'number', min: '0', max: '100', step: '0.5', value: r.markupPct, 'aria-label': 'Надценка в проценти' });
    const ex = () => {
      const p = Number(inp.value);
      return Number.isFinite(p) ? `Пример: нетна 1000 € → на сайта ${Math.ceil(Math.round(1000 * (1 + p / 100) * 100) / 100)} €` : '';
    };
    const exEl = h('span', { class: 'muted small' }, ex());
    inp.addEventListener('input', () => (exEl.textContent = ex()));
    markup.replaceChildren(
      h('h2', { class: 'set-title' }, 'Надценка'),
      h('div', { class: 'markup-row' },
        h('label', null, inp, ' % върху нетната цена на оператора'),
        h('button', { class: 'primary', onclick: async () => {
          try {
            const res = await api('api/markup', { markupPct: inp.value });
            inp.value = res.markupPct;
            exEl.textContent = ex();
            toast(`Надценка ${res.markupPct}% – важи за новите търсения веднага`);
          } catch (e) {
            if (e.message !== '401') toast(e.message, 'bad');
          }
        } }, 'Запази'),
        exEl),
      h('p', { class: 'muted small' }, 'Важи за всички хотели и оператори. Цената на сайта се закръгля нагоре до цяло евро. Вече направените резервации не се променят.'));
    renderPromos(promoBox);
    list.replaceChildren(h('div', { class: 'areas-grid' }, r.areas.map((a) => h('label', { class: `area-row${a.hidden ? ' off' : ''}` },
      h('input', { type: 'checkbox', checked: !a.hidden, onchange: async (e) => {
        const show = e.target.checked;
        try {
          await api(`api/areas/${encodeURIComponent(a.area)}`, { hidden: !show });
          toast(`${AREA_BG[a.area] || a.area}: ${show ? 'показва се на сайта' : 'скрит'}`);
          renderAreasView();
        } catch (x) {
          e.target.checked = !show;
          if (x.message !== '401') toast(x.message, 'bad');
        }
      } }),
      h('span', null, h('strong', null, AREA_BG[a.area] || a.area), h('small', { class: 'muted' }, ` ${a.area} · ${a.hotels} хотела`)),
      h('span', { class: `badge ${a.hidden ? 's-cancelled' : 's-confirmed'}` }, a.hidden ? 'скрит' : 'на сайта')))));
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
  }
}

// ---------- потребители (само администратор) ----------
const ROLE_LABEL = { admin: 'Администратор', staff: 'Служител' };

// случайна парола без букви, които се бъркат (l/1, O/0): xxxx-xxxx-xxxx
function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  const s = [...r].map((x) => abc[x % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

async function renderUsersView() {
  const list = h('section', { class: 'markup-box' }, h('p', { class: 'muted' }, 'Зареждане…'));
  const name = h('input', { placeholder: 'име, напр. maria', maxlength: '32', autocomplete: 'off', 'aria-label': 'Потребителско име', class: 'u-name' });
  const pass = h('input', { placeholder: 'парола (поне 10 знака)', maxlength: '200', autocomplete: 'new-password', 'aria-label': 'Парола', class: 'u-pass mono' });
  const role = h('select', { 'aria-label': 'Права' }, h('option', { value: 'staff' }, ROLE_LABEL.staff), h('option', { value: 'admin' }, ROLE_LABEL.admin));
  const add = h('form', { class: 'promo-form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const r = await api('api/users', { name: name.value, password: pass.value, role: role.value });
      toast(`Добавен: ${name.value.trim().toLowerCase()}. Предайте паролата лично.`);
      name.value = '';
      pass.value = '';
      drawUsers(list, r);
    } catch (x) {
      if (x.message !== '401') toast(x.message, 'bad');
    }
  } }, name, pass, h('button', { type: 'button', class: 'small-btn', onclick: () => (pass.value = genPassword()) }, 'Генерирай'), role, h('button', { class: 'primary', type: 'submit' }, 'Добави'));
  $app.replaceChildren(header(),
    h('section', { class: 'markup-box' },
      h('h2', { class: 'set-title' }, 'Нов потребител'),
      add,
      h('p', { class: 'muted small' }, 'Името е с латински букви, с него служителят влиза. Паролата не се пази в четим вид и после не може да се види – запишете я или я предайте лично. Служителят може да си я смени от името си горе вдясно.')),
    list,
    h('p', { class: 'muted small hint top-hint' }, '„Служител“ вижда и прави всичко без тази страница. „Администратор“ може и да управлява потребителите. Трябва да остане поне един администратор.'));
  try {
    drawUsers(list, await api('api/users'));
  } catch (e) {
    if (e.message === '401') return;
    toast(e.message, 'bad');
    state.view = 'bookings'; // напр. правата са сменени междувременно
    renderMain();
  }
}

function drawUsers(box, r) {
  const act = async (u, action, body = {}, done) => {
    try {
      drawUsers(box, await api(`api/users/${encodeURIComponent(u.name)}/${action}`, body));
      if (done) toast(done);
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const rows = r.users.map((u) => h('tr', null,
    h('td', null, h('strong', null, u.name), u.me ? h('span', { class: 'muted small' }, ' (вие)') : null),
    h('td', null, u.me ? ROLE_LABEL[u.role] : h('select', { 'aria-label': `Права на ${u.name}`, onchange: (e) => act(u, 'role', { role: e.target.value }, 'Правата са сменени') },
      Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, selected: v === u.role }, l)))),
    h('td', null, u.lastLoginAt ? when(u.lastLoginAt) : h('span', { class: 'muted' }, 'не е влизал'), u.sessions ? h('div', { class: 'muted small' }, `в момента: ${u.sessions} ${u.sessions === 1 ? 'сесия' : 'сесии'}`) : null),
    h('td', { class: 'muted small' }, u.createdAt ? `създаден ${when(u.createdAt)}${u.createdBy ? ` от ${u.createdBy}` : ''}` : ''),
    h('td', { class: 'num' },
      h('button', { class: 'small-btn', onclick: () => {
        const p = prompt(`Нова парола за ${u.name} (поне 10 знака). Запишете я – после не се вижда.${u.me ? '' : ' Ще излезе от админа на всички устройства.'}`, genPassword());
        if (p !== null) act(u, 'password', { password: p }, `Паролата на ${u.name} е сменена`);
      } }, 'Нова парола'), ' ',
      u.me ? null : h('button', { class: 'small-btn danger', onclick: () => confirm(`Да изтрия ли потребителя ${u.name}? Излиза от админа веднага.`) && act(u, 'delete', {}, `Изтрит: ${u.name}`) }, 'Изтрий'))));
  box.replaceChildren(
    h('h2', { class: 'set-title' }, 'Потребители'),
    h('table', { class: 'promo-table' },
      h('thead', null, h('tr', null, h('th', null, 'Име'), h('th', null, 'Права'), h('th', null, 'Последен вход'), h('th', null, ''), h('th', null, ''))),
      h('tbody', null, rows)));
}

// ---------- моята парола (всеки служител) ----------
function renderMeView() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '10' });
  const err = h('p', { class: 'error', 'aria-live': 'polite' });
  const btn = h('button', { type: 'submit', class: 'primary' }, 'Смени паролата');
  $app.replaceChildren(header(),
    h('form', { class: 'login pw', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (p1.value !== p2.value) {
        err.textContent = 'Новите пароли не съвпадат';
        return;
      }
      btn.disabled = true;
      try {
        await api('api/password', { current: cur.value, password: p1.value });
        toast('Паролата е сменена. Другите ви устройства излизат от админа.');
        state.view = 'bookings';
        renderMain();
      } catch (x) {
        if (x.message !== '401') err.textContent = x.message;
      } finally {
        btn.disabled = false;
      }
    } },
    h('h1', null, 'Моята парола'),
    h('p', { class: 'muted' }, `Потребител: ${state.user} · ${ROLE_LABEL[state.role] || ''}`),
    h('label', null, 'Сегашна парола', cur),
    h('label', null, 'Нова парола (поне 10 знака)', p1),
    h('label', null, 'Новата още веднъж', p2),
    btn,
    err));
  cur.focus();
}

// ---------- промо кодове ----------
async function renderPromos(box) {
  let r;
  try {
    r = await api('api/promos');
  } catch (e) {
    if (e.message !== '401') toast(e.message, 'bad');
    return;
  }
  const code = h('input', { placeholder: 'КОД, напр. ЛЯТО10', maxlength: '20', 'aria-label': 'Промо код', class: 'promo-code' });
  const type = h('select', { 'aria-label': 'Вид отстъпка' }, h('option', { value: 'pct' }, '%'), h('option', { value: 'eur' }, '€'));
  const value = h('input', { type: 'number', min: '1', step: '0.5', placeholder: '10', 'aria-label': 'Отстъпка', class: 'promo-val' });
  const until = h('input', { placeholder: 'валиден до дд.мм.гггг', maxlength: '10', 'aria-label': 'Валиден до', class: 'promo-until' });
  const note = h('input', { placeholder: 'бележка (по желание)', maxlength: '200', 'aria-label': 'Бележка', class: 'promo-note' });
  const act = async (path, body = {}) => {
    try {
      await api(path, body);
      renderPromos(box);
    } catch (e) {
      if (e.message !== '401') toast(e.message, 'bad');
    }
  };
  const rows = r.promos.map((p) => h('tr', { class: p.valid ? '' : 'muted' },
    h('td', null, h('strong', { class: 'mono' }, p.code), p.note ? h('div', { class: 'muted small' }, p.note) : null),
    h('td', null, p.label),
    h('td', null, p.until ? `до ${day(p.until)}` : 'без срок'),
    h('td', null, h('span', { class: `badge ${p.valid ? 's-confirmed' : 's-cancelled'}` }, p.valid ? 'важи' : p.active === false ? 'спрян' : 'изтекъл')),
    h('td', { class: 'num' }, `${p.uses} рез.`),
    h('td', { class: 'num' },
      h('button', { class: 'small-btn', onclick: () => act(`api/promos/${encodeURIComponent(p.code)}/${p.active === false ? 'on' : 'off'}`) }, p.active === false ? 'Пусни' : 'Спри'), ' ',
      h('button', { class: 'small-btn danger', onclick: () => confirm(`Да изтрия ли ${p.code}?`) && act(`api/promos/${encodeURIComponent(p.code)}/delete`) }, 'Изтрий'))));
  box.replaceChildren(
    h('h2', { class: 'set-title' }, 'Промо кодове'),
    h('form', { class: 'promo-form', onsubmit: (e) => {
      e.preventDefault();
      act('api/promos', { code: code.value, type: type.value, value: value.value, until: until.value, note: note.value });
    } }, code, h('span', { class: 'promo-val-wrap' }, '−', value, type), until, note, h('button', { class: 'primary', type: 'submit' }, 'Добави')),
    r.promos.length ? h('table', { class: 'promo-table' }, h('tbody', null, rows)) : h('p', { class: 'muted small' }, 'Още няма промо кодове.'),
    h('p', { class: 'muted small' }, 'Отстъпката е от цената на сайта (с надценката). Цената с промо код никога не пада под нетната цена на оператора.'));
}

// ---------- общи ----------
async function logout() {
  stopRefresh();
  await api('api/logout', {}).catch(() => {});
  state.user = null;
  state.role = null;
  state.view = 'bookings';
  renderLogin();
}

function startRefresh() {
  stopRefresh();
  state.timer = setInterval(() => document.visibilityState === 'visible' && loadList(), REFRESH_MS);
}
function stopRefresh() {
  clearInterval(state.timer);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------- старт ----------
(async () => {
  try {
    const r = await fetch('api/me', { credentials: 'same-origin' });
    if (r.ok) {
      const me = await r.json();
      state.user = me.user;
      state.role = me.role;
      renderMain();
    } else renderLogin();
  } catch {
    renderLogin('Няма връзка със сървъра.');
  }
})();
