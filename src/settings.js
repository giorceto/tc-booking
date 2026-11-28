// Настройки, които се сменят от админа без рестарт: data/settings.json
//   hiddenAreas – курорти, които не се показват на сайта и не се търсят при операторите
//                 (по подразбиране Истанбул – ще се пусне по-късно)
//   markupPct   – надценка върху нетната цена на оператора, % (по подразбиране 13)
//   promoCodes  – промо кодове: [{ code, type: 'pct'|'eur', value, until, active, note, createdAt, by }]
const fs = require('fs');
const path = require('path');
const { promoValid, normCode } = require('./promo');

const DEFAULTS = { hiddenAreas: ['ISTANBUL'], markupPct: 13, promoCodes: [] };

class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    if (file && fs.existsSync(file)) this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    this.index();
  }

  index() {
    this.hidden = new Set((this.data.hiddenAreas || []).map((a) => String(a).toUpperCase()));
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  get markupPct() {
    const n = Number(this.data.markupPct);
    return Number.isFinite(n) ? n : DEFAULTS.markupPct;
  }

  // Надценка 0–100 %, до една десета; onChange (сървърът) я подава на търсачката веднага
  setMarkup(pct) {
    const raw = String(pct == null ? '' : pct).trim().replace(',', '.');
    const n = Math.round(Number(raw) * 10) / 10;
    if (!raw || !Number.isFinite(n) || n < 0 || n > 100) throw new Error('Надценката трябва да е число между 0 и 100 %');
    this.data.markupPct = n;
    this.save();
    if (this.onChange) this.onChange();
    return n;
  }

  // ---------- промо кодове ----------
  promos() {
    return this.data.promoCodes || [];
  }

  // Важащ днес промо код (без значение главни/малки) или null
  findPromo(code) {
    const c = normCode(code);
    const p = c && this.promos().find((x) => x.code === c);
    return promoValid(p) ? p : null;
  }

  addPromo(p, by = '') {
    if (this.promos().some((x) => x.code === p.code)) throw new Error(`Код ${p.code} вече има`);
    this.data.promoCodes = [...this.promos(), { ...p, createdAt: new Date().toISOString(), by }];
    this.save();
  }

  updatePromo(code, patch) {
    const p = this.promos().find((x) => x.code === normCode(code));
    if (!p) throw new Error('Няма такъв промо код');
    if ('active' in patch) p.active = Boolean(patch.active);
    this.save();
    return p;
  }

  removePromo(code) {
    const c = normCode(code);
    if (!this.promos().some((x) => x.code === c)) throw new Error('Няма такъв промо код');
    this.data.promoCodes = this.promos().filter((x) => x.code !== c);
    this.save();
  }

  isHidden(area) {
    return this.hidden.has(String(area || '').toUpperCase());
  }

  setHidden(area, hidden) {
    const a = String(area || '').trim().toUpperCase();
    if (!a) throw new Error('Няма курорт');
    const set = new Set(this.data.hiddenAreas.map((x) => String(x).toUpperCase()));
    if (hidden) set.add(a);
    else set.delete(a);
    this.data.hiddenAreas = [...set].sort();
    this.index();
    this.save();
  }
}

module.exports = { Settings };
