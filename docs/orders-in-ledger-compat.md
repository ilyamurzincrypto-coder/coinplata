# Онлайн-заявки в ленте «Сделки за день» — отчёт совместимости (consumer = касса CoinPlata)

> Фаза разведки. Только чтение. Кода приложения не меняли, миграций/зависимостей нет.
> Producer-сторона (CoinPoint, `bot_orders`) разведана ранее — здесь не перепроверяется.
> Секреты не приводятся — только имена переменных окружения.

Дата: 2026-06-27. Ветка: `main`. Стек подтверждён по коду, схема — по живой БД кассы.

---

## 1. Карта стека (пути к файлам)

**Стек:** React 18 + Vite 5 + Tailwind 3 (НЕ Nuxt/Vue). Состояние — React Context-провайдеры в `src/store/`. Бэкенд — Supabase (один проект кассы). Деплой — Vercel.

| Что | Путь |
|---|---|
| Экран кассира (дашборд, layout, sticky) | `src/pages/CashierPage.jsx` |
| Лента «Сделки за день» (широкая таблица + инлайн-ввод) | `src/components/cashier/ledger/DealsLedger.jsx` |
| Ридер ленты (чтение `deals`+`deal_legs`) | `src/lib/cashierDealsReader.js` |
| Шапка «Остатки в кассе» (sticky) | `src/components/Balances.jsx`, `src/components/balances/BalancesPanel.jsx` |
| Поповер «по офисам» | `src/components/balances/CurrencyByOfficePopover.jsx` |
| Меты валют + ru-RU форматтеры | `src/components/balances/currencyMeta.js` (`BAL_COLUMNS`, `CCY_META`, `fmtRu`, `splitParts`) |
| Боковые курсы | `src/components/RatesSidebar.jsx`, `src/components/rates/*` |
| Supabase-клиент (единственная точка) | `src/lib/supabase.js` |
| Создание сделки (switcher legacy/v2) | `src/lib/dealOperations.js` → `createDeal()` |
| RPC-обёртки записи | `src/lib/supabaseWrite.js`, `src/lib/newLedger.js`, `src/lib/newLedgerAdapter.js` |
| Резолвер город→офис (уже есть!) | `src/utils/morningRatesParser.js` (`CITY_OFFICE_MATCHERS`, `KNOWN_CITIES`, `resolveCityOffices`) |
| Auth / роль / офис | `src/store/auth.jsx`, права — `src/store/permissions.jsx` |
| Справочники | `src/store/currencies.jsx`, `src/store/offices.jsx`, ридеры `src/lib/supabaseReaders.js` |
| Realtime-провайдер | `src/lib/realtime.jsx` (+ прямой `supabase.channel(...)` в `DealsLedger.jsx`) |

Прод-макет целевого UI (источник истины по виду/поведению): `~/Downloads/coinplata-cashier-4.html` (последний).

---

## 2. Модель данных кассы (её Supabase)

Сделка = **1 приход в `deals`** + **N легов расхода в `deal_legs`**.

### `deals` (приход + мета сделки)
- `id` **bigint** (канонический ключ сделки), `office_id` uuid, `manager_id` uuid, `created_by_user_id` uuid
- `client_id` uuid (FK `clients`), `client_nickname` text, `comment` text
- **`currency_in` text**, **`amount_in` numeric**, `in_actual_amount`, `in_account_id` uuid, `in_kind`, `in_partner_account_id`
- `kind` / `type` / `status` text; `profit_usd`, `fee_usd`, `commission_usd` numeric
- `created_at`, `updated_at`, `deleted_at` timestamptz; плюс risk_*, payee_*, flagged_*

### `deal_legs` (расход, по строке на ногу)
- `id` uuid, `deal_id` bigint, `leg_index` smallint
- **`currency` text**, **`amount` numeric**, `actual_amount`, **`rate` numeric**, `account_id`, `out_kind`, `partner_account_id`

### `clients` (контрагенты, «w110»)
- `id` uuid, `nickname` text, `full_name` text, **`telegram` text**, `accounting_code` text (вероятно «w110»-код)
- `is_otc_partner`, `is_referral` bool, `note`, `tag`, `risk_level`/`risk_score`
- **Нет поля `phone`.** Есть только `telegram` → влияет на вариант авто-связки (см. §5).

### `offices`
- `id` uuid, `name` text, `city` text, `status`, `active` bool, `sort_order`, `timezone`, `fee_*`
- **Нет колонки `code`.** (CoinPoint `bot_orders.office` = FK `offices.code` своего проекта.) Матч офиса заявки → офис кассы делается по `city`/`name` (см. §4, §6).

### `currencies`
- `code` text, `symbol`, `type` (`crypto`|`fiat`), `kind`, `decimals`/`scale`, `active`. В ленте/остатках набор зафиксирован `BAL_COLUMNS` = USDT, USD, EUR, TRY, RUB, GBP, CHF.

### RLS / роль кассира
- Касса авторизуется через **Supabase Auth**; зеркало пользователя — `public.users` (`role` text, `office_id` uuid, `status`). Роль вычисляется helper-ом **`f_role()`**.
- **Кассир = роль `manager`.**
- `deals`: SELECT — `owner/admin/accountant/manager`; INSERT — любой authenticated; UPDATE — `owner/admin/accountant` ИЛИ `manager` где `manager_id = auth.uid()`.
- `clients`: SELECT — `true` (любой authenticated); INSERT — любой authenticated; UPDATE — `owner/admin/accountant/manager`.
- RLS включён на `deals`, `deal_legs`, `clients`, `currencies`, `accounts`, `account_movements`, `office_rate_overrides`.

---

## 3. Как лента наполняется сейчас

- **Чтение:** `cashierDealsReader.loadCashierDeals({ officeId, fromIso })` — два запроса supabase-js: `deals` (фильтр `office_id`, `created_at ≥ начало дня`, `deleted_at is null`) + `deal_legs` по `deal_id IN (...)`. Маппинг строки → UI: `party=client_nickname`, приход = `currency_in`/`amount_in`, курс = `deal_legs[0].rate`, расход = массив легов `{ccy, amount}`.
- **Realtime: ДА.** В `DealsLedger.jsx` — `supabase.channel("cashier-deals-ledger")` с `postgres_changes` на `public.deals` и `public.deal_legs` → при любом изменении `refetch()`. Обе таблицы в публикации `supabase_realtime`.
- **UI:** широкая таблица «Контрагент | ПРИХОД [7 валют] | Курс | РАСХОД [7 валют]», заполненная валютная ячейка — зелёная; снизу инлайн-строка ввода → Enter/blur → `createDeal()` (через `create_deal` RPC), no-false-green. Колонки прибыли и строки оборотов нет.
- **Запись новой сделки:** `dealOperations.createDeal(payload)` → (v2) `adaptLegacyDealPayload` → `rpcCreateDealV2`. Требует `officeId` + (`clientId`|`clientNickname`) + `inAccountId` + `outputs[].accountId`. Движения и журнал двойной записи делает RPC.

---

## 4. Предлагаемый межпроектный дизайн интеграции (НЕ реализовано)

Касса (consumer) читает `bot_orders` напрямую из Supabase CoinPoint (producer). **Никакого UNION/общей базы.**

### 4.1 Второй Supabase-клиент (CoinPoint, read-only)
Отдельный клиент рядом с основным `src/lib/supabase.js`:
```js
// иллюстративно — НЕ коммитим в этой фазе
import { createClient } from "@supabase/supabase-js";
export const coinpoint = createClient(
  import.meta.env.VITE_COINPOINT_SUPABASE_URL,
  import.meta.env.VITE_COINPOINT_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, storageKey: "cp-coinpoint-auth" }, // ВАЖНО: не клобберить сессию кассы
  }
);
```
**Ловушки:**
- Два supabase-js клиента на одном origin делят `localStorage`. Обязателен отдельный `storageKey` (или `persistSession:false`), иначе клиент CoinPoint затрёт auth-сессию кассы (`src/lib/supabase.js` использует implicit-flow + `persistSession:true`).
- Касса **не аутентифицирована** в проекте CoinPoint. Чтобы anon-ключ CoinPoint реально отдал `bot_orders`, **на стороне CoinPoint нужна RLS-политика чтения** под нужный контекст (anon с фильтром, либо отдельная сервисная роль/JWT, либо edge-function-прокси). Service-role-ключ во фронте — **нельзя**. → producer-зависимость (§6).

### 4.2 Новые env (имена)
- `VITE_COINPOINT_SUPABASE_URL`
- `VITE_COINPOINT_SUPABASE_ANON_KEY`
- (опц.) `VITE_COINPOINT_REALTIME_ENABLED` — флаг включения подписки.

### 4.3 Канонический ключ заявки
- Использовать **`bot_orders.id`** как стабильный ключ (`meeting_code` NNN-NNN без уникального индекса и может отсутствовать у крипто-крипто).
- Producer-зависимость (опц.): человекочитаемый уникальный `order_code` на стороне CoinPoint — удобнее для подписи строки «из заявки <код>». Сейчас для UI можно показывать `meeting_code` (как лейбл), а связывать по `id`.

### 4.4 Realtime заявок
- Второй клиент подписывается на канал CoinPoint: `coinpoint.channel("orders").on("postgres_changes",{schema:"public",table:"bot_orders",...})`. Требует, чтобы `bot_orders` была в `supabase_realtime`-публикации CoinPoint и RLS пускала чтение (producer-зависимость).
- Начальная загрузка — `select` с фильтром офиса (см. 4.6) + `status='new'`; далее живые INSERT сверху.

### 4.5 «Провести» (обратная запись)
- Касса пишет **СВОЮ** сделку в Supabase кассы из факта: `createDeal({ officeId, clientNickname: contact, currencyIn, amountIn, inAccountId, outputs:[{currency, amount, accountId, rate}] })`.
- Затем **переключает статус заявки в CoinPoint**: `bot_orders.status` `new`→`confirmed` (UPDATE через клиент CoinPoint).
- **Идемпотентность:** не создавать дубль при повторном проведении. Варианты:
  - хранить ссылку на источник в сделке кассы (напр. `deals.comment` или новая колонка `source_order_id` — отметить как опц. consumer-доработку), проверять «уже проведено» по этой ссылке;
  - и/или гейт по `bot_orders.status` (проводим только из `new`; перед записью читаем актуальный статус).
- **Producer-зависимость:** доступ на запись `bot_orders.status` под роль кассира (RLS UPDATE на стороне CoinPoint).

### 4.6 Фильтр по офису
- `bot_orders.office` = код офиса CoinPoint (ANT/IST/MSK/SPB-подобный). Офис кассы — `offices.id` (uuid), без `code`.
- Резолвинг уже есть в кассе: `CITY_OFFICE_MATCHERS`/`resolveCityOffices` (`src/utils/morningRatesParser.js`) матчат код города → офис кассы по `city`/`name` regex. Тот же приём применить к `bot_orders.office`: код заявки → офис кассы → сравнить с текущим выбранным офисом.
- Альтернатива/надёжнее: явная таблица-маппинг `coinpoint_office_code → cashier office_id` (consumer-доработка) — отметить как открытый вопрос (§5).

---

## 5. Открытые вопросы / решения (выбор НЕ делаю)

1. **Связка контрагент (w110) ↔ телеграм-клиент заявки** — два варианта:
   - **(а) авто 1:1 по telegram.** В `clients` **есть** поле `telegram` (text) — технически возможно. Плюсы: без ручной работы. Минусы: формат не совпадает (`bot_orders.contact_telegram` = `@user` или `id<tg>`; `clients.telegram` — произвольный текст, не нормализован; `bot_orders.user_id` = `bot_users.id`, не telegram_id). Высок риск ложных/пропущенных матчей без нормализации. **Поля `phone` в `clients` нет** — матч по телефону невозможен.
   - **(б) ручная привязка кассиром + сохранение маппинга** для повторного использования (новая таблица сопоставления, consumer-сторона). Плюсы: точность, контроль. Минусы: ручной шаг на первый контакт.
   - По согласованному UI на этой фазе **контрагента не резолвим** — показываем сырой контакт из заявки; связку добавляем позже.
2. **`source` (сайт/бот/мини-апп):** в `bot_orders` сейчас НЕ хранится → producer-зависимость (§6). До появления колонки — поле в UI не показываем (или «—»).
3. **Ключ заявки:** `bot_orders.id` (решено). Опц. `order_code` — producer-доработка для красивой подписи.
4. **Доступ к CoinPoint:** какой механизм чтения/записи выбрать (anon+RLS / edge-function-прокси / сервисный JWT) — нужно решение на стороне CoinPoint (§6). От него зависит §4.1.
5. **Маппинг офисов:** regex-резолвер (есть) vs явная таблица-маппинг (надёжнее). Выбрать.
6. **Хранение «пришёл HH:MM» и связи заявка↔сделка:** где (только в CoinPoint `bot_orders`, или зеркалить в кассе) — влияет на идемпотентность §4.5.

---

## 6. Зависимости на стороне CoinPoint (producer)

1. **RLS/доступ к `bot_orders`** для кассы: политика SELECT (чтение заявок офиса) и UPDATE (`status` new→confirmed) под контекст кассира — иначе anon-ключ ничего не отдаст/не запишет. **Блокер интеграции.**
2. **Realtime-публикация** `bot_orders` (`supabase_realtime`) — для живого появления заявок.
3. **Новая колонка `source`** (`site`|`miniapp`|`bot`) — сейчас уходит только в уведомление менеджеру.
4. **Опц. `order_code`** — человекочитаемый уникальный код заявки.
5. (Согласование форматов) нормализация `contact_telegram` / наличие telegram_id — для будущей авто-связки контрагентов.

---

## 7. Рекомендованный план реализации по фазам

- **Фаза 0 (эта):** отчёт совместимости. ✅
- **Фаза 1 — доступ к источнику (producer-блокеры):** на стороне CoinPoint — RLS на `bot_orders` (read + update status), realtime-публикация, решение по механизму доступа (anon+RLS vs edge-function). Без этого consumer писать нечего.
- **Фаза 2 — read-only заявки в ленте:** второй Supabase-клиент (CoinPoint) c отдельным `storageKey`; ридер `bot_orders` (фильтр офиса через `CITY_OFFICE_MATCHERS`); realtime-подписка; рендер «живых» янтарных строк сверху ленты (по макету `coinplata-cashier-4.html`); сырой контакт без резолва контрагента. Без записи.
- **Фаза 3 — действия:** кружок «клиент пришёл» (`пришёл HH:MM`); «провести» → редактируемые суммы/курс (предзаполнены заявкой) → `createDeal` в кассе + `status` new→confirmed в CoinPoint; идемпотентность (ссылка источник↔сделка); пометки «из заявки <код>» / «≠ заявка» с исходными цифрами; визит → пустая инлайн-строка с подставленным контактом.
- **Фаза 4 — связка контрагентов:** выбранный вариант (а)/(б) из §5.1 + сохранение маппинга; показ `source` (после producer-колонки).

---

### Приложение: проверенные факты (consumer)
- Касса = React/Vite, не Nuxt/Vue. Один Supabase-клиент (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, implicit-flow, persistSession).
- Лента уже на realtime (`deals`/`deal_legs`); ридер — `cashierDealsReader.js`.
- Роль кассира = `manager` (через `f_role()`); RLS пускает read/write `deals` и `clients`.
- `clients.telegram` есть, `clients.phone` — нет. `offices` без `code` (матч по city/name; резолвер уже в коде).
- `deals.id` = bigint; ключ заявки = `bot_orders.id`.
