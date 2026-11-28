// Настройки, които се сменят от админа без рестарт: data/settings.json
//   hiddenAreas – курорти, които не се показват на сайта и не се търсят при операторите
//                 (по подразбиране Истанбул – ще се пусне по-късно)
const fs = require('fs');
const path = require('path');

const DEFAULTS = { hiddenAreas: ['ISTANBUL'] };

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
