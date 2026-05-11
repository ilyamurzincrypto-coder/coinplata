# Справка v2 — detailed "how it works" + worked visual examples (Spec C.7-info-v2)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** the Справка page (`src/pages/InfoPage.jsx`, `src/pages/info/content.js` — shipped). No DB, no permission changes.

## Overview

Expand the `/info` («Справка») page from short bullet lists to a proper plain-Russian manual: each area (and each Treasury sub-feature) gets a step-by-step **«Как работает»** explanation and one or more **worked examples** rendered with light visual blocks — a numbered "what you do → what happens" list and, where relevant, a mini Дт/Кт journal-entries table styled like the real `TransactionEntries`. No real screenshots / interactive demos — just self-contained presentational blocks so the page stays dependency-free.

## Content structure (`src/pages/info/content.js`)

Each section / sub-section gains two optional fields alongside the existing `{ id, title, what, related, can, sub? }`:

- `how: string[]` — ordered "how it works" steps (rendered as a numbered list under «Как работает:»). Plain RU, short sentences.
- `examples: Example[]` where `Example = { title: string, intro?: string, steps?: string[], journal?: JournalLine[], note?: string }`:
  - `title` — e.g. `"Пример: обмен $1000 наличными → USDT"`.
  - `intro` — one sentence of setup.
  - `steps` — "что делаешь → что получается" bullets.
  - `journal` — `JournalLine = { dir: "dr" | "cr", account: string, amount: number | string, cur: string, note?: string }` — rendered as a mini table (Дт rows emerald, Кт rows rose, right-aligned `amount` + `cur`, optional `note` muted). Multiple `journal` lines form one transaction's posting; if an example needs several transactions, use several `Example` objects (or a `journal` array with a blank-line separator — keep it simple: one `journal` array per `Example`, one transaction's worth).
  - `note` — italic explanatory closer.

The same structure is used for `sub` entries (Treasury tab sub-cards), which is where most of the worked examples live.

### Content to write (the implementer authors the full RU prose; this is the skeleton + the key examples)

- **Касса** — `how`: оператор открывает Кассу → видит курсы и балансы → жмёт «Новая сделка» → добавляет ноги «пришло»/«ушло» (валюта, сумма, счёт; для крипты — сеть) → система считает остаток и маржу → «Провести» → движения пишутся, сделка появляется в списке и (при v2) в Казначействе. `examples`:
  1. `"Пример: обмен $1000 наличными → USDT (TRC20)"` — intro: курс USD→USDT 1.0 минус маржа $50. steps: «нога IN: $1000, наличные, счёт Касса USD»; «нога OUT: 950 USDT, сеть TRC20, на наш Hot-кошелёк»; «остаток = 0, маржа = $50 → Провести». `journal` (одна транзакция, упрощённо): `Дт Касса USD 1000`, `Кт Обязательства перед клиентом 1000`, `Дт Обязательства перед клиентом 950 (экв. в USD)`, `Кт Hot USDT TRC20 950 USDT`, `Кт Доход: спред 50 USD`. note: «В Казначействе → Журнал это видно как одна транзакция «deal #…» с раскрывающимся деревом этих проводок; балансы Кассы USD и Hot USDT сдвинулись; в P&L за период появилось +50 в доходах».
  2. `"Пример: пополнение (top-up) — клиент сдал $500 на свой баланс"` — `journal`: `Дт Касса USD 500`, `Кт Обязательства перед клиентом (этот клиент) 500`. note: на балансе клиента появилось +$500, которые мы ему должны.
  3. `"Пример: перевод между нашими счетами — $2000 из кассы офиса А на банковский счёт"` — `journal`: `Дт Банк USD 2000`, `Кт Касса USD 2000` (+ комиссия отдельной строкой если есть).
  4. `"Пример: отложенная (deferred) нога"` — клиент должен получить 950 USDT, но сейчас выдаём только 500 → 450 остаётся обязательством; steps + краткая `journal`/note про резерв.
- **Капитал** — `how`: берёт балансы всех счетов, пересчитывает в базовую валюту по курсам, складывает по категориям. `examples`: 1 пример с числами (касса $5k + банк $10k + крипто 3000 USDT ≈ $3k → капитал ≈ $18k; прибыль = доходы − расходы за период).
- **Счета** — `how`: баланс счёта НЕ хранится числом — считается из движений; есть три метрики. `examples`: 1 пример: «опенинг $10000, потом сделка +$1000 и резерв под отложенную выдачу −$300 → баланс $11000, зарезервировано $300, доступно $10700».
- **Контрагенты** — `how` + 1 пример (профиль клиента: история сделок, текущий долг = остаток на счёте «обязательства» по этому клиенту).
- **Казначейство** — `how`: всё, что пишется в v2-леджер двойной записью, видно тут в 6 разрезах (Активы/Пассивы/Капитал/P&L/Обороты/Журнал). `sub` (каждый с `how` + пример):
  - **Активы / Пассивы / Капитал** — `how`: баланс по классам счетов; разворот счёта → его проводки; для счетов-обязательств → строки по клиентам/партнёрам → проводки конкретного клиента; внизу проверка «Капитал = Активы − Пассивы». `example`: ОСВ-подобный мини-снимок: «Активы $50k = Пассивы $32k − ... нет: Капитал $18k = Активы $50k − Пассивы $32k ✓»; и пример субконто-строки: счёт «Обязательства перед клиентами $32k» → разворот → «Иван Петров $12k», «ООО Ромашка $20k».
  - **P&L** — `how`: за выбранный период суммирует обороты по счетам доходов (Кт−Дт), расходов (Дт−Кт), курсовых разниц; чистая прибыль = доходы − расходы + курсовые; тумблер «сравнить с прошлым периодом» добавляет колонки «прошл.» и «Δ». `example`: «Май: доходы +$1200 (спред $900, комиссия $300), расходы −$400 (аренда $300, сеть $100), курсовые +$20 → чистая прибыль +$820; апрель было +$650 → Δ +$170». + мини-таблица.
  - **Обороты** — `how`: ОСВ — по каждому счёту остаток на начало (= текущий баланс минус все движения с начала периода), оборот по дебету, оборот по кредиту, остаток на конец; проверки Σ Дт = Σ Кт; экспорт CSV. Шахматка — матрица «счёт-Дт × счёт-Кт» (многоплечие транзакции разносятся пропорционально). `example`: ОСВ-строка «Касса USD: нач $10000 | Дт $1500 | Кт $500 | кон $11000»; Шахматка-фрагмент «строка Касса × столбец Обязательства клиента = $1000».
  - **Журнал** — `how`: хронология транзакций; разворот → таблица Дт/Кт; ссылка в исходный документ; фильтр по типу; у ручных проводок — «Сторнировать» (создаёт обратную проводку с причиной). `example`: дерево транзакции «deal #42» из примера Кассы (мини-таблица Дт/Кт тех же 5 строк), + пример сторно: исходная `Дт A 100 / Кт B 100` → сторно `Дт B 100 / Кт A 100`, у исходной появляется чип «сторнирована».
  - **Ручная проводка** — `how`: выбираешь счета и суммы Дт/Кт; должно сходиться Σ Дт = Σ Кт, одна валюта; для счетов-обязательств — выбираешь клиента/партнёра; предпросмотр → «Провести»; пишется в леджер + audit-trail; доступно owner/accountant; сторнируется из Журнала. `example`: `"Пример: начислить аренду $1800 заранее (расход будущих периодов)"` — `journal`: `Дт Расход: аренда офиса 1800 USD`, `Кт Касса USD 1800`. note: Σ Дт = Σ Кт = 1800 ✓; появится в Журнале (фильтр «ручные»).
- **Настройки** — `how` + короткий пример (матрица прав: роль accountant × раздел «Казначейство» × уровень «edit» = может вводить ручные проводки).
- **Аудит** — `how` + 1 пример (запись «E. Kara провёл ручную проводку #… 2026-05-11 14:32»).
- **Глоссарий** — каждый термин с микро-примером: движение (`{accountId, amount:+1000, direction:"in", source:{kind:"topup"}}`); двойная запись (`Дт Касса 1000 / Кт Обязательства 1000` — обе стороны равны); субконто (на счёте «Обязательства перед клиентами» отдельный остаток: client-1 = −500, client-2 = −1200); базовая валюта; зарезервировано/доступно; фича-флаги `VITE_USE_NEW_DEAL_FORM`/`VITE_USE_NEW_LEDGER`.

(Numbers in examples are illustrative — they don't need to reconcile to a real ledger; they just have to be internally consistent within an example. Keep prose plain and short.)

## Rendering (`src/pages/InfoPage.jsx`)

Extend `InfoCard` and `SubCard`:
- After the `can` bullets, if `section.how` (or `sub.how`) is non-empty: a «Как работает:» heading + an `<ol>` numbered list.
- After that, if `section.examples` / `sub.examples` is non-empty: for each example, a bordered card — header «{title}», `intro` (muted), `steps` (numbered or bulleted `<ol>/<ul>`), and if `example.journal` → a `<JournalMini lines={example.journal} />` (a small table: each row = `[Дт/Кт badge | account | amount cur | note?]`, Дт rows `text-emerald-700`, Кт `text-rose-700`, amounts `tabular-nums` right-aligned), and `note` (italic).
- `JournalMini` is a tiny inline component in `InfoPage.jsx` (no new file needed — it's a few lines). Keep the app's card styling.

## Testing

- `src/pages/info/content.test.js` (extend): every section has a non-empty `how` array of non-empty strings; every section has `examples` array with ≥1 example, each with a non-empty `title`; every example's `journal` (where present) is an array of `{ dir: "dr"|"cr", account: <non-empty str>, amount: <finite number-ish>, cur: <non-empty str> }`. (`Number(amount)` finite; `dir` ∈ {dr,cr}.)
- `src/pages/InfoPage.test.jsx` (extend): expanding a section renders its `how[0]` text and its `examples[0].title`; for a section/sub with a `journal` example, the rendered output contains one of the example's account names and one of its amounts. (One or two assertions are enough; don't enumerate every example.)

## Out of scope

- Real screenshots / live component embeds / interactive demos / video.
- Deep-links from an example to the actual page/tab.
- Translating the manual to en/tr (RU only; only `nav_info` stays i18n'd in 3 languages).
- A search box over the manual.

## References

- `src/pages/info/content.js` (`INFO_SECTIONS`) and `src/pages/InfoPage.jsx` (`InfoCard`/`SubCard`) — the things being extended.
- `src/pages/treasury_v2/parts/TransactionEntries.jsx` — visual reference for the `JournalMini` Дт/Кт table styling.
- Feature truth (so examples don't misdescribe behaviour): `CLAUDE.md`, the Treasury/Posting-Master/Turnover/Subconto specs under `docs/superpowers/`.
