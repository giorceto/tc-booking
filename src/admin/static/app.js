// Админ – резервации. Без библиотеки. Всички адреси са относителни (работи и зад Caddy с префикс).
// Данните от клиентите се слагат само като текст (textContent), никога като HTML.
'use strict';

const STATUS = { pending: 'За потвърждение', confirmed: 'Потвърдена', rejected: 'Отказана', cancelled: 'Анулирана' };
const TABS = [['pending', 'За потвърждение'], ['confirmed', 'Потвърдени'], ['rejected', 'Отказани'], ['cancelled', 'Анулирани'], ['', 'Всички']];
const REFRESH_MS = 60000;

const state = { view: 'bookings', user: null, status: 'pending', q: '', list: [], counts: {}, total: 0, selected: null, detail: null, timer: null };
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
    h('nav', { class: 'views' }, nav('bookings', 'Резервации'), nav('catalog', 'Каталог'), nav('content', 'Снимки от сайта'), nav('areas', 'Курорти')),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted' }, state.user),
    h('button', { class: 'link', onclick: logout }, 'Изход'));
}

function renderMain() {
  stopRefresh();
  if (state.view === 'content') return renderContentView();
  if (state.view === 'catalog') return renderCatalogView();
  if (state.view === 'areas') return renderAreasView();
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
        ['Нетна', money(i.net, i.currency)],
        ['Печалба', b.margin == null ? '– (различна валута)' : money(b.margin, p.currency)],
        ['Надценка', `${i.markupPct || 0}%`],
        i.eb ? ['EB', `${i.eb}% (включено)`] : null,
        ['Проверена', i.checkedAt ? when(i.checkedAt) : '–'],
      ]))),

    h('div', { class: 'card' }, h('h3', null, 'Какво е видял клиентът'), dl([
      ['Хотел', `${p.hotelName}${p.stars ? ` ${p.stars}*` : ''} · ${p.area} (${p.hotelId})`],
      ['Стая', `${p.room}${p.seaView ? ' · изглед към морето' : ''}`],
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

// ---------- курорти: кои се показват на сайта ----------
const AREA_BG = { ANTALYA: 'Анталия', BELEK: 'Белек', SIDE: 'Сиде', ALANYA: 'Алания', KEMER: 'Кемер', BODRUM: 'Бодрум', MARMARIS: 'Мармарис', FETHIYE: 'Фетие', DALAMAN: 'Даламан', KUSADASI: 'Кушадасъ', DIDIM: 'Дидим', CESME: 'Чешме', IZMIR: 'Измир', AYVALIK: 'Айвалък', ISTANBUL: 'Истанбул', KAPADOKYA: 'Кападокия' };

async function renderAreasView() {
  const list = h('section', { class: 'clist' }, h('p', { class: 'muted empty' }, 'Зареждане…'));
  $app.replaceChildren(header(),
    h('p', { class: 'muted small hint top-hint' }, 'Скритите курорти не се показват на сайта и за тях не се пращат заявки към операторите. Промяната важи веднага.'),
    list);
  try {
    const r = await api('api/areas');
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

// ---------- общи ----------
async function logout() {
  stopRefresh();
  await api('api/logout', {}).catch(() => {});
  state.user = null;
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
      state.user = (await r.json()).user;
      renderMain();
    } else renderLogin();
  } catch {
    renderLogin('Няма връзка със сървъра.');
  }
})();
