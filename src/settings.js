// Настройки, които се сменят от админа без рестарт: data/settings.json
//   hiddenAreas – курорти, които не се показват на сайта и не се търсят при операторите
//                 (по подразбиране Истанбул – ще се пусне по-късно)
//   markupPct   – надценка върху нетната цена на оператора, % (по подразбиране 13)
const fs = require('fs');
const path = require('path');

const DEFAULTS = { hiddenAreas: ['ISTANBUL'], markupPct: 13 };

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
