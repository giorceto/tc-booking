# Sedna Agency API (Summer Tour)

Код: `src/suppliers/sedna.js`. Документация: http://test.kodsedna.com/AgencyDoc/
Базов адрес: `http://online.summertour.com/AgencyApi/Api`

> Пътят наистина е **`Integratiion`** (с две „i“). Това не е грешка при нас.

## Особености

- **Вход с бисквитка** (cookie), не с токен. Бисквитките от `Set-Cookie` се пазят и се пращат при всяка заявка. Ние влизаме наново на 30 минути, а при `401`/`403` веднага.
- **Json.NET препратки.** Повтарящите се обекти идват като `{"$ref":"5"}` вместо копие, с `"$id"` в оригинала. Винаги пускайте отговора през `resolveRefs()` (`src/suppliers/jsonref.js`), иначе стаи и изхранвания „липсват“.
- **Лимит:** `HotelPriceSearch` е до **10 заявки в минута**; ние пазим 8 през `limiter.js`. Другите методи нямат такъв лимит.
- **Формат на датите:** `2027-06-15T00:00:00`.
- **Правописни грешки в полетата:** `RoomTypceCode` е с „c“.

## Вход

```
GET Integratiion/AgencyLogin?username=...&password=...
→ { "ErrorType": 0, "RecId": 1107, "Message": ... }
```

`RecId` е нашият **OperatorId** (1107). Нужен е при списъците и търсенето.

## Справочници

| Метод | Как | Връща |
|---|---|---|
| `Integratiion/GetHotelList?operatorId=1107&isActive=true` | POST `{}` | хотели: `Id`, `Code`, `Remark` (име), `RegionId`, `CategoryId`, `Latitude`, `Longitude`, `RoomTypes[]` (`Id`, `Code`, `Remark`, `MaxAdult`, `MaxChildAge`, `Boards[]`) |
| `Integratiion/GetRegionlist?operatorId=1107` | POST `{}` | региони: `Id`, `Remark`, `SubRegionId` |
| `Integratiion/GetSubRegions?operatorId=1107` | POST `{}` | подрегиони (напр. SIDE за региона KIZILOT) |
| `Integratiion/GetMainRegions`, `GetCountrys` | | по-горни нива |
| `Service2/GetHotelCategorylist` | **GET** | категории: `RecId` → `Remark` ("5 STAR") |
| `Service2/GetBoardList` | **GET** | изхранвания |
| `Integratiion/GetRoomTypeList` | | типове стаи |

- Курорт при нас = `подрегион / регион`, напр. „SIDE / KIZILOT“.
- В `data/seed/hotels-SUMMER.json` има 829 хотела с `rooms` (код → име) и `boards` (id → име).

## Търсене на цени

```
POST Integratiion/HotelPriceSearch
{
  "OperatorId": 1107,
  "BeginDate": "2027-06-15", "EndDate": "2027-06-22",
  "HotelId": 3470,                 // или "HotelList": [3470, 3471, ...] за много хотели наведнъж
  "Pax": 2, "Childs": 1, "ChildInfo": [5],
  "SaleDate": "2026-11-27"         // днешна дата – от нея зависи кой EB важи
}
```

- **Само числово `HotelId`.** Кодът (напр. WATER) се превръща в Id през `GetHotelList`.
- **`HotelList`** връща всички хотели с една заявка: около 7 сек за 30–40 хотела. Така търсенето по курорт се събира в лимита от 10 заявки/мин.

Ред от отговора:

| Поле | Значение |
|---|---|
| `HotelId`, `HotelCode`, `HotelName`, `RegionName` / `SubRegionRemark`, `StarName` | хотел |
| `HotelRoomRemark`, `RoomTypeRemark`, `RoomTypceCode` | стая |
| `BoardCode`, `BoardRemark` | изхранване |
| `BeginDate`, `TotalDays` | дати |
| `TotalPrice`, `CurrencyRemark` | **крайна нетна цена за престоя, след EB** (сверено с портала) |
| `StopSaleRemark` | ако има – стоп продажба |
| `AvailableHotel` | `false` = по запитване |
| `QuotaRemark`, `ReleaseRemark`, `RemainderQuota` | квота/релийз |
| `Detail[]` | разбивка: `{ PacketTypeName: "Contract" / "Early Booking" / ..., Amount }` |

- **EB % от търсенето** = `−сума(Amount при "Early Booking") / сума(Amount при "Contract") × 100`.
- Пример: Contract 1000, Early Booking −150 → EB 15%.

## Договори

```
POST Integratiion/GetContractList
{ "HotelId": 3470, "IsActive": true }
```

- **`Remark` е името на договора**: „SUMMER 2027 - B“, „SUMMER 2027 ( EXCL. ALB ) - B“, „WINTER 2026-2027“, „Aktarım“. Тук **няма** S27/C27, така че окончателен или roll-over не се вижда от името.
- **Полета на договора:** `RecId`, `BeginDate`, `EndDate`, `Boards[]` (id на изхранвания), `IsCancel`.
- **`Accommodations[]`** – цените:
  - `PeriodBegin` / `PeriodEnd`, `RoomType` (код), `Adult`, `Child`;
  - `ChildAge[]` – `{Begin, End}` на възрастите;
  - `Price` – **на стая на нощ**;
  - `BasicRoomPrice` – на човек: DBL = BasicRoomPrice × 2;
  - `Period_Type` – ползваме само „accom“.

## Пакети (EB и др.)

```
POST Integratiion/GetPackets
{ "HotelId": 3470 }
```

- `PacketType = 1` значи **ранно записване (EB)**.
- `ContractId` показва към кой договор е пакетът. Анулираните са с `IsCancel`.

Полета:

| Поле | Значение |
|---|---|
| `PacketName` | напр. „EB1“, „%20“ |
| `Percent` | процент отстъпка |
| `SalesDateBegin` / `SalesDateEnd` | период на записване |
| `StayDateBegin` / `StayDateEnd` | период на престой |
| `CheckinDateBegin` / `CheckinDateEnd` | дати на настаняване (1900–2099 = без ограничение) |
| `StayDayBegin` / `StayDayEnd` | нощувки (0 или 255 = без горна граница) |
| **`PacketRoomType[]`** | `{RoomTypeId}` – **за кои стаи важи** (`Id` от `GetHotelList.RoomTypes`) |
| **`PacketBoardCosts[]`** | id на изхранвания, **за които важи** |
| `RoomPax`, `BeginAge`, `EndAge` | ограничение по хора/възраст (0 = няма) |
| `IsHoneyMoon` | само за младоженци |

**EB само за някои стаи или бази:** сравнете `PacketRoomType` и `PacketBoardCosts` с всички стаи и бази в договора. Ако са всички, EB важи за всички (ALL). Ако са по-малко, важи само за изброените. При търсенето (`HotelPriceSearch`) Summer Tour вече прилага тези ограничения сам.

> XML експортът в `src/export/pricexml.js` засега пише `RoomType="ALL" BoardType="ALL"` винаги. При хотели с EB само за някои стаи това трябва да се допише.

## Правило за деца

- **Не вадим цени за повече от 3 деца.** Настаняване 2+4, 1+4 и т.н. се игнорира (`MAX_CHILDREN = 3` в `pricexml.js`).
- В търсачката сайтът не трябва да позволява повече от 3 деца на стая.
