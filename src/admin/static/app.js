// Админ – резервации. Без библиотеки. Всички адреси са относителни (работи и зад Caddy с префикс).
// Данните от клиентите се слагат само като текст (textContent), никога като HTML.
'use strict';

const STATUS = { pending: 'За потвърждение', confirmed: 'Потвърдена', rejected: 'Отказана', cancelled: 'Анулирана' };
const TABS = [['pending', 'За потвърждение'], ['confirmed', 'Потвърдени'], ['rejected', 'Отказани'], ['cancelled', 'Анулирани'], ['', 'Всички']];
const REFRESH_MS = 60000;

const state = { user: null, status: 'pending', q: '', list: [], counts: {}, total: 0, selected: null, detail: null, timer: null };
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

function renderMain() {
  $tabs = h('nav', { class: 'tabs', 'aria-label': 'Статус' });
  $search = h('input', { type: 'search', placeholder: 'Търсене: номер, име, имейл, хотел…', value: state.q, oninput: debounce(() => {
    state.q = $search.value;
    loadList();
  }, 300) });
  $list = h('section', { class: 'list' });
  $detail = h('section', { class: 'detail' }, h('p', { class: 'muted empty' }, 'Изберете резервация от списъка.'));
  $app.replaceChildren(
    h('header', { class: 'top' },
      h('strong', null, 'TC Booking'), h('span', { class: 'muted' }, ' · Резервации'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted' }, state.user),
      h('button', { class: 'link', onclick: logout }, 'Изход')),
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
