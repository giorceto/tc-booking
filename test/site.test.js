// Проверки на кода на страниците (без браузър)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { RULES } = require('../src/content/amenities');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('replaceChildren само през fill() – иначе null става текст „null“ в страницата', () => {
  for (const f of ['site/static/site.js', 'admin/static/app.js']) {
    const lines = read(f).split('\n').filter((l) => l.includes('replaceChildren(') && !l.includes('const fill =') && !l.trim().startsWith('//'));
    assert.deepStrictEqual(lines, [], f);
  }
});

test('имената на удобствата във филтъра са като на сървъра', () => {
  const js = read('site/static/site.js');
  const block = js.slice(js.indexOf('const AMEN_LABEL = {'), js.indexOf('};', js.indexOf('const AMEN_LABEL = {')));
  const fromSite = Object.fromEntries([...block.matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepStrictEqual(fromSite, Object.fromEntries(RULES.map((r) => [r.key, r.label])));
});

test('картата: без innerHTML и без външни библиотеки', () => {
  const js = read('site/static/map.js');
  assert.ok(!/innerHTML/.test(js));
  assert.ok(!/import\s|require\(/.test(js));
  const html = read('site/static/index.html');
  assert.ok(html.indexOf('map.js') < html.indexOf('site.js'), 'map.js се зарежда преди site.js');
  assert.ok(html.includes('<!--MAP-->'));
});
