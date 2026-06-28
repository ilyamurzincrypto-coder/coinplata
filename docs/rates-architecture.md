# Архитектура курсов в кассе CoinPlata

> Разведка (read-only), 2026-06-28. Источник истины — код и миграции репозитория
> `coinplata` (React 18 + Vite + Supabase). Везде помечено **KNOWN** (найдено в
> коде/схеме) и **INFERRED** (вывод по логике, не подтверждён прямо). Снимок на
> момент ветки `main`. Ничего, кроме этого файла, не менялось.

---

## 1. Карта потока курса

```
ИСТОЧНИК                ПАРСИНГ / НОРМАЛИЗАЦИЯ          ХРАНЕНИЕ                 ПРИМЕНЕНИЕ
─────────────────────   ────────────────────────────   ──────────────────────   ─────────────────────────
1. Текст «утренних       morningRatesParser.js          public.pairs             getRate(from,to,officeId)
   курсов» (Paramon)  →  (anchors/special, по городам) → (глобальные, generated  → лента сделок (deal-form,
   RatesImportModal       + resolveRateValue            rate=base*(1+spread))      cashier/*), OTC, обмен
                          + CITY_OFFICE_MATCHERS                                   калькулятор сумм (convert)
2. Вставка строк      →  ratesPasteParser.js         →  public.office_rate_     → спред-индикатор, маржа
   (paste)                (RATE_RE, percent-aware)        overrides (по офису)      (money.js, spread.js)
3. XLSX-файл          →  xlsxRates.js (From/To/Rate) →  через RPC import_rates  → кросс-курсы (CrossRatesPanel)
   RatesImportModal       validateRows/diff               (+ rate_snapshots аудит) → оценка балансов/казны
4. Внешние фиды        →  ExternalRatesWidget          v_external_rates_latest   → ТОЛЬКО ИНФО-виджет
   (Binance/Harem/TCMB/    (Edge Function ~5 мин)        (view) + localStorage      (в pairs НЕ пишется)
    CBR/ECB)                                             (локальный спред)
```

Запись курсов почти всегда идёт через **RPC** (атомарно, со снапшотом), а не
прямым insert. Чтение — через React-стор `useRates()` → `getRate()`.

---

## 2. Источники и парсер

### 2.1 Источники базовых курсов (KNOWN)
- **Ручной текст «утренних курсов»** — основной. `RatesImportModal.jsx` (вкладка «Текст»)
  → `parseMorningRates()` → `buildMorningUpdates()` → `rpcUpsertOfficeRate()` / `rpcReplaceSpecialRates()`.
- **Вставка строк (paste)** — `src/utils/ratesPasteParser.js`, формат `USDT -> TRY 45,10`, `USDT -> USD -1,00%`.
- **XLSX** — `src/utils/xlsxRates.js` + `RatesImportModal.jsx` (вкладка «Файл»), колонки From/To/Rate, → `rpcImportRates()`.
- **Внешние фиды** — `src/components/ExternalRatesWidget.jsx`: Binance/Harem/TCMB/CBR/ECB через Edge Function в `v_external_rates_latest`. **Только справочно**, в `pairs` НЕ попадает; локальный спред хранится в `localStorage`. (INFERRED: обратной связи в основной движок нет.)

### 2.2 morningRatesParser.js (KNOWN)
Файл: `src/utils/morningRatesParser.js`

**Вход** — многострочный текст (пример из теста):
```
[15.06.2026 10:44] Paramon: ANT
USDT -> USD  -0,80%
USDT -> TRY  45,50
IST
USDT -> TRY  45,50
RUB QR СБП>> USDT 75,50        // спец: СБП
USDT - RUB (НЕРЕЗ)            // спец-блок: Sell/Buy, TOD-TOD/TOM-TOM
```
- Срезаются префиксы `[дата время]` и `Paramon:`; комментарии `//`/`#` игнорируются.
- Заголовки городов: `ANT / IST / MSK / SPB` (standalone или inline).
- Строки курса: `RATE_RE = /^([A-Za-z]{2,6})\s*(?:->|=>|→)\s*([A-Za-z]{2,6})\s+\(?([+-]?\d+(?:[.,]\d+)?)\s*(%?)\)?$/`.
- Числа: `parseNumber()` → `parseFloat(str.replace(",", "."))` (запятая и точка).

**Выход:**
```js
{ anchors: [{ city, from, to, value, pct, raw }],
  special: [{ kind:"sbp"|"nerez", pair?, side?, settle?, from?, to?, value, raw }],
  skipped: [{ line, reason }] }
```

**Нормализация направления — `resolveRateValue({value,pct}, fromKind, toKind)`:**
```js
if (pct) return 1 + value/100;          // маржа на ~1:1 (USDT↔USD)
if (!fromCash && toCash) return value;  // crypto→cash: 1 USDT = N TRY  (как есть)
if (fromCash && !toCash) return value===0?null:1/value; // cash→crypto: инверсия
return value;                           // cash↔cash как есть
```
Единица: число — это «сколько TO за 1 FROM» после нормализации; для cash→crypto вход инвертируется (менеджер пишет «N кэша за 1 крипту»).

**Привязка к офису — `CITY_OFFICE_MATCHERS` (KNOWN):**
```js
ANT: /antal/i ;  IST: /istanbul|стамбул/i ;
MSK: city/name === "moscow" (строго) ;  SPB: /st\.?\s*pt|spb|peterburg|питер|спб/i
resolveCityOffices(city, offices) -> [office.id, ...]
```
`buildMorningUpdates()` оставляет только пары, где одна сторона = USDT, резолвит `officeIds`, считает rate, отдаёт `{ officeId, from, to, rate, city, raw }`; нераспознанное → `skipped`.

### 2.3 ratesPasteParser.js / xlsxRates.js (KNOWN)
- `ratesPasteParser.js`: одна строка, `->|→|>`, percent-aware (`isPercentPair`, `percentToRate = 1+v/100`); если текущий курс пары < 1 (хранится реципрокно) — вход инвертируется (`1/value`). Статусы строк: `new|updated|unchanged|error`.
- `xlsxRates.js`: XLSX до 5 МБ, гибкие алиасы колонок; валидация (`from≠to`, `0 < rate ≤ 1e10`), `rate.toFixed(10)`; diff к текущим (`new|updated|unchanged`), дубли — последняя побеждает.

---

## 3. Модель хранения

### 3.1 Таблицы Supabase (KNOWN — `supabase/migrations`)

**`public.pairs`** (глобальные курсы, `0001_init.sql:179`):
```sql
from_currency text FK currencies(code)
to_currency   text FK currencies(code)
base_rate     numeric(20,10) not null
spread_percent numeric(8,4) not null default 0
rate          numeric(20,10) GENERATED ALWAYS AS (base_rate*(1+spread_percent/100)) STORED
is_default    boolean default false
is_master     boolean            -- добавлено в 0046 (направление-«мастер»)
priority      smallint default 50
updated_at    timestamptz default now()
updated_by    uuid FK users(id)
-- UNIQUE (from_currency,to_currency) WHERE is_default   (один дефолт на пару)
```

**`public.office_rate_overrides`** (по офису, `0021_office_rate_overrides.sql:19`):
```sql
PK (office_id, from_currency, to_currency)
base_rate numeric(20,10), spread_percent numeric(8,4) default 0,
rate numeric(20,10) GENERATED ALWAYS AS (base_rate*(1+spread_percent/100)) STORED,
updated_at, updated_by
-- UDF effective_rate(office_id,from,to): override → иначе глобальный pairs.rate
```

**`public.rate_snapshots`** (аудит, `0001_init.sql:196`): `office_id?`, `created_by`, `reason`, `rates jsonb {"USD_TRY":44,...}`, `pairs_count`, `created_at`. Пишется перед каждым `import_rates`.

**`public.currencies`**: `code pk`, `type ('fiat'|'crypto')`, `symbol`, `decimals`. **`public.offices`**: `id`, `name`, `city`, `timezone`, `working_hours`, `min_fee_usd`, `fee_percent`, `status`, `active`. Сид-офисы: Mark Antalya (Antalya), Terra City (Antalya), Istanbul (Istanbul).

### 3.2 Привязка офис + время (KNOWN)
- Офис: глобальный курс в `pairs` (без офиса) + переопределение в `office_rate_overrides` (по `office_id`). Эффективный = override → глобальный.
- Время: единственный таймстемп — `pairs.updated_at` / `office_rate_overrides.updated_at`. Отдельного «утро vs текущий» НЕТ — все строки «текущие»; история только в `rate_snapshots` (jsonb-слепки). (INFERRED: снапшоты — архив, в UX не показываются.)

### 3.3 Realtime / «LIVE» (KNOWN)
- Стор: `src/store/rates.jsx` (`loadPairs()`, `loadOfficeRateOverrides()`, `getRate()`), сид-фолбэк `SEED_PAIRS`.
- «LIVE» в `RatesSidebar.jsx` = реактивная привязка к перезагрузке, **не** вебсокет-стрим. Триггер обновления — событие `bumpDataVersion()` (`src/lib/dataVersion.jsx`): после успешного RPC → `onDataBump(reload)` → `loadPairs()`.
- `RateChangeBanner.jsx` — **отдельно** подписан на Supabase Realtime UPDATE по `pairs` (баннер «курс изменил X»), фильтрует свои правки. (KNOWN по коду агента; realtime именно для баннера, не для значений в ленте.)

---

## 4. Где курсы применяются (KNOWN, файл → как берётся)

**Единая точка чтения — `getRate(from, to, officeId)` (`src/store/rates.jsx:316`).** Приоритет:
```
1) office override (прямой)   2) office USDT-pivot
3) глобальный прямой          4) глобальный USDT-pivot   → иначе undefined
pivotRate(from,to): from→USDT × USDT→to  (морнинг-парсер, USDT — единственный пивот)
```

| Место | Файл | Как берётся курс |
|---|---|---|
| Выбор курса в строку сделки | `src/lib/dealForm/pickRate.js` | по направлению in/out, при обратном — `1/rate`; ручной → `rateManual=true` |
| Сборка платежа сделки | `src/lib/dealForm/buildTx.js` | курс только на OUT-ноге; `rateSource = manual|market` |
| Таблица ног сделки | `src/components/cashier/DealLegsTable.jsx`, `LegRow.jsx`, `RateCell.jsx` | `marketRate = getRate(inCurrency, legCurrency)`; кнопка «сбросить к рынку» |
| Спред-индикатор | `src/components/cashier/SpreadIndicator.jsx` | `(current-market)/market*100`, порог опасности 5% |
| Автокомплит курса (Global + офисы) | `src/components/deal-form/DealRateAutocomplete.jsx` | `getRateRaw(from,to,officeId)` по каждому офису + глобально; freshness-метки |
| Капсула курса в форме | `src/components/deal-form/DealRateBlock.jsx` | rate + источник (office/global/manual) + маржа |
| Старая форма обмена | `src/components/ExchangeForm.jsx` | `getRate=(f,t)=>getRateRaw(f,t,currentOffice)`; авто vs `manualRate`; мин-комиссия через `computeNetOutput` |
| OTC | `src/components/OtcDealModal.jsx` | курс из сумм (`to/from`); рыночный — только подсказка автозаполнения |
| Конвертация сумм | `src/utils/convert.js` | прямой → триангуляция через **USD**; нет пути → `0` + warn; `hasRatePath()` для предчека |
| Маржа/нетто/остаток | `src/utils/money.js` | `computeNetOutput`, `computeProfitFromRates` (маржа = `amount/actual − amount/market`, в USD через `getRate(curIn,USD)`) |
| Спред-математика | `src/utils/spread.js` | `getMidRate` (USD-триангуляция), `computeSpread=(r/mid-1)*100` |
| Оценка балансов/казны | `src/components/Balances.jsx`, `src/pages/treasury_v2/tabs/DashboardTab.jsx`, `src/lib/treasury/postingEntry.js` | `convert(amount,ccy,base,getRate)`; нет курса → 0 / ошибка «No FX rate» |
| Курс готовой сделки (слип/лента) | `src/lib/treasury/dealSummary.js`, `cashier/DealDetail.jsx`, `CashierDealRow.jsx` | `rate = out/in` (из проводок, НЕ из таблицы курсов) |

**Выбор для конкретной сделки:** по офису + паре + направлению через `getRate(...)`; при отсутствии — `undefined`/`0` и предупреждение (см. §7). Бот/мини-апп/калькулятора в ЭТОМ репозитории нет (INFERRED: они в CoinPoint).

---

## 5. Авто-курсы и кросс-курсы

### 5.1 Спред / наценка (KNOWN + INFERRED)
- KNOWN: `spread_percent` хранится на паре и на офис-override; `rate` = `base_rate*(1+spread/100)` (генерируемая колонка). Правится owner/admin (RLS, §6). Ручной курс в сделке (`manualRate=true`) обходит авто, **не пишется в БД** (только на сделку).
- KNOWN: спред-индикатор сделки = `(rate/mid−1)*100`, `mid` через USD-триангуляцию (`spread.js`).
- INFERRED: на расчёт суммы сделки спред-as-display не влияет напрямую — суммы считаются по `getRate`/введённому курсу; `spread_percent` влияет на хранимый `rate` через генерируемую колонку.

### 5.2 Авто-курс (KNOWN)
`src/utils/tradingRates.js`: `forward = getRate(base,quote)`, `backward = getRate(quote,base)` или синтетика `1/forward` (флаг `backwardSynthetic`). Комиссия в курс НЕ зашита (база отдельно, спред отдельно). Обратная пара синтезируется на чтении, если в БД её нет.

### 5.3 Кросс-курсы (KNOWN) — блок «КРОСС-КУРСЫ»
Файл: `src/components/rates/CrossRatesPanel.jsx`
```js
usdtPer(x, getRate) = Number(getRate("USDT", x))   // «сколько x за 1 USDT»
для пары (a,b):  fwd = usdtPer(a)/usdtPer(b)        // → (зелёная)
                 rev = usdtPer(b)/usdtPer(a)        // ← (серая)
```
То есть USD/TRY, USD/EUR, TRY/EUR выводятся через **USDT-пивот** делением. Округление `fmtCross()`: ≥100→2, ≥10→3, ≥1→4, ≥0.01→5, иначе 6 знаков, запятая, без хвостовых нулей. Считается на клиенте при каждом рендере (в БД не кэшируется). Для РФ-офисов (RUB) кросс не показывается (`RatesSidebar.jsx`).

### 5.4 «LIVE» / триггеры пересчёта (KNOWN)
Пересчёт не по таймеру: правка курса → RPC → `bumpDataVersion()` → `loadPairs()` → ре-рендер сайдбара и кросс-курсов. Свежесть — `src/utils/rateFreshness.jsx`: <1ч `fresh`🟢, 1–6ч `stale`🟡, >6ч/нет `outdated`🔴 (по `updated_at`). Это **визуальная** метка, авто-инвалидизации нет.

### 5.5 Мастер-пара и синхрон обратной (KNOWN)
`0046_master_pair_model.sql`: одна «мастер»-пара на логическую пару (направление по priority: USDT<USD<EUR<GBP<CHF<TRY<RUB — см. оговорку ниже), триггер `sync_reverse_pair()` пишет обратную `base_rate = 1/master.base_rate`. `import_rates` (`0015`/`0049`) пишет атомарно: снапшот → upsert мастера → синхрон обратной; опц. `buy_rate` отдельно переопределяет обратную сторону. (Оговорка: точный порядок priority в разных агентских отчётах назван по-разному — **открытый вопрос §7**.)

---

## 6. Роли / RLS / офисы (KNOWN)
- Роли (`src/store/auth.jsx`, `public.users.role`): `owner > admin > accountant > manager`. Определение — `f_role()` (`select role from users where id=auth.uid()`), на фронте — флаги `isOwner/isAdmin/...`. Секреты — только env-имена (значения не выводим).
- RLS на курсах (`0001_init.sql`, `0021`): **SELECT — любой авторизованный**; **INSERT/UPDATE/DELETE `pairs` и `office_rate_overrides` — только owner/admin**; `rate_snapshots` INSERT — owner/admin/accountant.
- RPC-авторизация (`0042_rpc_authorization.sql`): `_require_role([...])` (42501 при отказе). `update_pair` — accountant/admin/owner; удаление офис-override — owner/admin; `create_deal` — manager/accountant/admin/owner.
- Офисы: единый список (`offices`), курсы **различаются по офисам** через override поверх глобальных. Текущий офис фронта — `localStorage coinplata.office` (`src/store/auth.jsx`).

---

## 7. Краевые случаи и открытые вопросы
- **Нет курса для пары:** `convert()` → `0` + throttled `console.warn`; критичные места должны звать `hasRatePath()`. Проводки: ошибка «No FX rate». (KNOWN)
- **Устаревание:** TTL только визуальный (1ч/6ч); автоинвалидизации/блокировки сделки по «протуху» нет. (KNOWN/INFERRED)
- **Синтетическая обратная пара:** `1/forward`, помечается `backwardSynthetic` (UI может приглушать). (KNOWN)
- **USDT-only пивот:** `pivotRate` только через USDT; валюта без пути к USDT не конвертируется. (KNOWN)
- **Ручной override > авто:** `manualRate=true` на сделке, в БД не сохраняется. (KNOWN)
- **Внешние фиды vs внутренние:** конфликт исключён — внешние в `pairs` не пишутся. (KNOWN)
- **Замороженный курс сделки:** сделка ссылается на `rate_snapshot_id`; поздние правки курсов не переоценивают её. (KNOWN из схемы `deals`)
- **Открытый вопрос — ориентация EUR:** `resolveRateValue` ориентируется по «крипта/кэш», что верно для TRY/RUB (USDT сильнее), но потенциально переворачивает EUR (EUR дороже USDT) — это та же природа бага, что чинили в CoinPoint. Нужно проверить на реальном утреннем тексте, как именно Paramon пишет `USDT->EUR` / `EUR->USDT`, и не уезжает ли пара в обратную сторону. (INFERRED — требует проверки на данных.)
- **Открытый вопрос — порядок priority мастер-пары:** в коде/миграциях встречаются разные перечисления (USDT-first vs USD-first). Уточнить по `0046`/`0049`. (INFERRED)
- **Открытый вопрос — спец-курсы СБП/НЕРЕЗ:** парсятся в `special[]` и `rpcReplaceSpecialRates()`, но влияют ли на расчёт сделок или только отображаются — не подтверждено. (INFERRED)

---

## 8. Граница касса CoinPlata ↔ CoinPoint
- **Две раздельные БД Supabase.** Курсы кассы (`pairs`/`office_rate_overrides`) и курсы CoinPoint (бот/сайт/мини-апп) — независимы, **синка курсов между ними нет**. (KNOWN)
- Что в кассе: вся модель курсов из §2–6 (источник Paramon-текст → `pairs`/overrides → применение в сделках/казне).
- Что в CoinPoint (не лезли вглубь из этого прогона): заявки клиентов (`bot_orders`), свои курсы для бота/сайта/мини-аппа.
- Связь (ПРЕДЛОЖЕНА, НЕ реализована) — `docs/orders-in-ledger-compat.md` (свежий, 2026-06-27): второй supabase-js клиент в кассе для чтения `bot_orders` из CoinPoint (env `VITE_COINPOINT_SUPABASE_URL`, `VITE_COINPOINT_SUPABASE_ANON_KEY`, опц. realtime-флаг), маппинг город→офис теми же `CITY_OFFICE_MATCHERS`. Это про **заявки**, а не про курсы; курсами системы не обмениваются.

---

### Сводка файлов
- Парсеры: `src/utils/morningRatesParser.js`, `ratesPasteParser.js`, `xlsxRates.js`
- Стор/резолвер: `src/store/rates.jsx` (`getRate`), `src/lib/dataVersion.jsx`
- Применение: `src/lib/dealForm/*`, `src/components/cashier/*`, `src/components/deal-form/*`, `src/components/ExchangeForm.jsx`, `src/utils/convert.js`, `money.js`, `spread.js`, `tradingRates.js`
- Кросс/LIVE/свежесть: `src/components/rates/CrossRatesPanel.jsx`, `RatesSidebar.jsx`, `RateChangeBanner.jsx`, `src/utils/rateFreshness.jsx`
- Схема/RPC/RLS: `supabase/migrations/0001_init.sql`, `0015_import_rates_rpc.sql`, `0021_office_rate_overrides.sql`, `0042_rpc_authorization.sql`, `0046_master_pair_model.sql`, `0049_*`
- Граница: `docs/orders-in-ledger-compat.md`
