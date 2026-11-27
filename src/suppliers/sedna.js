// Модул за операторите на Sedna (Summer Tour) – Agency API.
// Вход с бисквитка; HotelPriceSearch е ограничен до 10 заявки/мин от тяхна страна.
const Limiter = require('./limiter');
const { resolveRefs } = require('./jsonref');

module.exports = function sedna(op) {
  const limiter = new Limiter(op.ratePerMin || 8);
  let cookies = {};
  let operatorId = null;
  let loggedAt = 0;
  let hotelCache = null; // code -> Id (търсенето иска числово HotelId)

  const cookieHeader = () =>
    Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  function keepCookies(r) {
    const list = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }

  async function req(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (Object.keys(cookies).length) headers.Cookie = cookieHeader();
    const r = await fetch(`${op.url}/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(op.timeoutMs),
    });
    keepCookies(r);
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
    cookies = {};
    const q = `username=${encodeURIComponent(op.user)}&password=${encodeURIComponent(op.pass)}`;
    const { json } = await req('GET', `Integratiion/AgencyLogin?${q}`);
    if (!json || json.ErrorType !== 0 || !json.RecId) {
      throw new Error(`Неуспешен вход: ${(json && json.Message) || JSON.stringify(json).slice(0, 200)}`);
    }
    operatorId = json.RecId;
    loggedAt = Date.now();
    return { operatorId };
  }

  async function call(method, path, body) {
    if (!operatorId || Date.now() - loggedAt > 30 * 60 * 1000) await login();
    let res = await req(method, path, body);
    if (res.status === 401 || res.status === 403) {
      await login();
      res = await req(method, path, body);
    }
    return res.json;
  }

  async function hotels() {
    await call('GET', 'Integratiion/GetOperators'); // гарантира вход
    const j = await call('POST', `Integratiion/GetHotelList?operatorId=${operatorId}&isActive=true`, {});
    // Курорт: регион (напр. KIZILOT) -> подрегион (напр. SIDE)
    const arr = (x) => (Array.isArray(x) ? x : []);
    const regions = new Map(arr(await call('POST', `Integratiion/GetRegionlist?operatorId=${operatorId}`, {})).map((r) => [r.Id, r]));
    const subs = new Map(arr(await call('POST', `Integratiion/GetSubRegions?operatorId=${operatorId}`, {})).map((r) => [r.Id, r]));
    // категории: RecId -> име (напр. "5 STAR")
    let cats = new Map();
    for (const path of ['Service2/GetHotelCategorylist', 'Integratiion/GetHotelCategorylist']) {
      try {
        const c = arr(await call('GET', path));
        if (c.length) {
          cats = new Map(c.map((x) => [x.RecId ?? x.Id, x.Remark || x.Code]));
          break;
        }
      } catch (e) {
        /* пробваме следващия адрес */
      }
    }
    const list = arr(resolveRefs(j)).map((h) => {
      const r = regions.get(h.RegionId);
      const sub = r && subs.get(r.SubRegionId);
      return {
        code: h.Code,
        id: h.Id,
        name: h.Remark,
        area: [sub && sub.Remark, r && r.Remark].filter(Boolean).join(' / '),
        category: cats.get(h.CategoryId) || '',
        regionId: h.RegionId,
        lat: h.Latitude,
        lng: h.Longitude,
        // стаи (код -> име) и изхранвания (id -> име) – нужни за експорта на цени
        rooms: Object.fromEntries((h.RoomTypes || []).filter(Boolean).map((rt) => [rt.Code, String(rt.Remark || '').trim()])),
        boards: Object.fromEntries(
          (h.RoomTypes || []).filter(Boolean).flatMap((rt) => (rt.Boards || []).filter(Boolean).map((b) => [b.Id, String(b.Remark || '').trim()]))
        ),
      };
    });
    hotelCache = new Map(list.map((h) => [String(h.code).toUpperCase(), h.id]));
    return list;
  }

  const addDays = (d, n) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };

  // Ред от Sedna -> общ формат
  const norm = (o, date, nights) => {
    const det = Array.isArray(o.Detail) ? o.Detail : [];
    const contract = det.filter((d) => /contract/i.test(d.PacketTypeName || '')).reduce((s, d) => s + (d.Amount || 0), 0);
    const ebSum = det.filter((d) => /early/i.test(d.PacketTypeName || '')).reduce((s, d) => s + (d.Amount || 0), 0);
    return {
      hotelCode: o.HotelCode,
      hotelId: o.HotelId,
      hotelName: o.HotelName,
      region: o.RegionName || o.SubRegionRemark,
      category: o.StarName || o.StarCode,
      room: o.HotelRoomRemark || o.RoomTypeRemark,
      roomCode: o.RoomTypceCode,
      roomType: o.RoomTypeRemark,
      roomTypeCode: o.RoomTypceCode,
      board: o.BoardCode,
      boardName: o.BoardRemark,
      checkIn: (o.BeginDate || date || '').slice(0, 10),
      nights: o.TotalDays || nights,
      total: o.TotalPrice != null ? Math.round(o.TotalPrice * 100) / 100 : null,
      currency: o.CurrencyRemark,
      status: o.StopSaleRemark ? 'STOP' : o.AvailableHotel === false ? 'RQ' : 'OK',
      statusText: o.StopSaleRemark || o.QuotaRemark || o.ReleaseRemark || '',
      availableRooms: o.RemainderQuota,
      eb: contract > 0 ? Math.round((-ebSum / contract) * 1000) / 10 : 0,
    };
  };

  return {
    type: 'sedna',
    normalize: norm,

    async test() {
      const r = await login();
      return { ok: true, messages: [`Вход успешен, OperatorId = ${r.operatorId}`] };
    },

    hotels,

    async search({ hotel, date, nights, adults, childAges }) {
      // Приема код или числово Id на хотела
      let hotelId = Number(hotel);
      if (!hotelId) {
        if (!hotelCache) await hotels();
        hotelId = hotelCache.get(String(hotel).toUpperCase());
        if (!hotelId) throw new Error(`Хотел с код ${hotel} не е намерен при ${op.name}`);
      }
      if (!operatorId) await login();
      const body = {
        OperatorId: operatorId,
        BeginDate: date,
        EndDate: addDays(date, nights),
        HotelId: hotelId,
        Pax: adults,
        Childs: childAges.length,
        ChildInfo: childAges,
        SaleDate: new Date().toISOString().slice(0, 10),
      };
      const j = await limiter.schedule(() => call('POST', 'Integratiion/HotelPriceSearch', body));
      const rows = Array.isArray(j) ? j : [];
      const offers = rows.map((o) => norm(o, date, nights));
      const messages = Array.isArray(j) ? [] : [JSON.stringify(j).slice(0, 300)];
      return { offers, messages };
    },

    // Договори и пакети (ранно записване и др.) на хотел – за експорта на цени
    async contracts(hotelId) {
      const j = await call('POST', 'Integratiion/GetContractList', { HotelId: Number(hotelId), IsActive: true });
      return Array.isArray(j) ? resolveRefs(j) : [];
    },
    // Имена на договорите по хотел (по Id): { ID: [{ id, name, begin, end }] }
    async contractNames(ids) {
      const out = {};
      for (const id of ids) {
        try {
          out[id] = (await this.contracts(id))
            .filter((c) => c && !c.IsCancel)
            .map((c) => ({ id: c.RecId, name: String(c.Remark || '').trim(), begin: String(c.BeginDate || '').slice(0, 10), end: String(c.EndDate || '').slice(0, 10) }));
        } catch (e) {
          out[id] = null; // ще пробваме пак следващия път
        }
      }
      return out;
    },
    async packets(hotelId) {
      const j = await call('POST', 'Integratiion/GetPackets', { HotelId: Number(hotelId) });
      return Array.isArray(j) ? resolveRefs(j) : [];
    },

    // За дневната проверка на отстъпките: много хотели (по Id) с една заявка
    async searchMany({ hotelIds, date, nights, adults, childAges = [] }) {
      if (!operatorId) await login();
      const body = {
        OperatorId: operatorId,
        BeginDate: date,
        EndDate: addDays(date, nights),
        HotelList: hotelIds,
        Pax: adults,
        Childs: childAges.length,
        ChildInfo: childAges,
        SaleDate: new Date().toISOString().slice(0, 10),
      };
      const j = await limiter.schedule(() => call('POST', 'Integratiion/HotelPriceSearch', body));
      return Array.isArray(j) ? j : [];
    },

    async raw(path, body, method = 'POST') {
      return call(method, path, body);
    },

    limiterStatus: () => limiter.status(),
    limiterWaitMs: () => limiter.waitMs(),
  };
};
