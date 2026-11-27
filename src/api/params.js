// Проверка на входа от сайта (търсене и резервация).
// Грешките са HttpError(400) с текст, който може да се покаже на клиента.

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg) => new HttpError(400, msg);

const MAX_NIGHTS = 30;
const MAX_ADULTS = 6;
const MAX_CHILDREN = 3; // правило от Summer Tour, ползваме го навсякъде (docs/pricing-rules.md)
const MAX_CHILD_AGE = 17;
const MAX_DAYS_AHEAD = 730;

// Днешна дата в България (YYYY-MM-DD)
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' });

function int(v, name, min, max, def) {
  if (v == null || v === '') {
    if (def !== undefined) return def;
    throw bad(`Липсва ${name}`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name}: очаква се цяло число от ${min} до ${max}`);
  return n;
}

function parseDate(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('Датата трябва да е във формат ГГГГ-ММ-ДД');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw bad('Невалидна дата');
  const t = today();
  if (s < t) throw bad('Датата на настаняване е минала');
  const max = new Date(`${t}T00:00:00Z`);
  max.setUTCDate(max.getUTCDate() + MAX_DAYS_AHEAD);
  if (d > max) throw bad('Датата е твърде далеч напред');
  return s;
}

function parseChildAges(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  if (list.length > MAX_CHILDREN) throw bad(`Най-много ${MAX_CHILDREN} деца`);
  return list.map((x) => int(String(x).trim(), 'възраст на дете', 0, MAX_CHILD_AGE));
}

// query: { area | hotel, date, nights, adults, childAges: "5,9" }
function parseSearch(q) {
  const area = String(q.area || '').trim();
  const hotel = String(q.hotel || '').trim();
  if (!area === !hotel) throw bad('Изберете курорт или хотел');
  if (hotel && !/^H\d+$/.test(hotel)) throw bad('Невалиден хотел');
  return {
    area: area || null,
    hotel: hotel || null,
    params: {
      date: parseDate(q.date),
      nights: int(q.nights, 'нощувки', 1, MAX_NIGHTS, 7),
      adults: int(q.adults, 'възрастни', 1, MAX_ADULTS, 2),
      childAges: parseChildAges(q.childAges),
    },
  };
}

const str = (v, name, { max = 200, required = true } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (!s && required) throw bad(`Липсва ${name}`);
  if (s.length > max) throw bad(`${name}: най-много ${max} знака`);
  return s;
};

// body: { offerKey, expectedPrice, contact: {name, email, phone}, guests: [{firstName, lastName, birthDate?}], note? }
// expected = { adults, children } от търсенето – броят на гостите трябва да съвпада
function parseBooking(body, expected) {
  if (!body || typeof body !== 'object') throw bad('Празна заявка');
  const expectedPrice = Number(body.expectedPrice);
  if (!(expectedPrice > 0)) throw bad('Липсва цената, която клиентът е видял (expectedPrice)');
  const c = body.contact || {};
  const contact = {
    name: str(c.name, 'име за контакт'),
    email: str(c.email, 'имейл', { max: 254 }),
    phone: str(c.phone, 'телефон', { max: 40 }),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw bad('Невалиден имейл');
  if (!/^[+\d][\d\s()./-]{5,}$/.test(contact.phone)) throw bad('Невалиден телефон');
  const guests = Array.isArray(body.guests) ? body.guests : [];
  const need = expected.adults + expected.children;
  if (guests.length !== need) throw bad(`Попълнете имената на всички гости (${need})`);
  const parsedGuests = guests.map((g, i) => {
    const out = { firstName: str(g && g.firstName, `име на гост ${i + 1}`, { max: 60 }), lastName: str(g && g.lastName, `фамилия на гост ${i + 1}`, { max: 60 }) };
    const bd = str(g && g.birthDate, `дата на раждане на гост ${i + 1}`, { max: 10, required: false });
    if (bd) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bd)) throw bad(`Дата на раждане на гост ${i + 1}: формат ГГГГ-ММ-ДД`);
      out.birthDate = bd;
    }
    return out;
  });
  return { expectedPrice, contact, guests: parsedGuests, note: str(body.note, 'бележка', { max: 1000, required: false }) };
}

module.exports = { HttpError, parseSearch, parseBooking, today };
