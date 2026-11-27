// Резервациите (засега ръчни): клиентът изпраща заявка, служител я прави в портала на доставчика.
// Файл data/bookings.json (не се качва в git – има лични данни):
//   { nextNo, bookings: [{ id, createdAt, status, public, contact, guests, note, internal }] }
// public   – това, което клиентът е видял и може да види пак (без доставчика);
// internal – доставчик, код на хотела, нетна цена, оригиналната оферта – само за служителите.
const fs = require('fs');
const path = require('path');

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];
// pending   – за потвърждение (служителят трябва да я направи при доставчика)
// confirmed – потвърдена от доставчика, клиентът получава ваучер
// rejected  – доставчикът я е отказал / няма места
// cancelled – анулирана

const STATUS_LABEL = { pending: 'за потвърждение', confirmed: 'потвърдена', rejected: 'отказана', cancelled: 'анулирана' };

// Разрешени смени на статуса
const NEXT = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['cancelled'],
  rejected: ['pending'], // повторен опит (напр. при друг доставчик)
  cancelled: [],
};

class BookingStore {
  constructor(file) {
    this.file = file;
    this.data = { nextNo: 1, bookings: [] };
    if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  create({ public: pub, contact, guests, note, internal }) {
    const b = {
      id: `TCB-${String(this.data.nextNo++).padStart(6, '0')}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      public: pub,
      contact,
      guests,
      note,
      internal,
      history: [{ at: new Date().toISOString(), status: 'pending', by: 'site' }],
    };
    this.data.bookings.push(b);
    this.save();
    return b;
  }

  get(id) {
    return this.data.bookings.find((b) => b.id === id) || null;
  }

  // Най-новите първи. q – търсене по номер, име/имейл/телефон, гост, хотел, номер при доставчика
  list({ status, q } = {}) {
    let all = status ? this.data.bookings.filter((b) => b.status === status) : this.data.bookings;
    const s = String(q || '').trim().toLowerCase();
    if (s) {
      all = all.filter((b) =>
        [b.id, b.contact.name, b.contact.email, b.contact.phone, b.public.hotelName, b.internal.supplierRef, ...b.guests.map((g) => `${g.firstName} ${g.lastName}`)]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(s))
      );
    }
    return [...all].reverse();
  }

  counts() {
    const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const b of this.data.bookings) out[b.status] = (out[b.status] || 0) + 1;
    return out;
  }

  // Смяна на статуса. За „потвърдена“ трябва номерът на резервацията при доставчика.
  setStatus(id, status, { by = '', supplierRef, comment } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Непознат статус ${status}`);
    const b = this.get(id);
    if (!b) throw new Error('Няма такава резервация');
    if (!NEXT[b.status].includes(status)) throw new Error(`Резервацията е „${STATUS_LABEL[b.status]}“ и не може да стане „${STATUS_LABEL[status]}“`);
    const ref = supplierRef == null ? '' : String(supplierRef).trim();
    if (status === 'confirmed' && !ref && !b.internal.supplierRef) throw new Error('Попълнете номера на резервацията при доставчика');
    b.status = status;
    if (ref) b.internal.supplierRef = ref; // номер на резервацията при доставчика
    b.history.push({ at: new Date().toISOString(), status, by, ...(ref ? { supplierRef: ref } : {}), ...(comment ? { comment: String(comment) } : {}) });
    this.save();
    return b;
  }

  // Вътрешна бележка, без смяна на статуса
  addComment(id, comment, { by = '' } = {}) {
    const b = this.get(id);
    if (!b) throw new Error('Няма такава резервация');
    const c = String(comment || '').trim();
    if (!c) throw new Error('Празен коментар');
    b.history.push({ at: new Date().toISOString(), by, comment: c });
    this.save();
    return b;
  }
}

module.exports = { BookingStore, STATUSES, STATUS_LABEL, NEXT };
