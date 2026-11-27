// Нормализиране на имена на хотели, курорти, изхранване и стаи,
// за да се сравняват данни от различни оператори.

const TR = { İ: 'I', I: 'I', ı: 'I', Ş: 'S', ş: 'S', Ğ: 'G', ğ: 'G', Ü: 'U', ü: 'U', Ö: 'O', ö: 'O', Ç: 'C', ç: 'C', Â: 'A', â: 'A', Î: 'I', î: 'I', Û: 'U', û: 'U' };
const translit = (s) => String(s || '').replace(/[İIıŞşĞğÜüÖöÇçÂâÎîÛû]/g, (c) => TR[c] || c).toUpperCase();

// Думи, които не помагат да се различат хотелите
const STOP = new Set([
  'HOTEL', 'HOTELS', 'OTEL', 'OTELI', 'RESORT', 'RESORTS', 'SPA', 'AND', 'THE', 'BY', 'ADULT', 'ADULTS', 'ONLY',
  'ALL', 'INCLUSIVE', 'ULTRA', 'FAMILY', 'APART', 'APARTS', 'SUITE', 'SUITES', 'WELLNESS', 'THALASSO', 'COLLECTION',
  'DE', 'LUXE', 'DELUXE', 'BOUTIQUE', 'CONCEPT', 'NEW', 'NOT', 'AI', 'UAI', 'HV', 'HV1', 'CLASS', 'STAR', 'STARS',
]);

function cleanName(name) {
  let s = translit(name);
  s = s.replace(/\((?:[^()]*)\)/g, ' '); // (EX. ...), (+16 ADULT ONLY)
  s = s.replace(/\bEX\.?\s.*$/, ' '); // EX. СТАРО ИМЕ без скоби
  s = s.replace(/\+\s*\d+/g, ' '); // +16
  s = s.replace(/&/g, ' ');
  s = s.replace(/['’‘`´]/g, ''); // CITY'S -> CITYS, L'OCEANICA -> LOCEANICA
  s = s.replace(/[^A-Z0-9 ]+/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function tokens(name) {
  return cleanName(name)
    .split(' ')
    .filter((t) => t && !STOP.has(t) && !/^\d{1,2}$/.test(t));
}

function trigrams(str) {
  const s = ` ${str} `;
  const out = new Set();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

const dice = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};

// Подготвя "отпечатък" на хотел за бързо сравнение
function fingerprint(name) {
  const tk = tokens(name);
  const key = tk.join(' ');
  return { key, tok: new Set(tk), tri: trigrams(key) };
}

// 0..1 – колко си приличат две имена
function nameScore(fa, fb) {
  if (!fa.key || !fb.key) return 0;
  if (fa.key === fb.key) return 1;
  // същото, писано слято/разделено: SEASIDE = SEA SIDE, MAR-BAS = MARBAS
  if (fa.key.replace(/ /g, '') === fb.key.replace(/ /g, '')) return 0.96;
  const t = dice(fa.tok, fb.tok);
  const c = dice(fa.tri, fb.tri);
  // всички думи на по-краткото име се съдържат в по-дългото
  const [small, big] = fa.tok.size <= fb.tok.size ? [fa.tok, fb.tok] : [fb.tok, fa.tok];
  let contained = small.size >= 2;
  for (const x of small) if (!big.has(x)) contained = false;
  return Math.max(t, c * 0.97, contained ? 0.9 : 0);
}

// Курорти – еднакви имена при различните оператори
const AREA_ALIAS = {
  ANTALYA: 'ANTALYA', LARA: 'ANTALYA', KUNDU: 'ANTALYA', BELEK: 'BELEK', KADRIYE: 'BELEK', BOGAZKENT: 'BELEK',
  SIDE: 'SIDE', MANAVGAT: 'SIDE', KIZILOT: 'SIDE', KIZILAGAC: 'SIDE', EVRENSEKI: 'SIDE', COLAKLI: 'SIDE', KUMKOY: 'SIDE', SORGUN: 'SIDE', TITREYENGOL: 'SIDE', ILICA: 'SIDE',
  ALANYA: 'ALANYA', KONAKLI: 'ALANYA', AVSALLAR: 'ALANYA', INCEKUM: 'ALANYA', OKURCALAR: 'ALANYA', TURKLER: 'ALANYA', MAHMUTLAR: 'ALANYA', KARGICAK: 'ALANYA', OBA: 'ALANYA',
  KEMER: 'KEMER', BELDIBI: 'KEMER', GOYNUK: 'KEMER', KIRIS: 'KEMER', CAMYUVA: 'KEMER', TEKIROVA: 'KEMER', CIRALI: 'KEMER',
  BODRUM: 'BODRUM', MARMARIS: 'MARMARIS', ICMELER: 'MARMARIS', FETHIYE: 'FETHIYE', OLUDENIZ: 'FETHIYE', GOCEK: 'FETHIYE', DALAMAN: 'DALAMAN', SARIGERME: 'DALAMAN',
  KUSADASI: 'KUSADASI', DIDIM: 'DIDIM', CESME: 'CESME', IZMIR: 'IZMIR', AYVALIK: 'AYVALIK', ISTANBUL: 'ISTANBUL', KAPADOKYA: 'KAPADOKYA', CAPPADOCIA: 'KAPADOKYA',
};
function normArea(a) {
  const s = translit(a).replace(/[^A-Z ]/g, ' ').trim();
  if (!s) return '';
  for (const w of s.split(/\s+/)) if (AREA_ALIAS[w]) return AREA_ALIAS[w];
  return s;
}

// Група на изхранването
function boardGroup(code, name) {
  const s = `${translit(code)} ${translit(name)}`;
  if (/ULTRA|ULTIMATE|UALL|\bUAI\b|\bUTAI\b|\bULAI\b|\bULTA\b|DELUXE ALL|PREMIUM ALL|HIGH CLASS ALL|\bHCAI\b|EXCLUSIVE ALL/.test(s)) return 'UAI';
  if (/ALL INC|\bAI\b|\bALL\b|ALLINC/.test(s)) return 'AI';
  if (/FULL BOARD PLUS|\bFB\+|\bFBP\b/.test(s)) return 'FB+';
  if (/FULL BOARD|\bFB\b/.test(s)) return 'FB';
  if (/HALF BOARD PLUS|\bHB\+|\bHBP\b/.test(s)) return 'HB+';
  if (/HALF BOARD|\bHB\b/.test(s)) return 'HB';
  if (/BED.*BREAKFAST|BREAKFAST|\bBB\b/.test(s)) return 'BB';
  if (/ROOM ONLY|ONLY ROOM|ONLY BED|\bRO\b|\bOB\b|\bSC\b|SELF CATER/.test(s)) return 'RO';
  return translit(code) || '?';
}

const BOARD_LABEL = { UAI: 'Ultra All Inclusive', AI: 'All Inclusive', 'FB+': 'Full Board+', FB: 'Full Board', 'HB+': 'Half Board+', HB: 'Half Board', BB: 'Закуска', RO: 'Само нощувка' };

// Груба група на стаята
function roomGroup(...names) {
  const s = translit(names.filter(Boolean).join(' '));
  if (/VILLA/.test(s)) return 'Вила';
  if (/SUIT/.test(s)) return 'Суит';
  if (/FAM|DUBLEX|DUPLEX|CONNECT|INTERCON|2 BEDROOM|TWO BEDROOM/.test(s)) return 'Фамилна';
  if (/DELUX|DLX/.test(s)) return 'Делукс';
  if (/SUPER|SUP\b|PREMIUM/.test(s)) return 'Супериор';
  return 'Стандартна';
}

const seaView = (...names) => /SEA|DENIZ|SSV|SV\b/.test(translit(names.filter(Boolean).join(' ')));

// Категория на хотела -> { stars: 1..5 | null, label }
function parseStars(cat) {
  const raw = String(cat || '').trim();
  if (!raw) return { stars: null, label: '' };
  const s = translit(raw);
  if (/\bHV\s*-?\s*1\b|HOLIDAY VILLAGE 1|\b1\.?\s*SINIF/.test(s)) return { stars: 5, label: raw };
  if (/\bHV\s*-?\s*2\b|HOLIDAY VILLAGE 2|\b2\.?\s*SINIF/.test(s)) return { stars: 4, label: raw };
  let m =
    s.match(/(?:^|[^A-Z0-9])([1-5])\s*(?:\*|STAR|YILDIZ|YLDZ|\+|SUP|PLUS|S\b|$)/) ||
    s.match(/^\s*([1-5])\b/) ||
    s.match(/^\s*([1-5])[A-Z*+]*\s*$/) ||
    s.match(/(?:STAR|YILDIZ)\s*([1-5])\b/);
  if (m) return { stars: Number(m[1]), label: raw };
  m = s.match(/\b(FIVE|FOUR|THREE|TWO)\b/);
  if (m) return { stars: { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2 }[m[1]], label: raw };
  return { stars: null, label: raw };
}

module.exports = {
  parseStars, translit, cleanName, fingerprint, nameScore, normArea, boardGroup, BOARD_LABEL, roomGroup, seaView };
