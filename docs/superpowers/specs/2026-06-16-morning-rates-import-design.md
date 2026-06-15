# Импорт утреннего документа курсов + автокурсы кеш-кеш (USDT-пивот)

**Дата:** 2026-06-16
**Статус:** утверждён, готов к плану реализации
**Референс:** реализация в проекте `coinpoint` (`bot/src/util/rates-parser.ts`, `web/server/api/rates.get.ts`, `RatesEditor.vue`)

## Проблема

Каждое утро в Telegram приходит документ с курсами (от «Paramon») в свободном
текстовом формате, сгруппированный по офисам (городам). Сейчас в coinplata его
переносят руками. Нужна вставка текста → разбор → применение курсов, плюс
«автокурсы кеш-кеш»: производные кросс-курсы (USD→TRY, EUR→TRY, USD→EUR…)
должны выводиться из USDT-якорей **на лету**, синхронно с изменением якоря.

### Формат документа (пример)

```
[15.06.2026 10:44] Paramon: ANT
USDT -> USD  -0,80%
USD -> USDT  0,00%
USDT -> TRY  45,50
TRY -> USDT  46,5
USDT -> EUR  1,171
EUR -> USDT  1,152

IST
USDT -> USD  -0,60%
USD -> USDT  0,10%
USDT -> TRY  45,50
TRY -> USDT  45,6
USDT -> EUR  1,171
EUR -> USDT  1,152
[15.06.2026 10:44] Paramon: RUB QR СБП>> USDT  75,50
[15.06.2026 10:46] Paramon: MSK
USDT -> RUB  75,75
RUB -> USDT  76,92

SPB
USDT -> RUB  75,55
RUB -> USDT  77,12
[15.06.2026 11:38] Paramon: USDT - RUB (НЕРЕЗ)

Sell
TOD-TOD  73,28
TOD-TOM  73,23
TOM-TOM  73,33

Buy
TOD-TOD  71,87
TOD-TOM  71,79
TOM-TOM  71,92
```

Города: `ANT` = Анталья, `IST` = Стамбул, `MSK` = Москва, `SPB` = Санкт-Петербург.
Значения — либо процент-маржа (`-0,80%`), либо абсолютный курс (`45,50`).
Запятая — десятичный разделитель.

## Решения (утверждены пользователем)

1. **City→Office:** `ANT → ['mark','terra']` (оба офиса Антальи), `IST → ['ist']`,
   `MSK → []`, `SPB → []`. Пустой массив → строки уходят в `skipped` с причиной
   «нет офиса для MSK/SPB».
2. **Автокурсы = USDT-пивот, кросс выводится на лету** (не материализуется в БД).
3. **Парсим всё**, включая СБП и блок НЕРЕЗ. НЕРЕЗ пока информационная витрина,
   не участвует в сделках (см. F — это сознательное ограничение объёма).

## Архитектура

### A. Парсер — `src/utils/morningRatesParser.js`

Чистый JS, без зависимостей от React/Supabase, покрыт vitest. Порт логики из
coinpoint `rates-parser.ts`, расширенный спец-строками.

```
parseMorningRates(text) -> { anchors, special, skipped }
```

- **Препроцессинг строки:** срезать префикс `[DD.MM.YYYY HH:MM] Paramon:` (в т.ч.
  повторный `Paramon: Paramon:`), пустые строки и комментарии (`//`, `#`) — пропуск.
- **City-заголовки:** standalone (`ANT` на отдельной строке, опц. с `:`) и inline
  (`ANT USDT -> USD -0,80%` → город + остаток строки как курс). Хранится
  `currentCity` до следующего заголовка.
- **Курс-строка** (regex):
  `^([A-Za-z]{2,6})\s*(?:->|=>|→)\s*([A-Za-z]{2,6})\s+\(?([+-]?\d+(?:[.,]\d+)?)\s*(%?)\)?$`
  → `anchors[]` элемент `{ city, from, to, value, pct, raw }` (тикеры в upper-case).
  Если города ещё не было — `skipped` с причиной `no-city`.
- **`special[]`** (нет в coinpoint):
  - СБП: `RUB QR СБП>> USDT  75,50` → `{ kind:'sbp', from:'RUB', to:'USDT', value:75.5, raw }`.
    Распознаётся по литералу `СБП` и разделителю `>>`.
  - НЕРЕЗ: после заголовка `USDT - RUB (НЕРЕЗ)` парсятся подсекции `Sell`/`Buy`
    и строки `TOD-TOD|TOD-TOM|TOM-TOM  <число>` →
    `{ kind:'nerez', pair:'USDT/RUB', side:'sell'|'buy', settle:'TOD-TOD'|'TOD-TOM'|'TOM-TOM', value, raw }`.
- **`skipped[]`:** `{ line, reason }` для нечитаемых строк, MSK/SPB-курсов
  (после маппинга), строк без города.
- `parseNumber(str)` — `","→"."`, `parseFloat`, проверка `Number.isFinite`.

```
resolveRateValue({ value, pct }, fromKind, toKind) -> number | null
```
- `pct` → `1 + value/100` (маржа на ~1:1 пару, напр. USDT↔USD).
- crypto→cash → `value` (абсолют: 1 USDT = N TRY).
- cash→crypto → `value === 0 ? null : 1/value`.
- cash↔cash → `value` как есть.

`fromKind/toKind` берутся из типа валюты (`currencies.dict[code].type`:
`fiat`/`crypto`). USDT = crypto, остальные = fiat (cash).

### B. Маппинг city→office — `CITY_OFFICE_MAP`

Константа в `morningRatesParser.js` (или соседнем конфиге):
```js
export const CITY_OFFICE_MAP = {
  ANT: ['mark', 'terra'],
  IST: ['ist'],
  MSK: [],
  SPB: [],
};
```
Применение к `anchors`: для каждого якоря city → список officeId. Пустой список →
строка(и) в `skipped`. ANT-якорь даёт две записи (mark + terra).

### C. Применение импорта — только USDT-якоря как office-overrides

`applyMorningRates(parsed, ctx)` строит список апдейтов и пишет их:

- Берём из `anchors` только пары, где одна сторона = `USDT` (USDT↔TRY/USD/EUR/RUB).
  Это «якоря». Кросс-пары из документа (если попадутся) не пишем — они выводятся.
- Для каждого якоря: city → officeId(ы); по валютам from/to резолвим тип →
  `resolveRateValue` → итоговый `rate`. На каждый officeId — запись
  `{ officeId, from, to, rate }`.
- Запись: DB-режим → `rpcUpsertOfficeRate(officeId, from, to, rate)`; demo →
  `applyOfficeOverrideLocal(officeId, from, to, rate)`. Обе функции уже есть в
  `rates.jsx` / `lib/supabaseWrite.js`.
- ANT → каждая запись дублируется в `mark` и `terra`.
- Аудит: `logAudit` с reason вида `morning-import: N якорей · M офисов`.

### D. USDT-пивот в `getRate` — «синхронные» автокурсы кеш-кеш

Расширяем `getRate(from, to, officeId)` в `src/store/rates.jsx`. Текущий порядок:
office-override (прямой) → global default. Добавляем уровень пивота.

Новый порядок резолва:
1. `from === to` → `1`.
2. Прямой office-override (если `officeId` и есть запись) → вернуть.
3. **Office USDT-пивот:** если `officeId`, обе стороны ≠ `USDT`, и есть **офисные**
   якоря `from→USDT` и `USDT→to` → `getRate(from,'USDT',officeId) * getRate('USDT',to,officeId)`.
4. Global default rate → вернуть.
5. **Global USDT-пивот:** обе стороны ≠ `USDT`, есть глобальные `from→USDT` и
   `USDT→to` → произведение.

Защита от рекурсии: пивот вызывается только когда обе ноги — прямые курсы
(`from`/`to` против `USDT`), т.е. рекурсия максимум на 1 уровень. Хелпер
`pivotRate(from, to, officeId, directLookup)` использует прямой lookup для ног,
без повторного входа в пивот.

UI-индикация: в `RatesTable` ячейки, значение которых получено пивотом (нет
прямого курса/override), помечаются бейджем «авто» и не редактируются inline
(правка якоря — да, правка производной — нет).

### E. UI — вкладка «Вставить текст» в `RatesImportModal`

Существующая `src/components/RatesImportModal.jsx` (сейчас 3 шага для XLSX)
получает переключатель источника: **XLSX-файл** | **Текст**. Для текста:

- Шаг 1 «Вставка»: `<textarea>` под формат документа + кнопка «Разобрать».
- Шаг 2 «Превью» (`parseMorningRates` + маппинг + предпросчёт пивота),
  сгруппировано по офисам:
  - ✅ Якоря к применению: `office · from→to · итоговый rate` (после resolveRateValue).
  - 🔢 Производные кросс-курсы кеш-кеш: предпросмотр того, что выведет пивот
    (USD→TRY, EUR→TRY, USD→EUR …) — только показ, не запись.
  - ⭐ Special: СБП и НЕРЕЗ отдельной секцией.
  - ⚠️ Skipped: MSK/SPB, нечитаемые строки — с причинами.
- Шаг 3 «Применить»: чекбокс-подтверждение → `applyMorningRates` (якоря) +
  запись special (см. F). Сводка applied/skipped.

i18n: новые ключи в `src/i18n/translations.jsx` (en/ru/tr).

### F. Special-блок (СБП + НЕРЕЗ)

- **СБП** `RUB QR СБП>> USDT`: ложится в channel-модель coinplata. Создаём канал
  `ch_rub_sbp` (валюта RUB, платёжный kind/метка «СБП/QR») и пишем пару
  `RUB(ch_rub_sbp) → USDT` обычным курсом (`addChannel` + `addPair`/`setRate`).
  Это настоящий курс, доступен в сделках. Строка СБП в документе без city →
  трактуем как глобальный курс (не office-override).
- **НЕРЕЗ** (USDT/RUB, Sell/Buy, TOD-TOD/TOD-TOM/TOM-TOM): модели расчётных дат
  (settlement) в coinplata нет. Кладём в **новую лёгкую структуру `specialRates`**
  — snapshot последнего импорта: `{ pair, side, settle, value, importedAt }`.
  Хранение: demo → состояние в `RatesProvider`; DB → отдельная таблица или поле в
  `rate_snapshots` (решается на этапе плана). Показ — отдельная панель на странице
  Курсов (`RatesPage`). **Информационно, в движок сделок не зашивается** на этой
  итерации (сознательное ограничение объёма; полноценный forex с расчётными датами
  — отдельный под-проект).

## Что НЕ делаем (вне объёма)

- Forex-движок с расчётными датами (TOD/TOM) и участием НЕРЕЗ-курсов в сделках.
- Telegram-бот / автоприём документа (в coinplata фронта-only; вставка ручная).
- Изменение формата хранения global pairs или confirmation-lifecycle.
- Заведение офисов MSK/SPB (их строки пока пропускаются).

## Тестирование

- **Парсер (vitest):** реальный пример из этой спеки → ожидаемые `anchors`
  (кол-во по городам), `special` (1 СБП + 6 НЕРЕЗ), `skipped` (MSK/SPB якоря).
  Кейсы: inline-city, повторный `Paramon:` префикс, `%` vs абсолют, запятая,
  скобки/знаки, мусорные строки.
- **resolveRateValue:** `%`→`1+v/100`, crypto→cash абсолют, cash→crypto `1/v`,
  деление на ноль → `null`.
- **Маппинг:** ANT→2 записи, MSK/SPB→skipped.
- **USDT-пивот (`getRate`):** office-якоря USDT→TRY и USDT→USD → USD→TRY = пивот;
  изменение якоря меняет производную; отсутствие ноги → undefined (не падает).
- **Сборка:** `npm run build` + ручная проверка модалки в dev-сервере.

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/utils/morningRatesParser.js` | новый — парсер + `resolveRateValue` + `CITY_OFFICE_MAP` |
| `src/utils/morningRatesParser.test.js` | новый — vitest |
| `src/store/rates.jsx` | USDT-пивот в `getRate`; `specialRates` state; helper `pivotRate` |
| `src/components/RatesImportModal.jsx` | вкладка «Текст», превью, применение |
| `src/pages/RatesPage.jsx` | панель НЕРЕЗ/special; проброс apply |
| `src/lib/supabaseWrite.js` | (при необходимости) запись specialRates / СБП-пары |
| `src/i18n/translations.jsx` | ключи en/ru/tr |
| `src/pages/info/content.js` | обновить Справку (отгрузка фичи) |
