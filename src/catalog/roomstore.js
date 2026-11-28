// Стаите на хотелите при операторите и ръчните връзки между тях (админ → Стаи).
// data/rooms.json:
//   hotels: { H123: {
//     obs:   { <sig>: { op, room, roomType, roomCode, roomTypeCode, auto: { key, label }, seen } }  – наблюдавани в търсенията
//     map:   { <sig>: <key> }   – ръчно: тази стая на оператора е същата като стаята <key>
//     names: { <key>: 'име' }   – ръчно: нашето име на стаята
//     reviewedAt
//   } }
// <sig> = оператор + кодове + имена на стаята при него; <key> = ключ от roomInfo() (характеристики).
const fs = require('fs');
const path = require('path');
const { roomInfo, rawKey } = require('./rooms');

const sigOf = (o) => [o.op, o.roomCode, o.roomTypeCode, o.room, o.roomType].map((x) => (x == null ? '' : String(x))).join('|');

class RoomStore {
  constructor(file, { saveDelayMs = 30000 } = {}) {
    this.file = file;
    this.saveDelayMs = saveDelayMs;
    this.data = { hotels: {} };
    if (file && fs.existsSync(file)) this.data = { hotels: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    this.timer = null;
    this.refreshKeys();
  }

  // Разпознаването се подобрява с времето – при старт автоматичните ключове се смятат наново,
  // а ръчните връзки и имена към непознати стаи (raw|…) минават към новия вид на ключа
  refreshKeys() {
    const fix = (k) => (k && k.startsWith('raw|') ? rawKey(k.slice(4)) : k);
    for (const hm of Object.values(this.data.hotels)) {
      for (const ob of Object.values(hm.obs || {})) {
        const a = roomInfo(ob.room, ob.roomType);
        ob.auto = { key: a.key, label: a.label };
      }
      for (const sig of Object.keys(hm.map || {})) hm.map[sig] = fix(hm.map[sig]);
      hm.names = Object.fromEntries(Object.entries(hm.names || {}).map(([k, v]) => [fix(k), v]));
    }
  }

  hotel(id, create = false) {
    if (!this.data.hotels[id] && create) this.data.hotels[id] = { obs: {}, map: {}, names: {} };
    return this.data.hotels[id];
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  // наблюденията се записват на порции (търсенията са много)
  saveLater() {
    if (this.timer || !this.file) return;
    this.timer = setTimeout(() => this.save(), this.saveDelayMs);
    this.timer.unref();
  }

  // Име на стаята <key> в хотела: ръчното, иначе автоматичното от наблюдавана стая с този ключ
  labelOf(hm, key, fallback) {
    if (hm && hm.names && hm.names[key]) return hm.names[key];
    if (hm) for (const ob of Object.values(hm.obs)) if (ob.auto.key === key) return ob.auto.label;
    return fallback || key;
  }

  /** Стаята на офертата o (с o.op) в хотел hotelId: { key, label } */
  roomOf(hotelId, o) {
    const auto = roomInfo(o.room, o.roomType);
    const hm = this.hotel(hotelId);
    const key = (hm && hm.map[sigOf(o)]) || auto.key;
    return { key, label: this.labelOf(hm, key, auto.label) };
  }

  observe(hotelId, o) {
    const sig = sigOf(o);
    const hm = this.hotel(hotelId, true);
    const today = new Date().toISOString().slice(0, 10);
    const ob = hm.obs[sig];
    if (ob && ob.seen === today) return;
    const auto = roomInfo(o.room, o.roomType);
    hm.obs[sig] = { op: o.op, room: o.room || '', roomType: o.roomType || '', roomCode: o.roomCode || '', roomTypeCode: o.roomTypeCode || '', auto: { key: auto.key, label: auto.label }, first: (ob && ob.first) || today, seen: today };
    this.saveLater();
  }

  // ---------- за админа ----------
  // Стаите на хотела като таблица: редове = нашите стаи (ключове), колони = операторите
  table(hotelId) {
    const hm = this.hotel(hotelId);
    if (!hm) return null;
    const ops = [...new Set(Object.values(hm.obs).map((ob) => ob.op))].sort();
    const rows = new Map();
    for (const [sig, ob] of Object.entries(hm.obs)) {
      const key = hm.map[sig] || ob.auto.key;
      if (!rows.has(key)) rows.set(key, { key, label: this.labelOf(hm, key), custom: Boolean(hm.names[key]), cells: {} });
      const row = rows.get(key);
      (row.cells[ob.op] = row.cells[ob.op] || []).push({ sig, room: ob.room, roomType: ob.roomType, auto: ob.auto, manual: Boolean(hm.map[sig]), isNew: !hm.reviewedAt || ob.first > hm.reviewedAt.slice(0, 10) });
    }
    const list = [...rows.values()];
    // колко стаи са само при един от операторите – там най-често е разликата в имената
    const single = list.filter((r) => Object.keys(r.cells).length === 1).length;
    const raw = list.filter((r) => r.key.startsWith('raw|')).length;
    return { ops, rows: list.sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length || a.label.localeCompare(b.label)), single, raw, reviewedAt: hm.reviewedAt || null };
  }

  // Хотелите със стаи от поне 2 оператора, при които стаите не съвпадат напълно
  review({ state = 'todo' } = {}) {
    const out = [];
    for (const id of Object.keys(this.data.hotels)) {
      const t = this.table(id);
      if (!t || t.ops.length < 2) continue;
      const differs = t.single > 0 || t.raw > 0;
      const hasNew = t.rows.some((r) => Object.values(r.cells).some((c) => c.some((x) => x.isNew)));
      const todo = differs && hasNew;
      if ((state === 'todo' && !todo) || (state === 'done' && todo)) continue;
      out.push({ hotelId: id, ...t });
    }
    return out.sort((a, b) => b.single + b.raw - (a.single + a.raw));
  }

  setMap(hotelId, sig, key) {
    const hm = this.hotel(hotelId);
    if (!hm || !hm.obs[sig]) throw new Error('Няма такава стая');
    if (!key || key === hm.obs[sig].auto.key) delete hm.map[sig];
    else hm.map[sig] = key;
    this.save();
  }

  setName(hotelId, key, name) {
    const hm = this.hotel(hotelId);
    if (!hm) throw new Error('Няма такъв хотел');
    const n = String(name || '').trim().slice(0, 120);
    if (n) hm.names[key] = n;
    else delete hm.names[key];
    this.save();
  }

  setReviewed(hotelId) {
    const hm = this.hotel(hotelId);
    if (!hm) throw new Error('Няма такъв хотел');
    hm.reviewedAt = new Date().toISOString();
    this.save();
  }
}

module.exports = { RoomStore, sigOf };
