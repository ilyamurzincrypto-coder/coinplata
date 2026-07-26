# План: включение существующего леджера + зеркалирование CP PAY (CoinCash)

Дата: 2026-07-26. Статус: утверждён владельцем. Решение по итогам разведки (см. отчёт-аудит в переписке).

## Суть решения

НЕ пересборка. Двойной леджер (`ledger.*`) уже построен и живёт в проде (cutover 2026-05-10), держит остатки, реконсилится. Реальных клиентских сделок в нём нет (~4 тестовые, последняя 2026-07-01). Поэтому: **закрыть дыру курса → зеркалить структуру/инструменты CP PAY → полная зачистка бизнес-содержимого → новый бизнес с нуля руками эксперта**.

## Жёсткий порядок этапов

```
Этап 1  (валидация курса)              — первым, дыра в деньгах закрывается до всего
  1.5   (структура + инструменты)      — спека после утверждения макета знаков + мастера валют в CP PAY (общие для обоих продуктов)
  предусловия                          — PITR/бэкап + физическая инвентаризация касс владельцем
  1.75  (зачистка)                     — только после 1.5 и предусловий
Этап 2  (реальный поток в леджер)      — на чистой базе с новым планом счетов эксперта
Этап 3  (пересадка решений CP PAY)     — липкость форм, «Сверено», сортировка, знаковая подача по макету Фазы 1
```

---

## Этап 1 — серверная валидация курса (план файлов)

Слайсы независимые, каждый со своими воротами. Прод не трогаем — миграции и тесты на Supabase-ветке.

**Конфиг-дефолты (данные, не код — Кирилл донастроит):**
- `deal_rate_tolerance_pct` = **5** (жёстче ±25%-бэкстопа)
- `deal_rate_enforcement` = **reject**
- `deal_rate_review_pct` — задел под maker-checker, пока не используется

### Слайс 0 — префлайт (read-only)
- Полное тело `ledger.create_deal_v2` и `ledger.assert_deal_rate_sane` из живой БД (подтвердить call-site и текущий `p_tolerance`).
- `grep` писателей `manager_orders.rate` / `cashier_deals.rate`.
- Supabase-ветка (`create_branch`) для миграций/тестов.

### Слайс 1.a — серверный резолвер рыночного курса
- `supabase/migrations/NNNN_ledger_market_rate_resolver.sql` — `ledger.usdt_per(ccy, office_id)` + `ledger.resolve_market_rate(from, to, office_id)`. Повторяет `src/store/rates.jsx` getRate: офис-оверрайд (`public.office_rate_overrides`) → USDT-пивот офиса → глобал-дефолт (`public.pairs is_default`) → глобал USDT-пивот. Ориентация — как `usdtPer` (читаемое >1). Читает `pairs`/`overrides` — они переживают 1.75.
- **Ворота (стоп-условие):** parity-тест резолвера vs фронтовый `getRate` на фикс-наборе. Расхождение = разбор ДО кода энфорсмента.

#### Слайс 1.a — ВЫПОЛНЕНО (2026-07-26, prod, аддитивно)
Функции в проде: `ledger.resolve_market_rate(from,to,office)`, `ledger.usdt_per(cur,office)`, `ledger._global_pair_rate(from,to)` — три `CREATE FUNCTION`, ни одного `ALTER`, никто пока не вызывает. Откат = `DROP FUNCTION`.

**Parity 🟢 GREEN.** Матрица 16 активных валют × 5 живых офисов × оба направления = 1200 ячеек, 210 покрытых. JS-оракул = реальные `buildRatesLookup`/`pivotRate`/`getRate` (verbatim из `src/store/rates.jsx` + `src/utils/morningRatesParser.js`) на живом снимке БД. Результат:
- Расхождений `resolve_market_rate` ↔ `getRate` на 210 покрытых: **0** (относит. eps 1e-6).
- Перекрытие SQL сверх JS: **0** ячеек. Стоп-условие пройдено.

**Карта слепоты старого `public.effective_rate`** (то, что использует нынешний бэкстоп; для эксперта — «где контроль молчал/врал»):
- USDT-направление (`effective_rate(office,'USDT',cur)`): расхождений с `getRate` — **0**. Текущий ±25%-бэкстоп на USDT-оценке считает от ВЕРНЫХ эталонов (проблема только в грубости порога).
- Кросс-пары (non-USDT↔non-USDT): `effective_rate` **врёт на 44 из 210 ячеек** (~21%) — нет офис-пивота и синтеза обратных, берёт битые «=1»-сиды/инверсии. Примеры: Terra City `TRY→RUB` getRate 3672 vs effective_rate 1.75 (×2000); `RUB→CHF` 102.9 vs 1; `TRY→EUR` 53.4 vs 0.019 (инверсия).
- 10 валют без курса вообще (обе функции слепы, рыночных данных нет): `AED, BTC, BUSD, DAI, ETH, KZT, SOL, TON, UAH, USDC` — сделки в них rate-контролю не поддаются, пока не заведут пары.

**Следствие для 1.c:**
- USDT-агрегатная проверка (оценка ног через `ledger.usdt_per`) на покрытых валютах = битово идентична старой (USDT-направление 0 расхождений) → просто тайтним порог до 5%.
- **Основание** (`market_rate` конкретной пары сделки, «база × наценка/спред») читать из `ledger.resolve_market_rate`, НЕ из `effective_rate` — иначе на кросс-парах основание врёт в 44/210.
- Parity-гарнис лежит в scratchpad (`parity.mjs`); при финализации 1.c оформить как коммит-тест-регресс.

### Слайс 1.b — порог конфигом
- `supabase/migrations/NNNN_ledger_deal_rate_config.sql` — сиды `ledger.config`: `deal_rate_tolerance_pct=5`, `deal_rate_enforcement=reject`, `deal_rate_review_pct` (задел).

### Слайс 1.c — энфорсмент + запись основания
- `supabase/migrations/NNNN_ledger_deal_rate_validation.sql` — тело `ledger.assert_deal_rate_sane`: резолвит рыночный курс (1.a), считает вменённый курс сделки (`amtOut/amtIn`, USDT-пивот для мультивалюты), сравнивает с порогом (1.b). Сверх → `RAISE` с новым SQLSTATE (reject).
  - **Задел под 1.d без переделки:** статус/SQLSTATE спроектировать так, чтобы review-ветка добавлялась поверх (enum статуса расширяем, ветку review сейчас не активируем — при `enforcement=reject` это мёртвый код).
- Точечная правка `ledger.create_deal_v2`: записать основание в `transactions.metadata`: `{rate_basis:{base, margin_or_spread, deal_rate, market_rate, source, office_id}}` — «база × наценка/спред = курс», читаемо пост-фактум.
- **Ворота (тест владельца):** инвертированный курс отбивается; в допуске — книжится с сохранённым основанием. 94 существующие проводки не трогаются.

#### Слайс 1.b + 1.c — ВЫПОЛНЕНО (2026-07-26, prod)
Применено: `ledger.config` ключи `deal_rate_tolerance_pct=5 / _enforcement=reject / _review_pct=5 / _uncovered=reject`; переписан `ledger.assert_deal_rate_sane` (config-авторитетен, оценка через `usdt_per`, человеческий текст через `format()`); новый `ledger.deal_rate_basis` (`v_deal = round(out/in,10)`, ключ `deal_rate_orientation=OUT_per_IN`); `create_deal_v2` пропатчен **программно** (`pg_get_functiondef` + 2 `replace`: убран хардкод `0.25`, добавлен `rate_basis` в metadata) — тело байт-в-байт, риск транскрипции исключён.

**Тест-тройка 🟢 GREEN (живой прод, net-zero):**
- *В допуске* (1000 USDT→46200 TRY, Mark Antalya): забукана `posted`; `metadata.rate_basis` читаем — `market_rate 46.2 × spread 0% = deal_rate 46.2`, `usdt_in 1000 = usdt_out 1000`, `primary_pair USDT→TRY`, `orientation OUT_per_IN`, `source ledger.resolve_market_rate`; проводки сбалансированы по валютам → `reverse (cascade)` → **0 счетов с ненулевым сальдо**, статус `reversed`.
- *Инвертированный* (1000 USDT→100 TRY): `P0423` «Курс сделки отклоняется от рыночного на −99.78% (допуск ±5.00%) — проверьте ввод…» — на assert line 92 **до INSERT**; `tx`/`idempotency` не выросли (0 мусора).
- *Uncovered* (BTC): `P0424` «Нет рыночного курса для BTC — заведите валютную пару» — **до INSERT**, 0 мусора.
- Подтверждено: config-авторитетность (текст показал ±5.00% при вызове с 0.25); reject = чистый откат (ни tx, ни idem).
- *Остаток:* 4 net-zero-транзакции (deal+recognition+2 reversal) — сотрутся в 1.75.

**Хвост фронта — фикс не нужен, путь корректен:** `invokeLedger → formatLedgerError (message · details · hint) → throw → withToast → emitToast('error', 'Create deal failed: <фраза> · <hint>')`. Кассир видит человеческий текст, не `P0001`. `formatLedgerError` экспортирован; тест `src/lib/dealRateReject.test.js` (3/3) — «предъявление», что фраза P0423/P0424 доходит до тоста. Итог: 740 тестов, build зелёные.

**Осталось по Этапу 1:** слайс 1.e (`rate` text→numeric в `manager_orders`/`cashier_deals` + писатель `api/cashdesk/sync.js`).

### Слайс 1.d — maker-checker — НЕ строить сейчас
Пока `enforcement=reject` review-коридор мёртв. В 1.c заложены хуки (статус/SQLSTATE), чтобы 1.d добавлялся без переделки. Вернёмся, если эксперт попросит коридор.

### Слайс 1.e — `rate` text → numeric
- `supabase/migrations/NNNN_rate_columns_numeric.sql` — `manager_orders.rate`, `cashier_deals.rate` → `numeric` через `replace(rate,',','.')::numeric`. Риск низкий (mo: 0 плохих; cd: одно `"44,6"`).
- `api/cashdesk/sync.js` + фронт-писатели — писать числом.

### Фронт (хвост Этапа 1)
- `src/lib/newLedger.js` — обработать reject SQLSTATE (office_id + leg.rate уже шлются — подтвердить).
- `src/lib/dealOperations.js` + `src/pages/CashierPage.jsx` / `src/components/**/CreateOrderForm.jsx` — показать отбой курса.
- **Ворота Этапа 1:** инвертированный/вне-допуска курс не садится как деньги; основание пишется; `npm test` + `npm run build` зелёные.

> Зависимость: валидация переживёт 1.75, если новый план счетов эксперта сохранит контракт `fx_clearing`/кодов. Иначе — доводка привязки в Этапе 2.

---

## Этап 1.5 — структура и инструменты заведения (зеркало CP PAY)

Спека приходит после утверждения в CP PAY: **макет знаков (Фаза 1)** и **мастер валют (Фаза 2)** — общие для обоих продуктов. Кратко (детали — отдельным планом):
- **Подача учёта:** группы **Лоро** (клиенты/партнёры — liability) / **Ностро и кассы** (кассы/банки/кошельки офисов — asset) / **Капитал** (позиции/доход/расход — equity/revenue/expense). Единый табличный канон: один строчный компонент, колонки Номер·Имя·Тип·Остаток·₽-эквивалент.
- **Инструменты из UI:** мастер «Добавить валюту» (авто-позиция в Капитале сразу и видимо; крипте — обязательный смарт-контракт + авто-код 4-значный последовательный; фиату — ISO; символ-подсказка; поля не сбрасываются кликом мимо); заведение касс/ностро/кошельков с балансовым счётом (гейт); заведение клиентов-лоро со счетами чекбоксами.
- **Критерий:** сольный прогон эксперта без подсказок — валюта → счёт в Капитале виден → касса → клиент → сделка.

---

## Предусловия перед 1.75 (жёсткие ворота)
1. **PITR / явная бэкап-точка** + `pg_dump` стираемых таблиц в архив-схему `archive_YYYYMMDD`.
2. **Физическая инвентаризация касс офисов** владельцем/экспертом → реальные остатки = opening нового бизнеса.
3. Порядок соблюдён: Этап 1 + 1.5 готовы → снос → эксперт сеет план и openings.

---

## Этап 1.75 — зачистка (границы утверждены)

### 🔴 СТЕРЕТЬ (сначала архив-бэкапом)
`ledger.journal_entries`(94, вкл. майский сид), `ledger.transactions`(37), `ledger.balances`(45), `ledger.accounts`(262 план), `ledger.idempotency_keys/fx_position_history(348)/audit_alerts(15)`, `public.manager_orders`(91), `public.cashier_deals`(1), `public.participant_movements`(34)/`participant_accounts`(8), `public.partners/partner_accounts(9)/partner_account_movements(0)`, пустой скелет 13 таблиц (`deals, deal_legs, deal_in_payments, deal_leg_payments, account_movements, transfers, expenses, obligations, balance_adjustments, cash_closures, blockchain_txs, client_wallets`).

### 🟢 НЕ ТРОГАТЬ
`public.users`(11), `public.offices`(7), `public.audit_log`(691), `public.currencies`(17)/`ledger.currencies`(10)/`public.networks`, `public.external_rates`(558k), `public.rate_snapshots`(606), `public.pairs`(66)/`office_rate_overrides`(41)/`special_rates`(6), крипто-мониторинг (`wallet_aegis_cache`(26)/`wallet_move_alerts`/`aegis_webhook_deliveries`(132)/`cashdesk_sync_state`(3)).

### 🟡 РЕШЕНИЯ ВЛАДЕЛЬЦА (утверждены)
- **`public.clients`(19) — СОХРАНИТЬ.** Живые контакты = справочник, не бизнес-содержимое. Лоро-счета эксперт заведёт заново в 1.5.
- **`public.accounts`(62) — РАСЩЕПИТЬ.** Крипто-строки (26 active) — **нетронуты** (несут `address`/`network_id`/`aegis_wallet_id` для AEGIS/tx-watch). Фиат-строки (cash 27/bank 8) — **стереть**, эксперт пересоздаёт кассы мастерами 1.5. Мост `ledger_account_code` перелинкуется там же.
- **`ledger.wallet_addresses` — СОХРАНИТЬ** как справочник (адрес = физическая реальность, как offices; привязка к новым счетам восстанавливается в 1.5).

---

## Этап 2 — реальный поток в леджер (на чистой базе)
- Дилинг течёт через `create_deal_v2` **всегда**: мёртвые формы `ExchangeForm`/`DealForm`/`NewDealForm` и флаги `USE_NEW_DEAL_FORM*` — выпилить (один флоу = один источник; живая форма — `CreateOrderForm`).
- Income/Expense перестаёт писать в собственный `entries[]` — доходы/расходы книжатся проводками (expense/revenue-счета).
- `manager_orders` получает связку с леджер-сделкой при исполнении (`deal_id` перестаёт быть вечным NULL).
- **Ворота:** день работы кассира → каждая операция в леджере, `v_balance_check` зелёный, забуканная маржа сходится со слипами.

## Этап 3 — пересадка решений CP PAY (только отсутствующее)
Липкие формы (клик мимо не закрывает/не сбрасывает — системно на все формы кассы), «Сверено» + справочник типов под контроль, сортировка/фильтры/поиск по канону таблиц, знаковая подача Лоро/Ностро/Капитал по макету Фазы 1 (единая для обоих продуктов, макет после «да» эксперта в CP PAY), двойная маска номеров при необходимости. План счетов эксперта (262 → новый) НЕ перенумеровывать под наш формат без запроса — нумерация = язык владельца.

---

## Целевая картина `public.accounts ↔ ledger` (утверждена)
Истина = `ledger`. `public.accounts` — операционная витрина с мостом `ledger_account_code`; остатки **генерируются из `ledger.balances`**, поле `opening_balance` умирает. Крипто-строки остаются для мониторинга, фиат-строки создаются мастерами 1.5.

## Не трогать (сквозное)
Крипто-мониторинг AEGIS/TronGrid (read-only, работает), курсы-фиды (7 источников в `external_rates`), существующие 94 проводки (до архивации в 1.75), нумерацию плана счетов эксперта.
