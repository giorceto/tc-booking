// Имена на договорите по хотел и оператор (за таб "Цени").
// Кеш в data/contracts/<OP>.json; обновява се на заден план (бутон или всяка нощ).
const fs = require('fs');
const path = require('path');

// S27 = окончателен; C27 / R27 = roll-over; W26 = зимен.
function classify(name) {
  const n = String(name || '').trim().toUpperCase();
  if (/^[CR]\d{2}\b/.test(n) || /ROLL[\s-]?OVER/.test(n)) return 'rollover';
  if (/^S\d{2}\b/.test(n) || /\b(FINAL|KESIN)\b/.test(n)) return 'final';
  if (/^W\d{2}\b/.test(n) || /^WINTER\b/.test(n)) return 'winter';
  return '';
}
const isWinter = (c) => classify(c.name) === 'winter';

// Договорът, който ни интересува: най-новият летен (по начална дата), иначе най-новият изобщо
function latest(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const by = (a, b) => String(b.begin).localeCompare(String(a.begin));
  return [...list.filter((c) => !isWinter(c))].sort(by)[0] || [...list].sort(by)[0];
}

class Contracts {
  constructor(dir, getClient) {
    this.dir = dir;
    this.getClient = getClient;
    this.mem = {};
    this.jobs = {}; // op -> { running, done, total, startedAt, error }
    fs.mkdirSync(dir, { recursive: true });
  }
  file(op) {
    return path.join(this.dir, `${op}.json`);
  }
  get(op) {
    if (!this.mem[op]) {
      const f = this.file(op);
      this.mem[op] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { at: null, hotels: {} };
    }
    return this.mem[op];
  }
  save(op) {
    fs.writeFileSync(this.file(op), JSON.stringify(this.get(op)));
  }
  status(op) {
    const j = this.jobs[op] || {};
    return { running: !!j.running, done: j.done || 0, total: j.total || 0, error: j.error || '', at: this.get(op).at };
  }
  // keys: Id-та (Sedna) или кодове (Sejour)
  refresh(op, keys) {
    const job = this.jobs[op];
    if (job && job.running) return this.status(op);
    const j = (this.jobs[op] = { running: true, done: 0, total: keys.length, startedAt: Date.now(), error: '' });
    const data = this.get(op);
    (async () => {
      const c = this.getClient(op);
      const step = 10;
      for (let i = 0; i < keys.length; i += step) {
        const part = keys.slice(i, i + step);
        try {
          const r = await c.contractNames(part);
          for (const [k, v] of Object.entries(r)) if (v) data.hotels[k] = v;
        } catch (e) {
          j.error = e.message;
        }
        j.done = Math.min(keys.length, i + step);
        if (j.done % 50 === 0) this.save(op);
      }
      data.at = new Date().toISOString();
      this.save(op);
      j.running = false;
    })().catch((e) => {
      j.error = e.message;
      j.running = false;
    });
    return this.status(op);
  }
}

module.exports = { Contracts, classify, latest };
