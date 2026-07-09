# RATES_MAP — карта курсов (сайт · бот · касса)

> Фаза 1 (read-only разведка). Ничего не менялось. Задача — понять, как устроены курсы
> в трёх ролях, чтобы затем спланировать «касса = источник истины».
> Дата: 2026-07-09. Метод: 3 параллельных read-only агента по репозиториям + сверка.

---

## Для не-технаря (суть за минуту)

Сейчас существуют **ДВА независимых мира курсов**, и оба каждое утро заряжаются одним и тем же текстом Paramon, но **порознь**:

1. **Мир coinpoint (сайт + бот + мини-апп)** — курсы лежат в базе coinpoint (таблица `rates`, по городам ANT/IST/MSK/SPB). Их правят **из менеджерского бота (`/setrates`)** и **из веб-админки** — и то и другое пишет в одно место. Сайт, мини-апп, бот и мониторинг Exnode берут курс из одного API (`/api/rates`).
2. **Мир кассы (CoinPlata)** — у кассы **своя** база и своя логика (`pairs` + офисные override + `getRate`), правят курсы **своим** утренним импортом Paramon, матрицей офисов, редактором и авто-Rapira. Наружу касса курсы **не отдаёт** — они живут только внутри кассы.

Между этими мирами **нет курсового моста**: связаны только по заявкам (мост заявок coinpoint↔касса через секрет). Это **разные Supabase-проекты**.

**Что это значит для цели «касса = источник истины»:** нужно (а) чтобы курсы редактировались только в кассе, (б) касса начала **отдавать** курсы наружу (сейчас такого эндпоинта нет вообще), (в) coinpoint (сайт/бот/мини-апп) стал брать курсы из кассы, а своё редактирование — отключить (заглушки). Главная сложность — **разные модели** (пары кассы ↔ «направления» coinpoint, офис ↔ город) и **разные базы**.

---

## Сводная таблица (по ролям)

| Роль | Где живут курсы | Как считается | Кто правит | Кто потребляет |
|---|---|---|---|---|
| **Касса** (coinplata, Supabase `ygtphuxzazxdtyouxxir`, схемы public/ledger) | `pairs` (global), `office_rate_overrides` (per-office), `special_rates` (НЕРЕЗ/СБП), `external_rates`+view (Rapira), `rate_snapshots` | `getRate(from,to,office)` каскад: office override → office USDT-пивот → global → global-пивот; маржа `base·(1+spread%)` или `market+margin`; сделки — серверный `effective_rate()` | Paramon-импорт, матрица офисов, редактор пар, авто-Rapira, XLSX | Только внутри кассы: сайдбар, панели, создание ордера, RatesPage. **Наружу — ничего** |
| **Сайт + Мини-апп** (coinpoint / cp-admin-chats `web/`, Supabase `coinpoint`) | `coinpoint.rates` (append-only, per-city), + `directions`, `currencies`, `bot_settings`, `rate_locks` | Курс = готовое число из `rates.rate` (маржа уже зашита менеджером); per-city; кросс через USDT; city-commission; swap-markup; авто cash↔cash | Веб-админка `/admin` (RatesEditor, RatesCityGrid) → `POST /api/admin/rates[/bulk]` | Сайт-калькулятор, cash-карточки, мини-апп (calc/rates/exchange), `/rates.xml` (Exnode) — все через `GET /api/rates` |
| **Бот** (coinpoint / cp-admin-chats `bot/`, тот же Supabase `coinpoint`) | Та же `coinpoint.rates` (одна БД с сайтом) | То же (готовое число, per-city, USDT-кросс, city-fee, moscow-restriction). Спреда/маржи в коде НЕТ | **Менеджер-бот `/setrates`** (Paramon-блок) + авто-детект блока курсов → INSERT в `rates`. Legacy `/setrate` → `directions.rate` (мёртвый) | Клиент-бот «📊 Курсы», менеджер `/rates` и `/quote`, кабинет сайта (`init.post`) |

---

## C.1 Касса (coinplata)

**Supabase:** проект кассы (id из Vercel env `VITE_SUPABASE_URL`; в разведке — `ygtphuxzazxdtyouxxir`). Схемы `public`/`ledger`/`operations`.

### Хранение

| Сущность | DDL | Поля | Статус |
|---|---|---|---|
| `public.pairs` — глобальные пары (Currency→Channel→Pair) | `0001_init.sql:179` (+ `is_master` `0046`, realtime `0012`) | `from_currency, to_currency, base_rate, spread_percent, rate (generated = base·(1+spread/100)), is_default, priority, is_master` | В репо |
| `pairs.market_rate/buy_margin/sell_margin` — модель «рынок+маржа» | **нет DDL** (RPC `set_pair_margins`, read `supabaseReaders.js:137`) | `market_rate, buy_margin, sell_margin` | **ad-hoc** |
| `public.office_rate_overrides` — per-office поверх global | `0021_office_rate_overrides.sql:19` | PK `(office_id,from,to)`; `base_rate, spread_percent, rate (generated)` | В репо |
| `public.special_rates` — НЕРЕЗ TOD/TOM + СБП QR (снимок Paramon) | **нет DDL** (RPC `replace_special_rates`, read `supabaseReaders.js:1229`) | `kind, pair, side, settle, from/to_currency, value, imported_at` | **ad-hoc** |
| `public.external_rates` (+ view `v_external_rates_latest`) — снимки Rapira | **нет DDL** (insert `api/rapira/sync.js:71`) | `source, pair, bid, ask, mid, raw, fetched_at` | **ad-hoc** |
| `public.rapira_alert_state` — референс антиспама волатильности | **нет DDL** (`api/rapira/sync.js:80`) | `pair, ref_mid, ref_at` | **ad-hoc** |
| `public.rate_snapshots` — история курса на момент сделки | `0001_init.sql:196` | `office_id, created_by, reason, rates(jsonb), pairs_count` | В репо |

> ⚠️ **Системный риск:** весь «новый» слой (маржа на pairs, external_rates+view, special_rates, rapira_alert_state и их RPC) **не имеет DDL в `supabase/migrations/`** — применялся ad-hoc. Репозиторий не воспроизводит схему курсов кассы.

### Расчёт — `getRate(from, to, office)` (`src/store/rates.jsx:316-347`)
1. `from===to` → 1
2. Office direct override (`office_rate_overrides`)
3. Office USDT-пивот (по офисным якорям `from→USDT→to`)
4. Global default (`pairs`, default-пары)
5. Global USDT-пивот
6. иначе `undefined`

Пивот — `morningRatesParser.js:174` (`from→USDT→to = leg1·leg2`). Маржа — `base·(1+spread%)` (generated) ИЛИ `market+margin` (`set_pair_margins`). Спред derived — `src/utils/spread.js` (USD-триангуляция). Покупка/продажа — отдельные записи в `pairs` (`0036`), `src/utils/tradingRates.js`. Display-инверсия при `rate<1` — `src/lib/rates.js:18`. Rapira — `src/lib/rapiraSpreads.js` (`mid·(1∓spread)`). НЕРЕЗ/СБП **не в getRate** — только инфо-панель. **Фактический курс сделки в проде считает серверный `effective_rate()`** (`0045`), не фронтовый `getRate` (тот — для preview/prefill).

### Ввод (кто пишет курсы)
| Источник | Файл | Пишет в |
|---|---|---|
| Paramon (утренний текст) | `morningRatesParser.js` → `RatesImportModal.jsx:210` | `office_rate_overrides` (якоря) + `special_rates` (НЕРЕЗ/СБП) |
| Rapira авто (cron) | `api/rapira/sync.js` (тянет `api.rapira.net`) | `external_rates` + `rapira_alert_state` |
| «Авто по Rapira» (матрица) | `RatesPage.jsx:398` | `office_rate_overrides` (RU-офисы) |
| Матрица офисов | `OfficeRatesMatrix.jsx` → `RatesPage.jsx:372` | `office_rate_overrides` |
| Редактор пар (drawer/таблица) | `RatesTable/RatesMarginEditor` → `RatesPage.jsx:222/334/308` | `pairs` (update_pair / set_pair_margins / set_all_pair_spreads) |
| XLSX | `RatesImportModal.jsx:174` | `pairs` + `rate_snapshots` |

Write-RPC — `src/lib/supabaseWrite.js`.

### Потребители (внутри кассы) + «все курсы»
Загрузка в `RatesProvider` при монтировании + на `onDataBump`; realtime на `pairs`/`rate_snapshots`. Читают через `getRate`: `RatesSidebar`, `MasterRatesPanel`, `CrossRatesPanel`, `NerezPanel`, `cashier/RatesPanel`, создание ордера (`CreateOrderForm`, `dealOperations`, `LivePreview`). **Страница «все курсы» кассы = `src/pages/RatesPage.jsx`** (редактор + матрица + Rapira + coverage). Внешний виджет — `ExternalRatesWidget` (`v_external_rates_latest`).

### Наружу / извне
- **Наружу касса курсы НЕ отдаёт** — эндпоинта-выдачи нет (в `api/` только `rapira/sync` входящий и `cashdesk/*` — заявки/алерты).
- **Извне:** `api.rapira.net/open/market/rates` → `external_rates` (единственный внешний источник).
- **Мост coinpoint** — только заявки + ретрансляция Rapira-алерта (текст, не курсы).

---

## C.2 Сайт + Мини-апп (coinpoint / cp-admin-chats `web/`)

**Supabase:** схема `coinpoint`, `service_role` (env `NUXT_SUPABASE_URL`/`NUXT_SUPABASE_SERVICE_ROLE_KEY`). Клиент за курсами в Supabase напрямую НЕ ходит — только через свои `/api/*`.

### Хранение
| Что | Где | Файлы |
|---|---|---|
| Курсы (append-only) | `coinpoint.rates`: `direction (FK), rate, city (ANT/IST/MSK/SPB \| NULL), created_at`. «Текущий» = newest по (direction,city) | `admin/rates.post.ts`, `rates.get.ts:35` |
| Направления/валюты | `coinpoint.directions` (min/max/active/sort), `coinpoint.currencies` (`code`,`ticker`,`type`,`network`) | `rates.get.ts:35`, `stores/exchange.ts` |
| Конфиг цены | `coinpoint.bot_settings.data` (jsonb): `city_commissions, swap_markup, cash_margins, cash_manual_dirs, city_pairs, rate_lock_minutes` | `exchange/config.get.ts`, `RatesEditor.vue:303` |
| Фиксация курса «на час» | `coinpoint.rate_locks` (DDL в репо не найден — ad-hoc) | `rates/lock.post.ts` |
| Фолбэк без БД | хардкод `FALLBACK_RATES` | `web/server/utils/fallback.ts` |

### Расчёт
Курс = число из `rates.rate` как есть (маржа зашита менеджером; поверх `/api/rates` ничего не накручивает). Per-city (`rates.get.ts:69`), USDT-кросс-пивот (`:112`), спред-задание `web/app/utils/spread.ts`, USD-паритет `usd-parity.ts`, ориентация при импорте `rates-parser.ts:128`, city-commission `city-commission.ts`, swap-markup `swap-markup.ts`, авто cash↔cash (движок в боте). Детектор инверсии `rate-sanity.ts`.

### Редактирование (на сайте)
Веб-админка `/admin` → вкладка rates: `RatesEditor.vue` (одиночный + bulk Paramon) и `RatesCityGrid.vue` (сетка курс×город) → `POST /api/admin/rates` / `/api/admin/rates/bulk` (под `requireManager`, `service_role`) → INSERT `coinpoint.rates`. Парсер общий с ботом (`web/server/utils/rates-parser.ts` ≡ `bot/src/util/rates-parser.ts`). `PATCH /api/admin/directions/[id]` — только min/max/active (не курс).

### Потребители
| Кто | Откуда | Частота |
|---|---|---|
| Сайт-калькулятор | `GET /api/rates?city=X` | client-only, refresh по «часу» |
| Cash-карточки | `/api/rates?city=X` | при загрузке + смена города |
| Мини-апп (calc/rates/exchange) | `/api/rates` + `/api/directions` | при загрузке, localStorage-кэш `cp_rates` |
| Telegram-бот (каталог) | тот же `/api/rates` (CATALOG_API_URL) | ~5 мин |
| Exnode-мониторинг | `GET /rates.xml` | no-store, ~10 с |

Все — `cache-control: no-store`.

---

## C.3 Бот + Связи (coinpoint / cp-admin-chats `bot/`)

**Supabase:** та же БД, схема `coinpoint` (`bot/src/store/supabase.ts`). Одна база с сайтом.

### Расчёт в боте
Спреда/маржи в коде НЕТ — `amountTo = amountFrom · rate` (`bot/src/exchange/money.ts:45`). Per-city (`getCityRate`, `supabase.ts:1439`), USDT-кросс при отсутствии прямого. City-fee + moscow-restriction (`money.ts:81-156`). Клиент-поток `bot/src/flows/rates.ts`, калькулятор `exchange/wizard.ts`.

### Редактирование из менеджерского бота — КЛЮЧЕВОЕ (`bot/src/manager/rates.ts`)
| Команда | Хендлер | Пишет |
|---|---|---|
| `/setrates` + вставка Paramon-блока | `handleSetRatesCommand → applyBulkRatesShared` (`:76-216`) | **INSERT `coinpoint.rates` (direction, rate, city)** + rate-reminders + дозревание draft-заявок |
| Авто-детект блока (без команды) | `looksLikeBulkRates` (`:90`) | то же |
| `/setrate <id> <rate>` | `handleSetRateCommand` (`:51`) | ⚠️ **LEGACY** → `directions.rate` (никто не читает, «мёртвая») |
| `/rates`, `/quote` | `:18`, `manager/rate-quote.ts` | только просмотр/отправка |

### Связи
- **Сайт ↔ бот:** общая БД + общий парсер. Доп. моста нет.
- **coinpoint ↔ касса:** только **заявки** через `web/server/api/internal/cashdesk/*` (`x-cashdesk-secret`). Офис-маппинг `coinpoint.cashdesk_office_map` (ANT/IST/MSK → UUID кассы, `0065`), клиенты `cashdesk_client_map` (`0066`). Курс уходит в кассу только как **поле заявки** (`bot_orders.rate`), не как справочник. **Общих курсовых таблиц нет. Разные Supabase-проекты.**

---

## Единая схема потока (сейчас)

```
                         УТРЕННИЙ ТЕКСТ PARAMON (один и тот же)
                          │                                  │
        ┌─────────────────┘                                  └──────────────────┐
        ▼ (мир coinpoint)                                                        ▼ (мир кассы)
  бот /setrates ─┐                                              Paramon-импорт кассы (RatesImportModal)
  /admin RatesEditor ─┤ общий парсер                                   │
                      ▼                                                 ▼
             INSERT coinpoint.rates                        office_rate_overrides + pairs + special_rates
             (append-only, per-city)                              │ (+ Rapira → external_rates,
                      │  newest per (dir,city)                     │    матрица, редактор пар)
        ┌────────┬────┴────┬─────────┬──────────┐                  ▼
     сайт   cash-карты  мини-апп   бот-клиент  rates.xml     getRate(from,to,office)  ──▶ сайдбар/панели
     (/api/rates, no-store, USDT-кросс)        (Exnode)      [+ серверный effective_rate    RatesPage
                      │                                        для сделок]                  создание ордера
              rate_locks (фикс. на час)
                      
   coinpoint ──x-cashdesk-secret──▶ /api/internal/cashdesk/{orders,alert,...} ◀── касса
                        (ТОЛЬКО заявки + ретрансляция Rapira-алерта; КУРСОВОГО ФИДА НЕТ)
```

**Ключевой разрыв:** два хранилища курсов (`coinpoint.rates` ⟷ `pairs`/`office_rate_overrides`) заряжаются одним Paramon, но независимо; между ними нет ни общей таблицы, ни API. Касса наружу курсы не публикует.

---

## Модельное соответствие (что придётся мапить при миграции)

| Ось | coinpoint | Касса |
|---|---|---|
| Единица курса | `direction` (пара по `currencies.code`, напр. `USDT_TRC20→TRY_CASH`) | `pair` (from/to currency + канал) / результат `getRate` |
| География | `city`: ANT / IST / MSK / SPB (или NULL) | `office_id` (UUID): Mark Antalya, Terra City, Istanbul, Москва Вася |
| Уже есть маппинг офис↔город | `coinpoint.cashdesk_office_map` (ANT/IST/MSK → UUID кассы) | тот же |
| Модель хранения | append-only history, «текущий» = newest | pairs (base+spread / market+margin) + office overrides |
| Комиссии/наценки | `bot_settings` (city_commissions, swap_markup, cash_margins) | office.feePercent/minFeeUsd + серверный effective_rate |
| Спец-блоки | (нет НЕРЕЗ/СБП как отдельной сущности) | `special_rates` (НЕРЕЗ TOD/TOM, СБП QR) |

Соответствие **city↔office уже частично решено** (`cashdesk_office_map`). Главная незакрытая часть — **direction↔pair** (коды валют с сетью/каналом vs пары кассы) и **комиссии** (в coinpoint они отдельно от курса, в кассе — в серверном расчёте сделки).

---

## Не проверено / что нужно достать

1. **Project-ref обоих Supabase** (касса vs coinpoint) — в репо только пустые `.env.example`. Взять из Vercel/Supabase, чтобы на 100% подтвердить, что это разные проекты (в разведке — разные схемы и разные секреты, косвенно да).
2. **DDL ad-hoc объектов кассы** (`external_rates`+view, `special_rates`, `rapira_alert_state`, колонки маржи на `pairs`, RPC `set_pair_margins/replace_special_rates/import_rates`) — нет в миграциях; снять с живой БД.
3. **DDL `coinpoint.rate_locks`** — используется, но миграции нет; снять с БД.
4. **`effective_rate()` кассы vs фронтовый `getRate`** — два разных «итоговых курса»; для источника истины решить, какой канонический (сделки считает SQL, витрины — JS).
5. **`init.post.ts` сайта берёт курс без city-фильтра** (newest по всем городам) — расходится с ботом (строгий per-city); проверить, баг или намеренно.
6. **Legacy `/setrate` → `directions.rate`** — подтвердить, что не читается, перед выпилом.
7. **Движок авто cash↔cash** (источник tolunaylar, `cash_margins`) — живёт в боте; при миграции решить его судьбу.
8. **Реальное покрытие `pairs` кассы** (какие валюты, битые курсы) — не снималось.

---

*Read-only. Ничего не менялось. Дальше — `RATES_MIGRATION_PLAN.md` (Фаза 2, только предложение).*
