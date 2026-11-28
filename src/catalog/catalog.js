// Общ каталог на хотелите и връзките към кодовете при всеки оператор.
// data/catalog.json:
//   hotels: [{ id, name, area, links: { OP: { code, name, area, state: 'auto'|'check'|'ok', score } } }]
//   blocked: ["OP:CODE|H123", ...]  – двойки, които човек е разкачил и не трябва да се свързват отново
const fs = require('fs');
const path = require('path');
const { fingerprint, nameScore, normArea, parseStars } = require('./normalize');

const AUTO = 0.92; // над това – свързва автоматично
const CHECK = 0.74; // между CHECK и AUTO – свързва, но за проверка

class Catalog {
  constructor(file) {
    this.file = file;
    this.data = { hotels: [], blocked: [], nextId: 1, updatedAt: null };
    if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    this.index();
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    fs.renameSync(this.file + '.tmp', this.file);
    this.index();
  }

  index() {
    this.byId = new Map(this.data.hotels.map((h) => [h.id, h]));
    this.byLink = new Map(); // "OP:CODE" -> hotel
    for (const h of this.data.hotels) for (const [op, l] of Object.entries(h.links)) this.byLink.set(`${op}:${l.code}`, h);
    this.blocked = new Set(this.data.blocked);
  }

  newHotel(name, area) {
    const h = { id: `H${this.data.nextId++}`, name, area, links: {} };
    this.data.hotels.push(h);
    return h;
  }

  // Добавя хотелите на оператор. lists = { OP: [{code, name, area}] }, order = по-големите първо
  build(lists) {
    const stats = {};
    const ops = Object.keys(lists).sort((a, b) => lists[b].length - lists[a].length);
    const fp = new Map(); // кеш на отпечатъците на каталога
    // имената от непроверени връзки (check) дават най-много „за проверка“ – иначе следващият оператор
    // се връзва „автоматично“ към грешно име и грешката става верига (виж markChains)
    const fpOf = (h) => {
      if (!fp.has(h.id)) fp.set(h.id, [{ f: fingerprint(h.name), max: 1 }, ...Object.values(h.links).map((l) => ({ f: fingerprint(l.name), max: l.state === 'check' ? AUTO - 0.01 : 1 }))]);
      return fp.get(h.id);
    };

    for (const op of ops) {
      const st = (stats[op] = { total: lists[op].length, already: 0, auto: 0, check: 0, created: 0 });
      for (const oh of lists[op]) {
        if (!oh.code) continue;
        const existing = this.byLink.get(`${op}:${oh.code}`);
        if (existing) {
          // обновява името/курорта, ако операторът го е сменил
          Object.assign(existing.links[op], { name: oh.name, area: normArea(oh.area), category: oh.category || '' });
          this.applyCategory(existing, oh.category);
          st.already++;
          continue;
        }
        const f = fingerprint(oh.name);
        const area = normArea(oh.area);
        let best = null;
        let bestScore = 0;
        for (const h of this.data.hotels) {
          if (h.links[op]) continue; // вече има хотел от този оператор
          if (this.blocked.has(`${op}:${oh.code}|${h.id}`)) continue;
          let s = Math.max(...fpOf(h).map((x) => Math.min(x.max, nameScore(f, x.f))));
          if (s < CHECK - 0.1) continue;
          // еднакъв код при друг оператор (често при Sejour) – плюс
          if (Object.values(h.links).some((l) => l.code === oh.code)) s = Math.min(1, s + 0.08);
          // различен курорт – минус
          if (area && h.area && area !== h.area) s -= 0.15;
          if (s > bestScore) {
            bestScore = s;
            best = h;
          }
        }
        let target;
        let state;
        if (best && bestScore >= AUTO) {
          target = best;
          state = 'auto';
          st.auto++;
        } else if (best && bestScore >= CHECK) {
          target = best;
          state = 'check';
          st.check++;
        } else {
          target = this.newHotel(oh.name, area);
          state = 'ok';
          st.created++;
        }
        target.links[op] = { code: oh.code, name: oh.name, area, category: oh.category || '', state, score: Math.round(bestScore * 100) / 100 };
        this.applyCategory(target, oh.category);
        if (!target.area && area) target.area = area;
        fp.delete(target.id);
        this.byLink.set(`${op}:${oh.code}`, target);
      }
    }
    this.save();
    return stats;
  }

  // codes: false – без търсене по кода при оператора (за клиентския сайт, за да не се издават кодовете)
  search(q, limit = 30, { codes: byCode = true } = {}) {
    const s = String(q || '').trim().toUpperCase();
    let list = this.data.hotels;
    if (s) {
      const f = fingerprint(s);
      list = list
        .map((h) => {
          const names = [h.name, ...Object.values(h.links).map((l) => l.name)];
          const codes = byCode ? Object.values(h.links).map((l) => l.code) : [];
          let score = codes.includes(s) ? 2 : names.some((n) => n.toUpperCase().includes(s)) ? 1.5 : Math.max(...names.map((n) => nameScore(f, fingerprint(n))));
          return { h, score };
        })
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score || Object.keys(b.h.links).length - Object.keys(a.h.links).length)
        .map((x) => x.h);
    }
    return list.slice(0, limit);
  }

  get(id) {
    return this.byId.get(id);
  }

  review() {
    const out = [];
    for (const h of this.data.hotels) for (const [op, l] of Object.entries(h.links)) if (l.state === 'check') out.push({ hotel: h, op, link: l });
    return out.sort((a, b) => b.link.score - a.link.score);
  }

  confirm(id, op) {
    const h = this.get(id);
    if (!h || !h.links[op]) throw new Error('Няма такава връзка');
    h.links[op].state = 'ok';
    delete h.links[op].why;
    this.save();
    return h;
  }

  // Потвърждава няколко връзки наведнъж (ops празно – всички за проверка)
  confirmMany(id, ops) {
    const h = this.get(id);
    if (!h) throw new Error('Няма такъв хотел');
    const list = ops && ops.length ? ops : Object.keys(h.links).filter((op) => h.links[op].state === 'check');
    for (const op of list) {
      if (!h.links[op]) throw new Error(`Няма връзка към ${op}`);
      h.links[op].state = 'ok';
      delete h.links[op].why;
    }
    this.save();
    return h;
  }

  // Отделя няколко връзки в ЕДИН нов хотел (напр. три оператора с AQI PEGASOS RESORT, слети по грешка с ROYAL)
  split(id, ops) {
    const h = this.get(id);
    if (!h) throw new Error('Няма такъв хотел');
    if (!ops || !ops.length) throw new Error('Изберете поне една връзка');
    for (const op of ops) if (!h.links[op]) throw new Error(`Няма връзка към ${op}`);
    if (ops.length === Object.keys(h.links).length) throw new Error('Всички връзки са избрани – няма какво да остане в хотела');
    const first = h.links[ops[0]];
    const n = this.newHotel(first.name, first.area || h.area);
    for (const op of ops) {
      const l = h.links[op];
      delete h.links[op];
      this.data.blocked.push(`${op}:${l.code}|${h.id}`);
      const { why, ...rest } = l;
      n.links[op] = { ...rest, state: 'ok', score: 1 };
      this.applyCategory(n, l.category);
    }
    this.save();
    return n;
  }

  // Мести връзки към друг хотел от каталога (напр. ROYAL, вързан по грешка към WORLD -> към AQI PEGASOS ROYAL)
  move(id, ops, toId) {
    const h = this.get(id);
    const to = this.get(toId);
    if (!h || !to) throw new Error('Няма такъв хотел');
    if (h === to) throw new Error('Това е същият хотел');
    if (!ops || !ops.length) throw new Error('Изберете поне една връзка');
    for (const op of ops) {
      if (!h.links[op]) throw new Error(`Няма връзка към ${op}`);
      if (to.links[op]) throw new Error(`${to.id} вече има връзка към ${op} (${to.links[op].name}) – първо я отделете или проверете`);
    }
    for (const op of ops) {
      const { why, ...l } = h.links[op];
      delete h.links[op];
      this.data.blocked.push(`${op}:${l.code}|${h.id}`);
      this.data.blocked = this.data.blocked.filter((b) => b !== `${op}:${l.code}|${to.id}`);
      to.links[op] = { ...l, state: 'ok', score: 1 };
    }
    if (!Object.keys(h.links).length) this.data.hotels = this.data.hotels.filter((x) => x !== h);
    this.save();
    return to;
  }

  // Групата на избраните връзки – действията са за цялата група:
  //  - верижните, станали през тях (why: chain:<op>);
  //  - непроверените със същото име при друг оператор (почти сигурно същият хотел)
  withChain(id, ops) {
    const h = this.get(id);
    if (!h) return ops;
    const set = new Set(ops);
    const keys = new Set(ops.filter((op) => h.links[op]).map((op) => fingerprint(h.links[op].name).key));
    for (const [op, l] of Object.entries(h.links)) {
      if (l.state !== 'check') continue;
      if ((l.why && l.why.startsWith('chain:') && set.has(l.why.slice(6))) || keys.has(fingerprint(l.name).key)) set.add(op);
    }
    return [...set];
  }

  // Верижни връзки: автоматична (auto) връзка, която прилича само на име от НЕпроверена връзка,
  // а не на основното име и проверените – става „за проверка“ (why: chain:<оператор>).
  // Така грешка от една непроверена връзка не стига до търсачката през другите оператори.
  markChains() {
    let n = 0;
    for (const h of this.data.hotels) {
      const L = Object.entries(h.links);
      const checks = L.filter(([, l]) => l.state === 'check');
      if (!checks.length) continue;
      const trusted = [h.name, ...L.filter(([, l]) => l.state === 'ok').map(([, l]) => l.name)].map(fingerprint);
      for (const [, l] of L) {
        if (l.state !== 'auto') continue;
        const f = fingerprint(l.name);
        if (Math.max(...trusted.map((t) => nameScore(f, t))) >= AUTO) continue;
        const via = checks.find(([, k]) => nameScore(f, fingerprint(k.name)) >= AUTO);
        if (!via) continue;
        l.state = 'check';
        l.why = `chain:${via[0]}`;
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  // Разкачва хотела на оператора и го прави отделен хотел в каталога
  unlink(id, op) {
    const h = this.get(id);
    if (!h || !h.links[op]) throw new Error('Няма такава връзка');
    const l = h.links[op];
    delete h.links[op];
    this.data.blocked.push(`${op}:${l.code}|${h.id}`);
    const n = this.newHotel(l.name, l.area);
    n.links[op] = { ...l, state: 'ok', score: 1 };
    if (!Object.keys(h.links).length) this.data.hotels = this.data.hotels.filter((x) => x !== h);
    this.save();
    return n;
  }

  // Ръчно свързва хотел на оператор (op:code) към хотел от каталога.
  // Ако кодът е вързан другаде – мести го (празните записи се трият).
  // Ако хотелът вече има друг код при този оператор – старият става отделен хотел.
  link(id, op, oh) {
    const h = this.get(id);
    if (!h) throw new Error('Няма такъв хотел в каталога');
    if (!oh || !oh.code) throw new Error('Няма такъв хотел при оператора');
    const cur = this.byLink.get(`${op}:${oh.code}`);
    if (cur === h) {
      h.links[op].state = 'ok';
      this.save();
      return h;
    }
    if (cur) {
      delete cur.links[op];
      if (!Object.keys(cur.links).length) this.data.hotels = this.data.hotels.filter((x) => x !== cur);
    }
    if (h.links[op]) {
      const old = h.links[op];
      this.data.blocked.push(`${op}:${old.code}|${h.id}`);
      const n = this.newHotel(old.name, old.area);
      n.links[op] = { ...old, state: 'ok', score: 1 };
    }
    this.data.blocked = this.data.blocked.filter((b) => b !== `${op}:${oh.code}|${h.id}`);
    h.links[op] = { code: oh.code, name: oh.name, area: normArea(oh.area), state: 'ok', score: 1 };
    this.save();
    return h;
  }

  // Категория от списъка на оператора – звездите се вземат, ако хотелът още няма
  applyCategory(h, category) {
    if (h.starsManual) return;
    const c = parseStars(category);
    if (c.stars && (h.starsSrc !== 'list' || !h.stars)) {
      h.stars = c.stars;
      h.cat = c.label;
      h.starsSrc = 'list';
    } else if (!h.cat && c.label) h.cat = c.label;
  }

  // Запомня категорията (звезди) на хотела, видяна в оферта. Записва на диска до 30 с по-късно.
  noteCategory(id, cat) {
    const h = this.get(id);
    if (!h || h.starsManual || h.starsSrc === 'list' || !cat || (!cat.stars && !cat.label)) return;
    if (h.stars === (cat.stars || null) && h.cat === cat.label) return;
    if (h.stars && !cat.stars) return; // не губим звезди заради описание без цифра
    h.stars = cat.stars || null;
    h.cat = cat.label;
    h.starsSrc = 'offer';
    if (!this._saveT) this._saveT = setTimeout(() => { this._saveT = null; this.save(); }, 30000);
  }

  // Ръчно задаване на звезди (1–5); null = обратно на автоматично
  setStars(id, stars) {
    const h = this.get(id);
    if (!h) throw new Error('Няма такъв хотел');
    const n = stars === null || stars === '' ? null : Number(stars);
    if (n !== null && !(n >= 1 && n <= 5)) throw new Error('Звездите трябва да са от 1 до 5');
    if (n === null) {
      delete h.starsManual;
      h.stars = null;
      delete h.starsSrc;
      for (const l of Object.values(h.links)) this.applyCategory(h, l.category);
    } else {
      h.stars = n;
      h.starsManual = true;
    }
    this.save();
    return h;
  }

  rename(id, name) {
    const h = this.get(id);
    if (!h) throw new Error('Няма такъв хотел');
    const n = String(name || '').trim();
    if (!n) throw new Error('Празно име');
    h.name = n;
    this.save();
    return h;
  }

  // Слива два хотела от каталога (from -> into)
  merge(fromId, intoId) {
    const from = this.get(fromId);
    const into = this.get(intoId);
    if (!from || !into || from === into) throw new Error('Невалидни хотели');
    for (const op of Object.keys(from.links)) if (into.links[op]) throw new Error(`И двата хотела имат връзка към ${op} – първо разкачете едната`);
    for (const [op, l] of Object.entries(from.links)) into.links[op] = { ...l, state: 'ok' };
    this.data.hotels = this.data.hotels.filter((x) => x !== from);
    this.save();
    return into;
  }

  stats() {
    const byCount = {};
    for (const h of this.data.hotels) {
      const n = Object.keys(h.links).length;
      byCount[n] = (byCount[n] || 0) + 1;
    }
    return { hotels: this.data.hotels.length, byOperatorCount: byCount, toCheck: this.review().length, updatedAt: this.data.updatedAt };
  }
}

module.exports = Catalog;
