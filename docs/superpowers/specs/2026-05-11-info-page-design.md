# «Справка / Info» page — plain-language feature manual (Spec C.5-info)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** nothing (purely additive: a new top-level page + one nav item). No DB, no permission changes, no provider changes.

## Overview

A new top-level **«Справка»** page in the app, reachable from the header nav, that explains — in plain Russian, "as if for someone who's never seen the app" — every feature of the service: for each area, **what it is**, **what it's connected to** (which data / modules it builds on), and **what it can do** (a human-readable bullet list). Plus a short "how it all fits together" glossary block (movements → balances; v2 ledger → Treasury; subconto = client/partner on a liability account; the `VITE_*` feature flags).

Read-only static content. No store, no permission gating (visible to everyone). The manual prose lives directly in the component / a content module in Russian (it's documentation, not UI chrome — routing it through the i18n `DICT` in 3 languages would be disproportionate); only the nav label `nav_info` goes through `DICT` (en/ru/tr).

## Where it lives / wiring

- `components/Header.jsx` — add `{ id: "info", key: "nav_info", section: "transactions" }` to `NAV_PAGES` (the `section: "transactions"` makes it visible to all defined roles, which all have ≥`view` on `transactions`). Position: last in the nav (after `settings`), or right after `treasury` — pick last.
- `src/i18n/translations.jsx` — add `nav_info` to en/ru/tr (`"Info"` / `"Справка"` / `"Bilgi"`). (Find the existing `nav_*` keys — `nav_cashier`, `nav_treasury`, etc. — and add alongside.)
- `App.jsx` — `import InfoPage from "./pages/InfoPage.jsx";` and add `{page === "info" && canShow("info") && <InfoPage />}` next to the other page renders. `PAGE_SECTION` is **not** modified — `canShow(p) = can(PAGE_SECTION[p] || "transactions")`, so `canShow("info")` falls back to `can("transactions")` which is truthy for all roles. (If the project later wants `info` truly always-on regardless of role, that's a follow-up; `transactions` is universal enough today.)

## Content module — `src/pages/info/content.js`

A pure module exporting `INFO_SECTIONS`: an array of area objects:

```js
{ id, title, what, related, can: ["…", "…"], sub?: [ { id, title, what?, related?, can: [...] } ] }
```

- `id` — short slug (e.g. `"cashier"`, `"treasury"`).
- `title` — RU heading (e.g. `"Касса"`).
- `what` — one plain sentence ("Это про …").
- `related` — one sentence ("Держится на …" / "Связано с …").
- `can` — array of plain-language bullets ("Создать обмен с несколькими ногами", …).
- `sub` — optional nested sub-features (used for Treasury's tabs); each has at least `title` + `can`, optionally `what`/`related`.

The areas (final list — the implementer fills the prose, but these are the items and the gist):

1. **Касса** — главный экран оператора. _Что:_ курсы и балансы + создание сделок. _Связано:_ счета (движения / v2-леджер), курсы (каналы/пары), клиенты, обязательства (отложенные OUT-ноги). _Умеет:_ создать обмен (несколько ног in/out), top-up клиента, перевод между нашими счетами, доход/расход; редактировать сделку; видеть открытые обязательства и закрывать их.
2. **Капитал** — _Что:_ сводки по капиталу в базовой валюте. _Связано:_ балансы всех счетов, курсы (для перевода в base), рефералы, клиенты. _Умеет:_ показать сколько денег и где, прибыль, реферальные начисления, LTV клиентов.
3. **Счета** — _Что:_ список наших счетов (касса, банк, крипто-кошельки). _Связано:_ движения (балансы считаются из них, не хранятся), офисы. _Умеет:_ видеть баланс / зарезервировано / доступно по каждому счёту; история движений; добавить счёт; импорт/экспорт.
4. **Контрагенты** — _Что:_ клиенты и OTC-партнёры в одном разделе. _Связано:_ сделки, обязательства, рефералы. _Умеет:_ список клиентов и партнёров; профиль с историей; вкладка обязательств (кто кому сколько должен).
5. **Казначейство** — _Что:_ бухгалтерский раздел на двойной записи (v2-леджер: транзакции + журнальные проводки Дт/Кт + план счетов). _Связано:_ всё, что пишется в `ledger.*` (сделки кассы, переводы, пополнения, корректировки, ручные проводки), курсы (для базовой валюты). _Умеет:_ см. подпункты. `sub`:
   - **Активы / Пассивы / Капитал** — баланс по классам счетов; разворот счёта → его проводки за всё время; для счетов с субконто (клиенты/партнёры) — сворачиваемые субконто-строки → проводки конкретного клиента/партнёра; внизу прилипшая проверка тождества «Активы = Пассивы + Капитал».
   - **P&L** — отчёт о прибылях за период: доходы / расходы / курсовые разницы / чистая прибыль; пресеты периода (сегодня/неделя/месяц/квартал/год/30 дней); экспорт CSV; тумблер «сравнить с прошлым периодом» (добавляет колонки «прошл.» и «Δ»).
   - **Обороты** — ОСВ (оборотно-сальдовая ведомость: остаток на начало / оборот Дт / оборот Кт / остаток на конец по каждому счёту, с проверками тождеств и экспортом CSV) + Шахматка (матрица оборотов счёт-Дт × счёт-Кт за период).
   - **Журнал** — хронология транзакций; разворот → таблица Дт/Кт проводок; ссылка в исходный документ; фильтр по типу (сделки/переводы/пополнения/корректировки/ручные/сторно); у ручных проводок — кнопка «Сторнировать».
   - **Ручная проводка** — конструктор ручной N-плечей проводки (для корректировок, реклассификаций, начислений, ручных комиссий): выбираешь счета, вводишь Дт/Кт, должно сходиться Σ Дт = Σ Кт, одна валюта; доступно только owner/accountant; пишется в леджер + audit-alert; сторнируется из Журнала. (Счета с обязательным субконто — клиенты/партнёры — в v1 в этом конструкторе не доступны.)
6. **Настройки** — _Что:_ администрирование. _Связано:_ пользователи, права, офисы, курсы. _Умеет:_ пользователи и приглашения; матрица прав (роль × раздел × уровень disabled/view/edit); офисы; курсы (каналы fiat: cash/bank/sepa/swift, crypto: network с gas-fee; пары; lifecycle draft→confirmed); базовая валюта.
7. **Аудит** — _Что:_ журнал действий. _Связано:_ все операции. _Умеет:_ кто что когда сделал.
8. **Как всё связано (глоссарий)** — короткие пояснения: «движения (movements) — это атомарные перемещения денег; балансы считаются из них, нигде не хранятся»; «v2-леджер — двойная запись (каждая транзакция = пары Дт/Cr на 174-счётном плане); Казначейство показывает именно его»; «субконто — измерение на счёте-обязательстве: на счёте «обязательства перед клиентами» хранится отдельный остаток по каждому клиенту»; «фича-флаги `VITE_USE_NEW_DEAL_FORM` (новая форма сделки) и `VITE_USE_NEW_LEDGER` (запись через `ledger.*` вместо легаси-таблиц) — что включают, как откатить».

(The implementer should write the prose to be genuinely plain — short sentences, no jargon without a one-line gloss. The above is the skeleton + gist; expand it sensibly without inventing features that don't exist.)

## Component — `src/pages/InfoPage.jsx`

- `import { useTranslation }` for the page title (or just hardcode "Справка" — but a `nav_info`-style title key is fine; the page heading can reuse `t("nav_info")` or a literal "Справка / Info" — implementer's call; keep it simple). Renders: a page heading + a short intro line, then `INFO_SECTIONS.map(section => <InfoCard section />)`.
- `InfoCard` (small, can be inline in the same file): a collapsible card — header (the `title` + a chevron, click toggles), body: the `what` line (italic/muted), the `related` line, the `can` bullet list, and if `sub` — a nested list of sub-cards (each sub-card: `title` bolded, optional `what`/`related`, `can` bullets), slightly indented. Default state: collapsed, except maybe the first card open (implementer's call). Tailwind, consistent with the rest of the app's card style (`bg-white rounded-[14px] border border-slate-200/70`, etc.).
- No store, no `useCan`, no async. Pure render of static content.
- The `<main>` wrapper should match the other pages' container (`max-w-[...] mx-auto px-6 py-6`-ish — copy from e.g. `TreasuryShell` / another page).

## Testing

- `src/pages/info/content.test.js` (or `.js` colocated): sanity over `INFO_SECTIONS` — non-empty array; every section has a non-empty `id`, `title`, `what`, `related`, and a non-empty `can` array; every `sub` item (where present) has a non-empty `title` and `can`; `id`s are unique.
- `src/pages/InfoPage.test.jsx`: renders the page heading; renders every section's `title`; clicking a section header expands it and reveals its `what` / `can` text (mock `useTranslation` as `t: (k) => k` if the page uses it). One smoke-level test is enough.

## Out of scope

- Search within the manual; screenshots / diagrams / video; versioned changelog of the manual; translating the manual to en/tr (RU only — only `nav_info` is i18n'd in 3 languages).
- Linking each manual entry to the actual page/tab (deep-links). Nice-to-have, defer.
- Embedding it as a tab inside Treasury — explicitly rejected (the user asked for a separate top-level page).

## References

- Page wiring: `src/App.jsx` (`PAGE_SECTION`, `canShow`, the `{page === "X" && canShow("X") && <XPage/>}` renders), `src/components/Header.jsx` (`NAV_PAGES`, `can(p.section)` filter), `src/i18n/translations.jsx` (`nav_*` keys).
- Card / container styling to mirror: `src/pages/treasury_v2/parts/ClassSection.jsx`, `src/pages/treasury_v2/TreasuryShell.jsx`.
- Feature truth (what to describe): this repo's `CLAUDE.md`, and the specs/plans under `docs/superpowers/` (Treasury Spec B, Posting Master C.1, Turnover C.2, P&L C.3, Subconto C.4).
