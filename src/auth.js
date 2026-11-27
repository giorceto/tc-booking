// Вход за служителите (админ): потребители със scrypt хеш в data/users.json, сесии в паметта.
//
//   node src/auth.js add <име> [парола]     добавя потребител или сменя паролата (без парола – пита)
//   node src/auth.js remove <име>
//   node src/auth.js list
//
// data/users.json не се качва в git. Сесиите се губят при рестарт – служителите влизат пак.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_IDLE_MS = 12 * 3600 * 1000; // без действие 12 часа -> изход
const SESSION_MAX_MS = 7 * 24 * 3600 * 1000; // най-много 7 дни, после вход отново
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 10; // толкова грешни пароли за 15 мин (от едно IP или за едно име) -> временно спиране

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const hash = crypto.scryptSync(String(password), salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(got, expected);
}

// за непознато име – сравняваме с измислен хеш, за да отнеме същото време (не се разбира кои имена съществуват)
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));

class Users {
  constructor(file) {
    this.file = file;
  }

  load() {
    if (!fs.existsSync(this.file)) return {};
    return JSON.parse(fs.readFileSync(this.file, 'utf8')).users || {};
  }

  save(users) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ users }, null, 1), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  add(name, password) {
    name = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(name)) throw new Error('Името: 2–32 знака, латински букви, цифри, . _ -');
    if (String(password || '').length < 10) throw new Error('Паролата трябва да е поне 10 знака');
    const users = this.load();
    const existed = Boolean(users[name]);
    users[name] = { hash: hashPassword(password), createdAt: (users[name] && users[name].createdAt) || new Date().toISOString(), changedAt: new Date().toISOString() };
    this.save(users);
    return existed ? 'changed' : 'added';
  }

  remove(name) {
    const users = this.load();
    if (!users[name]) throw new Error('Няма такъв потребител');
    delete users[name];
    this.save(users);
  }

  list() {
    return Object.keys(this.load()).sort();
  }

  // Връща името при вярна парола, иначе null
  check(name, password) {
    name = String(name || '').trim().toLowerCase();
    const u = this.load()[name];
    const ok = verifyPassword(password, u ? u.hash : DUMMY);
    return ok && u ? name : null;
  }
}

class Sessions {
  constructor() {
    this.map = new Map(); // token -> { user, createdAt, seenAt }
    setInterval(() => this.cleanup(), 10 * 60000).unref();
  }

  create(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.map.set(token, { user, createdAt: now, seenAt: now });
    return token;
  }

  get(token) {
    const s = token && this.map.get(token);
    if (!s) return null;
    const now = Date.now();
    if (now - s.seenAt > SESSION_IDLE_MS || now - s.createdAt > SESSION_MAX_MS) {
      this.map.delete(token);
      return null;
    }
    s.seenAt = now;
    return s;
  }

  destroy(token) {
    this.map.delete(token);
  }

  // изход на всички сесии на потребител (напр. след смяна на паролата)
  destroyUser(user) {
    for (const [t, s] of this.map) if (s.user === user) this.map.delete(t);
  }

  cleanup() {
    for (const t of [...this.map.keys()]) this.get(t);
  }
}

// Брои грешните опити за вход по ключ (IP и име)
class LoginGuard {
  constructor({ max = FAIL_MAX, windowMs = FAIL_WINDOW_MS } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.fails = new Map(); // ключ -> [време на всеки грешен опит]
  }

  recent(key) {
    const now = Date.now();
    const list = (this.fails.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.fails.set(key, list);
    else this.fails.delete(key);
    return list;
  }

  blocked(...keys) {
    return keys.some((k) => this.recent(k).length >= this.max);
  }

  fail(...keys) {
    for (const k of keys) this.fails.set(k, [...this.recent(k), Date.now()]);
  }

  reset(...keys) {
    for (const k of keys) this.fails.delete(k);
  }
}

module.exports = { Users, Sessions, LoginGuard, hashPassword, verifyPassword };

// ---------- команден ред ----------
if (require.main === module) {
  const { ROOT } = require('./config');
  const users = new Users(path.join(ROOT, 'data', 'users.json'));
  const [cmd, name, pass] = process.argv.slice(2);

  // Пита за парола, без да я показва на екрана (и без да остава в историята на командите)
  async function askPassword() {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl._writeToOutput = () => {}; // въведеното не се показва на екрана
    rl.on('SIGINT', () => {
      process.stdout.write('\n');
      process.exit(130);
    });
    const lines = rl[Symbol.asyncIterator](); // пази редовете, ако дойдат наведнъж (напр. през pipe)
    const ask = async (q) => {
      process.stdout.write(q);
      const { value, done } = await lines.next();
      process.stdout.write('\n');
      if (done) throw new Error('Не е въведена парола');
      return value;
    };
    try {
      const a = await ask('Парола: ');
      if ((await ask('Още веднъж: ')) !== a) throw new Error('Паролите не съвпадат');
      return a;
    } finally {
      rl.close();
    }
  }

  (async () => {
    if (cmd === 'add' && name) {
      const p = pass || (await askPassword());
      const r = users.add(name, p);
      console.log(r === 'added' ? `Добавен: ${name.toLowerCase()}` : `Сменена парола: ${name.toLowerCase()} (рестартирайте услугата, за да излязат старите сесии)`);
    } else if (cmd === 'remove' && name) {
      users.remove(name.toLowerCase());
      console.log(`Изтрит: ${name.toLowerCase()} (излиза от админа веднага)`);
    } else if (cmd === 'list') {
      console.log(users.list().join('\n') || '(няма потребители)');
    } else {
      console.log('Употреба:\n  node src/auth.js add <име> [парола]\n  node src/auth.js remove <име>\n  node src/auth.js list');
      process.exit(1);
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
