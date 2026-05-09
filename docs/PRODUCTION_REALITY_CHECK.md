# PRODUCTION_REALITY_CHECK.md

**Diagnostic snapshot — 2026-05-09**
**Branch:** `cutover/direction1` (HEAD `896bb3e`)
**Production URL:** `coinplata.vercel.app`
**Production deploy from:** `main` (HEAD `b0c325f`)
**Author:** Claude Code (diagnostic only — нет правок кода, нет PR)

---

## TL;DR (читать первым)

> **Продукт в проде сломан и менеджеры не работают в нём 2 дня.**
>
> - Последняя реальная сделка в БД: **2026-05-07 07:17 UTC**. Сегодня **2026-05-09**. За 2 дня — **0 deals в `public.deals`, 0 в `ledger.transactions`**.
> - Два feature flag-а **включены** в Vercel: `VITE_USE_NEW_DEAL_FORM=true`, `VITE_USE_NEW_LEDGER=true`. То есть кассиры видят НОВУЮ форму и она пытается писать в **новый ledger**.
> - Cron `ledger.audit_alerts` каждый час кричит **`critical — Detected 13 balance mismatches`**: opening balances в `ledger.balances` есть, а соответствующих `journal_entries` НЕТ. Расхождение ≈ **50 000 USD + USDT**.
> - Treasury раздел (Лоро / Ностро / Капитал, который Кирилл хочет) — **3 placeholder**-таба «раздел в разработке». Не сделано ни одного KPI.
> - Cutover `cutover/direction1` ещё **не в main** — 2 коммита висят в feature-ветке (#16, #17).
>
> **Рекомендация:** немедленно откатить feature-flags в Vercel в `false`/удалить → менеджеры снова смогут работать в legacy ExchangeForm. Затем разобраться, почему DealForm v2 + adapter не пишут в ledger.

---

## 1. Что реально показывается пользователю в production

`coinplata.vercel.app` собирается из ветки `main` (HEAD `b0c325f` — _W4 widget polish_, PR #15). При обоих включённых флагах путь рендеринга сделки следующий:

| Слой | Путь | Что видно |
|---|---|---|
| Routing | `App.jsx:191-194` | `Cashier` (transactions section) |
| Кассирская страница | `src/pages/CashierPage.jsx:611-628` | `formMounted` → ветка `USE_NEW_DEAL_FORM` |
| Форма | `src/components/cashier/DealForm.jsx:273-372` | **DealForm v2** (новая) |
| Layout формы | `DealForm.jsx:273` | `flex gap-3 items-start` — слева `DealLegsTable` (`flex-1`), справа `RatesPanel` (`hidden xl:block` — sidebar 480 px при ≥ 1280 px ширины) |
| Submit | `dealOperations.createDeal()` (`src/lib/dealOperations.js:37`) | при `USE_NEW_LEDGER=true` → `adaptLegacyDealPayload()` → `rpcCreateDealV2` → **`ledger.create_deal_v2`** |

Раздел **Treasury** (id `treasury`, пункт меню `nav_treasury` в `Header.jsx:20`) показывает три таба, каждый — заглушка:

- `src/pages/treasury/NostroTab.jsx:9-19` — «Наши счета у других банков и контрагентов. Раздел в разработке.»
- `src/pages/treasury/LoroTab.jsx:9-18` — «Счета контрагентов и партнёров у нас. Раздел в разработке.»
- `src/pages/treasury/CapitalTab.jsx:8-18` — «Собственный капитал, фонды, резервы. Раздел в разработке.»

Раздел **Capital** (id `capital`, тот же permission `capital`) — это _старый_ дашборд: 6 табов (Overview / P&L / Income-Expense / Referrals / RateHistory / Accounting), наполнен и работает. Он не пуст. Owner мог их перепутать.

`OpenObligationsWidget` (создан в PR #14) **не подключён ни в одну страницу** — единственное упоминание в `src/components/cashier/README.md:35`.

---

## 2. Какие feature flags активны / неактивны

В Vercel **Production** environment (подтверждено owner-ом):

| Flag | Vercel value | Эффект | Что пишет |
|---|---|---|---|
| `VITE_USE_NEW_DEAL_FORM` | `true` | `DealForm` v2 (легги-таблица + RatesPanel sidebar) вместо `ExchangeForm` | UI |
| `VITE_USE_NEW_LEDGER` | `true` | `dealOperations.createDeal/createTransfer/createTopup/createBalanceAdjustment` идут в `ledger.create_deal_v2` / `create_transfer` / `create_adjustment` через `newLedgerAdapter` | `ledger.transactions` |

В коде flag читается ровно в двух местах:

- `src/pages/CashierPage.jsx:14-15` — `USE_NEW_DEAL_FORM = import.meta.env.VITE_USE_NEW_DEAL_FORM === "true"`
- `src/lib/newLedger.js:493-495` — `USE_NEW_LEDGER = import.meta.env.VITE_USE_NEW_LEDGER === "true"`

⚠️ **`.env.local.example` (`/.env.local.example`) не упоминает оба флага** — там только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. То есть для разработчика, который копирует пример, они **не зафиксированы как часть конфигурации**, и легко пропустить, что в Vercel они уже включены.

⚠️ **Switcher не покрывает все операции**. `dealOperations.js:87-96` — `updateDeal`, `deleteDeal`, `completeDeal`, `deleteTransfer`, `settleObligation*`, `cancelObligation`, `recordPartnerInflow/Outflow` — все они **жёстко legacy `rpc*`** и пишут в `public.deals` независимо от `USE_NEW_LEDGER`. Это значит: новая сделка летит в `ledger.transactions`, но любая последующая операция над ней — в `public.deals`. Гарантированный split-brain.

---

## 3. Различие между `main` code и production deploy

| | Commit | Тема |
|---|---|---|
| `origin/main` HEAD (что задеплоено в prod) | `b0c325f` | _feat(ui): widget polish — filters panel + cancel modal (W4 + W2) (#15)_ |
| `cutover/direction1` HEAD (что у тебя локально) | `896bb3e` | _feat(cutover): crypto input/output subtypes + 4-param opening overload (#17)_ |

Между ними **5 коммитов** (см. `git log origin/main..HEAD`):

```
896bb3e feat(cutover): crypto input/output subtypes + 4-param opening overload (#17)
7c7fcea feat(cutover): extended inventory — crypto wallets + inter-office balances (#16)
75c4dcd merge main: integrate partners section + restored cutover validations
3fa1ab9 feat(cutover): drop partner_balance support (owner decision B)
b02fe0b feat(ledger-cutover): direction 1 — opening + verify + freeze helpers
```

**Вывод**: в продакшене **нет** crypto-subtypes (`cutover_4_*`), нет 4-param opening overload, нет inter-office accounts seed. Но связанные **миграции БД уже применены** (см. `cutover_2_inter_office_accounts_seed_v2`, `cutover_3_create_opening_extended_inventory`, `cutover_4_crypto_subtype_migration`, `cutover_5*` — все в Supabase). То есть **БД ушла вперёд кода** на 2 коммита.

DealForm v2 / Direction 2 / Operations Workflow — всё **уже в `main`** (через PR #3-#15) и **в проде** работает, просто не используется.

---

## 4. Конкретные visual bugs (со слов owner-а + подтверждения из кода)

### B1. «Два курса слева и справа, layout нарушен» в форме создания сделки
**Owner-описание (verbatim):** _«UI создания сделки выглядит сломанным (два курса слева и справа, layout нарушен)»_

**Код-якорь:** `src/components/cashier/DealForm.jsx:273-372`. Layout — `flex gap-3 items-start`:
- Слева `DealLegsTable` (`flex-1 min-w-0`) — внутри каждой leg-row есть колонка **«Курс»** (`HEADERS = ["", "Валюта", "Сумма", "Курс", "Тип", "Счёт", ""]` — `DealLegsTable.jsx:12`).
- Справа `RatesPanel` (`hidden xl:block`) — отдельный sidebar со списком всех пар.

То есть на экранах ≥ 1280 px курсы появляются и в строках таблицы, и в правом sidebar — это **дизайн-намерение** (left = «курс этой leg», right = «справочник курсов офиса»), но без визуального якоря пользователь видит «два места с курсами» и не понимает, какой главный.

**Скриншота от owner-а нет** — в отчёте описано так, как owner это сформулировал. До получения скрина точное определение бага (например: дубликаты значений, перекошенный grid, RatesPanel закрывает поля при определённой ширине) **открыто**.

### B2. Treasury Dashboard пуст
**Owner-описание:** _«Капитал раздел пустой (Treasury Dashboard не сделан)»_

**Код-якорь:** все три файла в `src/pages/treasury/` — `Nostro/Loro/CapitalTab.jsx` — буквально `<section>...раздел в разработке</section>`. Это **не bug**, это **not done** (см. § 5).

Возможно owner видел `nav_treasury` (Treasury) и зашёл туда, ожидая дашборд. Старый `Capital` page (`/pages/CapitalPage.jsx`) — другая страница, она наполнена.

### B3. Бухгалтерских проводок нет в UI
**Owner-описание:** _«Бухгалтерских проводок в UI нет»_

**Код-якорь:** в коде существуют:
- `src/components/DealDetailPanel.jsx:422` — секция _«Бухгалтерские проводки (Дт / Кт / Сумма)»_, но она построена из legacy `deal_legs` + `deal_in_payments`, **не** из `ledger.journal_entries`.
- `src/pages/capital/AccountingTab.jsx` — accounting feed (approve/reject), берёт из view `v_accounting_feed` (UNION по 5 типам) — **тоже legacy**.

Журнала из `ledger.journal_entries` (двойная запись из v2) в UI **нет вообще**. Не написана ни одна страница, которая читает `ledger.transactions` / `ledger.journal_entries` / `ledger.balances`. Это not done.

### B4. Менеджеры физически не создают сделок 2 дня (наблюдаемо)
| Day | `public.deals` created | `public.audit_log` create | `public.audit_log` update |
|---|---|---|---|
| 2026-05-07 | 1 (last deal at 07:17) | 33 | 37 |
| 2026-05-08 | **0** | 0 | 3 |
| 2026-05-09 | **0** | 0 | 1 |

С момента, когда были включены v2 флаги, **ни одна сделка не записалась ни в `public.deals`, ни в `ledger.transactions` (которое и так = 0 строк)**. То есть либо менеджеры в массовом порядке отказались от системы, либо форма крашится на submit и они не могут продолжить.

### B5. Балансы в `ledger.balances` рассинхрон с `ledger.journal_entries`
Cron `ledger.audit_alerts` (`level=critical`) каждый час создаёт алерт:

> _«Detected 13 balance mismatches between balances and journal_entries»_

Образец 2026-05-09 14:05 UTC:

| account_id (LSB) | currency | computed (jrnl) | materialized (balances) | diff |
|---|---|---|---|---|
| `19e9811b…` | USDT | 0 | 200 | +200 |
| `9f469b88…` | USDT | 0 | 300 | +300 |
| `74e872cd…` | USDT | 0 | 400 | +400 |
| `88d57de4…` | USDT | 0 | 500 | +500 |
| `52d83665…` | USDT | 0 | 600 | +600 |
| `48472e8e…` | USDT | 0 | 1 000 | +1 000 |
| `3fbf5900…` | USDT | 0 | 2 000 | +2 000 |
| `b9be7c67…` | USD | 0 | 4 000 | +4 000 |
| `695727a8…` | USD | 0 | 11 000 | +11 000 |
| `beb4329b…` | USDT | 0 | 150 | +150 |
| `b4c07dd0…` | USDT | 0 | 5 075 | +5 075 |
| `582403cb…` | USD | 0 | 15 000 | +15 000 |
| `fcb01c29…` | USDT | 0 | 10 225 | +10 225 |

Σ ≈ **30 000 USD + 19 850 USDT расхождения**. Все 13 строк в одну сторону: `materialized > computed`. Это значит `ledger.balances` получил opening-числа (через `cutover_3_create_opening_extended_inventory` или родственную миграцию), но **journal_entries не были созданы** — значит либо opening-RPC засеял балансы напрямую без проводки, либо сделанные проводки потом были удалены/откатились.

Это **не visual bug**, это data-integrity issue, но он будет всплывать в Treasury / Капитал / Audit, как только их подключат.

---

## 5. Known incomplete features (Treasury Sprint 1-3 = NOT done, не bugs)

Сравниваю требования Кирилла из контекста проекта (Лоро / Ностро / Капитал / FX-позиция / двойная запись) с реализацией:

| Что хочет Кирилл | Где должно быть | Статус |
|---|---|---|
| **Ностро** (наши активы — кеш, крипто, банки, биржи) | `src/pages/treasury/NostroTab.jsx` | ⛔ Placeholder «в разработке» |
| **Лоро** (обязательства перед клиентами/партнёрами) | `src/pages/treasury/LoroTab.jsx` | ⛔ Placeholder «в разработке» |
| **Капитал** (Активы − Обязательства, фонды, резервы) | `src/pages/treasury/CapitalTab.jsx` | ⛔ Placeholder «в разработке» |
| **Открытая FX-позиция** (главный риск-индикатор) | — | ⛔ Не существует ни UI, ни компонент. `grep -rn "fx_position"` в `src/` = ноль. |
| **Журнал проводок (Дт / Кт / Сумма)** из ledger | — | ⛔ Нет страницы которая читает `ledger.journal_entries`. Существующие «проводки» в `DealDetailPanel.jsx:422` и `AccountingTab.jsx` — legacy. |
| **ОСВ / Шахматка** | — | ⛔ Нет |
| **OpenObligationsWidget** | `src/components/...` | ⚠ Создан в PR #14, но **не подключён в layout**. В сделочной форме его нет. |
| **operations workflow в UI** (статусы deal_workflow) | — | ⛔ `operations.deal_workflow = 0 rows`, и UI на view `v_open_deals` нет. |

**Вывод:** Treasury MVP, который Кирилл сформулировал как обязательное условие, **существует как backend-инфраструктура** (миграции `operations_*`, `direction2_*`, `ledger_*` применены, RPC написаны и тесты зелёные), но **в frontend-е не реализован ни одним рабочим компонентом**. Это _scope не сделан_, а не «сломано».

---

## 6. Рекомендация — что делать первым приоритетом

### P0 — немедленно (часы, не дни): остановить кровотечение

1. **Откатить v2 флаги в Vercel Production env**:
   - `VITE_USE_NEW_DEAL_FORM=false` (или удалить)
   - `VITE_USE_NEW_LEDGER=false` (или удалить)

   Эффект: кассиры снова видят `ExchangeForm` (стабильную) и пишут в `public.deals` через legacy `rpcCreateDeal`. Менеджеры разморозятся за один редеплой (`vercel --prod` с нуля или `Redeploy` в UI). Перед редеплоем — предупредить менеджеров, что во время refresh может слететь черновик в `sessionStorage`.

2. **Заглушить cron `ledger.audit_alerts`** ИЛИ **исправить opening-несоответствие**: 13 critical алертов в час засоряют любой следующий debugging. Минимум — поднять threshold до уровня, при котором не алертит на opening. Идеально — найти источник rows и удалить их (если opening-balances «фиктивные» — `DELETE FROM ledger.balances WHERE …` при остановленных журналах).

3. **Зафиксировать факт пустого ledger** в README или RUNBOOK: `ledger.transactions=0`, `operations.deal_workflow=0` — формально cutover ещё не запущен, и эта строка в RUNBOOK сейчас врёт читателю.

### P1 — следующая неделя: понять, почему DealForm v2 не пишет

После отката флагов — снять production stress, потом отладить новую форму **на staging/preview**, **не на prod**:

1. **Воспроизвести submit-failure** в DealForm v2 локально с production-like данными. Гипотезы (по убыванию вероятности):
   - `adaptLegacyDealPayload` бросает на каком-то реальном сценарии (партнёр в IN/OUT, one-sided deal, cross-currency transfer, legacy_only account). См. `newLedgerAdapter.js:29-31, 95-97, 130-132, 142-144, 173-175, 281-283` — все throw-ы помечены _«Disable VITE_USE_NEW_LEDGER for this operation»_.
   - `accountCodeByLegacyId` (DealForm.jsx:42-50) — карта может быть пустой, если ни один account не имеет `ledgerAccountCode`.
   - `errorMapper` обновлён в `0978a7e` — если backend вернул код, который mapper не понимает, тост может скрыть ошибку.
2. **Закрыть split-brain в `dealOperations.js:87-96`**: либо все update/delete/complete/settle тоже маршрутить через v2, либо явно blokировать UI кнопок (Edit / Delete / Settle), пока `USE_NEW_LEDGER=true`. Текущее состояние — гарантированный data drift.
3. **Перенести `VITE_USE_NEW_*` в `.env.local.example`** с дефолтом `false` и комментом, чтобы любой dev сразу видел, что они существуют.

### P2 — после реальной стабилизации: Treasury MVP для Кирилла

Только когда форма работает в проде хотя бы 3-5 рабочих дней без алертов:

- **Не строить Treasury поверх legacy `public.deals`** — это даст Кириллу те же цифры, которые у него уже есть.
- Подключить `OpenObligationsWidget` в `CashierPage` — это уже написано.
- Treasury Sprint 1: **читалка `ledger.balances`** → собрать Ностро / Лоро / Капитал из journal_entries _только когда они начнут наполняться_. До тех пор — таб «в разработке» честнее, чем фейковый дашборд.
- FX-позиция — отдельный ticket, нужен `ledger.fx_position_history` (таблица уже есть, 0 rows).

### P3 — отдельно: security

- **9 ledger таблиц без RLS** (advisory от Supabase MCP, level=`critical`):
  `ledger.currencies, ledger.accounts, ledger.transactions, ledger.journal_entries, ledger.balances, ledger.idempotency_keys, ledger.fx_position_history, ledger.balance_anomaly_config, ledger.config`.
  Любой клиент с anon-ключом может читать/писать в них. Перед публичным cutover — обязательно ENABLE RLS + написать политики (минимум `auth.role() IN ('service_role','authenticated')` на read и только `service_role` на write).
- Не запускать blanket `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` без политик — это сломает все RPC (которые `SECURITY DEFINER` могут пройти, но клиентский SDK — нет).

---

## Что НЕ сделано в этом отчёте (для следующей итерации)

- **Скриншот production** для bug B1 — без него точная природа «два курса слева и справа» не определена. Нужно от owner-а.
- **`vercel.json`** в репо имеет только rewrites/headers; **`netlify.toml`** тоже присутствует и активен (rewrite `/* → /index.html`, cache headers). Какой из платформ реально обслуживает `coinplata.vercel.app` — не верифицировано (по названию домена — Vercel; `netlify.toml` остался от старой инсталляции и должен быть удалён). Vercel CLI в системе **не установлен** (`npm i -g vercel`), `.vercel/project.json` отсутствует — env-vars в Vercel я не мог запросить через MCP-плагин, потому что он требует teamId. Owner подтвердил значения вручную.
- **Production runtime logs** — без Vercel CLI не подняты.
- **Список ВСЕХ visual багов в DealForm v2** — собран только тот, что назвал owner; формальное a11y/UX-ревью — отдельная задача (можно через `frontend-design` skill после устранения P0-P1).

---

_Конец диагностики. Следующий шаг — решение owner-а: откатываем флаги? Чиним форму? Идём на Treasury?_
