// Експорт на договорени цени от Summer Tour (Sedna) в XML формата на Tours Club (като IRE-SEAMAR-S27-*.xml).
// Правила: без цени за повече от 3 деца; само ранни записвания (EB), изтеклите отпадат, началото на текущия е днес.

const MAX_CHILDREN = 3;

const d10 = (s) => (s ? String(s).slice(0, 10) : '');
const dmy = (s) => {
  const x = d10(s);
  return x ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : '';
};
const todayIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const num = (v) => {
  const r = Math.round(Number(v) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};
const x = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Име на настаняването: DOUBLE ROOM / SINGLE ROOM / DOUBLE ROOM+EXTRA BED / N PAX / A+N CHD (b-e,99) ...
function accName(a, roomName) {
  const ad = Number(a.Adult) || 0;
  const ch = Number(a.Child) || 0;
  if (ch === 0) {
    if (/FAM/i.test(roomName) || ad >= 4) return `${ad} PAX`;
    return { 1: 'SINGLE ROOM', 2: 'DOUBLE ROOM', 3: 'DOUBLE ROOM+EXTRA BED' }[ad] || `${ad} PAX`;
  }
  const ages = (a.ChildAge || []).filter(Boolean).slice().sort((p, q) => q.End - p.End || q.Begin - p.Begin); // по-голямата възраст първо
  const txt = ages.map((g) => `(${Number(g.Begin)}-${Number(g.End)},99)`).join(' ');
  return `${ad}+${ch} CHD${txt ? ' ' + txt : ''}`;
}

// Най-новият активен договор (по начална дата)
function pickContract(contracts, id) {
  const list = (contracts || []).filter((c) => c && !c.IsCancel);
  if (id) {
    const c = list.find((c) => String(c.RecId) === String(id));
    if (c) return c;
  }
  return list.sort((a, b) => String(b.BeginDate).localeCompare(String(a.BeginDate)))[0] || null;
}

function build(hotel, contract, packets) {
  const rooms = new Map(); // име стая -> Map(настаняване -> Map(начало -> [от, до, цена]))
  for (const a of contract.Accommodations || []) {
    if (!a) continue;
    if ((Number(a.Child) || 0) > MAX_CHILDREN) continue;
    if (a.Period_Type && !/accom/i.test(a.Period_Type)) continue;
    const rn = ((hotel.rooms || {})[a.RoomType] || a.RoomType || '').trim();
    const an = accName(a, rn);
    if (!rooms.has(rn)) rooms.set(rn, new Map());
    const accs = rooms.get(rn);
    if (!accs.has(an)) accs.set(an, new Map());
    accs.get(an).set(d10(a.PeriodBegin), [dmy(a.PeriodBegin), dmy(a.PeriodEnd), Number(a.Price)]);
  }
  const today = todayIso();
  const eb = (packets || [])
    .filter((p) => p && String(p.ContractId) === String(contract.RecId) && !p.IsCancel && Number(p.PacketType) === 1 && Number(p.Percent) > 0)
    .filter((p) => d10(p.SalesDateEnd) >= today)
    .map((p) => {
      const from = d10(p.SalesDateBegin) > today ? d10(p.SalesDateBegin) : today;
      const nb = Number(p.StayDayBegin) || 0;
      const ne = Number(p.StayDayEnd) || 0;
      return {
        sort: from,
        name: p.PacketName || '',
        ResFrom: dmy(from),
        ResTo: dmy(p.SalesDateEnd),
        StayFrom: dmy(p.StayDateBegin),
        StayTo: dmy(p.StayDateEnd),
        Discount: `${num(p.Percent)}%`,
        Nights: ne >= 255 || ne === 0 ? `${nb}-999` : `${nb}-${ne}`,
      };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort));
  return { rooms, eb };
}

// Windows-1251 (както е в примерния файл)
const CP1251_EXTRA = { 0x401: 0xa8, 0x451: 0xb8, 0x2116: 0xb9, 0x404: 0xaa, 0x454: 0xba, 0x406: 0xb2, 0x456: 0xb3, 0x407: 0xaf, 0x457: 0xbf, 0x2013: 0x96, 0x2014: 0x97, 0x201c: 0x93, 0x201d: 0x94, 0x2019: 0x92, 0x20ac: 0x88 };
function toCp1251(str) {
  const out = Buffer.alloc(str.length);
  let i = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out[i++] = c;
    else if (c >= 0x410 && c <= 0x44f) out[i++] = c - 0x350;
    else if (CP1251_EXTRA[c]) out[i++] = CP1251_EXTRA[c];
    else out[i++] = 0x3f; // ?
  }
  return out.subarray(0, i);
}

function toXml(hotel, contract, built, { samoId = '', remote = 'SUM', resort = '', category = '' } = {}) {
  const boards = (contract.Boards || []).map((b) => (hotel.boards || {})[b] || String(b));
  const L = [];
  L.push('<?xml version="1.0" encoding="windows-1251" ?>');
  L.push('<Hotels>');
  L.push(`\t<Hotel SamoID="${x(samoId)}" Remote="${x(remote)}" Code="${x(hotel.code)}" Name="${x(String(hotel.name || '').trim())}" Category="${x(category)}" Location="${x(resort)}" Currency="EUR">`);
  L.push(`\t\t<ContractData SeasonFrom="${dmy(contract.BeginDate)}" SeasonTo="${dmy(contract.EndDate)}"></ContractData>`);
  L.push('\t\t<Discounts>');
  for (const e of built.eb)
    L.push(`\t \t\t<EB ResFrom="${e.ResFrom}" ResTo="${e.ResTo}" StayFrom="${e.StayFrom}" StayTo="${e.StayTo}" Discount="${e.Discount}" BoardType="ALL" RoomType="ALL" Type="Stay" Nights="${e.Nights}"></EB>`);
  L.push('\t\t</Discounts>');
  L.push('\t\t<Rooms>');
  for (const [rn, accs] of built.rooms) {
    L.push(`\t\t\t<Room Type="${x(rn)}" Board="${x(boards.join(', '))}">`);
    for (const [an, periods] of accs) {
      L.push(`\t\t\t\t<Accommodation Type="${x(an)}">`);
      for (const k of [...periods.keys()].sort()) {
        const [f, t, v] = periods.get(k);
        L.push(`\t\t\t \t\t<Price DateFrom="${f}" DateTo="${t}" Value="${num(v)}"></Price>`);
      }
      L.push('\t\t\t\t</Accommodation>');
    }
    L.push('\t\t\t</Room>');
  }
  L.push('\t\t</Rooms>');
  L.push('\t</Hotel>');
  L.push('</Hotels>');
  return toCp1251(L.join('\r\n') + '\r\n');
}

function fileName(remote, code, contract) {
  const season = 'S' + String(contract.BeginDate || '').slice(2, 4);
  const clean = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${clean(remote)}-${clean(code)}-${season}-${todayIso()}.xml`;
}

module.exports = { pickContract, build, toXml, fileName, accName, MAX_CHILDREN };
