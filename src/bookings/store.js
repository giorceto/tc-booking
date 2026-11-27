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

  list({ status } = {}) {
    const all = status ? this.data.bookings.filter((b) => b.status === status) : this.data.bookings;
    return [...all].reverse();
  }

  setStatus(id, status, { by = '', supplierRef, comment } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Непознат статус ${status}`);
    const b = this.get(id);
    if (!b) throw new Error('Няма такава резервация');
    b.status = status;
    if (supplierRef !== undefined) b.internal.supplierRef = supplierRef; // номер на резервацията при доставчика
    b.history.push({ at: new Date().toISOString(), status, by, ...(comment ? { comment } : {}) });
    this.save();
    return b;
  }
}

module.exports = { BookingStore, STATUSES };
