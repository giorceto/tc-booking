// Чете хотел от нашия сайт (tours-club.com): име, звезди, държава, курорт, снимки, описание по раздели, координати.
// Страницата е https://www.tours-club.com/h/<id>/<slug>.html; списъкът с хотели е в sitemap.xml
// (адреси хотел/<slug>/<оферта>/<id>/ – един хотел се среща в много оферти).
const { parseStars } = require('../catalog/normalize');

const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', euro: '€', ndash: '–', mdash: '—', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', hellip: '…', deg: '°' };
const decode = (s) =>
  String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

// HTML -> обикновен текст с нови редове на мястото на <br>, <p>, <li>
function htmlText(html) {
  return decode(
    String(html || '')
      .replace(/\r/g, '')
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      /* някои блокове на сайта не са валиден JSON (коментари) – прескачаме ги */
    }
  }
  return out;
}

// Име без звездите в края: "LIMAK ARCADIA SPORT RESORT HOTEL 5*" -> "LIMAK ARCADIA SPORT RESORT HOTEL"
const stripStars = (name) => String(name || '').replace(/\s+(\d\s*\*+|\d\+?\s*\*|HV\s*-?\s*[12])\s*$/i, '').trim();

/**
 * @param {string} html  страницата h/<id>/<slug>.html
 * @param {string} base  адресът на сайта, напр. https://www.tours-club.com
 * @returns {null | { siteId, name, stars, country, locality, url, image, photos:[{big,thumb}], sections:[{title,text}], lat, lon, rating, reviews }}
 */
function parseHotelPage(html, base) {
  const ld = jsonLd(html);
  const hotel = ld.find((x) => x && x['@type'] === 'Hotel');
  if (!hotel) return null;
  const url = String(hotel.url || '');
  const idm = url.match(/\/h\/(\d+)\//);
  if (!idm) return null;
  const siteId = idm[1];
  const abs = (p) => new URL(p, base.replace(/\/?$/, '/')).href;

  // снимки: галерията (data-lightbox-gallery), само на този хотел – файлът завършва на <10 цифри време><id>
  const own = new RegExp(`_\\d{10}${siteId}\\.(jpe?g|png|webp)$`, 'i');
  const seen = new Set();
  const photos = [];
  const add = (p) => {
    const rel = p.replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
    if (!/^img\/OBEKTI\//.test(rel) || !own.test(rel) || seen.has(rel)) return;
    seen.add(rel);
    // без BIG_ е по-малката снимка (~40 KB срещу ~300 KB) – за картите в резултатите
    photos.push({ big: abs(rel), thumb: abs(rel.replace(/\/BIG_/, '/')) });
  };
  if (hotel.image) add(String(hotel.image));
  for (const m of html.matchAll(/data-lightbox-gallery="[^"]*"\s+href="([^"]+)"/g)) add(m[1]);
  if (photos.length < 2) for (const m of html.matchAll(/img\/OBEKTI\/BIG_[^"')\s]+/g)) add(m[0]);

  // описание: <h3 class="day">Заглавие:</h3>текст … до картата или „Актуални почивки към …“
  const sections = [];
  const start = html.indexOf('offer-text-containt');
  if (start >= 0) {
    let body = html.slice(start);
    const ends = [/<a name=["']?map/i, /<h3 class="day">\s*Карта/i, /<h2 class="antetka-2">/i].map((re) => body.search(re)).filter((i) => i > 0);
    if (ends.length) body = body.slice(0, Math.min(...ends));
    const parts = body.split(/<h3 class="day">/i).slice(1);
    for (const p of parts) {
      const i = p.indexOf('</h3>');
      if (i < 0) continue;
      const title = htmlText(p.slice(0, i)).replace(/:\s*$/, '');
      const text = htmlText(p.slice(i + 5));
      if (title && text) sections.push({ title, text });
    }
  }

  const map = html.match(/hotelmap\.php\?LAT=(-?[\d.]+)&(?:amp;)?LON=(-?[\d.]+)/i);
  const product = ld.find((x) => x && x['@type'] === 'Product' && x.aggregateRating);
  const rating = product ? Number(product.aggregateRating.ratingValue) || null : null;
  const reviews = product ? Number(product.aggregateRating.reviewCount) || 0 : 0;
  const rawName = decode(hotel.name);

  return {
    siteId,
    name: stripStars(rawName),
    stars: parseStars(rawName.match(/(\d\s*\*+|HV\s*-?\s*[12])\s*$/i)?.[0] || '').stars,
    country: decode((hotel.address && hotel.address.addressCountry) || ''),
    locality: decode((hotel.address && hotel.address.addressLocality) || ''),
    url,
    image: photos[0] || null,
    photos,
    sections,
    lat: map ? Number(map[1]) : null,
    lon: map ? Number(map[2]) : null,
    rating,
    reviews,
  };
}

// sitemap.xml -> [{ siteId, slug }] (без повторения)
function parseSitemap(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    let u;
    try {
      u = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const x = u.match(/\/хотел\/([^/]+)\/\d+\/(\d+)\/?$/);
    if (x && !out.has(x[2])) out.set(x[2], { siteId: x[2], slug: x[1] });
  }
  return [...out.values()];
}

// Адресът на страницата на хотела
const hotelUrl = (base, { siteId, slug }) => `${base.replace(/\/$/, '')}/h/${siteId}/${encodeURIComponent(slug).replace(/%2A/gi, '*')}.html`;

module.exports = { parseHotelPage, parseSitemap, hotelUrl, htmlText, stripStars };
