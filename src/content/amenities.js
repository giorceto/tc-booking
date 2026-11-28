// Удобства на хотела, извлечени от описанието на нашия сайт (раздели „Разположение“, „На територията“, „Плаж“…).
// Само по ключови думи – затова са подредени по важност и се показват като „удобства“, не като обещание.
// \b не работи с кирилица – границите на думите са с \p{L} (флаг u).
const W = (s) => new RegExp(`(?<!\\p{L})(?:${s})`, 'giu');

// key – за иконата на страницата; label – текстът; test – по целия текст или само по раздел (section)
const RULES = [
  { key: 'beach', label: 'Собствен плаж', test: W('собствен(?:ия|ият|а)?[\\s,]+(?:[\\p{L}-]+[\\s,]+){0,2}плаж|частен\\s+плаж|own\\s+beach') },
  { key: 'sea', label: 'На брега на морето', test: W('на\\s+(?:самия\\s+)?бряг(?:а)?\\s+на\\s+морето|на\\s+(?:самия\\s+)?морския\\s+бряг|първа\\s+линия|първата\\s+линия|непосредствено\\s+(?:до|на)\\s+(?:морето|плажа)') },
  { key: 'sand', label: 'Пясъчен плаж', test: W('пясъч') },
  { key: 'pool', label: 'Открит басейн', test: W('открит\\p{L}*\\s+(?:\\p{L}+\\s+)?басейн|басейн\\p{L}*\\s+на\\s+открито|басейн') },
  { key: 'indoor', label: 'Закрит басейн', test: W('закрит\\p{L}*\\s+(?:\\p{L}+\\s+)?басейн|вътреш\\p{L}*\\s+басейн|басейн\\p{L}*\\s+на\\s+закрито') },
  { key: 'slides', label: 'Водни пързалки', test: W('водн\\p{L}*\\s+пързалк|пързалк|аквапарк|аква\\s*парк|aqua\\s*park') },
  { key: 'spa', label: 'СПА център', test: W('(?:спа|spa)[\\s-]*(?:&\\s*wellness\\s+)?(?:център|центъра|centre|center|зона|комплекс|процедури|услуги|салон)|уелнес|wellness') },
  { key: 'steam', label: 'Хамам и сауна', test: W('хамам|турска\\s+баня|сауна|парна\\s+баня') },
  { key: 'fitness', label: 'Фитнес', test: W('фитнес|fitness|gym(?!\\p{L})') },
  { key: 'kids', label: 'Детски клуб', test: W('детск\\p{L}*\\s+клуб|мини[\\s-]?клуб|mini[\\s-]?club|kids?\\s+club') },
  { key: 'animation', label: 'Анимация', test: W('анимаци') },
  { key: 'alacarte', label: 'Ресторанти а ла карт', test: W('а\\s?ла\\s?карт|à\\s?la\\s?carte|a\\s?la\\s?carte') },
  { key: 'wifi', label: 'Wi-Fi', test: W('wi[\\s-]?fi|безжичен\\s+интернет|безжична\\s+интернет|интернет') },
  { key: 'tennis', label: 'Тенис корт', test: W('тенис\\s+корт|тенис(?!\\s+на\\s+маса)') },
  { key: 'watersports', label: 'Водни спортове', test: W('водни\\s+(?:видове\\s+)?спорт') },
  { key: 'golf', label: 'Голф', test: W('голф|golf') },
  { key: 'disco', label: 'Дискотека', test: W('дискотек|нощен\\s+клуб|night\\s?club') },
  // хотелът е само за възрастни – не „зона/част/ресторант само за възрастни“ в хотел за семейства
  { key: 'adults', label: 'Само за възрастни', test: W('(?:хотел\\p{L}*|комплекс\\p{L}*)\\s+(?:е\\s+)?(?:само|единствено)\\s+за\\s+възрастни|(?:хотел\\p{L}*|комплекс\\p{L}*)\\s+(?:приема|настанява)\\s+(?:само\\s+)?гости\\s+над\\s+1[2-8]|adults?\\s+only'), name: /ADULTS?\s*ONLY|\+\s*1[68](?!\d)|(?<!\d)1[68]\s*\+/i },
  { key: 'accessible', label: 'Стаи за хора с увреждания', test: W('(?:стаи|помещения)[^.]{0,40}(?:двигателни\\s+затруднения|увреждания|инвалидна\\s+количка)|улеснен\\s+достъп|специално\\s+оборудвани\\s+стаи') },
  { key: 'parking', label: 'Паркинг', test: W('паркинг|parking') },
];

// Отрицание в същото изречение точно преди думата: „не е подходящ за … инвалидна количка“, „няма басейн“
const NEG = /(?<!\p{L})(?:не\s+(?:е|са|се|разполага|предлага)|няма|без)(?!\p{L})[^.!?\n]{0,40}$/iu;

function found(re, text) {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (!NEG.test(before)) return true;
  }
  return false;
}

/**
 * @param {{title:string, text:string}[]} sections
 * @param {string} [name] името на хотела – „ADULTS ONLY“ често е само в него
 * @returns {{key:string, label:string}[]} по реда в RULES
 */
function amenities(sections, name = '') {
  const text = (sections || []).map((s) => `${s.title}: ${s.text}`).join('\n');
  if (!text) return [];
  const out = [];
  for (const r of RULES) if ((r.name && r.name.test(name)) || found(r.test, text)) out.push({ key: r.key, label: r.label });
  // „пясъчен“ без „собствен“ – само „Пясъчен плаж“; и двете – един ред
  const has = (k) => out.some((x) => x.key === k);
  if (has('beach') && has('sand')) {
    out.find((x) => x.key === 'beach').label = 'Собствен пясъчен плаж';
    out.splice(out.findIndex((x) => x.key === 'sand'), 1);
  }
  // закрит басейн без открит – „басейн“ не значи открит
  if (has('indoor') && has('pool') && !found(W('открит\\p{L}*\\s+(?:\\p{L}+\\s+)?басейн|басейн\\p{L}*\\s+на\\s+открито'), text)) {
    const p = out.find((x) => x.key === 'pool');
    p.label = 'Басейни';
  }
  return out;
}

module.exports = { amenities, RULES };
