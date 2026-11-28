// Стаите на хотела – характеристики от името при оператора, за да се сравняват между операторите.
// Операторите пишат една и съща стая различно:
//   Summer (Sedna):  room = „SUPERIOR ROOM SEA VIEW“
//   Sejour:          room = „DOUBLE ROOM“, roomType = „SUPERIOR SEA VIEW“
// Еднакви характеристики (вид + ниво + изглед + особености) = една и съща стая -> един ключ и
// наше име на български (името на оператора е характерно и издава кой е).
const { translit } = require('./normalize');

// Вид на помещението (първото съвпадение печели)
const TYPES = [
  ['villa', /VILLA/],
  ['bungalow', /BUNGALOW/],
  ['penthouse', /PENTHOUSE/],
  ['residence', /RESIDENCE/],
  ['house', /(?<!PENT)HOUSE/],
  ['studio', /STUDIO/],
  ['suite', /SUIT/], // SUITE, SUIT
  ['family', /FAMIL|\bFAM\b|DUBLEX|DUPLEX|CONNECT|INTERCON|\b2\s*BEDROOM|TWO\s*BEDROOM|2\s*ROOMS?\b|\bAPART/],
  ['room', /./],
];
// Ниво
const LEVELS = [
  ['economy', /ECONOM|\bECO\b|BUDGET|SMALL|MINI\b/],
  ['promo', /PROMO|OPPORTUNITY|SPECIAL\s+ROOM/],
  ['superior', /SUPERIOR|\bSUP\b|\bSUPR?\b/],
  ['deluxe', /DELUX|\bDLX\b|\bDLUX\b/],
  ['premium', /PREMIUM|PRESTIGE|ELITE|EXCLUSIVE|LUXURY|\bLUX\b/],
  ['club', /\bCLUB\b/],
  ['large', /LARGE|BIG\b|SPACIOUS/],
  ['junior', /JUNIOR|\bJR\b/],
  ['king', /\bKING\b/],
  ['grand', /\bGRAND\b/],
  ['executive', /EXECUTIVE/],
  ['presidential', /PRESIDENT/],
  ['royal', /ROYAL/],
  ['senior', /SENIOR/],
  ['comfort', /COMFORT/],
  ['standard', /STANDARD|\bSTD\b|\bSTANDART\b|CLASSIC|\bDOUBLE\b|\bDBL\b|\bTWIN\b|\bTRPL?\b|TRIPLE|\bSGL\b|SINGLE/],
];
// Изглед
const VIEWS = [
  ['sidesea', /SIDE\s*SEA|PARTIAL\s*SEA|PARTLY\s*SEA|LATERAL\s*SEA|\bSSV\b|\bPSV\b/],
  ['sea', /SEA\s*VIEW|SEAVIEW|SEA\s*FRONT|SEAFRONT|SEA\s*SIDE|SEASIDE|\bSV\b|DENIZ|\bSEA\b/],
  ['pool', /POOL\s*VIEW|\bPV\b|POOL\s*SIDE|POOL\s+(?:AND\s+)?SEA\s*VIEW/],
  ['garden', /(?<!PRIVATE\s)GARDEN|\bGV\b|PARK\s*VIEW/],
  ['lake', /\bLAKE\b/],
  ['golf', /\bGOLF\b/],
  ['river', /RIVER/],
  ['mountain', /MOUNTAIN|\bMV\b|FOREST|NATURE|\bHILL\b/],
  ['land', /LAND\s*VIEW|\bLV\b|LAND\b|CITY\s*VIEW|STREET|INLAND/],
];
// Особености (всички, които ги има)
const FEATURES = [
  ['swimup', /SWIM\s*-?\s*UP(?:\s+SHAR\w*\s+POOL)?|SWIMUP|POOL\s*ACCESS/],
  ['duplex', /DUBLEX|DUPLEX|LOFT|MAISONET/],
  ['bunk', /BUNK/],
  ['nobalcony', /WITHOUT\s+BALCON|NO\s+BALCON|W\/O\s+BALCON/],
  ['jacuzzi', /JACUZZ|JAKUZ|WHIRLPOOL/],
  ['annex', /ANNEX|ANEX\b|\bEK\s*BINA/],
  ['main', /MAIN\s*BUILD|\bMB\b/],
  ['connected', /CONNECT|INTERCON/],
  ['onebed', /\b1\s*BEDROOM|ONE\s*BEDROOM/],
  ['twobed', /\b2\s*BEDROOM|TWO\s*BEDROOM|2\s*ROOMS?\b|\b2\s*BDR/],
  ['threebed', /\b3\s*BEDROOM|THREE\s*BEDROOM/],
  ['privatepool', /PRIVATE\s+(?:SWIMMING\s+)?POOL|OWN\s+POOL|WITH\s+(?:JACUZZI\s+(?:&\s*|AND\s+)?)?POOL\b|(?:&|AND)\s*POOL\b(?!\s*(?:&\s*)?\w*\s*VIEW)/],
  ['privategarden', /PRIVATE\s+GARDEN/],
  ['plus', /\bPLUS\b/],
  ['famsuite', /FAMIL\w*\s+(?:\w+\s+){0,2}SUIT|SUIT\w*\s+FAMIL/],
  ['lagoon', /LAGOON|LAGUNA/],
  ['corner', /CORNER/],
  ['honeymoon', /HONEYMOON|ROMANTI/],
  ['roof', /\bROOF/],
  ['kids', /CHI?LD\s*FRIENDLY|CHD\s*FRIENDLY|KIDS?\s*(?:ROOM|CONCEPT|FRIENDLY)|CHILD\s*DISCOUNT/],
  ['adults', /ADULTS?\s*ONLY|ONLY\s*ADULTS?|ADULTS?\s*ZONE|\+\s*1[68]/],
  ['roh', /\bROH\b|RUN\s+OF\s+(THE\s+)?HOUSE/],
];

// Думи без значение за вида на стаята: брой легла, съединителни думи, балкон (почти всички имат)
const IGNORE = /\b(?:ROOMS?|ODA|DOUBLE|DBL|TWIN|SINGLE|SGL|TRIPLE|TRPL?|QUAD|USE|WITH|AND|OR|THE|OF|IN|ON|FOR|VIEW|BALCONY|BALKON|BALCONIES|TERRACE|BED|BEDS|BEDROOMS?|BATHROOMS?|PERSON|PAX|ADULTS?|ADULT|CHILD|CHD|NEW|TYPE|CATEGORY|HOTEL|RESORT|BUILDING|BLOCK|FLOOR|GROUND|UPPER|LOWER|AREA|SECTION|UNIT|NO|STANDART|SIDE|DIRECT|ACCESS|FRONT|FRENCH|ZONE|ONLY|HIGH|STAIRS|DOOR|ENTRANCE|BEACH|SHARED|SHARING|ADJOINING|VIEWS|PARTIAL)\b|\b[A-Z]{1,3}\b|\d+/g;

const TYPE_BG = { villa: 'Вила', bungalow: 'Бунгало', penthouse: 'Пентхаус', residence: 'Резиденция', house: 'Къща', studio: 'Студио', suite: 'Суит', family: 'Фамилна стая', room: 'Стая' };
const LEVEL_BG = {
  economy: 'Икономична', promo: 'Промо', superior: 'Супериорна', deluxe: 'Делукс', premium: 'Премиум', club: 'Клубна',
  large: 'Голяма', junior: 'Джуниър', king: 'Кинг', comfort: 'Комфорт', standard: 'Стандартна',
  grand: 'Гранд', executive: 'Екзекютив', presidential: 'Президентски', royal: 'Кралски', senior: 'Сениър',
};
const VIEW_BG = {
  sea: 'с изглед към морето', sidesea: 'със страничен изглед към морето', pool: 'с изглед към басейна',
  garden: 'с изглед към градината', mountain: 'с изглед към планината', land: 'с изглед към сушата',
  lake: 'с изглед към езерото', golf: 'с изглед към голф игрището', river: 'с изглед към реката',
};
const FEATURE_BG = {
  swimup: 'с достъп до басейна (swim-up)', duplex: 'на две нива', bunk: 'с двуетажно легло', nobalcony: 'без балкон',
  jacuzzi: 'с джакузи', annex: 'в допълнителната сграда', main: 'в основната сграда', connected: 'свързани стаи',
  onebed: 'с 1 спалня', twobed: 'с 2 спални', threebed: 'с 3 спални', roh: 'по избор на хотела',
  privatepool: 'с частен басейн', lagoon: 'с достъп до лагуна', corner: 'ъглова', honeymoon: 'за младоженци',
  roof: 'на покрива', kids: 'подходяща за деца', adults: 'само за възрастни', privategarden: 'с частна градина',
};

const first = (list, s) => (list.find(([, re]) => re.test(s)) || [null])[0];

/**
 * @returns {{ key: string, label: string, type, level, view, features: string[], known: boolean }}
 * key – еднакъв за една и съща стая при различните оператори; known – разпознато ли е нещо освен „стая“
 */
// Разпознаването е с много регулярни изрази, а при търсене по курорт стаите са хиляди – помним резултата
const cache = new Map();
function roomInfo(room, roomType) {
  const ck = `${room || ''}\u0001${roomType || ''}`;
  let r = cache.get(ck);
  if (!r) {
    r = recognize(room, roomType);
    if (cache.size > 20000) cache.clear();
    cache.set(ck, r);
  }
  return r;
}

// Само брой легла/хора – не казва коя е стаята
const OCCUPANCY = /\b(?:ROOMS?|ODA|DOUBLE|DBL|TWIN|SINGLE|SGL|TRIPLE|TRPL?|QUAD)\b/g;
const clean = (x) => translit(x).replace(/[^A-Z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Името от двете полета: Summer често дава едно и също и в двете („COLONEL SUITE“ / „COLONEL SUITE“),
// Sejour – „DOUBLE ROOM“ + вида („COLONEL SUITE“), където „DOUBLE ROOM“ е само брой легла
function joinNames(room, roomType) {
  const a = clean(room);
  const b = clean(roomType);
  if (!b || a.includes(b)) return a;
  if (!a || b.includes(a)) return b;
  if (!a.replace(OCCUPANCY, ' ').trim()) return b;
  return `${a} ${b}`;
}

// Ключът на непозната стая – без думите за брой легла: „DOUBLE ROOM COLONEL SUITE“ = „COLONEL SUITE“
function rawKey(s) {
  return `raw|${clean(s).replace(OCCUPANCY, ' ').replace(/\s+/g, ' ').trim() || clean(s)}`;
}

function recognize(room, roomType) {
  const s = joinNames(room, roomType);
  const type = first(TYPES, s);
  let level = first(LEVELS, s);
  const view = first(VIEWS, s);
  const features = FEATURES.filter(([, re]) => re.test(s)).map(([k]) => k);
  // „стандартна“ е по подразбиране – DOUBLE/TWIN не са ниво, а брой легла
  if (!level) level = 'standard';
  // остатък след разпознатите думи: ако има значима непозната дума (HONEYMOON, TERRACE, LAKE HOUSE…),
  // стаята е особена – собствен ключ, не се слива с друга (служител може да я върже в админа)
  // разпознатите думи се махат по позициите си в оригиналното име (иначе едно правило „изяжда“ част от друго)
  const mask = new Array(s.length).fill(false);
  for (const [, re] of [...TYPES.filter(([k]) => k !== 'room'), ...LEVELS, ...VIEWS, ...FEATURES]) {
    for (const m of s.matchAll(new RegExp(re.source, 'g'))) for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
  }
  const rest = [...s].map((c, i) => (mask[i] ? ' ' : c)).join('')
    .replace(IGNORE, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (rest.length) return { key: rawKey(s), label: s, type: 'room', level: null, view: null, features: [], known: false, rest };
  const key = [type, level, view || '-', ...features.sort()].join('|');

  // име на български
  let name;
  if (type === 'room') name = `${LEVEL_BG[level]} стая`;
  else if (type === 'family') name = level === 'standard' ? 'Фамилна стая' : `${LEVEL_BG[level]} фамилна стая`;
  else if (type === 'suite') {
    const suite = features.includes('famsuite') ? 'фамилен суит' : 'суит';
    name = level === 'standard' ? suite.replace(/^ф/, 'Ф').replace(/^с/, 'С') : `${LEVEL_BG[level].replace(/на$/, 'ен').replace(/ична$/, 'ичен')} ${suite}`;
  }
  else if (level === 'standard') name = TYPE_BG[type];
  else {
    // род: вила/къща/резиденция – женски; бунгало/студио – среден; пентхаус – мъжки
    const g = { villa: 'f', house: 'f', residence: 'f', bungalow: 'n', studio: 'n', penthouse: 'm' }[type];
    const adj = LEVEL_BG[level];
    const form = g === 'f' ? adj : g === 'n' ? adj.replace(/на$/, 'но').replace(/ична$/, 'ично') : adj.replace(/на$/, 'ен').replace(/ична$/, 'ичен');
    name = `${form} ${TYPE_BG[type].toLowerCase()}`;
  }
  if (features.includes('plus')) name += ' плюс';
  const parts = [name];
  if (view) parts.push(VIEW_BG[view]);
  const feats = features.filter((f) => FEATURE_BG[f]).map((f) => FEATURE_BG[f]);
  const label = [parts.join(' '), ...feats].join(', ').replace(/^(\p{L})/u, (c) => c.toUpperCase());
  return { key, label, type, level, view: view || null, features, known: true };
}

module.exports = { roomInfo, rawKey };
