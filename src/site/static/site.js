// Търсене и резервация на хотели (busrent.eu/book/). Без библиотеки, само относителни адреси.
// Данните идват от API-то (docs/api.md) – в тях няма нищо за доставчиците.
'use strict';

// ---------- помощни ----------
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (n, cur = 'EUR') => `${Number(n).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} ${cur === 'EUR' ? '€' : cur}`;
const day = (d) => d.split('-').reverse().join('.');
const addDays = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' });
const pax = (adults, kids) => [plural(adults, 'възрастен', 'възрастни'), kids ? plural(kids, 'дете', 'деца') : ''].filter(Boolean).join(' + ');

const AREA_BG = {
  ANTALYA: 'Анталия', BELEK: 'Белек', SIDE: 'Сиде', ALANYA: 'Алания', KEMER: 'Кемер', BODRUM: 'Бодрум', MARMARIS: 'Мармарис',
  FETHIYE: 'Фетие', DALAMAN: 'Даламан', KUSADASI: 'Кушадасъ', DIDIM: 'Дидим', CESME: 'Чешме', IZMIR: 'Измир', AYVALIK: 'Айвалък',
  ISTANBUL: 'Истанбул', KAPADOKYA: 'Кападокия',
};
const areaName = (a) => AREA_BG[a] || (a ? a.charAt(0) + a.slice(1).toLowerCase() : '');

// Икони на удобствата – тънки линии 24×24 (пътищата са постоянни, не идват отвън)
const ICONS = {
  beach: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z M12 12v9 M7 21h10',
  sea: 'M2 10c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2 M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2 M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  sand: 'M3 18c4-4 14-4 18 0 M12 4v4 M6 6l2 2 M18 6l-2 2 M8 13a4 4 0 0 1 8 0',
  pool: 'M8 3v11 M15 3v11 M8 7h7 M8 11h7 M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2 M2 21c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  indoor: 'M3 10l9-6 9 6 M5 9v4 M19 9v4 M3 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2 M3 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2',
  slides: 'M5 21V6a2 2 0 0 1 4 0 M9 6c4 1 4 6 7 9s3 4 5 4 M3 21h18',
  spa: 'M12 20c-5 0-8-3-8-8 4 0 8 3 8 8z M12 20c5 0 8-3 8-8-4 0-8 3-8 8z M12 20c-2-4-2-9 0-13 2 4 2 9 0 13z',
  steam: 'M8 3c-1 2 1 3 0 5 M12 3c-1 2 1 3 0 5 M16 3c-1 2 1 3 0 5 M4 12h16v8H4z',
  fitness: 'M6 7v10 M3 9v6 M18 7v10 M21 9v6 M6 12h12',
  kids: 'M12 3a5 6 0 0 1 5 6c0 4-3 6-5 6s-5-2-5-6a5 6 0 0 1 5-6z M12 15l-1 2h2z M12 17c0 2-2 2-2 4',
  animation: 'M12 3l2.6 5.6 6 .6-4.5 4 1.3 6L12 16l-5.4 3.2 1.3-6-4.5-4 6-.6z',
  alacarte: 'M7 3v8 M5 3v5a2 2 0 0 0 4 0V3 M7 11v10 M17 3c-2 1-3 4-3 7h3v11',
  wifi: 'M2 9a15 15 0 0 1 20 0 M5 12.5a10 10 0 0 1 14 0 M8.5 16a5 5 0 0 1 7 0 M12 19.5h.01',
  tennis: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5.6 5.6c3 3 3 9.8 0 12.8 M18.4 5.6c-3 3-3 9.8 0 12.8',
  watersports: 'M12 3v13 M12 4l7 11h-7 M12 7l-6 8h6 M3 19c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 2-1',
  golf: 'M8 21V3l9 4-9 4 M4 21h9',
  disco: 'M9 18V5l11-2v13 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  adults: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8 9v6 M12 9h3l-3 6',
  accessible: 'M12 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M11 8l1 6h5l2 5 M11 11h5 M9 11.5a5 5 0 1 0 6 6',
  parking: 'M5 3h14v18H5z M9 17V7h4a3 3 0 0 1 0 6H9',
};
function icon(key, cls = 'ai') {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[key] || ICONS.animation);
  svg.append(p);
  return svg;
}
const amenList = (list, cls) => h('ul', { class: cls }, list.map((a) => h('li', null, icon(a.key), a.label)));

// ---------- състояние ----------
const S = {
  areas: [],
  target: null, // { area } | { hotel, label }
  params: null,
  results: new Map(), // hotelId -> хотел от API-то
  done: false,
  incomplete: false,
  ctrl: null,
  shown: 20,
  expanded: new Set(),
  board: '',
  onlyAvailable: false,
  view: 'list', // 'list' – резултати по курорт; 'hotel' – страницата на един хотел
  hotelId: null,
  prev: null, // запазеният списък, от който е отворен хотелът (за „← Всички хотели“ и Назад)
  roomSel: new Map(), // стая -> избран offerKey (изхранване)
};
const infoCache = new Map(); // H -> Promise със снимките и описанието от сайта
const infoData = new Map(); // H -> заредените данни (null – няма); липсва – още се зарежда

// ---------- формата ----------
// Дати и гости са в S (не в полета): S.checkIn, S.checkOut (ГГГГ-ММ-ДД), S.adults, S.childAges ('' = неизбрана възраст)
Object.assign(S, { checkIn: null, checkOut: null, adults: 2, childAges: [] });
const MAX_NIGHTS = 30;
const nightsOf = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function initForm() {
  $('search').addEventListener('submit', onSubmit);
  initSuggest();
  $('dates-btn').addEventListener('click', () => (CAL.open ? closeCal() : openCal()));
  $('pax-btn').addEventListener('click', () => ($('pax').hidden ? openPax() : closePax()));
  // клик извън прозорчетата и Escape ги затварят
  document.addEventListener('mousedown', (e) => {
    if (CAL.open && !e.target.closest('.seg.dates')) closeCal();
    if (!$('pax').hidden && !e.target.closest('.seg.pax')) closePax();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (CAL.open) closeCal(true);
    if (!$('pax').hidden) closePax(true);
  });
  renderDatesText();
  renderPaxText();
}

function readForm() {
  if (!S.target) S.target = resolveTyped($('where').value);
  if (!S.target) return { error: 'Изберете курорт или хотел от списъка.', focus: 'where' };
  if (!S.checkIn || !S.checkOut) return { error: 'Изберете дати на настаняване и напускане.', focus: 'dates-btn' };
  if (S.checkIn < today()) return { error: 'Датата на настаняване е минала.', focus: 'dates-btn' };
  if (S.childAges.some((a) => a === '')) return { error: 'Изберете възрастта на всяко дете.', focus: 'pax-btn' };
  return {
    params: {
      ...(S.target.hotel ? { hotel: S.target.hotel } : { area: S.target.area }),
      date: S.checkIn,
      nights: nightsOf(S.checkIn, S.checkOut),
      adults: S.adults,
      childAges: S.childAges.map(Number),
    },
  };
}

function onSubmit(e) {
  e.preventDefault();
  hideSuggest();
  closeCal();
  closePax();
  const r = readForm();
  $('form-error').textContent = r.error || '';
  if (r.error) {
    if (r.focus) $(r.focus).focus();
    if (r.focus === 'dates-btn') openCal();
    if (r.focus === 'pax-btn') openPax();
    return;
  }
  search(r.params);
}

// На телефон полетата са едно под друго и прозорчето е под цялото „хапче“ – слагаме го точно под полето
function placePop(pop) {
  if (!window.matchMedia('(max-width: 900px)').matches) {
    pop.style.top = '';
    return;
  }
  const seg = pop.closest('.seg');
  pop.style.top = `${seg.offsetTop + seg.offsetHeight + 6}px`;
}

// ---------- календар: от – до, дд.мм.гггг ----------
const MONTHS = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const CAL = { open: false, y: 0, m: 0 };
const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function renderDatesText() {
  const el = $('dates-text');
  const sub = $('dates-sub');
  el.classList.toggle('placeholder', !S.checkIn);
  if (!S.checkIn) el.textContent = 'Изберете дати';
  else if (!S.checkOut) el.textContent = `${day(S.checkIn)} – …`;
  else el.textContent = `${day(S.checkIn)} – ${day(S.checkOut)}`;
  sub.hidden = !(S.checkIn && S.checkOut);
  if (!sub.hidden) sub.textContent = plural(nightsOf(S.checkIn, S.checkOut), 'нощувка', 'нощувки');
}

function openCal() {
  closePax();
  hideSuggest();
  const base = S.checkIn || today();
  CAL.y = Number(base.slice(0, 4));
  CAL.m = Number(base.slice(5, 7)) - 1;
  CAL.open = true;
  $('cal').hidden = false;
  $('dates-btn').setAttribute('aria-expanded', 'true');
  renderCal();
  placePop($('cal'));
  const first = $('cal').querySelector('.day.start') || $('cal').querySelector('.day:not([disabled])');
  if (first) first.focus();
}

function closeCal(focusBack) {
  if (!CAL.open) return;
  CAL.open = false;
  $('cal').hidden = true;
  $('dates-btn').setAttribute('aria-expanded', 'false');
  if (focusBack) $('dates-btn').focus();
}

function shiftMonth(k) {
  const d = new Date(Date.UTC(CAL.y, CAL.m + k, 1));
  const t = today();
  if (d.getUTCFullYear() * 12 + d.getUTCMonth() < Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1) return;
  CAL.y = d.getUTCFullYear();
  CAL.m = d.getUTCMonth();
  renderCal();
}

function renderCal() {
  const months = window.matchMedia('(max-width: 700px)').matches ? 1 : 2;
  const t = today();
  const maxDate = addDays(t, 729);
  // при избор на напускане – до 30 нощувки след настаняването
  const pickingOut = S.checkIn && !S.checkOut;
  const limit = pickingOut ? addDays(S.checkIn, MAX_NIGHTS) : maxDate;
  const grids = [];
  for (let k = 0; k < months; k++) {
    const first = new Date(Date.UTC(CAL.y, CAL.m + k, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth();
    const offset = (first.getUTCDay() + 6) % 7; // понеделник първи
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'blank' }));
    for (let d = 1; d <= count; d++) {
      const id = isoOf(y, m, d);
      const cls = ['day'];
      if (id === t) cls.push('today');
      if (id === S.checkIn) cls.push('start');
      if (id === S.checkOut) cls.push('end');
      if (S.checkIn && S.checkOut && id > S.checkIn && id < S.checkOut) cls.push('in');
      const off = id < t || id > limit || (pickingOut && id === S.checkIn);
      cells.push(h('button', {
        type: 'button', class: cls.join(' '), 'data-date': id, disabled: off && id !== S.checkIn,
        'aria-label': `${d} ${MONTHS[m].toLowerCase()} ${y}`, 'aria-pressed': String(id === S.checkIn || id === S.checkOut),
        onclick: () => pickDay(id),
        onmouseenter: () => hoverDay(id),
        onfocus: () => hoverDay(id),
      }, d));
    }
    grids.push(h('div', { class: 'month' },
      h('div', { class: 'mtitle' }, `${MONTHS[m]} ${y}`),
      h('div', { class: 'grid' }, WEEKDAYS.map((w) => h('span', { class: 'wd' }, w)), cells)));
  }
  const n = S.checkIn && S.checkOut ? nightsOf(S.checkIn, S.checkOut) : 0;
  const hint = !S.checkIn ? 'Изберете дата на настаняване' : !S.checkOut ? 'Изберете дата на напускане' : `${day(S.checkIn)} – ${day(S.checkOut)} · ${plural(n, 'нощувка', 'нощувки')}`;
  $('cal').replaceChildren(
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', class: 'nav', 'aria-label': 'Предишен месец', onclick: () => shiftMonth(-1) }, '‹'),
      h('button', { type: 'button', class: 'nav', 'aria-label': 'Следващ месец', onclick: () => shiftMonth(1) }, '›')),
    h('div', { class: 'months' }, grids),
    h('div', { class: 'cal-foot' },
      h('span', { class: 'hint' }, hint),
      S.checkIn ? h('button', { type: 'button', class: 'link', onclick: () => { S.checkIn = S.checkOut = null; renderDatesText(); renderCal(); } }, 'Изчисти') : null,
      h('button', { type: 'button', class: 'primary small', disabled: !n, onclick: () => closeCal(true) }, 'Готово')));
}

// преглед на периода, докато се избира напускането
function hoverDay(id) {
  if (!S.checkIn || S.checkOut) return;
  for (const b of $('cal').querySelectorAll('.day')) b.classList.toggle('in', b.dataset.date > S.checkIn && b.dataset.date <= id && !b.disabled);
}

function pickDay(id) {
  if (!S.checkIn || S.checkOut || id <= S.checkIn) {
    S.checkIn = id;
    S.checkOut = null;
  } else S.checkOut = id;
  $('form-error').textContent = '';
  renderDatesText();
  renderCal();
  const again = $('cal').querySelector(`.day[data-date="${id}"]`);
  if (again) again.focus();
  if (S.checkOut) setTimeout(() => closeCal(true), 250);
}

// ---------- гости ----------
function renderPaxText() {
  const k = S.childAges.length;
  $('pax-text').textContent = `${plural(S.adults, 'възрастен', 'възрастни')}${k ? `, ${plural(k, 'дете', 'деца')}` : ''}`;
}

function openPax() {
  closeCal();
  hideSuggest();
  $('pax').hidden = false;
  $('pax-btn').setAttribute('aria-expanded', 'true');
  renderPax();
  placePop($('pax'));
  const b = $('pax').querySelector('button');
  if (b) b.focus();
}

function closePax(focusBack) {
  if ($('pax').hidden) return;
  $('pax').hidden = true;
  $('pax-btn').setAttribute('aria-expanded', 'false');
  if (focusBack) $('pax-btn').focus();
}

function renderPax() {
  const stepper = (label, sub, value, min, max, set) => h('div', { class: 'step-row' },
    h('div', null, h('div', null, label), sub ? h('small', { class: 'muted' }, sub) : null),
    h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': `${label}: по-малко`, disabled: value <= min, onclick: () => { set(value - 1); renderPax(); renderPaxText(); } }, '−'),
      h('span', { 'aria-live': 'polite' }, value),
      h('button', { type: 'button', 'aria-label': `${label}: повече`, disabled: value >= max, onclick: () => { set(value + 1); renderPax(); renderPaxText(); } }, '+')));
  $('pax').replaceChildren(
    stepper('Възрастни', '', S.adults, 1, 6, (v) => (S.adults = v)),
    stepper('Деца', 'до 17 години', S.childAges.length, 0, 3, (v) => (S.childAges = v > S.childAges.length ? [...S.childAges, ''] : S.childAges.slice(0, v))),
    S.childAges.length ? h('div', { class: 'ages' }, S.childAges.map((a, i) => {
      const sel = h('select', { 'aria-label': `Възраст на дете ${i + 1}`, onchange: () => { S.childAges[i] = sel.value; $('form-error').textContent = ''; } },
        h('option', { value: '' }, `Възраст на дете ${i + 1}`));
      for (let y = 0; y <= 17; y++) sel.append(h('option', { value: y }, y === 0 ? 'под 1 г.' : `${y} г.`));
      sel.value = String(a);
      return sel;
    })) : null,
    h('div', { class: 'pax-foot' }, h('small', { class: 'muted' }, 'Цените са за една стая.'), h('button', { type: 'button', class: 'primary small', onclick: () => closePax(true) }, 'Готово')));
}

// ---------- предложения: курорт или хотел ----------
let sugg = [];
let active = -1;
let hotelTimer = null;
let hotelSeq = 0;

function areaMatches(q) {
  const lo = q.toLowerCase();
  const up = q.toUpperCase();
  return S.areas.filter((a) => a.area.startsWith(up) || areaName(a.area).toLowerCase().startsWith(lo));
}

function resolveTyped(text) {
  const q = text.trim();
  if (!q) return null;
  const exact = S.areas.find((a) => a.area === q.toUpperCase() || areaName(a.area).toLowerCase() === q.toLowerCase());
  if (exact) return { area: exact.area };
  if (sugg.length) return sugg[0].value;
  return null;
}

function initSuggest() {
  const input = $('where');
  input.addEventListener('input', () => {
    S.target = null;
    const q = input.value.trim();
    sugg = areaMatches(q).slice(0, 5).map((a) => ({ label: areaName(a.area), hint: `курорт · ${plural(a.hotels, 'хотел', 'хотела')}`, value: { area: a.area } }));
    showSuggest();
    clearTimeout(hotelTimer);
    if (q.length < 2) return;
    hotelTimer = setTimeout(async () => {
      const seq = ++hotelSeq;
      try {
        const r = await fetch(`api/hotels?q=${encodeURIComponent(q)}`);
        if (!r.ok || seq !== hotelSeq) return;
        const { hotels } = await r.json();
        const areas = sugg.filter((x) => x.value.area);
        sugg = [...areas, ...hotels.slice(0, 8).map((x) => ({ label: x.name, hint: `${'★'.repeat(x.stars || 0)} ${areaName(x.area)}`.trim(), value: { hotel: x.hotelId, label: x.name } }))];
        showSuggest();
      } catch {
        /* без предложения за хотели */
      }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if ($('suggest').hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length;
      showSuggest();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(sugg[active]);
    } else if (e.key === 'Escape') hideSuggest();
  });
  input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
}

function showSuggest() {
  const list = $('suggest');
  if (!sugg.length || document.activeElement !== $('where')) return hideSuggest();
  if (active >= sugg.length) active = -1;
  list.replaceChildren(...sugg.map((s, i) => h('li', {
    id: `sg-${i}`, role: 'option', class: i === active ? 'on' : '', 'aria-selected': String(i === active),
    onmousedown: (e) => {
      e.preventDefault();
      pick(s);
    },
  }, h('span', null, s.label), h('small', null, s.hint))));
  list.hidden = false;
  placePop(list);
  $('where').setAttribute('aria-expanded', 'true');
  if (active >= 0) $('where').setAttribute('aria-activedescendant', `sg-${active}`);
  else $('where').removeAttribute('aria-activedescendant');
}

function hideSuggest() {
  $('suggest').hidden = true;
  $('where').setAttribute('aria-expanded', 'false');
  $('where').removeAttribute('aria-activedescendant');
  active = -1;
}

function pick(s) {
  S.target = s.value;
  $('where').value = s.label;
  hideSuggest();
  $('form-error').textContent = '';
}

// ---------- търсене (поток от събития, SSE през fetch) ----------
async function search(params) {
  if (S.ctrl) S.ctrl.abort();
  const ctrl = (S.ctrl = new AbortController());
  Object.assign(S, { params, done: false, incomplete: false, error: '', shown: 20, board: '', onlyAvailable: false });
  $('popular').hidden = true;
  S.results = new Map(); // нов – запазеният списък (S.prev) остава непокътнат
  S.expanded.clear();
  S.roomSel.clear();
  S.view = params.hotel ? 'hotel' : 'list';
  S.hotelId = params.hotel || null;
  if (!params.hotel) S.prev = null;
  saveUrl(params);
  renderAll();

  const qs = new URLSearchParams({ date: params.date, nights: params.nights, adults: params.adults, stream: '1' });
  if (params.hotel) qs.set('hotel', params.hotel);
  else qs.set('area', params.area);
  if (params.childAges.length) qs.set('childAges', params.childAges.join(','));

  try {
    const r = await fetch(`api/search?${qs}`, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return fail(j.error || 'Търсенето не успя. Опитайте отново.');
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        onEvent(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (!S.done && S.ctrl === ctrl) fail('Връзката прекъсна. Опитайте отново.');
  } catch (e) {
    if (e.name !== 'AbortError') fail('Няма връзка. Проверете интернета и опитайте отново.');
  }
}

function onEvent(block) {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) data += line.slice(6);
  }
  if (!data) return;
  const d = JSON.parse(data);
  if (event === 'part') {
    for (const x of d.hotels) S.results.set(x.hotelId, x);
    if (S.target && S.target.hotel && !$('where').value && d.hotels[0]) {
      $('where').value = d.hotels[0].name;
      S.target.label = d.hotels[0].name;
    }
    scheduleRender();
  } else if (event === 'done') {
    S.done = true;
    S.incomplete = d.incomplete;
    renderAll();
  } else if (event === 'error') fail(d.error);
}

function fail(msg) {
  S.done = true;
  S.error = msg;
  $('status').replaceChildren(h('p', { class: 'error' }, msg));
  if (S.view === 'hotel') renderHotelPage();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    renderAll();
  }, 150);
}

// ---------- резултати ----------
function visibleHotels() {
  const out = [];
  for (const x of S.results.values()) {
    const options = x.options.filter((o) => (!S.board || o.board === S.board) && (!S.onlyAvailable || o.available));
    if (!options.length) continue;
    const best = options.find((o) => o.available) || options[0];
    out.push({ ...x, options, from: best.price, fromAvailable: best.available });
  }
  return out.sort((a, b) => a.from - b.from);
}

function renderAll() {
  const p = S.params;
  if (!p) return;
  document.body.classList.toggle('view-hotel', S.view === 'hotel');
  $('hotel').hidden = S.view !== 'hotel';
  if (S.view === 'hotel') return renderHotelPage();
  const list = visibleHotels();
  const where = p.hotel ? $('where').value || 'хотела' : areaName(p.area);
  const when = `${day(p.date)} – ${day(addDays(p.date, p.nights))}, ${plural(p.nights, 'нощувка', 'нощувки')}, ${pax(p.adults, p.childAges.length)}`;

  // статус
  const st = [];
  if (!S.done) st.push(h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), S.results.size ? `Търсим още… намерени ${plural(S.results.size, 'хотел', 'хотела')}` : 'Търсим най-добрите цени…'));
  else if (!S.results.size) st.push(h('p', { class: 'empty' }, 'Няма свободни хотели за тези дати. Пробвайте с други дати или друг курорт.'));
  else st.push(h('p', null, h('strong', null, plural(S.results.size, 'хотел', 'хотела')), ` · ${where} · ${when}`));
  if (S.done && S.incomplete) st.push(h('p', { class: 'note' }, 'Част от цените не се заредиха. Опитайте отново след малко за пълен списък.'));
  $('status').replaceChildren(...st);

  renderFilters();

  // хотели
  const shown = list.slice(0, S.shown);
  $('results').replaceChildren(...shown.map(hotelCard));
  $('more').replaceChildren(
    ...(list.length > S.shown ? [h('button', { class: 'secondary', onclick: () => { S.shown += 20; renderAll(); } }, `Покажи още (${list.length - S.shown})`)] : [])
  );
}

const BOARD_ORDER = ['UAI', 'AI', 'FB+', 'FB', 'HB+', 'HB', 'BB', 'RO'];
function renderFilters() {
  const boards = new Map();
  for (const x of S.results.values()) for (const o of x.options) if (!boards.has(o.board)) boards.set(o.board, o.boardLabel);
  const box = $('filters');
  box.hidden = boards.size < 2 && !S.results.size;
  if (box.hidden) return;
  const sorted = [...boards].sort((a, b) => (BOARD_ORDER.indexOf(a[0]) + 99) % 99 - (BOARD_ORDER.indexOf(b[0]) + 99) % 99);
  const chip = (value, label) => h('button', { type: 'button', class: `chip${S.board === value ? ' on' : ''}`, 'aria-pressed': String(S.board === value), onclick: () => { S.board = value; S.shown = 20; renderAll(); } }, label);
  box.replaceChildren(
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Изхранване' }, chip('', 'Всички'), sorted.map(([v, l]) => chip(v, l))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.onlyAvailable, onchange: (e) => { S.onlyAvailable = e.target.checked; S.shown = 20; renderAll(); } }), 'Само с потвърдени места')
  );
}

function hotelCard(x) {
  const opts = x.options.slice(0, 3);
  const open = () => openHotel(x);
  return h('article', { class: `hotel${x.image ? ' with-photo' : ''}` },
    x.image ? h('button', { class: 'photo', type: 'button', 'aria-label': `${x.name} – виж хотела`, onclick: open },
      h('img', { src: x.image, alt: '', loading: 'lazy', decoding: 'async' }),
      x.photos > 1 ? h('span', { class: 'count' }, `${x.photos} снимки`) : null) : null,
    h('div', { class: 'body' },
    h('header', null,
      h('div', null,
        h('h3', null, h('button', { type: 'button', class: 'hname', onclick: open }, x.name), x.stars ? h('span', { class: 'stars', 'aria-label': `${x.stars} звезди` }, ' ', '★'.repeat(x.stars)) : null),
        h('div', { class: 'area' }, areaName(x.area),
          x.rating ? h('span', { class: 'rating', title: `${x.reviews} отзива` }, ` · ★ ${x.rating.toFixed(1)}`, h('small', null, ` (${x.reviews})`)) : null),
        x.amenities && x.amenities.length ? amenList(x.amenities, 'amen') : null),
      h('div', { class: 'from' }, h('small', null, 'от'), h('strong', null, money(x.from, x.currency)), h('small', null, `за ${plural(S.params.nights, 'нощувка', 'нощувки')}`))),
    h('ul', { class: 'options' }, opts.map((o) => h('li', null,
      h('div', { class: 'room' },
        h('span', null, o.room || o.roomGroup),
        h('span', { class: 'tags' },
          h('span', { class: 'board' }, o.boardLabel),
          o.seaView ? h('span', { class: 'tag sea' }, 'изглед към морето') : null,
          o.eb ? h('span', { class: 'tag eb' }, `ранно записване −${o.eb}%`) : null,
          o.available ? null : h('span', { class: 'tag rq' }, 'по запитване'))),
      h('div', { class: 'price' }, money(o.price, o.currency)),
      h('button', { class: 'primary small', onclick: () => openBooking(x, o) }, 'Резервирай')))),
    h('button', { class: 'see-hotel', type: 'button', onclick: open }, x.options.length > 3 ? `Виж хотела и всички ${x.options.length} варианта →` : 'Виж хотела →')));
}

// ---------- страницата на хотела ----------
function hotelInfo(id) {
  if (!infoCache.has(id)) {
    infoCache.set(id, fetch(`api/hotel/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        infoData.set(id, d);
        if (S.view === 'hotel' && S.hotelId === id) renderHotelPage();
        return d;
      }));
  }
  return infoCache.get(id);
}

function hotelUrl(id) {
  const p = S.params;
  const qs = new URLSearchParams({ hotel: id, date: p.date, nights: p.nights, adults: p.adults });
  if (p.childAges.length) qs.set('childAges', p.childAges.join(','));
  return `?${qs}`;
}

// От списъка към хотела – без ново търсене (цените вече са тук)
function openHotel(x, { push = true } = {}) {
  if (S.view === 'list') {
    S.prev = { params: S.params, results: S.results, done: S.done, incomplete: S.incomplete, shown: S.shown, board: S.board, onlyAvailable: S.onlyAvailable, scroll: window.scrollY, target: S.target, where: $('where').value };
  }
  S.view = 'hotel';
  S.hotelId = x.hotelId;
  S.roomSel.clear();
  S.target = { hotel: x.hotelId, label: x.name };
  $('where').value = x.name;
  if (push) history.pushState({ v: 'hotel' }, '', hotelUrl(x.hotelId));
  renderAll();
  window.scrollTo(0, 0);
}

// Обратно към списъка – запазения, ако е за същите дати и хора; иначе ново търсене по курорта
function backToList() {
  const x = S.results.get(S.hotelId);
  const p = S.params;
  const same = S.prev && ['date', 'nights', 'adults'].every((k) => S.prev.params[k] === p[k]) && S.prev.params.childAges.join() === p.childAges.join();
  if (same) {
    Object.assign(S, { params: S.prev.params, results: S.prev.results, done: S.prev.done, incomplete: S.prev.incomplete, shown: S.prev.shown, board: S.prev.board, onlyAvailable: S.prev.onlyAvailable, target: S.prev.target, view: 'list', hotelId: null });
    $('where').value = S.prev.where;
    const y = S.prev.scroll;
    saveUrl(S.params);
    renderAll();
    window.scrollTo(0, y);
    return;
  }
  const area = (S.prev && S.prev.params.area) || (x && x.area);
  if (!area) return;
  S.target = { area };
  $('where').value = areaName(area);
  const { hotel, ...rest } = p;
  search({ ...rest, area });
}

window.addEventListener('popstate', () => {
  const q = new URLSearchParams(location.search);
  const hotel = q.get('hotel');
  if (!hotel && S.view === 'hotel' && S.prev) return backToList();
  if (hotel && S.view === 'list' && S.results.has(hotel)) return openHotel(S.results.get(hotel), { push: false });
  loadUrl();
});

// изхранванията на една стая – като избор с радио бутони, цената се сменя
function roomGroups(options) {
  const m = new Map();
  for (const o of options) {
    const k = o.room || o.roomGroup;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return [...m].map(([room, opts]) => ({ room, opts: opts.sort((a, b) => a.price - b.price) })).sort((a, b) => a.opts[0].price - b.opts[0].price);
}

const firstSentence = (t) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^.{20,220}?[.!?](\s|$)/);
  return m ? m[0].trim() : s.slice(0, 200);
};

function renderHotelPage() {
  const id = S.hotelId;
  const x = S.results.get(id);
  const p = S.params;
  const box = $('hotel');
  hotelInfo(id); // снимките и описанието – щом дойдат, страницата се рисува пак
  const info = infoData.get(id);

  const name = (x && x.name) || (info && info.name) || (S.target && S.target.label) || '';
  const stars = (x && x.stars) || (info && info.stars) || 0;
  const area = (x && x.area) || (info && info.area) || '';
  const photos = info && info.photos && info.photos.length ? info.photos : x && x.image ? [{ big: x.image, thumb: x.image }] : [];
  const sections = (info && info.sections) || [];
  const rating = (x && x.rating) || (info && info.rating);
  const reviews = (x && x.reviews) || (info && info.reviews) || 0;
  const siteUrl = (x && x.siteUrl) || (info && info.siteUrl);
  const groups = x ? roomGroups(x.options) : [];
  const best = x ? x.options.find((o) => o.available) || x.options[0] : null;
  const when = `${day(p.date)} – ${day(addDays(p.date, p.nights))} · ${plural(p.nights, 'нощувка', 'нощувки')} · ${pax(p.adults, p.childAges.length)}`;
  const go = (sel) => () => box.querySelector(sel).scrollIntoView({ behavior: 'smooth', block: 'start' });
  const boards = x ? [...new Set(x.options.map((o) => o.boardLabel))] : [];
  const sec = (re) => sections.find((s) => re.test(s.title));

  const mosaic = photos.length
    ? h('div', { class: `mosaic n${Math.min(photos.length, 5)}` },
        photos.slice(0, 5).map((ph, i) => h('button', { type: 'button', class: `m${i}`, 'aria-label': `Снимка ${i + 1}`, onclick: () => openGallery(name, photos, i) },
          h('img', { src: i === 0 ? ph.big : ph.thumb, alt: i === 0 ? name : '', loading: i === 0 ? 'eager' : 'lazy' }))),
        photos.length > 1 ? h('button', { type: 'button', class: 'all-photos', onclick: () => openGallery(name, photos, 0) }, `Всички снимки (${photos.length})`) : null)
    : null;

  const roomsBody = [];
  if (!x && !S.done) roomsBody.push(h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Търсим свободни стаи и най-добрите цени…'));
  else if (!x) roomsBody.push(h('p', { class: 'empty' }, S.error || 'Няма свободни стаи за тези дати. Пробвайте с други дати.'));
  else {
    if (!S.done) roomsBody.push(h('p', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Търсим още цени…'));
    if (S.done && S.incomplete) roomsBody.push(h('p', { class: 'note' }, 'Част от цените не се заредиха. Опитайте отново след малко.'));
    roomsBody.push(h('div', { class: 'rooms' }, groups.map((g) => roomCard(x, g))));
  }

  box.replaceChildren(
    h('nav', { class: 'crumbs' },
      area ? h('button', { type: 'button', class: 'link back', onclick: () => (S.prev && history.state && history.state.v === 'hotel' ? history.back() : backToList()) }, `← Всички хотели в ${areaName(area)}`) : null),
    mosaic,
    h('div', { class: 'h-tabs', role: 'navigation', 'aria-label': 'Раздели' },
      [['#h-overview', 'Общ преглед'], ['#h-rooms', 'Стаи'], ['#h-about', 'За хотела'], ['#h-location', 'Местоположение'], ['#h-policies', 'Условия']].map(([sel, label]) => h('button', { type: 'button', onclick: go(sel) }, label))),
    h('section', { id: 'h-overview', class: 'h-overview' },
      h('div', null,
        h('h1', null, name || 'Хотел', stars ? h('span', { class: 'stars', 'aria-label': `${stars} звезди` }, ' ', '★'.repeat(stars)) : null),
        h('div', { class: 'area' }, `${areaName(area)}, Турция`),
        rating ? h('div', { class: 'score' }, h('span', { class: 'score-badge' }, rating.toFixed(1)), h('span', null, h('strong', null, rating >= 4.5 ? 'Отличен' : rating >= 4 ? 'Много добър' : 'Добър'), h('small', { class: 'muted' }, ` · ${plural(reviews, 'отзив', 'отзива')} на нашия сайт`))) : null,
        h('ul', { class: 'highlights' },
          boards.length ? h('li', null, h('strong', null, 'Изхранване: '), boards.join(', ')) : null,
          sec(/Плаж/i) ? h('li', null, h('strong', null, 'Плаж: '), firstSentence(sec(/Плаж/i).text)) : null,
          sec(/Разположение/i) ? h('li', null, h('strong', null, 'Разположение: '), firstSentence(sec(/Разположение/i).text)) : null),
        amenitiesBlock(info)),
      h('aside', { class: 'price-box' },
        best ? [h('small', { class: 'muted' }, 'от'), h('div', { class: 'big' }, money(best.price, best.currency)), h('small', { class: 'muted' }, `общо за ${plural(p.nights, 'нощувка', 'нощувки')}, ${pax(p.adults, p.childAges.length)}`)]
          : h('small', { class: 'muted' }, S.done ? 'Няма свободни стаи за тези дати' : 'Търсим цени…'),
        h('button', { type: 'button', class: 'primary', onclick: go('#h-rooms') }, 'Изберете стая'))),
    h('section', { id: 'h-rooms', class: 'h-section' },
      h('div', { class: 'h-head' }, h('h2', null, 'Изберете стая'),
        h('div', { class: 'when' }, when, h('button', { type: 'button', class: 'link', onclick: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); openCal(); } }, 'Промени'))),
      roomsBody),
    h('section', { id: 'h-about', class: 'h-section' },
      h('h2', null, 'За хотела'),
      sections.length ? h('dl', { class: 'about' }, sections.map((s2) => [h('dt', null, s2.title), h('dd', null, s2.text)])) : h('p', { class: 'muted' }, info === undefined ? 'Зареждане…' : 'Още няма описание.'),
      siteUrl ? h('p', null, h('a', { href: siteUrl, target: '_blank', rel: 'noopener' }, 'Виж хотела на сайта на Tours Club ↗')) : null),
    h('section', { id: 'h-location', class: 'h-section' },
      h('h2', null, 'Местоположение'),
      h('p', null, `${areaName(area)}, Турция`),
      info && info.lat && info.lon ? h('p', null, h('a', { href: `https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lon}#map=15/${info.lat}/${info.lon}`, target: '_blank', rel: 'noopener' }, 'Виж на картата ↗')) : null),
    h('section', { id: 'h-policies', class: 'h-section' },
      h('h2', null, 'Условия'),
      h('ul', { class: 'policies' },
        h('li', null, 'Цената е за целия престой в една стая за избраните гости. Отстъпката за ранно записване вече е включена.'),
        h('li', null, 'Заявката не е плащане. Проверяваме наличността при хотела и се свързваме с вас до края на работния ден.'),
        h('li', null, 'Стаите „по запитване“ се потвърждават допълнително.'),
        h('li', null, 'Имената на гостите трябва да са както в паспорта.'))));
}

// Удобствата от описанието: първите 8, „Всички удобства“ разгъва
function amenitiesBlock(info) {
  const list = (info && info.amenities) || [];
  if (!list.length) return null;
  const all = S.amenAll === S.hotelId;
  return h('div', { class: 'amenities' },
    h('h2', null, 'Удобства'),
    amenList(all ? list : list.slice(0, 8), 'amen-grid'),
    list.length > 8 ? h('button', { type: 'button', class: 'link', onclick: () => { S.amenAll = all ? null : S.hotelId; renderHotelPage(); } }, all ? 'По-малко' : `Всички удобства (${list.length})`) : null,
    h('p', { class: 'muted amen-note' }, 'По описанието на хотела. Някои услуги може да са платени или сезонни.'));
}

function roomCard(x, g) {
  const key = S.roomSel.get(g.room);
  const sel = g.opts.find((o) => o.offerKey === key) || g.opts.find((o) => o.available) || g.opts[0];
  const base = g.opts[0].price;
  const nm = `r-${g.room}`;
  return h('article', { class: 'room-card' },
    h('h3', null, g.room),
    h('ul', { class: 'facts' },
      h('li', null, `${sel.roomGroup} стая`),
      sel.seaView ? h('li', null, 'Изглед към морето') : null,
      h('li', null, `За ${pax(S.params.adults, S.params.childAges.length)}`)),
    h('fieldset', { class: 'boards' },
      h('legend', null, 'Изхранване'),
      g.opts.map((o) => h('label', { class: o === sel ? 'on' : '' },
        h('input', { type: 'radio', name: nm, checked: o === sel, onchange: () => { S.roomSel.set(g.room, o.offerKey); renderHotelPage(); } }),
        h('span', null, o.boardLabel, o.available ? null : h('small', { class: 'rq-text' }, ' · по запитване')),
        h('span', { class: 'diff' }, o === g.opts[0] ? money(o.price, o.currency) : `+${money(o.price - base, o.currency)}`)))),
    h('div', { class: 'tags' },
      sel.eb ? h('span', { class: 'tag eb' }, `ранно записване −${sel.eb}%`) : null,
      sel.available ? h('span', { class: 'tag ok' }, 'потвърдени места') : h('span', { class: 'tag rq' }, 'по запитване')),
    h('div', { class: 'room-foot' },
      h('div', null, h('div', { class: 'big' }, money(sel.price, sel.currency)), h('small', { class: 'muted' }, `общо за ${plural(S.params.nights, 'нощувка', 'нощувки')}`)),
      h('button', { type: 'button', class: 'primary', onclick: () => openBooking(x, sel) }, 'Резервирай')));
}

// Снимките на цял екран
function openGallery(name, photos, start = 0) {
  const dlg = $('gallery');
  let i = start;
  const big = h('img', { class: 'g-big', alt: '' });
  const num = h('span', { class: 'g-num' });
  const thumbs = photos.map((p, k) => h('button', { type: 'button', class: 'g-thumb', 'aria-label': `Снимка ${k + 1}`, onclick: () => show(k) }, h('img', { src: p.thumb, alt: '', loading: 'lazy' })));
  const show = (k) => {
    i = (k + photos.length) % photos.length;
    big.src = photos[i].big;
    big.alt = `${name} – снимка ${i + 1}`;
    num.textContent = `${i + 1} / ${photos.length}`;
    thumbs.forEach((t, n) => t.classList.toggle('on', n === i));
    thumbs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const close = h('button', { class: 'close', 'aria-label': 'Затвори', onclick: () => dlg.close() }, '×');
  dlg.onkeydown = (e) => {
    if (e.key === 'ArrowRight') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
  };
  dlg.replaceChildren(
    h('div', { class: 'b-head' }, h('h2', null, name), close),
    h('div', { class: 'gallery' },
      h('div', { class: 'g-stage' }, big,
        photos.length > 1 ? [h('button', { type: 'button', class: 'g-nav prev', 'aria-label': 'Предишна', onclick: () => show(i - 1) }, '‹'), h('button', { type: 'button', class: 'g-nav next', 'aria-label': 'Следваща', onclick: () => show(i + 1) }, '›'), num] : null),
      photos.length > 1 ? h('div', { class: 'g-strip' }, thumbs) : null));
  dlg.showModal();
  show(start);
  close.focus();
}

// ---------- адрес на страницата: /book/?area=SIDE&date=…  (сайтът може да води направо към хотел: ?hotel=H123) ----------
function saveUrl(p) {
  const qs = new URLSearchParams();
  if (p.hotel) qs.set('hotel', p.hotel);
  else qs.set('area', p.area);
  qs.set('date', p.date);
  qs.set('nights', p.nights);
  qs.set('adults', p.adults);
  if (p.childAges.length) qs.set('childAges', p.childAges.join(','));
  history.replaceState(null, '', `?${qs}`);
}

function loadUrl() {
  const q = new URLSearchParams(location.search);
  const area = (q.get('area') || '').toUpperCase();
  const hotel = q.get('hotel') || '';
  if (/^H\d+$/.test(hotel)) S.target = { hotel };
  else if (area) {
    S.target = { area };
    $('where').value = areaName(area);
  }
  const date = q.get('date') || '';
  const nights = Number(q.get('nights')) || 7;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today() && nights >= 1 && nights <= MAX_NIGHTS) {
    S.checkIn = date;
    S.checkOut = addDays(date, nights);
  }
  const adults = Number(q.get('adults'));
  if (adults >= 1 && adults <= 6) S.adults = adults;
  S.childAges = (q.get('childAges') || '').split(',').filter((x) => /^\d+$/.test(x) && Number(x) <= 17).slice(0, 3);
  renderDatesText();
  renderPaxText();
  if (S.target && S.checkIn) {
    const r = readForm();
    if (r.params) search(r.params);
  } else if (S.target && hotel) openCal();
}

// ---------- резервация ----------
const B = { hotel: null, option: null, price: null, sending: false };

function openBooking(x, o) {
  Object.assign(B, { hotel: x, option: o, price: o.price, sending: false });
  const p = S.params;
  const dlg = $('book');
  const priceBox = h('div', { class: 'b-price' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Проверяваме цената…');
  const notice = h('div', { class: 'b-notice', role: 'status' });
  const form = bookingForm(p);
  dlg.replaceChildren(
    h('div', { class: 'b-head' }, h('h2', { id: 'book-title' }, 'Заявка за резервация'), h('button', { class: 'close', 'aria-label': 'Затвори', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'b-sum' },
      h('strong', null, x.name, x.stars ? ` ${'★'.repeat(x.stars)}` : ''), h('div', { class: 'muted' }, areaName(x.area)),
      h('div', null, `${o.room || o.roomGroup} · ${o.boardLabel}${o.seaView ? ' · изглед към морето' : ''}`),
      h('div', null, `${day(p.date)} – ${day(addDays(p.date, p.nights))} · ${plural(p.nights, 'нощувка', 'нощувки')} · ${pax(p.adults, p.childAges.length)}${p.childAges.length ? ` (${p.childAges.join(', ')} г.)` : ''}`)),
    priceBox, notice, form);
  dlg.showModal();
  recheck(priceBox, notice, form);
}

async function recheck(priceBox, notice, form) {
  const o = B.option;
  const showPrice = () => priceBox.replaceChildren(h('span', null, 'Обща цена'), h('strong', null, money(B.price, o.currency)));
  try {
    const r = await fetch(`api/offer/${encodeURIComponent(o.offerKey)}/recheck`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 410) {
      priceBox.replaceChildren();
      notice.replaceChildren(h('p', { class: 'error' }, j.error || 'Тази оферта вече не е налична.'));
      form.hidden = true;
      return;
    }
    if (!r.ok) {
      showPrice();
      notice.replaceChildren(h('p', { class: 'note' }, 'Не успяхме да проверим цената сега – ще я проверим отново при изпращане.'));
      return;
    }
    B.price = j.price;
    showPrice();
    const msgs = [];
    if (j.changed) msgs.push(h('p', { class: 'note' }, `Цената току-що се промени: беше ${money(j.previousPrice, j.currency)}, сега е ${money(j.price, j.currency)}.`));
    if (j.onRequest) msgs.push(h('p', { class: 'note' }, 'Тази стая е по запитване – ще потвърдим свободните места и ще ви се обадим.'));
    notice.replaceChildren(...msgs);
  } catch {
    showPrice();
  }
}

function bookingForm(p) {
  const field = (label, attrs) => h('label', { class: 'f' }, h('span', null, label), h('input', attrs));
  const guestRows = [];
  for (let i = 0; i < p.adults; i++) {
    guestRows.push(h('fieldset', { class: 'guest' }, h('legend', null, `Възрастен ${i + 1}`),
      field('Име', { name: `g${i}-first`, required: true, maxlength: 60, autocomplete: i === 0 ? 'given-name' : 'off' }),
      field('Фамилия', { name: `g${i}-last`, required: true, maxlength: 60, autocomplete: i === 0 ? 'family-name' : 'off' })));
  }
  p.childAges.forEach((age, k) => {
    const i = p.adults + k;
    guestRows.push(h('fieldset', { class: 'guest' }, h('legend', null, `Дете ${k + 1} (${age} г.)`),
      field('Име', { name: `g${i}-first`, required: true, maxlength: 60 }),
      field('Фамилия', { name: `g${i}-last`, required: true, maxlength: 60 }),
      field('Дата на раждане', { name: `g${i}-birth`, required: true, placeholder: 'дд.мм.гггг', inputmode: 'numeric', maxlength: 10, oninput: maskDate })));
  });
  const err = h('p', { class: 'error', role: 'alert' });
  const send = h('button', { type: 'submit', class: 'primary' }, 'Изпрати заявката');
  const form = h('form', { class: 'b-form', novalidate: true, onsubmit: (e) => submitBooking(e, form, err, send) },
    h('h3', null, 'За контакт'),
    h('div', { class: 'grid2' },
      field('Име и фамилия', { name: 'name', required: true, maxlength: 200, autocomplete: 'name' }),
      field('Телефон', { name: 'phone', type: 'tel', required: true, maxlength: 40, autocomplete: 'tel', placeholder: '+359 …' }),
      field('Имейл', { name: 'email', type: 'email', required: true, maxlength: 254, autocomplete: 'email' })),
    h('h3', null, 'Гости ', h('small', { class: 'muted' }, 'имената както са в паспорта')),
    guestRows,
    h('label', { class: 'f' }, h('span', null, 'Бележка (по желание)'), h('textarea', { name: 'note', rows: 2, maxlength: 1000 })),
    err,
    h('div', { class: 'b-actions' }, send, h('small', { class: 'muted' }, 'Заявката не е плащане. Ще се свържем с вас за потвърждение.')));
  return form;
}

async function submitBooking(e, form, err, send) {
  e.preventDefault();
  if (B.sending) return;
  const missing = [...form.querySelectorAll('[required]')].find((x) => !x.value.trim());
  if (missing) {
    err.textContent = 'Попълнете всички полета.';
    missing.focus();
    return;
  }
  const v = (n) => form.elements[n].value.trim();
  const p = S.params;
  const guests = Array.from({ length: p.adults + p.childAges.length }, (_, i) => ({
    firstName: v(`g${i}-first`),
    lastName: v(`g${i}-last`),
    ...(form.elements[`g${i}-birth`] ? { birthDate: isoDate(v(`g${i}-birth`)) } : {}),
  }));
  const badBirth = guests.findIndex((g) => g.birthDate === null);
  if (badBirth >= 0) {
    err.textContent = 'Датата на раждане трябва да е във формат дд.мм.гггг (напр. 02.03.2021).';
    form.elements[`g${badBirth}-birth`].focus();
    return;
  }
  const body = { offerKey: B.option.offerKey, expectedPrice: B.price, contact: { name: v('name'), email: v('email'), phone: v('phone') }, guests, note: v('note') };
  B.sending = true;
  send.disabled = true;
  err.textContent = '';
  try {
    const r = await fetch('api/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 201 || r.status === 200) return done(j);
    if (r.status === 409 && j.reason === 'price_changed') {
      B.price = j.price;
      document.querySelector('.b-price').replaceChildren(h('span', null, 'Обща цена'), h('strong', null, money(j.price, j.currency)));
      err.textContent = `Цената току-що се промени на ${money(j.price, j.currency)}. Натиснете „Изпрати заявката“ отново, за да я потвърдите.`;
    } else {
      err.textContent = j.error || 'Заявката не беше изпратена. Опитайте отново.';
      if (r.status === 410) send.hidden = true;
    }
  } catch {
    err.textContent = 'Няма връзка. Проверете интернета и опитайте отново.';
  } finally {
    B.sending = false;
    send.disabled = false;
  }
}

// дд.мм.гггг: точките се слагат сами, докато се пише
function maskDate(e) {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
  e.target.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('.');
}
// дд.мм.гггг -> ГГГГ-ММ-ДД (null, ако не е истинска дата в миналото)
function isoDate(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso <= today() ? iso : null;
}

function done(j) {
  const dlg = $('book');
  dlg.replaceChildren(
    h('div', { class: 'b-head' }, h('h2', { id: 'book-title' }, 'Заявката е изпратена'), h('button', { class: 'close', 'aria-label': 'Затвори', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'b-done' },
      h('p', null, 'Номер на заявката: ', h('strong', { class: 'ref' }, j.bookingId)),
      h('p', null, `${j.hotelName} · ${day(j.checkIn)}, ${plural(j.nights, 'нощувка', 'нощувки')} · ${money(j.price, j.currency)}`),
      h('p', null, j.onRequest
        ? 'Стаята е по запитване. Ще проверим свободните места и ще се свържем с вас до края на работния ден.'
        : 'Ще потвърдим резервацията при хотела и ще се свържем с вас до края на работния ден.'),
      h('button', { class: 'primary', onclick: () => dlg.close() }, 'Добре')));
}

// ---------- популярни курорти (докато още няма търсене) ----------
function renderPopular() {
  const box = $('popular');
  box.hidden = Boolean(S.params) || !S.areas.length;
  if (box.hidden) return;
  $('popular-list').replaceChildren(...S.areas.slice(0, 8).map((a) => h('button', { type: 'button', class: 'resort', onclick: () => {
    pick({ label: areaName(a.area), value: { area: a.area } });
    $('search').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (S.checkIn && S.checkOut) $('search').requestSubmit();
    else openCal();
  } }, h('strong', null, areaName(a.area)), h('span', null, plural(a.hotels, 'хотел', 'хотела')))));
}

// ---------- старт ----------
(async () => {
  initForm();
  try {
    const r = await fetch('api/areas');
    S.areas = r.ok ? (await r.json()).areas : [];
  } catch {
    S.areas = [];
  }
  if (!S.areas.length) $('status').replaceChildren(h('p', { class: 'note' }, 'Търсенето временно не работи. Моля, опитайте по-късно.'));
  loadUrl();
  renderPopular();
})();
