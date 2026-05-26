# Активы — pivot-таблица Office × Currency (Treasury)

**Date:** 2026-05-26
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** ничего нового. Использует существующий `ctx` (`useLedger() + useBaseCurrency()`) и `passesOfficeFilter` из `v2selectors`. DB не трогаем.

## Overview

Текущая вкладка «Активы» (`AssetsTab`) — трёхуровневое дерево Офис → Валюта → Счёт. Кирилл хочет привычный 1С-вид: одна большая таблица, где **строки — офисы**, **колонки — валюты**, плюс правая колонка `≈ base`. Клик по заголовку колонки сортирует офисы по этой колонке. Клик по строке-офису разворачивает листы-счета под ним. Клик по листу — текущий drill-down `AccountInlineEntries`.

UI остаётся в текущем DS (bg-surface, text-ink/muted, rounded-card), просто меняется расклад данных.

## Селектор — `assetsPivotByOffice(ctx)` (`src/lib/treasury/v2selectors.js`)

Добавить рядом с `assetsByOfficeCurrency` (старый селектор не удаляем — он используется в тесте; можно удалить вместе с его вызовами, см. ниже). Подпись:

```js
export function assetsPivotByOffice(ctx)
// → {
//   currencies: ["USD", "EUR", "TRY", "RUB", "USDT", ...],   // упорядоченный список колонок
//   rows: [{
//     officeId: string|null,                                  // null = «без офиса»
//     totals: { USD: 33543, EUR: 9254, TRY: 229010, ... },    // native, ключ — currency
//     totalInBase: 49293.38,
//     accounts: [{                                            // листья для раскрытия
//       accountId, code, name, currency, balance, balanceInBase
//     }]
//   }],
//   grandTotals: { USD: 49629, EUR: 31319, ..., inBase: 105306.49 }
// }
```

**Правила построения:**

- Перебираем `ctx.accounts` где `type === "asset"` и проходящие `passesOfficeFilter(acc, ctx.officeFilter)`.
- Для каждого: суммируем `ctx.balances.filter(b.accountId === acc.id).balance` в native (`balance`) и в base (`toBase(b.balance, b.currency)`).
- Группируем по `officeId || null` → копим `totals[currency] += balance` и `totalInBase += inBase`; пушим в `accounts[]`.
- `currencies[]` строится так:
  1. Собираем все валюты, встретившиеся в asset-счетах (любых, даже с нулевым балансом — если счёт в плане есть, колонка должна быть).
  2. Сортируем: `ctx.baseCurrency` всегда первой; остальные по `Σ|toBase(amount)|` desc.
- `rows` сортируем: `null`-офис всегда последним, остальные по `|totalInBase|` desc (как в текущем `assetsByOfficeCurrency`).
- `accounts` внутри row сортируем по `|balanceInBase|` desc.
- `grandTotals[ccy] = Σ rows.totals[ccy]`; `grandTotals.inBase = Σ rows.totalInBase`.

**Удаление `assetsByOfficeCurrency`:** старый селектор остаётся только если его кто-то ещё использует. Поиск: `grep -rn "assetsByOfficeCurrency" src/` показывает только `AssetsTab.jsx` и его тест. После переписи AssetsTab — удаляем старый селектор и его тест.

## UI — `AssetsTab.jsx` переписать

**Шапка** — без изменений (`Активы [N] ≈ $X` + кнопки `Ненулевые / CSV / + Счёт в план`). `[N]` теперь = `pivot.rows.length` (количество видимых офисов).

**Тело — одна большая таблица в карточке `bg-surface rounded-card`:**

Структура (`<table>` или CSS-grid — выбираем `<table>` ради нативного sticky-thead и tabular-nums; колонки имеют `text-right font-mono tabular`):

```
┌─────────────┬──────────┬──────────┬─────────┬──────────┐
│ Касса (Office) │  USD ▼  │   EUR    │   TRY   │  ≈ USD   │  ← sticky thead, клик по ccy сортирует
├─────────────┼──────────┼──────────┼─────────┼──────────┤
│ ▾ Istanbul  │  33 543  │   9 254  │ 229 010 │ $49 293  │  ← row.totals + totalInBase
│   5036 Cash USD │ 33 543 │    —    │   —    │ $33 543  │  ← раскрытие: лист в своей колонке
│   5037 Cash EUR │    —    │  9 254  │   —    │ $10 808  │
│ ▸ Terra City │  13 986 │  20 265  │ 410 240 │ $47 813  │
├─────────────┼──────────┼──────────┼─────────┼──────────┤
│ ИТОГО       │  49 629  │  31 319  │ 759 250 │ $105 306 │  ← sticky bottom row
└─────────────┴──────────┴──────────┴─────────┴──────────┘
```

**Поведение:**

1. **Sticky thead** — `<thead>` с `sticky top-0 z-10 bg-surface` (внутри прокрутки страницы). Если таблица узкая — горизонтального скролла нет; если широкая (много валют) — `overflow-x-auto` на обёртке, колонка `Касса` залипает слева (`sticky left-0 bg-surface`).
2. **Sort** — внутренний `useState({key, dir})`. Default = `{ key: "__inBase", dir: "desc" }` (правая колонка). Клик по заголовку валюты → `key: currency, dir: "desc"`; повторный клик → `"asc"`; третий → reset к default. Клик по колонке «Касса» → сортирует по имени офиса (`localeCompare`). Активная колонка показывает `▼/▲` справа от названия. Сортировка применяется только к строкам-офисам, листы внутри раскрытого офиса всегда отсортированы по `|balanceInBase|` desc.
3. **Раскрытие** — `useState(expandedOffices: Set<string>)`. Клик по строке-офису toggle. Раскрытые: рендерится по `accounts.length` строк, каждая показывает `code · name` в первой колонке, native-баланс в колонке своей валюты, `≈base` в правой, остальные ccy-ячейки — `—` (`text-muted-soft`). Лист тоже кликабельный — раскрывает `AccountInlineEntries` (как сейчас) в отдельной строке `<tr><td colSpan={N}>...</td></tr>`. Состояние раскрытия листа — `useState(expandedAccounts: Set<string>)`.
4. **Inline-редактор баланса** — `InlineBalanceEditor` остаётся в строке-листе в колонке его валюты вместо обычного числа (как сейчас). При клике на ячейку — `e.stopPropagation()` чтобы не сворачивать строку.
5. **Ненулевые фильтр** — переключатель в шапке (как сейчас). Когда включён:
   - скрываем row, у которой `Math.abs(totalInBase) < 0.005`;
   - скрываем колонку-валюту, если `Math.abs(grandTotals[ccy]) < 0.005`;
   - внутри раскрытого row скрываем account с `Math.abs(balanceInBase) < 0.005`.
6. **Строка ИТОГО** — `<tfoot>` с `sticky bottom-0 bg-surface-sunk font-semibold`. Каждая ячейка = `Σ` по соответствующей видимой колонке (`grandTotals[ccy]` для native, `grandTotals.inBase` для правой).
7. **Пустые ячейки** — `—` мягким цветом (`text-muted-soft`). Native-числа форматируем как `{curSymbol(ccy)}{fmt(amount, ccy)}` (то же, что `nativeFmt` сейчас).
8. **Empty state** — если `pivot.rows.length === 0`, рендерим существующий empty state (Building2 icon + `trv2_no_accounts`).
9. **Хедер таблицы — sticky** при скролле страницы (используем `position: sticky`, не fixed). Top offset = высота шапки Treasury (если будет визуальный конфликт — обернём в локальный scroll-контейнер, но первая попытка — `sticky top-0` на `<thead>` без обёртки).

**Балансовое тождество (внизу страницы) — не трогаем**, оно живёт в `TreasuryShell.jsx`.

## CSV экспорт

Меняем формат CSV на pivot (что видим на экране — то и в CSV):

```
office, USD, EUR, TRY, RUB, USDT, base_usd
Istanbul, 33543.00, 9254.00, 229010.00, 0, 0, 49293.38
Terra City, 13986.00, 20265.00, 410240.00, 40000.00, 0, 47813.11
ИТОГО, 49629.00, 31319.00, ..., 105306.49
```

- Колонки строятся из `pivot.currencies` (после фильтра «Ненулевые», если включён) + правая `base_<ccy>`.
- Строки = `pivot.rows` (после фильтра) + одна строка ИТОГО.
- Если `currency` отсутствует в `row.totals` → пустая ячейка.
- Не разворачиваем листья в CSV (это сводный отчёт по офисам). Плоский per-account экспорт можно вернуть отдельной кнопкой позже, если попросят.

## i18n

Новые ключи в `src/i18n/translations.jsx`:

- `trv2_assets_col_office` — «Касса» / «Office» / «Kasa».
- `trv2_assets_col_base` — «≈ {base}» — собирать в коде: `t("trv2_assets_col_base").replace("{base}", baseCurrency)`. Альтернативно — рендерить `≈ {baseCurrency}` без i18n (символ ≈ универсальный, валюта уже строка).
- `trv2_assets_grand_total` — «ИТОГО» / «Total» / «Toplam».

Существующие ключи (`trv2_tab_assets`, `trv2_no_accounts`, `trv2_chart_add_btn`, `trv2_assets_no_office`) переиспользуем.

## Permissions

Без изменений. `can("accounting", "edit")` управляет кнопкой `+ Счёт в план` и `InlineBalanceEditor` (последний сам проверяет через свой контекст).

## Testing

**`v2selectors.test.js` — `assetsPivotByOffice`:**

- Базовый кейс (2 офиса, 3 валюты): проверить `currencies` отсортированы (base first, остальные по Σ|inBase| desc); `rows.length === 2`; `totals` на каждой строке правильные; `totalInBase` и `grandTotals.inBase` совпадают.
- Office filter: `ctx.officeFilter = <uuid>` → одна строка, валюты только этой офиса; `officeFilter = "all"` → включает null-офис.
- Null-office bucket: офис с `officeId: null` всегда в конце.
- Валюта присутствует в плане счетов но balance == 0: колонка ВСЁ РАВНО есть в `currencies`.
- `accounts[]` внутри row отсортированы по `|balanceInBase|` desc.
- `grandTotals[ccy]` = Σ по rows.

**`AssetsTab.test.jsx` — переписать:**

- Рендер pivot-таблицы: проверить thead-колонки в правильном порядке, строки-офисы, ИТОГО.
- Клик по заголовку колонки `USD` → сортировка desc, второй клик → asc, третий → reset.
- Клик по строке-офису → разворачиваются листы; native-баланс в колонке валюты, `—` в остальных.
- Клик по листу → рендерится `AccountInlineEntries` (можно мокнуть).
- Фильтр «Ненулевые»: row с нулём скрывается, колонка с Σ==0 скрывается.
- Empty state: пустой `accounts` → Building2.
- CSV-экспорт: вызов `exportCSV` с правильными колонками и строкой ИТОГО (моком `utils/csv.js`).

## Out of scope

- Группировка row по `subtype` (Cash/Bank) — пока строки только по офису. При желании Кирилла позже добавим toggle «По офисам / По кассам».
- Sticky колонка «Касса» при горизонтальном скролле — добавляем только если на реальных данных таблица переполняется (>7-8 валют). Иначе обычная таблица.
- Pivot для пассивов / капитала — отдельная задача, если попросят.
- Inline-добавление новых счетов из этой таблицы — кнопка `+ Счёт в план` остаётся как сейчас (модалка `ChartAccountModal`).

## Файлы

- `src/lib/treasury/v2selectors.js` — добавить `assetsPivotByOffice`, удалить `assetsByOfficeCurrency` (вместе с его тестом).
- `src/lib/treasury/v2selectors.test.js` — тесты `assetsPivotByOffice`, удалить тесты `assetsByOfficeCurrency`.
- `src/pages/treasury_v2/tabs/AssetsTab.jsx` — переписать рендер.
- `src/pages/treasury_v2/tabs/AssetsTab.test.jsx` — переписать тесты.
- `src/i18n/translations.jsx` — 3 новых ключа × 3 языка.
- `src/pages/info/content.js` — обновить раздел «Казначейство → Активы» под новый pivot-вид.
