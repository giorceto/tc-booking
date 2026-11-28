// Проверява входа при всички доставчици от тази машина:  npm run selftest
// (IP адресът на сървъра трябва да е разрешен при доставчика – виж docs/operators.md)
const { operators } = require('../src/config');
const { ADAPTERS } = require('../src/suppliers');

(async () => {
  for (const op of operators) {
    const name = op.name.padEnd(14);
    if (!op.enabled) {
      console.log(`  --  ${name} не е настроен (липсва: ${op.missing.join(', ')})`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await ADAPTERS[op.type](op).test();
      console.log(`  OK  ${name} ${Date.now() - t0} ms  ${(r.messages || []).join('; ')}`);
    } catch (e) {
      console.log(`  XX  ${name} ${e.name === 'TimeoutError' ? 'не отговаря (възможно е IP-то да не е разрешено)' : e.message}`);
    }
  }
})();
