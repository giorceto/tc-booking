// Модул за операторите на Sejour (SAN TSG) – REST API v2.
// Документация: http://docs.santsg.com/sejour/v2/
const Limiter = require('./limiter');

module.exports = function sejour(op) {
  const limiter = new Limiter(op.ratePerMin);
  let token = null;
  let tokenAt = 0;

  const msgs = (j) => (j && j.Messages ? j.Messages.map((m) => `${m.Code}: ${m.Description}`) : []);

  async function post(path, body, auth, timeoutMs) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${op.url}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs || op.timeoutMs),
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${r.status} (не е JSON): ${text.slice(0, 200)}`);
    }
    return { status: r.status, json };
  }

  async function login() {
    const { json } = await post(
      'Authentication/Login',
      { DatabaseName: op.db, UserCode: op.user, Password: op.pass, Language: 'en-US' },
      false
    );
    const t = json.Body || json.Token;
    if (!t || typeof t !== 'string') throw new Error(`Неуспешен вход: ${msgs(json).join('; ') || 'няма токен'}`);
    token = t;
    tokenAt = Date.now();
    return msgs(json);
  }

  // Вика метод от API-то; при изтекъл токен влиза отново веднъж.
  async function call(path, body, timeoutMs) {
    if (!token || Date.now() - tokenAt > 50 * 60 * 1000) await login();
    let res = await post(path, body, true, timeoutMs);
    if (res.status === 401) {
      await login();
      res = await post(path, body, true, timeoutMs);
    }
    return res.json;
  }

  // Оферта от Sejour -> общ формат
  const norm = (o) => ({
    hotelCode: o.HotelCode,
    hotelName: o.HotelName,
    region: o.RegionName,
    category: o.CategoryCode,
    room: o.RoomName,
    roomCode: o.RoomCode,
    roomType: o.RoomTypeName,
    roomTypeCode: o.RoomTypeCode,
    board: o.BoardCode,
    boardName: o.BoardName,
    checkIn: (o.CheckInDate || '').slice(0, 10),
    nights: o.Night,
    total: o.TotalPrice,
    currency: o.Currency,
    status: o.AvailabilityStatus,
    statusText: o.AvailabilityStatusDesc,
    availableRooms: o.AvailableRoomCount,
    eb: Math.max(0, ...(o.RoomSpoInfo || []).filter((x) => x.SpoType === 'EB').map((x) => Number(x.Percent) || 0)),
  });

  return {
    type: 'sejour',
    normalize: norm,

    async test() {
      token = null;
      const messages = await login();
      return { ok: true, messages };
    },

    // Всички хотели + курорта им (взима се по региони)
    async hotels() {
      const all = await call('Hotel/GetHotel', {});
      const map = new Map((all.Body || []).map((h) => [h.Code, { code: h.Code, name: h.Name, area: '' }]));
      const regions = (await call('Hotel/GetRegion', {})).Body || [];
      for (const r of regions) {
        const j = await call('Hotel/GetHotel', { RegionCode: r.Code });
        for (const h of j.Body || []) {
          const x = map.get(h.Code) || { code: h.Code, name: h.Name };
          x.area = r.Name;
          x.regionCode = r.Code;
          map.set(h.Code, x);
        }
      }
      // категория (звезди) – търсене на хотелите по всяка категория
      try {
        const cats = (await call('Hotel/GetCategory', {})).Body || [];
        for (const c of cats) {
          const j = await call('Hotel/GetHotel', { CategoryCode: c.Code });
          for (const h of j.Body || []) {
            const x = map.get(h.Code);
            if (x) x.category = c.Name || c.Code;
          }
        }
      } catch (e) {
        /* без категории – не е фатално */
      }
      return [...map.values()];
    },

    async search({ hotel, date, nights, adults, childAges }) {
      const body = {
        CheckInDate: date,
        Night: nights,
        HotelCode: hotel,
        RoomCriterias: [{ Adult: adults, Child: childAges.length, ChildAges: childAges }],
      };
      const j = await limiter.schedule(() => call('Search/HotelSearch', body));
      const offers = ((j.Body && j.Body.RoomOffers) || []).map(norm);
      return { offers, messages: msgs(j) };
    },

    // За дневната проверка на отстъпките: курорти и търсене на цял курорт с една заявка
    async regions() {
      return (await call('Hotel/GetRegion', {})).Body || [];
    },

    async searchRegion({ region, date, nights, adults, childAges = [] }) {
      const body = { CheckInDate: date, Night: nights, RegionCode: region, RoomCriterias: [{ Adult: adults, Child: childAges.length, ChildAges: childAges }] };
      const j = await limiter.schedule(() => call('Search/HotelSearch', body));
      return (j.Body && j.Body.RoomOffers) || [];
    },

    // Имена на договорите (сезоните) по хотел: { CODE: [{ id, name, begin, end }] }
    // Export/GetContractView връща целия договор (~1 MB на хотел), затова на малки групи.
    async contractNames(codes) {
      const out = {};
      for (let i = 0; i < codes.length; i += 5) {
        const part = codes.slice(i, i + 5);
        const j = await call('Export/GetContractView', { HotelCodes: part }, 90000);
        for (const c of part) out[c] = [];
        for (const h of (j && j.Body && j.Body.ContractContainerList) || []) {
          const code = h.HotelData && h.HotelData.HotelCode;
          if (!code) continue;
          out[code] = (h.Contracts || []).map((k) => k.SeasonData || {}).map((s) => ({
            id: s.HotelSeason,
            name: s.HotelSeason || '',
            begin: String(s.HotelSeasonBegin || '').slice(0, 10),
            end: String(s.HotelSeasonEnd || '').slice(0, 10),
          }));
        }
      }
      return out;
    },

    // За тестове: вика произволен метод, напр. path = "Hotel/GetRegion"
    async raw(path, body) {
      return call(path, body);
    },

    limiterStatus: () => limiter.status(),
    limiterWaitMs: () => limiter.waitMs(),
  };
};
