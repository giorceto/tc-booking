// Регистър на доставчиците: създава клиент за всеки настроен оператор от .env.
// Всеки клиент има един и същ интерфейс (виж docs/suppliers.md):
//   test(), hotels(), search({hotel,date,nights,adults,childAges}),
//   normalize(raw[, date, nights]), raw(path, body), limiterStatus(), limiterWaitMs()
// Sejour има още regions(), searchRegion(); Sedna има searchMany(), contracts(), packets().
const { operators } = require('../config');

const ADAPTERS = {
  sejour: require('./sejour'),
  sedna: require('./sedna'),
};

function createSuppliers(list = operators) {
  const clients = {};
  for (const op of list) {
    if (!op.enabled) continue;
    const make = ADAPTERS[op.type];
    if (!make) {
      console.warn(`  ! ${op.id}: непознат тип "${op.type}" (очаква се sejour или sedna)`);
      continue;
    }
    const c = make(op);
    c.id = op.id;
    c.name = op.name;
    clients[op.id] = c;
  }
  return clients;
}

module.exports = { createSuppliers, ADAPTERS };
