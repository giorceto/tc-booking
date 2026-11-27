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
};

// ---------- формата ----------
function initForm() {
  const opts = (sel, from, to, def, fmt = String) => {
    for (let i = from; i <= to; i++) sel.append(h('option', { value: i, selected: i === def }, fmt(i)));
  };
  opts($('nights'), 1, 21, 7);
  opts($('adults'), 1, 6, 2);
  opts($('children'), 0, 3, 0);
  $('date').min = today();
  $('children').addEventListener('change', renderAges);
  $('search').addEventListener('submit', onSubmit);
  initSuggest();
}

function renderAges(_, values = []) {
  const n = Number($('children').value);
  const box = $('ages');
  box.hidden = n === 0;
  const old = [...box.querySelectorAll('select')].map((s) => s.value);
  box.replaceChildren(
    h('span', { class: 'label' }, n === 1 ? 'Възраст на детето' : 'Възраст на децата'),
    h('div', { class: 'age-row' }, Array.from({ length: n }, (_, i) => {
      const sel = h('select', { 'aria-label': `Възраст на дете ${i + 1}` }, h('option', { value: '' }, 'г.'));
      for (let a = 0; a <= 17; a++) sel.append(h('option', { value: a }, `${a} г.`));
      sel.value = values[i] ?? old[i] ?? '';
      return sel;
    }))
  );
}

function readForm() {
  const childAges = [...$('ages').querySelectorAll('select')].map((s) => s.value);
  if (!S.target) S.target = resolveTyped($('where').value);
  if (!S.target) return { error: 'Изберете курорт или хотел от списъка.', focus: 'where' };
  const date = $('date').value;
  if (!date) return { error: 'Изберете дата на настаняване.', focus: 'date' };
  if (date < today()) return { error: 'Датата на настаняване е минала.', focus: 'date' };
  if (childAges.some((a) => a === '')) return { error: 'Изберете възрастта на всяко дете.' };
  return {
    params: {
      ...(S.target.hotel ? { hotel: S.target.hotel } : { area: S.target.area }),
      date,
      nights: Number($('nights').value),
      adults: Number($('adults').value),
      childAges: childAges.map(Number),
    },
  };
}

function onSubmit(e) {
  e.preventDefault();
  hideSuggest();
  const r = readForm();
  $('form-error').textContent = r.error || '';
  if (r.error) {
    if (r.focus) $(r.focus).focus();
    return;
  }
  search(r.params);
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
  Object.assign(S, { params, done: false, incomplete: false, shown: 20, board: '', onlyAvailable: false });
  S.results.clear();
  S.expanded.clear();
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
    if (S.target && S.target.hotel && !$('where').value && d.hotels[0]) $('where').value = d.hotels[0].name;
    scheduleRender();
  } else if (event === 'done') {
    S.done = true;
    S.incomplete = d.incomplete;
    renderAll();
  } else if (event === 'error') fail(d.error);
}

function fail(msg) {
  S.done = true;
  $('status').replaceChildren(h('p', { class: 'error' }, msg));
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
  const open = S.expanded.has(x.hotelId);
  const opts = open ? x.options : x.options.slice(0, 4);
  const info = () => openInfo(x);
  return h('article', { class: `hotel${x.image ? ' with-photo' : ''}` },
    x.image ? h('button', { class: 'photo', type: 'button', 'aria-label': `Снимки на ${x.name}`, onclick: info },
      h('img', { src: x.image, alt: '', loading: 'lazy', decoding: 'async' }),
      x.photos > 1 ? h('span', { class: 'count' }, `${x.photos} снимки`) : null) : null,
    h('div', { class: 'body' },
    h('header', null,
      h('div', null,
        h('h3', null, x.name, x.stars ? h('span', { class: 'stars', 'aria-label': `${x.stars} звезди` }, ' ', '★'.repeat(x.stars)) : null),
        h('div', { class: 'area' }, areaName(x.area),
          x.rating ? h('span', { class: 'rating', title: `${x.reviews} отзива` }, ` · ★ ${x.rating.toFixed(1)}`, h('small', null, ` (${x.reviews})`)) : null),
        x.image ? h('button', { class: 'link small', type: 'button', onclick: info }, 'Снимки и описание') : null),
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
    x.options.length > 4 ? h('button', { class: 'link', onclick: () => { open ? S.expanded.delete(x.hotelId) : S.expanded.add(x.hotelId); renderAll(); } }, open ? 'По-малко' : `Още ${plural(x.options.length - 4, 'вариант', 'варианта')}`) : null));
}

// ---------- снимки и описание (от нашия сайт) ----------
async function openInfo(x) {
  const dlg = $('info');
  const close = h('button', { class: 'close', 'aria-label': 'Затвори', onclick: () => dlg.close() }, '×');
  dlg.replaceChildren(h('div', { class: 'b-head' }, h('h2', { id: 'info-title' }, x.name), close), h('p', { class: 'loading pad' }, h('span', { class: 'spinner' }), 'Зареждане…'));
  dlg.showModal();
  let d;
  try {
    const r = await fetch(`api/hotel/${encodeURIComponent(x.hotelId)}`);
    if (!r.ok) throw new Error();
    d = await r.json();
  } catch {
    dlg.replaceChildren(dlg.firstChild, h('p', { class: 'error pad' }, 'Не успяхме да заредим информацията. Опитайте отново.'));
    return;
  }
  let i = 0;
  const big = h('img', { class: 'g-big', alt: `${x.name} – снимка 1` });
  const num = h('span', { class: 'g-num' });
  const thumbs = d.photos.map((p, k) => h('button', { type: 'button', class: 'g-thumb', 'aria-label': `Снимка ${k + 1}`, onclick: () => show(k) }, h('img', { src: p.thumb, alt: '', loading: 'lazy' })));
  const show = (k) => {
    i = (k + d.photos.length) % d.photos.length;
    big.src = d.photos[i].big;
    big.alt = `${x.name} – снимка ${i + 1}`;
    num.textContent = `${i + 1} / ${d.photos.length}`;
    thumbs.forEach((t, n) => t.classList.toggle('on', n === i));
    thumbs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const gallery = d.photos.length
    ? h('div', { class: 'gallery' },
        h('div', { class: 'g-stage' }, big,
          d.photos.length > 1 ? [h('button', { type: 'button', class: 'g-nav prev', 'aria-label': 'Предишна', onclick: () => show(i - 1) }, '‹'), h('button', { type: 'button', class: 'g-nav next', 'aria-label': 'Следваща', onclick: () => show(i + 1) }, '›'), num] : null),
        d.photos.length > 1 ? h('div', { class: 'g-strip' }, thumbs) : null)
    : null;
  dlg.onkeydown = (e) => {
    if (!d.photos.length) return;
    if (e.key === 'ArrowRight') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
  };
  dlg.replaceChildren(
    h('div', { class: 'b-head' }, h('div', null, h('h2', { id: 'info-title' }, x.name, x.stars ? h('span', { class: 'stars' }, ' ', '★'.repeat(x.stars)) : null), h('div', { class: 'area' }, areaName(x.area))), close),
    gallery,
    h('div', { class: 'info-text' },
      d.sections.map((s) => h('section', null, h('h3', null, s.title), h('p', null, s.text))),
      d.siteUrl ? h('p', null, h('a', { href: d.siteUrl, target: '_blank', rel: 'noopener' }, 'Виж хотела на сайта на Tours Club ↗')) : null));
  if (d.photos.length) show(0);
  close.focus(); // при презареждането фокусът излиза от прозореца – без това стрелките не работят
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today()) $('date').value = date;
  const setSel = (id, v) => v && [...$(id).options].some((o) => o.value === v) && ($(id).value = v);
  setSel('nights', q.get('nights'));
  setSel('adults', q.get('adults'));
  const ages = (q.get('childAges') || '').split(',').filter((x) => /^\d+$/.test(x) && Number(x) <= 17).slice(0, 3);
  $('children').value = String(ages.length);
  renderAges(null, ages);
  if (S.target && $('date').value) {
    const r = readForm();
    if (r.params) search(r.params);
  } else if (S.target && hotel) $('date').focus();
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
      field('Дата на раждане', { name: `g${i}-birth`, type: 'date', required: true, max: today() })));
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
    ...(form.elements[`g${i}-birth`] ? { birthDate: v(`g${i}-birth`) } : {}),
  }));
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
})();
