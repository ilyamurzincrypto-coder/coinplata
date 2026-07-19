# AEGIS — Интеграция кассы, Phase 0 (разведка)

> **Статус:** read-only разведка. Кода и миграций **не применялось**. Дата: 2026-07-19.
> **Цель:** карта того, что уже есть в кассе, и план части B, чтобы стартовать сразу после готовности контракта AEGIS /v1.
> Все факты сверены с живой БД (проект `ygtphuxzazxdtyouxxir`) и кодом на `main`.

---

## TL;DR

- Криптосчёт в кассе = **ровно один (валюта, сеть, адрес)**. 9 активных крипто-счетов, 9 разных адресов, 0 без адреса. «Мнемонический» кошелёк (одна seed-фраза, много сетей) в модели **не существует** — он раскладывается на несколько счетов (напр. `W89 Lara` = ERC20 + TRC20 = 2 счёта).
- Поскольку адресов на счёт **никогда не >1**, поля AEGIS кладём **колонками на `public.accounts`** (переиспользуя уже существующие `address`/`network_id`), **без отдельной таблицы** `account_wallets`. DDL — в §2, **не применён**.
- Инфраструктура крона есть (`vercel.json` → Vercel Cron), гейт `CRON_SECRET`. Rapira/Tolunay — готовые шаблоны фолбэк-поллинга AEGIS.
- Вебхуки: серверные endpoints с секретами есть, но **HMAC-проверки подписи в репо нет ни одной** — `api/aegis/webhook.js` будет первой. Дедуп по `delivery_id` — новая таблица по образцу `ledger.idempotency_keys`.
- Уведомления: есть **два** механизма — in-UI «колокольчик» (Supabase Realtime) и **Telegram-алерт** (`@coinpoint_manager_bot` через coinpoint-мост, фолбэк — прямой Telegram). Изобретать не нужно; нужен только триггер «кошелёк→critical».
- Границы: заглушка `blockchainApi.js` **не реанимируется**; балансы/риск — только из AEGIS в кэш-колонки; деньги-инварианты леджера интеграция **не трогает** (это read-only мониторинг).

---

## 1. Модель криптосчетов

**Таблица `public.accounts`** (операционные счета; читается `src/lib/supabaseReaders.js:loadAccounts`). Крипто-релевантные колонки:

| Колонка | Тип | Назначение |
|---|---|---|
| `address` | `text` NULL | адрес кошелька (**уже есть**) |
| `network_id` | `text` NULL | сеть — хранится как `'TRC20'`/`'ERC20'` (**уже есть**) |
| `type` | `text` NOT NULL | `crypto` / `cash` / `bank` |
| `kind` | `text` NULL | generated: `crypto` если `type='crypto' OR network_id IS NOT NULL` |
| `is_deposit`, `is_withdrawal` | `bool` | направление (приём / выдача) |
| `last_checked_block`, `last_checked_at` | `bigint`/`ts` | **курсор старого on-chain стаба** (не AEGIS) |
| `currency_code`, `office_id`, `name`, `active`, `opening_balance` | | базовые |

**Адрес и сеть — уже есть на счёте.** Отдельного «типа Мнемонический» нет:
- `ledger.accounts.custody_type` = только `hot` / `book` / `cash` (не «мнемонический»).
- «Мнемонический» из списка Кирилла (`W-120 Cen 14.07-1CP …`) — это концепт **кошелёк-менеджера** (одна seed-фраза → несколько адресов в разных сетях). В кассе он не моделируется как сущность.

**Один счёт = один адрес.** Проверено на проде:
```
crypto_accts = 9 | distinct_addresses = 9 | no_address = 0
```
Мнемонический кошелёк раскладывается на **несколько счетов** (по одному на сеть).

**Реальные крипто-счета в проде** (без секретов):

| Счёт | Валюта | Сеть | Офис | dep/wd |
|---|---|---|---|---|
| Hot · USDT ERC20 · Istanbul | USDT | ERC20 | Istanbul | ✓/✓ |
| Hot · USDT TRC20 · Istanbul | USDT | TRC20 | Istanbul | ✓/✓ |
| Hot · USDT ERC20 · Mark Antalya | USDT | ERC20 | Mark Antalya | ✓/✓ |
| Treasury · USDT ERC20 (SafePal) | USDT | ERC20 | Mark Antalya | ✓/✓ |
| Treasury · USDT TRC20 (SafePal) | USDT | TRC20 | Mark Antalya | ✓/✓ |
| W88 Mark | USDT | TRC20 | Mark Antalya | ✓/✓ |
| W92 USDT | USDT | TRC20 | Mark Antalya | ✗/✗ |
| W89 Lara · USDT ERC20 | USDT | ERC20 | Terra City | ✓/✓ |
| W89 Lara · USDT TRC20 | USDT | TRC20 | Terra City | ✓/✓ |

Всё — USDT (TRC20/ERC20). BTC-счетов пока нет. Имена `W88/W89/W92` соответствуют W-нумерации из списка Кирилла; `W89 Lara` наглядно показывает «один мнемоник → два счёта».

---

## 2. Куда положить связку AEGIS

### Решение: **колонки на `public.accounts`, без отдельной таблицы**

Правило из ТЗ: *«если адресов на счёт может быть >1 — тогда таблицей»*. Факт из §1: адресов на счёт **ровно 1, всегда** (9/9 distinct). Значит критерий для отдельной таблицы **не выполняется** → расширяем существующую строку счёта. `address` и `network_id` уже там; добавляем только связку/кэш AEGIS.

Нюанс мнемоника решается **без** таблицы: если AEGIS выдаёт один `aegis_wallet_id` на мнемоник (охватывающий и ERC20, и TRC20 адрес), то оба счёта `W89 Lara` просто несут **один и тот же** `aegis_wallet_id` в колонке — это корректно и не требует связной сущности. Отдельная таблица `account_wallets` понадобилась бы только если один счёт начал бы держать несколько адресов — чего в модели нет и не планируется.

> Если позже потребуется **кошелёк-уровневая** агрегация (риск/капабилити на весь мнемоник как first-class объект) — это отдельная будущая сущность `wallet_groups`, **вне скоупа** данной интеграции.

### DDL (предложение — НЕ применять)

```sql
-- AEGIS: связка + кэш риска/баланса на операционном крипто-счёте.
-- Все поля NULLable и НЕ авторитетны для денег (кэш мониторинга).
alter table public.accounts
  add column if not exists aegis_wallet_id   text,                 -- id кошелька в AEGIS (может совпадать у счетов одного мнемоника)
  add column if not exists aegis_capability  text,                 -- капабилити из AEGIS (deposit|withdraw|sign|... — enum уточнить у /v1)
  add column if not exists risk_level        text,                 -- low|medium|high|critical (канон уточнить, см. §5 и открытые вопросы)
  add column if not exists risk_updated_at   timestamptz,          -- когда AEGIS последний раз прислал риск
  add column if not exists balance_usd_est   numeric,              -- КЭШ оценки баланса в USD (дисплей-only, НЕ в леджер)
  add column if not exists synced_at         timestamptz;          -- последний успешный апдейт из AEGIS (вебхук ИЛИ поллинг)

-- Быстрый выбор кошельков под мониторинг.
create index if not exists accounts_aegis_wallet_idx
  on public.accounts (aegis_wallet_id) where aegis_wallet_id is not null;
create index if not exists accounts_risk_level_idx
  on public.accounts (risk_level) where risk_level is not null;
```
- **`address` / `network_id` переиспользуем**, новые не заводим.
- **Нормализация сети:** касса хранит `'TRC20'/'ERC20'` (upper), AEGIS ждёт `trc20|erc20|btc` (lower). Маппинг — на границе (register/webhook), схему не менять. BTC в кассе пока нет.
- **`balance_usd_est` — НЕ источник истины.** Баланс счёта считается леджером (`v_account_balances`, проводки Дт/Кт). Это кэш для витрины/сверки, он **не** участвует в `balanceOf`/journal.

Дедуп-таблица вебхуков — см. §4 (тоже DDL, не применять).

---

## 3. Крон / фоновые задачи

**Инфраструктура крона есть — Vercel Cron** (`vercel.json`):

```json
"crons": [
  { "path": "/api/cashdesk/sync", "schedule": "* * * * *"   },  // 1 мин
  { "path": "/api/rapira/sync",   "schedule": "*/2 * * * *" },  // 2 мин
  { "path": "/api/tolunay/sync",  "schedule": "*/10 * * * *" }  // 10 мин
]
```

- Каждый крон — Vercel serverless `handler(req,res)` в `api/*/sync.js`.
- Гейт — `CRON_SECRET`: `if (cronSecret && req.headers.authorization !== 'Bearer '+cronSecret) → 401` (`api/rapira/sync.js:23-26`). Vercel Cron подставляет этот bearer автоматически.
- Источник Rapira публичный (`https://api.rapira.net/...`, без auth); запись в БД — `SUPABASE_SERVICE_ROLE_KEY` (мимо RLS).
- Прецедент «состояния/курсора» между запусками: `public.rapira_alert_state` (`pair` PK, `ref_mid`, `ref_at`), `public.cashdesk_sync_state`.

**Вывод для AEGIS-поллинга:** тем же механизмом — да. Добавить `api/aegis/poll.js` (чистый шаблон — `api/tolunay/sync.js`: fetch → parse → upsert, без моста) + строку в `vercel.json crons` каждые N минут + гейт `CRON_SECRET`. Поллинг — **фолбэк** к вебхуку (§4): если вебхук не пришёл, крон подтягивает риск/баланс и обновляет те же кэш-колонки + `synced_at`.

---

## 4. Приём вебхуков

**Серверные endpoints с секретами есть** (полный список — в разведке; ключевое):

| Endpoint | Методы | Auth вызывающего |
|---|---|---|
| `api/cashdesk/*` | POST/GET | `requireStaff` (JWT сотрудника + роль из `public.users`) — `api/cashdesk/_auth.js` |
| `api/rapira/sync`, `api/tolunay/sync` | cron | `CRON_SECRET` bearer |
| `api/share/manage` | GET/POST/DELETE | `requireStaff` |
| `api/share/accounts` | GET | публичный, по opaque-токену `share_tokens` (service-role) |

Секреты в env: `CASHDESK_API_SECRET`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `COINPOINT_API_URL`, `RAPIRA_*`, `TOLUNAY_URL`.

**Важно:** **HMAC/подпись входящих запросов в репо не проверяется нигде** (`createHmac`/`timingSafeEqual`/`x-signature` — 0 совпадений). `x-cashdesk-secret` используется только **исходяще** (касса шлёт в coinpoint); приёмник живёт в проекте coinpoint, не здесь. Значит `api/aegis/webhook.js` — **первый** приёмник с проверкой подписи; образца «входящий вебхук с shared-secret» в кассе нет, ближайшее — opaque-токен `api/share/accounts.js` и сравнение `CRON_SECRET`.

### `api/aegis/webhook.js` — предлагаемая форма

1. **Проверка HMAC** (новый секрет `AEGIS_WEBHOOK_SECRET`): `crypto.createHmac('sha256', secret).update(rawBody)` → `crypto.timingSafeEqual` со значением из заголовка подписи AEGIS (имя заголовка/алгоритм — из контракта /v1). При несовпадении → `401`, тело не парсим как доверенное. Нужен **raw body** (на Vercel — отключить авто-JSON или собрать буфер).
2. **Дедуп по `delivery_id`** (at-least-once → возможны повторы). Хранить в **новой таблице Postgres** (Redis не нужен — прецедент уже в БД):
   ```sql
   -- НЕ применять. Дедуп доставок вебхука AEGIS (по образцу ledger.idempotency_keys).
   create table if not exists public.aegis_webhook_deliveries (
     delivery_id   text primary key,          -- id доставки из AEGIS
     event_type    text,
     request_hash  text,                       -- sha256 тела (детект «тот же id, другой payload»)
     received_at   timestamptz not null default now()
   );
   ```
   `insert ... on conflict (delivery_id) do nothing`; если 0 строк вставлено — доставка уже обработана → `200 ok, duplicate` без сайд-эффектов.
3. **Обновление кэша**: по `aegis_wallet_id`/адресу найти счёт(а), записать `risk_level`, `risk_updated_at`, `balance_usd_est`, `synced_at`. Порог-кросс (в warning/critical) → уведомление (§5).

Прецеденты идемпотентности в кассе (для сверки семантики): `ledger.idempotency_keys` (`key`, `transaction_id`, `request_hash`, `expires_at`, `FOR UPDATE`, ошибка `P0422` при том же ключе с другим payload) и клиентский `newIdempotencyKey()` в `src/lib/newLedger.js`.

---

## 5. Уведомления

**Механизм есть — два канала, оба переиспользуемы:**

**A. In-UI «колокольчик»** — `src/store/notifications.jsx` + `src/components/NotificationsBell.jsx` (в `Header.jsx`).
- Хранилище: React state + `localStorage` (`coinplata.notifications`, последние 50).
- Универсальный создатель `pushNotification({type,title,body,link})`.
- События приходят через **Supabase Realtime `postgres_changes`** на таблицах `pairs`/`deals`/`transfers`/`obligations`. Триггера на порог баланса/риска кошелька **пока нет**.
- Клиентский канал: чтобы серверное событие «риск critical» долетело до колокольчика, оно должно **попасть в таблицу, на которую клиент подписан** (либо добавить подписку на новую таблицу, напр. на `accounts` UPDATE `risk_level`, либо на отдельную `wallet_alerts`).

**B. Telegram** — `api/rapira/sync.js:notifyBot()` (единственный telegram-путь):
1. **Основной:** `POST ${COINPOINT_API_URL}/api/internal/cashdesk/alert` с `x-cashdesk-secret` → `@coinpoint_manager_bot` (токен бота живёт в coinpoint, не в кассе).
2. **Фолбэк:** прямой `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` → `TELEGRAM_ALERT_CHAT_ID`.

Контракт — `docs/rapira-alerts.md`. Сейчас шлётся только `kind:'rate_volatility'`.

**Рекомендация:** для «кошелёк ушёл в warning/critical» — **переиспользовать оба**: (1) `notifyBot()`-шаблон с новым `kind:'wallet_risk'` в менеджерский бот; (2) UPDATE `risk_level` на счёте (или запись в `wallet_alerts`) → Realtime → колокольчик кассира. **Новый механизм не нужен.** Открытый вопрос — маршрутизация (кому: менеджеры глобально / по офису / касса конкретного офиса) — это продуктовое решение, см. открытые вопросы.

---

## 6. Импорт списка Кирилла

- **Списка в репозитории нет.** Grep по `W-1xx` / `мнемон` / `Cen` / `1CP` — совпадений нет. Значит список существует **вне кассы** — экспорт из кошелёк-менеджера или ручной реестр (формат нужно получить).
- **Что уже в кассе:** 9 крипто-счетов, у всех есть адрес (см. §1). Физически это ~6 кошельков: `Hot ×3`, `Treasury ×2`, `W88 Mark`, `W89 Lara (×2 сети)`, `W92`.
- **Предлагаемый формат импорта — CSV `name,address,network`** + **ручная привязка офиса в UI** (офис из имени **не** выводить автоматически — имена вроде «W89 Lara» неоднозначны). Импорт создаёт/сопоставляет счёт по `(address, network)`; сеть нормализуем в `TRC20/ERC20/BTC`.
- **Сверка «сколько уже есть»:** на текущий момент в кассе **9 адресов**. Точную долю пересечения со списком Кирилла посчитать нельзя без самого списка — это открытый вопрос (нужен экспорт, тогда матчинг по `address`).

---

## 7. Границы (подтверждение)

- **Заглушка `blockchainApi.js` не реанимируется.** Она *импортируется* `src/store/monitoring.jsx` (`fetcherForNetwork`), но polling **выключен по умолчанию** (`useState(false)`), фетчеры всегда возвращают `[]`, реальные данные идут только через демо-`simulateIncoming()`. Второй стаб — `src/utils/resolveCrypto.js`. **AEGIS их не оживляет:** балансы/риск приходят из AEGIS в кэш-колонки (§2), старый on-chain-поллинг остаётся выключенным/устаревшим. Курсоры `last_checked_block/at` к AEGIS отношения не имеют.
- **Балансы/риск — только из AEGIS.** `balance_usd_est`/`risk_level` — кэш мониторинга; авторитетный баланс — леджер (`v_account_balances`). Эвристический `checkWalletRisk()` из `src/utils/aml.js` (low/medium/high) остаётся для tx-уровня в UI, но **риск кошелька авторитетно — из AEGIS**.
- **Деньги-инварианты леджера не затрагиваются.** Интеграция — read-only overlay: пишет только в свои кэш-колонки/служебные таблицы, **не** трогает `journal_entries`, `create_deal_v2`, резервы, `balanceOf`. Ни одной проводки интеграция не создаёт.

---

## Схема потока

```
РЕГИСТРАЦИЯ (разово / при заведении счёта)
  public.accounts(address, network_id)
        │  register(address, network) →
        ▼
     AEGIS  ──→ { aegis_wallet_id, capability }
        │
        ▼  сохраняем на счёт: aegis_wallet_id, aegis_capability

RUNTIME (риск/баланс)
     AEGIS ──push──► api/aegis/webhook.js
                       ├─ verify HMAC (AEGIS_WEBHOOK_SECRET)
                       ├─ dedup delivery_id → aegis_webhook_deliveries
                       └─ update accounts: risk_level, risk_updated_at,
                                           balance_usd_est, synced_at
        ▲ (фолбэк, если push не пришёл)
     Vercel Cron ──► api/aegis/poll.js ──pull──► AEGIS ──► тот же update кэша

ПОТРЕБЛЕНИЕ
  • UI: раздел «Счета» / дерево — бейдж risk_level + balance_usd_est
  • Порог warning/critical →
       ├─ Telegram: notifyBot() kind:'wallet_risk' → @coinpoint_manager_bot
       └─ In-UI: UPDATE risk_level → Supabase Realtime → колокольчик
```

---

## Открытые вопросы (к контракту /v1 и владельцу)

1. **Гранулярность `aegis_wallet_id`:** на адрес или на мнемоник (охватывает несколько сетей)? Определяет, совпадает ли id у `W89 Lara ERC20`/`TRC20`.
2. **Enum `aegis_capability`:** какие значения? Соотносить ли с `is_deposit`/`is_withdrawal`?
3. **Канон `risk_level`:** ТЗ говорит `warning/critical`, `aml.js` — `low/medium/high`. Нужен единый набор (напр. `low|medium|high|critical`) + маппинг порогов на алерт.
4. **Схема вебхука:** имя заголовка подписи, алгоритм (HMAC-SHA256?), поле `delivery_id`, список `event_type`, гарантии доставки (at-least-once?), тело payload.
5. **Баланс:** AEGIS шлёт `balance_usd_est` пушем или только по поллингу? Частота/актуальность.
6. **Регистрация:** касса вызывает AEGIS `register(address)` → получает `wallet_id`, **или** мы импортируем готовые `wallet_id` из AEGIS/списка Кирилла?
7. **Список Кирилла:** формат и место (экспорт кошелёк-менеджера?), чтобы построить CSV-импорт и сверить адреса.
8. **Маршрутизация алертов (§5):** менеджеры глобально / по офису / касса офиса? Оба канала или только Telegram?
9. **BTC:** когда появятся BTC-кошельки (enum сети уже включает `btc`, счетов нет).

---

## Оценка: что блокирует старт части B (кроме готовности /v1)

| Блокер | Критичность | Комментарий |
|---|---|---|
| Контракт /v1: payload вебхука + схема подписи + enum capability/risk + API регистрации | **Высокая** | Основной блокер; без него нельзя писать `webhook.js`/`poll.js` и зафиксировать enum'ы. |
| Список кошельков Кирилла (формат/экспорт) | Средняя | Блокирует §6 (импорт + сверка), но не мониторинг уже заведённых 9 счетов. |
| Провижн секретов в Vercel: `AEGIS_URL`, `AEGIS_API_KEY`, `AEGIS_WEBHOOK_SECRET` | Средняя | Нужно до деплоя endpoints. |
| Решение по маршрутизации алертов (§5) | Низкая | Механизм готов; это продуктовый выбор. |

**Что НЕ блокирует:** миграция §2 (аддитивные NULLable-колонки) может лечь независимо, как только зафиксированы enum'ы `risk_level`/`capability` — она безопасна для леджера и не ждёт вебхуков. То есть часть B можно начать со схемы + UI-бейджа риска (данные пока пустые), а `webhook.js`/`poll.js` подключить по готовности /v1.
```
