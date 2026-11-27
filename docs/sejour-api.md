# Sejour REST API v2 (SAN TSG)

Ползва се от Anea, Irels, Sonar, Akay и Peninsula. Код: `src/suppliers/sejour.js`.
Официална документация: http://docs.santsg.com/sejour/v2/

Всички заявки са `POST` с JSON тяло. Отговорът е `{ Body, Messages: [{Code, Description}] }`.

## Вход

```
POST {url}/Authentication/Login
{ "DatabaseName": "ANEA", "UserCode": "...", "Password": "...", "Language": "en-US" }
```

- Отговорът съдържа JWT токен в `Body` (низ).
- Всяка следваща заявка изпраща `Authorization: Bearer <token>`.
- Токенът важи около час. Ние влизаме наново след 50 минути, а при `401` влизаме веднага и повтаряме заявката веднъж.
- Има и стар SOAP интерфейс (`/sws/Authentication.asmx?WSDL`). Не го ползваме.

## Хотели, курорти, категории

| Метод | Тяло | Връща |
|---|---|---|
| `Hotel/GetHotel` | `{}` | всички хотели: `Code`, `Name` |
| `Hotel/GetHotel` | `{ "RegionCode": "SID" }` | хотелите в регион |
| `Hotel/GetHotel` | `{ "CategoryCode": "5*" }` | хотелите в категория |
| `Hotel/GetRegion` | `{}` | регионите: `Code`, `Name` (напр. SID / SIDE) |
| `Hotel/GetCategory` | `{}` | категориите: `Code`, `Name` |

`GetHotel` без филтър не връща региона и категорията на хотела. Затова `hotels()` минава по всеки регион и после по всяка категория. Това е еднократно (нощно) теглене.

## Търсене на цени

```
POST {url}/Search/HotelSearch
{
  "CheckInDate": "2027-06-15",
  "Night": 7,
  "HotelCode": "CRYSAD",                       // или "RegionCode": "SID" за цял курорт
  "RoomCriterias": [{ "Adult": 2, "Child": 1, "ChildAges": [5] }]
}
```

`Body.RoomOffers[]` – една оферта = една стая + изхранване:

| Поле | Значение |
|---|---|
| `HotelCode`, `HotelName`, `RegionName`, `CategoryCode` | хотел |
| `RoomName`, `RoomCode`, `RoomTypeName`, `RoomTypeCode` | стая |
| `BoardCode`, `BoardName` | изхранване |
| `CheckInDate`, `Night` | дати |
| `TotalPrice`, `Currency` | **крайна нетна цена за целия престой, след EB** (сверено с портала) |
| `AvailabilityStatus`, `AvailabilityStatusDesc` | `OK` = налично; иначе по запитване/стоп |
| `AvailableRoomCount` | свободни стаи |
| `RoomSpoInfo[]` | приложени оферти: `{ SpoType: "EB", Percent: 15 }` и др. |

- **EB %:** `max(Percent)` от `RoomSpoInfo` със `SpoType == "EB"`.
- **Скорост:** търсене на цял регион (`RegionCode`) отнема около 0.7 сек и връща всички хотели в него наведнъж. Затова за търсене по курорт ползваме регионите, а не хотел по хотел.
- Курортът при нас (напр. SIDE) може да е няколко региона при оператора. Обединяват се през `normArea()`.

## Договори (Export)

И двата метода работят поне при Sonar. Отговорът е **голям, около 1 MB на хотел**, затова се теглят по 5 хотела на заявка, с timeout 90 сек.

### `Export/GetContractView`

```
POST {url}/Export/GetContractView
{ "HotelCodes": ["CRYSAD", "..."] }
```

`Body.ContractContainerList[]`:

- `HotelData`: `HotelCode`, `HotelName`, `HotelCategory` ("5*"), `HotelRegionCode`, `HotelRegion`, `HotelTrfRegionCode`, `HotelTrfRegion`.
- `Contracts[]`, по един за сезон:
  - `SeasonData`: `HotelSeason` (**името на договора**: S26, S27, W26…), `HotelSeasonBegin`, `HotelSeasonEnd`, `Currency`, `AllotmentType`.
  - `EarlyBookings[]`: `Percent`, `SalePeriodBegin/End` (кога се записва), `AccomodationPeriodBegin/End` (престой), `NightBegin/End`, `Room`, `RoomType`, `Board` (празно = за всички), `SpoCode: "EB"`.
  - `Rates[]`, `AccomDatas[]`, `StopSaleDatas[]`, `ReleaseDatas[]`, `MinumumStayDatas[]`, `ChildAgeDatas[]`, `SpecialOffers[]`, `RollingEarlyBookings[]`, `TurboEarlyBookings[]` и др.

### `Export/GetSejourContractExportView`

- Същото като горния метод, но в другия формат на SAN: `Body.Data[].Hotel[].General.Hotel_Season`, `Accom[]` и т.н.

### Имена на договорите

| Име | Значение |
|---|---|
| `S` + година (S27) | окончателен летен договор |
| `C27` / `R27` | roll-over |
| `W26` | зимен |

При сканиране на 254-те хотела на Sonar (21.10.2026) имаше само S26, S27 и W26. Класификацията е в `src/export/contracts.js`.

## Неизползвани, но налични

- `Export/*` дава и стоп продажби, релийз и минимален престой. Полезно е за кеширане на наличност, без да се търси всеки път.
- Резервации през API: **не е проверено** дали и как се правят. Засега не резервираме през API.
