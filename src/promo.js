// Промо кодове: отстъпка от продажната цена (в % или в €). Смята се САМО на сървъра.
// Цената с промо код никога не е под нетната цена на оператора – иначе продаваме на загуба
// (напр. 15 % промо при 13 % надценка).

const CODE_RE = /^[A-ZА-Я0-9][A-ZА-Я0-9_-]{2,19}$/u;
const normCode = (c) => String(c || '').trim().toUpperCase();

const promoLabel = (p) => (p.type === 'pct' ? `−${p.value}%` : `−${p.value} €`);

// Днешна дата в България (ГГГГ-ММ-ДД)
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' });

// Важи ли днес: активен и (без краен срок или срокът не е минал)
const promoValid = (p) => Boolean(p) && p.active !== false && (!p.until || p.until >= today());

/**
 * @param {number} sell  продажна цена (с надценката), цели евро
 * @param {number} net   нетна цена на оператора
 * @param {{type:'pct'|'eur', value:number}} promo
 * @returns {number} цена с отстъпката, цели евро (нагоре), не под нетната
 */
function promoPrice(sell, net, promo) {
  let p = promo.type === 'pct' ? sell * (1 - promo.value / 100) : sell - promo.value;
  p = Math.ceil(Math.round(p * 100) / 100);
  const floor = Math.ceil(Number(net) || 0);
  return Math.min(sell, Math.max(p, floor));
}

// Проверка на нов промо код от админа
function parsePromo(body) {
  const code = normCode(body && body.code);
  if (!CODE_RE.test(code)) throw new Error('Кодът: 3–20 знака, букви (латиница или кирилица), цифри, - и _');
  const type = body.type === 'eur' ? 'eur' : 'pct';
  const value = Math.round(Number(String(body.value ?? '').replace(',', '.')) * 100) / 100;
  if (!(value > 0) || (type === 'pct' && value > 50) || (type === 'eur' && value > 2000)) {
    throw new Error(type === 'pct' ? 'Отстъпката в % трябва да е между 0 и 50' : 'Отстъпката в € трябва да е между 0 и 2000');
  }
  let until = null;
  const u = String(body.until || '').trim();
  if (u) {
    const m = u.match(/^(\d{2})\.(\d{2})\.(\d{4})$/) || u.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error('Валиден до: дд.мм.гггг');
    until = m[0].includes('.') ? `${m[3]}-${m[2]}-${m[1]}` : m[0];
    const d = new Date(`${until}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== until) throw new Error('Невалидна дата');
  }
  return { code, type, value, until, active: body.active !== false, note: String(body.note || '').trim().slice(0, 200) };
}

module.exports = { promoPrice, promoLabel, promoValid, parsePromo, normCode };
