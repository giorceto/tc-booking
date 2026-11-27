// Кирилица -> латиница по Закона за транслитерацията (като в българските паспорти).
// „-ия“ в края на дума става „-ia“: Мария -> Maria, София -> Sofia.
const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y',
  ю: 'yu', я: 'ya', ё: 'yo', ы: 'y', э: 'e',
};

const isUpper = (c) => Boolean(c) && c !== c.toLowerCase();

function toLatin(s) {
  return String(s || '')
    .replace(/ия(?=$|[^а-яё])/gi, (m) => (m[0] === 'И' ? 'I' : 'i') + (m[1] === 'Я' ? 'A' : 'a'))
    .replace(/[а-яё]/gi, (c, i, str) => {
      const lo = c.toLowerCase();
      const t = MAP[lo];
      if (t == null) return c;
      if (c === lo) return t;
      // Ж в дума с главни букви -> ZH (ЖИВКО -> ZHIVKO), иначе Zh (Живко -> Zhivko)
      if (t.length > 1 && (isUpper(str[i + 1]) || (!/[a-zа-яё]/i.test(str[i + 1] || '') && isUpper(str[i - 1])))) return t.toUpperCase();
      return t.charAt(0).toUpperCase() + t.slice(1);
    });
}

module.exports = { toLatin };
