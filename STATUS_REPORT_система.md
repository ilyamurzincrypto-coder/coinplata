# STATUS REPORT — Система (касса CoinPlata)

> Аудит готовности функционала. Продукт: **касса криптообменника** (не сайт).
> Режим: read-only, ничего в коде/БД не менялось.
> Дата прогона: 2026-07-02. Ветка `main`, коммит на момент прогона `d7f8a51`.
> Метод: инвентаризация из кода 6 параллельными агентами + собственные прогоны (build/test/grep) + точечная сверка с прод-БД (`ygtphuxzazxdtyouxxir`).

---

## A. Экзек-саммари (для команды)

Касса **технически работает и уже стоит в проде**: кассир видит остатки и курсы, заводит сделки (в основном через inline-строку в ленте «Сделки за день»), утренние курсы импортируются из текста Paramon, авто-курсы и алерты волатильности с Rapira — живые, заявки из бота (coinpoint) ежеминутно затягиваются в кассу. Под капотом — честная двойная запись в Postgres с триггерными инвариантами (проверено на проде: 0 разбалансов на 37 транзакциях), а Казначейство (Активы/Пассивы/Капитал, ОСВ, шахматка, журнал) сделано добротно. **Но продукт ещё не готов как система, на которую можно опереться в бою**: реального потока сделок через новый леджер почти не было (4 сделки за 1.5 месяца после cutover), а несколько важных вещей либо сломаны тихо, либо не доделаны — прибыль по сделкам не признаётся (заглушка комиссии 0.01 → P&L ≈ 0), часть обязательств из новой формы теряется молча, флоу «заявка → готовая сделка» отсутствует, а денежный контур в БД по состоянию репозитория **без RLS** (балансы клиентов читаются одним anon-ключом). Отдельная системная проблема: **git не является источником правды для БД** — ядро v2-леджера и ~7 боевых RPC применялись напрямую, миграций в репо нет, прод с нуля не воспроизводится. AML — это стаб (фейковые риск-скоры), для криптообменника это комплаенс-риск №1.

**Светофор по областям (обоснованные %):**

| Область | Готовность | Комментарий |
|---|---|---|
| 🟢 Двойная запись (целостность БД) | **85%** | Триггеры Dr=Cr, 0 разбалансов в проде; минус — RLS выкл, DDL не в репо |
| 🟢 Казначейство / отчёты (ОСВ, шахматка, P&L, журнал) | **85%** | Деревья, identity-чек, кассы-группы, 596 зелёных тестов |
| 🟢 Интеграция Rapira (курсы+алерты) | **85%** | Cron+БД+алерты+UI живые и документированы |
| 🟡 Офисы / мультигород | **75%** | Прод-офисы из БД, per-office параметры; store-мутации без персиста |
| 🟡 Telegram / coinpoint-мост | **75%** | Приём заявок живой; обратный канал написан, но фронтом не вызывается |
| 🟡 Курсы (rates) | **70%** | Офисные override + импорт + матрица работают; ~2800 строк мёртвого UI, подтверждение выродилось |
| 🟡 Контрагенты | **70%** | CRUD/архив/профиль на проде; нет дедупа, LTV по нику |
| 🟡 Аудит-лог | **70%** | Пишется в БД, фильтры/CSV; нет IP/diff, полнота на дисциплине |
| 🟡 Остатки / леджер (область целиком) | **62%** | Балансы верны; резервы/«утро»/дельты = 0, P&L фиктивный |
| 🟡 Сделки | **60%** | Создание работает; 2 тихих фин-бага, нет номера/edit/OTC в активной форме |
| 🟡 i18n (en/ru/tr) | **60%** | Словарь 3×1382 без дыр, но ~200 файлов хардкод-русского |
| 🟠 Заявки (orders) | **55%** | Приём+показ есть; флоу заявка→сделка = 0, мост односторонний |
| 🟠 Роли / доступы | **55%** | Роли работают; per-user overrides не персистятся, секции наполовину декоративны |
| 🟠 Бэкенд / безопасность | **55%** | Функционал богатый; денежный контур без RLS + anon-гранты, DDL не в репо |
| 🔴 Воспроизводимость БД из репо | **30%** | Ядро v2 + ~7 RPC + rate-таблицы применены мимо git |
| 🔴 AML / KYT | **10%** | Стаб: фейковые риск-скоры, реальной интеграции нет |

**Общая оценка: ~60%** — «работает как внутренний инструмент под присмотром», но не готово как продукт с финансовыми и комплаенс-гарантиями.

---

## B. Таблица по модулям

| Модуль | Статус | Что работает | Чего не хватает | UI | Тест | Файлы | Риск |
|---|---|---|---|---|---|---|---|
| Курсы | 🟡 | Офисные override, импорт Paramon, XLSX, матрица, сайдбар, Rapira-авто, свежесть/coverage | Подтверждение выродилось, удаление пары не персистится, ~2800 строк мёртвого UI, схема частично не в репо | ✅ | 🟡 (41 тест на утилиты, 0 на UI) | `store/rates.jsx`, `components/rates/*`, `utils/morningRatesParser.js` | средний |
| Сделки | 🟡 | Создание (inline-лента + NewDealForm), multi-IN/OUT, сторно/void, лента realtime | Потеря deferredOut/partial, комиссия→0.01, фиктивные obligation-обёртки, нет №/edit/OTC | ✅ | 🟡 (95 тестов на payload, 0 на живой UI) | `CashierPage.jsx`, `deal-form/NewDealForm.jsx`, `newLedgerAdapter.js` | высокий |
| Заявки + мост | 🟠 | `manager_orders`, cron-приём из coinpoint, показ жёлтыми строками в ленте, «под заявки» | Флоу заявка→сделка (markDone мёртв, deal_id пуст), обратный канал не вызывается | ✅ | ⬜ | `api/cashdesk/sync.js`, `lib/managerOrders.js`, `DealsLedger.jsx` | высокий |
| Остатки / леджер | 🟡 | v2 Dr/Cr, balanceOf через мост-view, opening backfill, заморозка legacy | reserved=0 захардкожен, «утро»/дельты=0, P&L=0.01, клиентские dims не пишутся | ✅ | ✅ (596) | `store/accounts.jsx`, `lib/newLedger.js`, `lib/treasury/*` | высокий |
| Казначейство | 🟢 | Активы/Пассивы/Капитал деревья, ОСВ, шахматка, P&L, журнал, кассы-группы, identity-чек | Пассивы-по-контрагентам пусты (нет dims), авто-закрытия периода нет | ✅ | ✅ | `lib/treasury/v2selectors.js`, `pages/treasury_v2/*` | низкий |
| Контрагенты | 🟡 | CRUD клиентов/партнёров, архив, поиск, профиль/LTV | Нет дедупа, LTV по текстовому нику, партнёрский профиль-заглушка | ✅ | 🟡 | `pages/counterparties/*`, `store/partners.jsx` | средний |
| Роли / доступы | 🟠 | 4 роли, матрица, `useCan`, серверный `_require_role`, гейтинг страниц | Overrides не персистятся (F5 сброс), сервер знает только роль, часть секций декоративна | ✅ | ⬜ | `store/permissions.jsx`, `pages/settings/PermissionsTab.jsx` | высокий |
| Офисы | 🟡 | 7 прод-офисов из БД, CRUD с персистом (OfficesTab), per-office minFee/часы | Store-мутации не пишут в БД, seed-рудименты | ✅ | ⬜ | `store/offices.jsx`, `pages/settings/OfficesTab.jsx` | средний |
| i18n | 🟡 | DICT 3×1382 без расхождений, fallback, выбор языка | ~200 файлов с хардкод-кириллицей вне DICT | ✅ | ⬜ | `i18n/translations.jsx` | средний |
| Аудит-лог | 🟡 | Запись в БД, фильтры/поиск/CSV, ~20 источников | Нет IP/diff, полнота на дисциплине вызовов | ✅ | ⬜ | `store/audit.jsx`, `pages/settings/AuditLogTab.jsx` | средний |
| Rapira + алерты | 🟢 | Cron */2, external_rates, детектор волатильности, «Авто по Rapira» | Спреды хардкод (кроме USDT_RUB), таблицы не в репо | ✅ | ⬜ | `api/rapira/sync.js`, `lib/rapiraSpreads.js` | низкий |
| Telegram / мост | 🟡 | Алерты в coinpoint (+Telegram fallback), приём заявок | Обратный канал не вызывается, доставка best-effort | 🟡 | ⬜ | `api/cashdesk/*.js` | средний |
| AML / KYT | 🔴 | UI-бейджи риска | Реальной интеграции нет — стаб (hash-скоринг) | ✅ | ⬜ | `utils/aml.js`, `store/monitoring.jsx` | **критический (комплаенс)** |
| Бэкенд (Supabase) | 🟠 | public-RLS зрелый, RPC-слой, idempotency, cron-мосты | ledger.* без RLS, anon-гранты, DDL v2 не в репо, plaintext-пароли в миграциях | — | 🟡 | `supabase/migrations/*`, `api/*` | **критический** |

---

## C. Детализация по областям

Ниже — полные секции по каждой области с доказательствами (файл:строка).

---

### C.1 Курсы (rates) — ~70%

| Подобласть | Статус | Что работает | Чего нет | Файлы |
|---|---|---|---|---|
| Модель пар (Currency→Channel→Pair, `getRate`) | ✅ | Загрузка `public.pairs`, каскад override→USDT-пивот→global | Channel-модель декоративна; мутаторы local-only | `store/rates.jsx:316-347` |
| Удаление пары | ⚠️ | Кнопка Delete → только локальный стейт | RPC `delete_pair` нет вообще — после reload пара возвращается | `RatesPage.jsx:460`, `rates.jsx:418` |
| Маржа/спред base×(1+spread%) | ✅ | `update_pair`, bulk `set_all_pair_spreads`, инлайн-правка | — | `supabaseWrite.js:1002-1084`, миграции 0037/0060/0062/0065 |
| Модель «рынок + маржа» | 🟡 | `set_pair_margins`, RatesTable editMargin | Миграций нет в репо; `sellMargin` не редактируется; RatesMarginEditor мёртв | `RatesPage.jsx:334`, `RatesTable.jsx:224` |
| Импорт Paramon (утро) | ✅ | Парсер городов/%/СБП/НЕРЕЗ, preview, upsert по офисам | Только USDT-якоря; `special_rates` без миграции | `utils/morningRatesParser.js` (32 теста) |
| Импорт XLSX | ✅ | 3-шаговая модалка, diff, `import_rates` атомарно | — | `RatesImportModal.jsx`, миграции 0015/0049 |
| Кросс-курсы | ✅ | USDT-пивот в getRate/сайдбаре | 3 разные базы триангуляции (USDT/USD) — расхождение | `CrossRatesPanel.jsx`, `utils/spread.js` |
| Спец: НЕРЕЗ (TOD/TOM) | ✅ | Парсинг → `special_rates` → NerezPanel | В движке сделок не участвует | `NerezPanel.jsx` |
| Спец: QR RUB (СБП) | 🟡 | Парсится, создаёт пару ch_rub_sbp | Отдельного UI-блока нет | `RatesImportModal.jsx:218` |
| Спец: CNY/Юань | ⬜ | — | Ни одного упоминания в src | — |
| Confirmation (draft→confirmed) | ⚠️ | Баннер, `confirm_rates`→snapshot | Статус in-memory (F5 сброс); «подтверждено» = любой snapshot за сегодня; `modifiedAfterConfirmation` в проде недостижим | `RatesConfirmationBanner.jsx:37`, миграции 0006/0017 |
| Rapira авто-курс ± спред | ✅ | Cron */2 → external_rates → кнопка «Авто по Rapira» | Ручное применение; спреды хардкод; external_rates без миграции | `api/rapira/sync.js`, `rapiraSpreads.js` |
| Волатильность-алерты | ✅ | Детектор 1.5%, пуш в бот + Telegram fallback, `?test=1` | rapira_alert_state без миграции, нет тестов | `api/rapira/sync.js:74-144` |
| Матрица по офисам | ✅ | Строки USDT↔валюта × офисы, тап→upsert, точки свежести | Только USDT-якоря; группировка стран regex — хрупко | `OfficeRatesMatrix.jsx` |
| Сайдбар курсов | ✅ | Аккордеон офисов, MasterRatesPanel, кросс, НЕРЕЗ, клик-копирование | Свежесть только по overrides | `RatesSidebar.jsx` |
| Coverage / Freshness | ✅ | analyzeCoverage, пороги 1ч/6ч, чипы | dismissed per-браузер | `utils/ratesCoverage.js`, `rateFreshness.jsx` |
| RatesBar / DailyRatesModal / ExternalRatesWidget | ⚠️ мёртвый | Код полный | **Импортированы, но не рендерятся** — ~2800 строк недостижимого UI (включая единственную защиту от инверсии курса) | `RatesBar.jsx`, `DailyRatesModal.jsx`, `ExternalRatesWidget.jsx` |
| Paste-парсер | ⚠️ мёртвый | Парсер строк | Потребитель — только его тест | `utils/ratesPasteParser.js` |

**Нюансы:** два контура — глобальные `pairs` (подложка, есть битые курсы) и офисные `office_rate_overrides` (реальный рабочий контур; утренний импорт и Rapira пишут только сюда, нал↔нал через USDT-пивот). Отсутствующие миграции: `special_rates`, `replace_special_rates`, `external_rates`, `v_external_rates_latest`, `rapira_alert_state`, `set_pair_margins`, `set_all_pair_spreads`, колонки `market_rate/buy_margin/sell_margin`. Подтверждение курсов семантически сломано в проде.

---

### C.2 Сделки (deals) — ~60%

| Подобласть | Статус | Что работает | Чего нет / сломано | Файлы |
|---|---|---|---|---|
| Активная форма | ✅/⚠️ | **NewDealForm (redesign) — дефолт**; ExchangeForm — запасная; v2 DealForm мёртв | Какая форма в проде — зависит от Vercel env | `CashierPage.jsx:20-22,610` |
| Флоу форма→RPC | ✅ | payload→adapter→`create_deal_v2`, idempotency+SHA-256 | SQL самой RPC в репо нет | `dealOperations.js:51`, `newLedgerAdapter.js:101` (95 тестов) |
| № сделки | 🔴 | — | Нет человекочитаемого номера: «№» = индекс строки за день, в audit — UUID | `DealsLedger.jsx:860` |
| Статусы v2 | 🟡 | tx сразу `posted`; подтверждение = metadata.confirmed_at (цвет) | pending/checking → только metadata, резервирования нет | `cashierDealsReader.js:126` |
| Timing в NewDealForm | 🔴 | «клиент позже» доходит | **«мы позже»/«частично» молча теряются** — CashierPage не передаёт deferredOut/partialMode в createDeal | `NewDealForm.jsx:569` vs `CashierPage.jsx:162-209` |
| Multi-IN / Multi-OUT | ✅ | Массивы ног, матрица курсов N×M, сплит расхода | Маржа в Summary — по primary-ноге | `NewDealForm.jsx:153-249`, `DealRateMatrix.jsx` |
| OTC / партнёрские счета | 🟡 | adapter резолвит partner-счета; полный OTC — в ExchangeForm | **NewDealForm жёстко шлёт outKind:"ours"** — OTC недоступен в активной форме | `NewDealForm.jsx:561`, `ExchangeForm.jsx:1100` |
| Комиссия / профит | ⚠️ | commission из custom/commissionUsd; manual-rate snapshot | **Кастомная USD-комиссия у сделки без USD-ноги → sentinel 0.01**; min-fee cap не передаётся в RPC | `newLedgerAdapter.js:249-266` |
| Backdate | ⚠️ | В ленте работает (p_effective_date) | Из форм идёт через `set_deal_created_at` (public.deals, заморожена) → «Backdate failed» | `CashierPage.jsx:236`, миграция 0070 |
| Лента «Сделки за день» | ✅ | Чтение ledger + realtime, inline-создание, сплит, сторно-фильтр | Эвристики (контрагент/курс/cash-клиент по nickname) | `DealsLedger.jsx`, `cashierDealsReader.js` |
| Редактирование | 🔴 | `update_deal_v2` в БД есть | **UI нет**: EditTransactionModal мёртв, показывает «Edit отключён в v2» | `EditTransactionModal.jsx:151` |
| Удаление / reverse | 🟡 | В ленте: сторно/void с диалогами | DeleteDealButton жёстко disabled при v2 | `DealsLedger.jsx:472`, `ledger_void_deal.sql` |
| v2-обёртки obligations | 🔴 | legacy-ветки живы | **v2-ветки фиктивны** — сигнатуры не совпадают, упадут при вызове | `dealOperations.js:135-211` |
| Demo vs Supabase | ✅ | Полный in-memory путь | В demo есть reserved-инвариант, в v2 нет | `CashierPage.jsx:317-410` |

**Нюанс — активная форма:** по умолчанию монтируется **NewDealForm**. ExchangeForm (3879 строк, самый функционально полный — OTC, payee, partial/deferred, checking) — запасная. Редизайн отгружен **с регрессом**: OTC/partial/deferred-out недоступны или теряются. Отлично протестированная обвязка `lib/dealForm/*` (buildTx/validateTx/submitFlow/pickRate, 95 тестов) обслуживает **несмонтированный** код.

---

### C.3 Заявки (orders) + мост / обязательства — ~55%

| Подобласть | Статус | Что работает | Чего нет | Файлы |
|---|---|---|---|---|
| `manager_orders` (хранение) | ✅ | kind exchange/visit, статусы, RLS, realtime; в проде 32 строки | deal_id ни разу не заполнен (0 строк) | `manager_orders_1_create.sql` |
| Приём из coinpoint (cron) | ✅ | Vercel cron 1/мин, дельта-курсор, идемпотентный upsert; **прод жив (синк сегодня 19:18 UTC)** | Только pull; при ошибке — console.warn | `api/cashdesk/sync.js:22-90` |
| Обратный канал касса→coinpoint | 🔴 | Функция `/api/cashdesk/status` написана (requireStaff) | **Ни одного вызова из фронта** — «пришёл/отмена/проведено» до бота не доходят | `api/cashdesk/status.js` |
| Лента заявок в кассе | ✅/⚠️ | Pending → жёлтые строки **вверху той же таблицы** «Сделки за день», realtime, тоггл «пришёл» | За флагом `VITE_MANAGER_ORDERS_ENABLED` (в проде вкл, но нигде не документирован); нет привязки контрагента | `DealsLedger.jsx:773-850`, `lib/managerOrders.js` |
| Заявка → готовая сделка | 🔴 | — | **Флоу отсутствует сознательно** (`OrderDetailsModal.jsx:4`: «"Провести" нет»); `markDone()` написан, но не импортирован; прод: done=0, deal_id=0 | `lib/managerOrders.js:92-103` (мёртвый) |
| «Под заявки» в остатках | ✅ | Сумма pending по валютам, красное при нехватке | Не резервирует в леджере — визуальный слой | `BalancesPanel.jsx:96-119` |
| Obligations v2 (metadata) | ✅/⚠️ | deferred_* в metadata, панель «Незавершённое·долги», закрытие | **В проде 0 транзакций с deferred_side** — ни разу не использовано | `cashierDealsReader.js:147-230`, `ObligationsPanel.jsx` |
| Obligations legacy | 🔴 | Таблица/store/модалки/таб | **Заморожена и пуста (0 строк)** — весь UI показывает нули | `store/obligations.jsx`, `ObligationsTab.jsx` |
| OpenObligationsWidget | 🔴 | Компонент+хук+3 теста | Импортирован в CashierPage, **но не отрендерен** — мёртвый импорт | `CashierPage.jsx:5` |

**Ключевое для задачи «заявки+сделки под кнопкой»:** лента заявок **уже существует** — pending `manager_orders` рендерятся жёлтыми строками вверху `DealsLedger`. Флоу «заявка→сделка» как код **отсутствует** (markDone мёртв, deal_id пуст), мост односторонний (обратный канал не вызывается, cron может перезаписать локальный статус).

---

### C.4 Остатки / двойная запись / ledger — ~62%

| Подобласть | Статус | Что работает | Чего нет | Файлы |
|---|---|---|---|---|
| Схема `ledger` (Dr/Cr, триггеры) | ✅ | 11 таблиц; триггеры баланса/валюты/субконто; **прод: 0 разбалансов на 37 tx**, v_balance_check 0 расхождений | DDL не в репо; **RLS выкл на 9 таблицах** (critical advisory) | `cutover_1_...sql` + БД |
| RPC-слой (create_deal_v2/transfer/adjustment/…) | ✅ | Все функции в pg_proc + обёртки; идемпотентность | cross-currency transfer не поддержан | `newLedger.js:113-491` |
| Adapter legacy→v2 | ✅ | Дедуп IN, partner-счета, deferred/partial OUT, one-sided | **Комиссия 0.01** когда fee не задан (прод: все 4 recognition = 0.01); 6 счетов без ledger_account_code | `newLedgerAdapter.js:78-91,252-266` (21 тест) |
| 10 follow-up обёрток | 🔴 | Сигнатуры есть | **Payload не совпадает с RPC** → упадут; EditTransactionModal даёт submit при баннере «отключено» | `dealOperations.js:119-211` |
| Движок баланса | 🟡 | DB-режим: `v_account_balances`→`ledger.balances` (верно) | **reserved=0 захардкожен** в view; deltaOf из movements (0 строк) | `store/accounts.jsx:231-320` |
| Reserved / pending | 🔴 | Код legacy цел; v2 create_reservation есть в БД | legacy мёртв; **v2-резервы никто не вызывает**; workflow — 0 строк | `exchangeMovements.js`, БД |
| Opening entries | ✅ | 13 tx + 12 OBE, сбалансированы | source_kind='opening' не использован (косметика) | `cutover_1_...sql:13-151` |
| Заморозка legacy | ✅ | REVOKE на 7 таблиц; deals/movements/obligations = 0 строк | — | `cutover_1_...sql:220-257` |
| Balances UI (утро/текущий/под заявки) | 🟡 | «Текущий» корректен; разбивка по офисам | **«Утро»=«Текущий», «за день +$0» всегда** (movements пусты) | `BalancesPanel.jsx:40-119` |
| Казначейство: Активы | ✅ | Вертикальное дерево, кассы-группы исключены, inline-edit→manual_entry, CSV | — | `v2selectors.js:83-134` |
| Казначейство: Пассивы | 🟡 | Селектор liabilitiesByCounterparty, знак Дт−Кт | **В проде 0 balances с client_id** — вкладка пуста (dims не пишутся) | `v2selectors.js:153-275` |
| Казначейство: Капитал + баланс-чек | ✅ | Identity Активы=Пассивы+Капитал, допуск $0.5, конвенция Кирилла | Авто-закрытия периода нет | `v2selectors.js:323-381`, `BalanceCheckBar.jsx` |
| ОСВ / Шахматка / P&L / Журнал | ✅ | trialBalance, chessTurnover, pnlForPeriod, журнал, ручные проводки | — | `v2selectors.js:648-897` (596 тестов) |
| Кассы-группы (111-114) | ✅ | Подтверждено в проде, листья 1110-1143 с parent | — | `v2selectors.js:91-104` |
| PostgREST exposed schemas | ✅ | REST-проверка: ledger→200, operations→401 | — | эмпирически |

**Нюансы:** двойная запись на уровне БД **реально надёжна** (инварианты триггерами, immutable для приложения, 0 разбалансов в проде). Но: (1) «мост» старый↔новый мир скрывает смерть movements-метрик («утро», дельты, reserved = нули без источника); (2) **P&L фиктивный** — заглушка 0.01, маржа застревает в клиринге 351x; (3) пассивы по контрагентам пусты — client_id не проносится в проводки; (4) реальное использование минимально (4 сделки, 0 workflow за 1.5 мес).

---

### C.5 Контрагенты · Роли · Офисы · i18n · Аудит · Интеграции

| Подобласть | Статус | Что работает | Чего нет | Файлы |
|---|---|---|---|---|
| Клиенты CRUD | ✅ | Создание/архив/удаление/поиск в Supabase `clients` | **Нет дедупа** — дубли накапливаются | `pages/counterparties/ListTab.jsx`, `supabaseWrite.js:1740` |
| Партнёры (OTC) | 🟡 | Отдельная сущность, CRUD, soft-delete | Профиль — заглушка «в 2.2»; UX разорван (счета в Settings) | `store/partners.jsx`, миграция 0071 |
| LTV / профиль клиента | ✅ | volume/profit/LTV, месячные бары, рефералы, кошельки с AML-бейджем | **Привязка по тексту ника** — переименование рвёт историю | `ClientProfileModal.jsx:50-63` |
| Роли: матрица | ✅ | 4 роли × 11 секций × 3 уровня, ROLE_DEFAULTS⊕overrides | **Overrides в useState — не персистятся** (F5 сброс) | `permissions.jsx:35-104` |
| Роли: сервер | 🟡 | `_require_role` в RPC | Проверка только по роли, не по секциям | миграция 0042 |
| Гейтинг страниц | ✅ | PAGE_SECTION, редирект, фильтр меню, хоткеи | 6/11 секций не смаплены — «мёртвые» тумблеры | `App.jsx:47-176` |
| Auth / активация | 🟡 | Реальный Supabase Auth, lifecycle, guard «последний owner» | Рядом mock-пароль + switchUser (demo) — путаница | `store/auth.jsx`, `LoginPage.jsx` |
| Офисы / мультигород | 🟡 | 7 прод-офисов из БД, CRUD с персистом (OfficesTab), per-office параметры | Store-мутации не пишут в БД; seed=3 ≠ прод | `store/offices.jsx`, `OfficesTab.jsx` |
| i18n | ✅/🟡 | **DICT 3×1382, расхождений нет**, fallback | **~200 файлов с хардкод-кириллицей** вне DICT | `i18n/translations.jsx` |
| Аудит-лог | ✅ | Запись в БД + reload, ~20 источников, фильтры/CSV | IP всегда пуст, нет diff, полнота на дисциплине | `store/audit.jsx` |
| Rapira авто+алерты | ✅ | Cron */2, external_rates, детектор 1.5%, кнопка в матрице | Спреды хардкод кроме USDT_RUB | `api/rapira/sync.js` |
| Telegram / coinpoint | ✅ | Алерты в мост (+Telegram fallback), приём заявок, `?test=1` | Своего бота нет; доставка best-effort | `api/rapira/sync.js:105`, `api/cashdesk/*` |
| AML / KYT | ⚠️ **стаб** | Hash-скоринг с игрушечными списками, бейджи High/Med/Low | **Реальной интеграции нет** (честно подписано «стаб — Chainalysis/TRM/Elliptic») | `utils/aml.js`, `store/monitoring.jsx` |

**Нюансы:** AML — самый опасный пункт (генератор псевдослучайных риск-скоров, выглядит готовым). i18n формально идеален, фактически дырявый (новые разделы писались по-русски мимо DICT). Права — «театр на клиенте» (overrides эфемерны, сервер знает только роль). Rapira/Telegram — единственные по-настоящему боевые интеграции.

---

### C.6 Бэкенд (Supabase) + безопасность — ~55%

| Подобласть | Статус | Что работает | Чего нет | Файлы |
|---|---|---|---|---|
| Базовая схема public | ✅ | 0001_init: таблицы + 19 RLS + 57 политик + RPC + вьюхи + seed | — | `0001_init.sql` |
| Legacy-RPC сделок | ✅ | Полный цикл; авторизация (0042), FOR UPDATE против double-settle | Legacy заморожены (by design) | `0008/0011/0013/0042` |
| Ядро v2-леджера (схема ledger) | 🔴 | В проде живёт | **Нет в репо**: ни CREATE SCHEMA, ни таблиц, ни create_deal_v2/topup/transfer/… | grep create schema → только operations |
| RPC без миграций в репо | 🔴 | Фронт вызывает → в проде есть | replace_special_rates, set_all_pair_spreads, set_pair_margins, confirm_ledger_transaction, create_ledger_account… | `supabaseWrite.js:465-1586` |
| RLS public | 🟡 | Read открыт staff (0035, осознанно); write ужесточён (0043) | Всё на f_role() из users — компрометация 1 аккаунта = чтение всего | `0035/0043` |
| **RLS ledger** | 🔴 | — | **9 таблиц ledger без RLS** + exposed + realtime — anon читает/пишет | `docs/PRODUCTION_REALITY_CHECK.md:214`, `realtime_ledger_deals.sql` |
| pg_cron | 🟡 | 1 джоб: flag_stale_workflows 03:00 | Переоценок/сверок нет | `operations_6_...sql:57` |
| Vercel cron / serverless | ✅ | cashdesk/sync (1/мин), rapira/sync (*/2), requireStaff на status | **CRON_SECRET опционален** — не задан = открыто | `vercel.json:5-8`, `api/*` |
| Edge Functions | ⬜ | Нет; config.toml тоже нет | Exposed schemas не в git | `ls supabase/` |
| Целостность v2 | 🟡 | idempotency + request_hash, je_balance_check, verify_opening | void_deal отключает balance-check в транзакции; ядро вне репо | `newLedger.js:66-76`, `ledger_void_deal.sql` |

**### Безопасность / секреты**
- 🔴 **GRANT EXECUTE … TO anon на денежные RPC** (14 обёрток: create_deal_v2, create_topup, create_withdrawal, create_transfer, complete_deal_leg, create_reservation, reverse_transaction…) — `direction2_3_public_wrappers_for_v2_rpcs.sql:53-351`.
- 🔴 **`ledger.update_deal_v2` без role-check** — `direction2_2_1_update_deal_v2.sql:188` (только created_by в metadata).
- 🔴 **`create_adjustment` (12-арг overload) TO anon без role-check** — регресс с «service_role only» — `0106_create_adjustment_dim_params.sql:177`.
- 🔴 **Балансовые вьюхи открыты anon**: `v_client_balances`, `v_partner_balances` (`0105:62-63`), `v_accounting_feed`, `v_balance_adjustments` (`0096`).
- ⚠️ **Plaintext-пароли в миграциях**: `0032_hardcode_cpakseltom_user.sql:31`, `0041_hardcode_firatpfs_user.sql:25` (реальные email + `123456789`) — в истории git навсегда.
- ⚠️ **CRON_SECRET опционален** — `api/rapira/sync.js:24`.
- ✅ **Секретов в файлах репо нет** (`.env`/`.env.local` отсутствуют и в истории; `.gitignore` кроет `*.local`; сканы токенов чисто; Telegram-токен в coinpoint).
- ✅ `api/cashdesk/status.js` защищён requireStaff (anti-IDOR).
- 🟡 `admin_set_password` пишет encrypted_password напрямую (гейт owner/admin, min 6); auth-flow `implicit` (токен в URL-hash).

---

## D. Что осталось до запуска (приоритизировано)

### 🔴 Блокеры (нельзя опираться в бою без этого)
1. **[Безопасность] Проверить advisors и включить RLS на `ledger.*`** (9 таблиц), закрыть anon-чтение балансов клиентов/партнёров, ревизия anon-грантов на денежные RPC, добавить role-check в `update_deal_v2` и overload `create_adjustment`. Сначала верификация на живом проекте, потом фикс. **[M верификация → L фикс]**
2. **[Данные] Убрать заглушку комиссии 0.01** → признавать реальную маржу выручкой, иначе P&L систематически ≈0. **[M/L]**
3. **[Сделки] Починить тихую потерю `deferredOut`/`partial`** из NewDealForm (CashierPage не передаёт в createDeal) — иначе обязательство исчезает без следа. **[M]**
4. **[Воспроизводимость] Внести DDL v2-леджера + недостающие RPC + rate-таблицы в `supabase/migrations/`** — чтобы репо восстанавливал прод. **[M]**
5. **[Безопасность] Сменить пароли** пользователей из `0032`/`0041` и перестать хардкодить. **[S]**

### 🟡 Важное
6. **[Заявки] Флоу «заявка → готовая сделка»**: подключить `markDone` + запись `deal_id` + обратный канал в coinpoint (`/api/cashdesk/status`) из UI. *(← следующая продуктовая задача пользователя)* **[M/L]**
7. **[Леджер] Резервы/«под заявки» в v2** — либо реализовать (create_reservation из UI), либо явно убрать метрику. **[M]**
8. **[UI] Метрики дня** («Утро», «за день ±$», RESERVED) — считать из леджера или скрыть, а не показывать нули. **[M]**
9. **[Сделки] OTC в NewDealForm** (или оставить путь через ExchangeForm явно). **[M]**
10. **[Сделки] Номер сделки** (человекочитаемый) — чтобы ссылаться. **[S/M]**
11. **[Сделки] UI редактирования** через существующий `update_deal_v2`. **[M]**
12. **[Леджер] Починить/убрать фиктивные v2-обёртки** obligations (упадут при вызове). **[M]**
13. **[Права] Персист per-user overrides** (таблица/RPC), иначе F5 сбрасывает. **[S/M]**
14. **[Безопасность] Сделать `CRON_SECRET` обязательным.** **[S]**
15. **[AML] Реальная интеграция** (Chainalysis/TRM/AMLBot) или честно пометить UI как нерабочий. **[L]**

### ⚪ Мелочи / долги
16. Удалить ~2800 строк мёртвого UI (RatesBar, DailyRatesModal, ExternalRatesWidget, RatesMarginEditor, ratesPasteParser, cashier/DealForm, EditTransactionModal). **[S]**
17. `delete_pair` RPC — персист удаления пары. **[S]**
18. i18n-зачистка хардкод-русского (~200 файлов). **[L, поэтапно]**
19. Починить семантику подтверждения курсов. **[M]**
20. Задокументировать флаги (`VITE_MANAGER_ORDERS_ENABLED` и др.) в CLAUDE.md/Справке. **[S]**
21. Code-split бандла (index 1.25 MB / 344 KB gzip). **[S/M]**
22. LTV/аналитика клиента по `client_id`, не по нику. **[M]**

---

## E. Риски, долги, сломанное («мины»)

| # | Риск | Тип | Серьёзность |
|---|---|---|---|
| 1 | `ledger.*` без RLS + exposed + realtime → anon читает балансы клиентов, вероятно пишет проводки | Безопасность | **Критический** (проверить на проде) |
| 2 | Git не воспроизводит БД (ядро v2 + ~7 RPC + rate-таблицы применены мимо миграций) | Тех-долг/DR | **Критический** |
| 3 | P&L сделок ≈0 (заглушка комиссии 0.01, маржа в клиринге 351x) | Данные/финансы | Высокий |
| 4 | Тихая потеря deferredOut/partial из NewDealForm → пропавшее обязательство | Данные/финансы | Высокий |
| 5 | AML — стаб с фейковыми риск-скорами; UI показывает «Low risk», которому нельзя верить | Комплаенс | Высокий |
| 6 | Флоу заявка→сделка отсутствует; мост односторонний (бот не знает судьбу заявки; cron перезаписывает локальный статус) | Функционал | Высокий |
| 7 | Plaintext-пароли в миграциях 0032/0041 (в истории git навсегда) | Безопасность | Высокий |
| 8 | Reserved/pending в v2 отсутствует (reserved=0 захардкожен, workflow 0 строк) | Функционал | Средний |
| 9 | Права per-user не персистятся (F5 сброс) — ложное чувство контроля | Безопасность/UX | Средний |
| 10 | ~2800 строк мёртвого UI + мёртвые obligation-обёртки маскируют готовность | Тех-долг | Средний |
| 11 | Живой UI (DealsLedger/NewDealForm/CashierPage) — 0 тестов; хорошо покрыт мёртвый код | Качество | Средний |
| 12 | i18n дырявый (~200 файлов хардкод-русского) — «3 языка» неполны для новых разделов | UX | Средний |
| 13 | Метрики дня («Утро»/дельты) показывают нули без источника | UX/доверие | Средний |
| 14 | Пассивы-по-контрагентам пусты (client_id не пишется в проводки) | Функционал | Средний |

---

## F. Не смог проверить (нужен доступ / прод / секреты)

- **Vercel env**: `VITE_USE_NEW_DEAL_FORM_REDESIGN`, `VITE_USE_NEW_LEDGER`, `VITE_MANAGER_ORDERS_ENABLED`, `COINPOINT_API_URL`, `CASHDESK_API_SECRET`, `CRON_SECRET`, `TELEGRAM_*` — заданы ли. Нужно: `vercel env ls`.
- **Advisors безопасности на проде** (RLS ledger, exposed schemas, security definer) — нужен `mcp get_advisors` + `pg_policies`.
- **Тела прод-функций** `ledger.create_deal_v2 / create_topup / …` — есть ли внутри role-check (в репо их текстов нет). Нужно: `pg_get_functiondef`.
- **Coinpoint-сторона** (`/api/internal/cashdesk/alert`, `bot_orders`) — отдельный репозиторий.
- **Работоспособность `/api/cashdesk/status` end-to-end** — никем не вызывается.
- **Сменены ли пароли** cpakseltom/firatpfs после 0032/0041.
- **Точность numeric→JS Number** в readers на крипто-суммах с 8+ знаками.
- **Поведение periodClose** (в проде ни разу не запускался).

---

## G. Приложение: как проверялось

**Команды и результат:**

| Проверка | Команда | Результат |
|---|---|---|
| Сборка | `npm run build` | ✅ Проходит. Warning: чанк `index` 1.25 MB / 344 KB gzip (жирнее порога) |
| Тесты (дефолт) | `npm test` (`vitest run`) | ✅ **596 passed / 59 файлов, exit 0** |
| Тест (интеграционный) | `npx vitest run src/lib/__integration__/adapter-prod-shape.test.js` | ✅ 7 passed (исключён из дефолтного прогона) |
| Итого тестов | — | 60 файлов, все зелёные |

**Grep-маркеры незавершёнки (по src, без тестов):** TODO 4 · FIXME 0 · HACK 1 (тестовый адрес в `aml.js`) · XXX 3 (в осн. текст Справки) · WIP 0 · `not implemented` 0 · `@ts-ignore` 0 · stub 6 (легитимные) · `placeholder` 302 (в осн. HTML-атрибуты) · `throw new Error(` 234 (в осн. валидация). Вывод: кодовая база **чистая от явных маркеров «WIP»** — незавершёнка проявляется не в маркерах, а в мёртвом коде и несостыковке фронт↔RPC.

**`.skip`/`.only` в тестах:** не найдено.

**Секреты:** реального `.env` в гите и истории нет (только `.env.local.example`); `.gitignore` кроет `*.local`, `.claude/`, `.vercel`.

**Масштаб:** 137 миграций · 144 компонента · 25 провайдеров · 14 страниц · нет `supabase/functions/`.

**Сверка с прод-БД** (`ygtphuxzazxdtyouxxir`, read-only, только агент по леджеру): 37 транзакций / 94 проводки, 0 разбалансов (Dr=Cr per-currency), `v_balance_check` 0 расхождений; 4 «боевых» сделки (круглые суммы, похоже на приёмку), 0 workflow, 0 deferred_side, все recognition-tx = комиссия 0.01; кассы-группы 111-114 с листьями подтверждены; PostgREST: `ledger`→200, `operations`→401.

---

*Отчёт сгенерирован read-only аудитом. Ничего в коде и БД не менялось. Проценты обоснованы находками (см. области C и таблицу B), а не выставлены произвольно.*
