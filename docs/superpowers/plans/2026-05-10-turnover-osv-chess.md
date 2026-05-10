# Turnover Report (ОСВ + Шахматка) Implementation Plan (Spec C.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only «Обороты» tab to the Treasury section with two period reports over `ledger.journal_entries` — an Оборотно-сальдовая ведомость (trial balance: per-account opening / Σ Dr / Σ Cr / closing) and a Шахматка (account×account turnover cross-tab, base currency, proportional allocation for multi-leg transactions).

**Architecture:** Two new pure selectors in `src/lib/treasury/v2selectors.js` (`trialBalance`, `chessTurnover`) plus a 1-arg backward-compatible extension of `accountEntries`. UI: `TurnoverTab` (period picker + ОСВ/Шахматка sub-view toggle, mirroring `JournalTab`/`PnLTab` patterns) rendering `TrialBalanceTable` or `ChessSheetTable`. Tab wired into `TreasuryShell` between `pnl` and `journal`, no new permission. CSV export reuses `src/utils/csv.js`'s `exportCSV`.

**Tech Stack:** Vite + React 18 + Tailwind 3; Vitest + @testing-library/react (jsdom). No router/state-lib. No DB changes.

**Spec:** `docs/superpowers/specs/2026-05-10-turnover-osv-chess-design.md`. Builds on Spec B (`src/pages/treasury_v2/`) and Spec C.1 (Posting Master), both on `main`.

---

## Phase 0 — Branch + baseline

### Task 0.1: Confirm branch and baseline green

**Files:** none.

- [ ] **Step 1: Confirm the working branch** — `git branch --show-current` → expected `feat/turnover` (created with the spec; if on `main`, `git checkout feat/turnover`).
- [ ] **Step 2: Baseline tests** — `npx vitest run --no-file-parallelism` → expected all green (28 files / 257 tests as of the Posting Master merge). Note the exact counts; later phases only add.
- [ ] **Step 3: Baseline build** — `npm run build` → succeeds (the chunk-size warning is pre-existing).

---

## Phase 1 — i18n keys

### Task 1.1: Add `trv2_tab_turnover` + `trv2_to_*` keys (en / ru / tr)

**Files:** Modify: `src/i18n/translations.jsx` (three locale blocks; each has a `trv2_loading:` line near the end of the `trv2_*` cluster and a `trv2_tab_journal:` line — insert near those).

- [ ] **Step 1: English keys** — After the existing `trv2_tab_journal: "Журнал"` line... actually find the `trv2_tab_journal:` entry in the EN block (its value is `"Journal"`). After it add:

```jsx
    trv2_tab_turnover: "Turnover",
```

After the existing EN `trv2_loading: "Loading ledger…",` (and any keys already added after it) add:

```jsx
    // Turnover report (Spec C.2) — ОСВ + Шахматка
    trv2_to_view_osv: "Trial balance",
    trv2_to_view_chess: "Chess sheet",
    trv2_to_col_account: "Account",
    trv2_to_col_currency: "Cur",
    trv2_to_col_opening: "Opening",
    trv2_to_col_debit: "Debit",
    trv2_to_col_credit: "Credit",
    trv2_to_col_closing: "Closing",
    trv2_to_subtotal: "Subtotal",
    trv2_to_total: "Total",
    trv2_to_class_revenue: "Revenue",
    trv2_to_class_expense: "Expense",
    trv2_to_class_other: "Other",
    trv2_to_check_turnover: "Σ Debit turnover = Σ Credit turnover",
    trv2_to_check_opening: "Σ Opening (Dr side) = Σ Opening (Cr side)",
    trv2_to_check_closing: "Σ Closing (Dr side) = Σ Closing (Cr side)",
    trv2_to_export_csv: "Export CSV",
    trv2_to_chess_row_total: "Σ by Debit",
    trv2_to_chess_col_total: "Σ by Credit",
    trv2_to_chess_note: "Cell = turnover that flowed from the row account (Dr) to the column account (Cr), in {cur}. For transactions with more than two legs, each Dr leg is allocated across the Cr legs in proportion to their size.",
    trv2_to_empty_osv: "No account activity in the selected period.",
    trv2_to_empty_chess: "No transactions in the selected period.",
```

- [ ] **Step 2: Russian keys** — In the RU block, after `trv2_tab_journal: "Журнал",` add:

```jsx
    trv2_tab_turnover: "Обороты",
```

After RU `trv2_loading: "Загрузка леджера…",` (and any keys after it) add:

```jsx
    // Отчёт по оборотам (Spec C.2) — ОСВ + Шахматка
    trv2_to_view_osv: "ОСВ",
    trv2_to_view_chess: "Шахматка",
    trv2_to_col_account: "Счёт",
    trv2_to_col_currency: "Вал.",
    trv2_to_col_opening: "Сальдо нач.",
    trv2_to_col_debit: "Оборот Дт",
    trv2_to_col_credit: "Оборот Кт",
    trv2_to_col_closing: "Сальдо кон.",
    trv2_to_subtotal: "Итого по разделу",
    trv2_to_total: "Итого",
    trv2_to_class_revenue: "Доходы",
    trv2_to_class_expense: "Расходы",
    trv2_to_class_other: "Прочее",
    trv2_to_check_turnover: "Σ Оборот Дт = Σ Оборот Кт",
    trv2_to_check_opening: "Σ Сальдо нач. (Дт) = Σ Сальдо нач. (Кт)",
    trv2_to_check_closing: "Σ Сальдо кон. (Дт) = Σ Сальдо кон. (Кт)",
    trv2_to_export_csv: "Экспорт CSV",
    trv2_to_chess_row_total: "Итого по Дт",
    trv2_to_chess_col_total: "Итого по Кт",
    trv2_to_chess_note: "Ячейка = оборот, ушедший со счёта строки (Дт) на счёт столбца (Кт), в {cur}. Для транзакций больше чем с двумя плечами каждое плечо Дт разносится по плечам Кт пропорционально их величине.",
    trv2_to_empty_osv: "Нет движений по счетам за выбранный период.",
    trv2_to_empty_chess: "Нет транзакций за выбранный период.",
```

- [ ] **Step 3: Turkish keys** — In the TR block, after `trv2_tab_journal: "Günlük",` (the TR value of `trv2_tab_journal` — find it; it may be `"Günlük"` or similar) add:

```jsx
    trv2_tab_turnover: "Cirolar",
```

After TR `trv2_loading: "Defter yükleniyor…",` (and any keys after it) add:

```jsx
    // Ciro raporu (Spec C.2) — ОСВ + Şahmat tablosu
    trv2_to_view_osv: "Mizan",
    trv2_to_view_chess: "Şahmat tablosu",
    trv2_to_col_account: "Hesap",
    trv2_to_col_currency: "Pb",
    trv2_to_col_opening: "Açılış",
    trv2_to_col_debit: "Borç ciro",
    trv2_to_col_credit: "Alacak ciro",
    trv2_to_col_closing: "Kapanış",
    trv2_to_subtotal: "Ara toplam",
    trv2_to_total: "Toplam",
    trv2_to_class_revenue: "Gelir",
    trv2_to_class_expense: "Gider",
    trv2_to_class_other: "Diğer",
    trv2_to_check_turnover: "Σ Borç ciro = Σ Alacak ciro",
    trv2_to_check_opening: "Σ Açılış (Borç) = Σ Açılış (Alacak)",
    trv2_to_check_closing: "Σ Kapanış (Borç) = Σ Kapanış (Alacak)",
    trv2_to_export_csv: "CSV dışa aktar",
    trv2_to_chess_row_total: "Borç toplamı",
    trv2_to_chess_col_total: "Alacak toplamı",
    trv2_to_chess_note: "Hücre = satır hesabından (Borç) sütun hesabına (Alacak) akan ciro, {cur} cinsinden. İkiden fazla bacaklı işlemlerde her Borç bacağı, Alacak bacaklarına büyüklükleri oranında dağıtılır.",
    trv2_to_empty_osv: "Seçili dönemde hesap hareketi yok.",
    trv2_to_empty_chess: "Seçili dönemde işlem yok.",
```

- [ ] **Step 4: Build** — `npm run build` → succeeds.
- [ ] **Step 5: Commit**
```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): trv2_to_* keys + trv2_tab_turnover (en/ru/tr)"
git push
```

---

## Phase 2 — Selectors (TDD)

### Task 2.1: Extend `accountEntries` with an optional `period` filter

**Files:** Modify: `src/lib/treasury/v2selectors.js` (the `accountEntries` function). Test: add to `src/lib/treasury/v2selectors.test.js`.

Context: `accountEntries(ctx, accountId, limit = 50)` currently returns the account's entries (mapped to a display shape), newest first, capped at `limit`. We add an optional 4th param `period = null`; when given, also keep only entries whose **transaction's `effectiveDate`** is in `[period.from, period.to]`. Default unchanged → existing callers (`AccountInlineEntries` with `accountEntries(ctx, accountId, 50)`) keep working identically.

- [ ] **Step 1: Failing test** — Append to `src/lib/treasury/v2selectors.test.js`:

```js
import { accountEntries } from "./v2selectors.js";

describe("accountEntries — optional period filter", () => {
  it("without period, returns all entries for the account (unchanged behaviour)", () => {
    const ctx = makeLedgerCtx();
    const all = accountEntries(ctx, "ac_cash_usd_mark");
    // fixture: je1 (tx_open) + je3 (tx_deal_1) touch ac_cash_usd_mark
    expect(all.map((e) => e.id).sort()).toEqual(["je1", "je3"]);
  });
  it("with a period, keeps only entries whose tx effectiveDate is in [from,to]", () => {
    const ctx = makeLedgerCtx();
    // tx_open.effectiveDate = 2026-04-01, tx_deal_1.effectiveDate = 2026-05-10
    const r = accountEntries(ctx, "ac_cash_usd_mark", 50, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" });
    expect(r.map((e) => e.id)).toEqual(["je3"]);
    const r2 = accountEntries(ctx, "ac_cash_usd_mark", 50, { from: "2026-03-01T00:00:00Z", to: "2026-04-30T00:00:00Z" });
    expect(r2.map((e) => e.id)).toEqual(["je1"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/v2selectors.test.js -t "optional period filter"` → FAIL (period arg ignored — the second assertion still returns both ids).

- [ ] **Step 3: Implement** — In `src/lib/treasury/v2selectors.js`, change `accountEntries` to:

```js
export function accountEntries(ctx, accountId, limit = 50, period = null) {
  const { entries, transactions } = ctx;
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const fromMs = period ? new Date(period.from).getTime() : -Infinity;
  const toMs = period ? new Date(period.to).getTime() : Infinity;
  return entries
    .filter((e) => e.accountId === accountId)
    .filter((e) => {
      if (!period) return true;
      const tx = txById.get(e.transactionId);
      const ts = tx ? new Date(tx.effectiveDate).getTime() : new Date(e.createdAt).getTime();
      return ts >= fromMs && ts <= toMs;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map((e) => {
      const tx = txById.get(e.transactionId);
      return {
        id: e.id,
        createdAt: e.createdAt,
        direction: e.direction,
        amount: e.amount,
        currency: e.currency,
        clientId: e.clientId || null,
        partnerId: e.partnerId || null,
        note: e.note || "",
        txId: e.transactionId,
        txKind: tx ? tx.kind : "unknown",
        sourceRefId: tx ? tx.sourceRefId : null,
      };
    });
}
```

(That body is the existing one with the extra `period` param + the extra `.filter`. Keep whatever the existing `.map(...)` shape is — it's reproduced above; verify it matches the file before/after.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/v2selectors.test.js` → all green (existing + the 2 new ones).
- [ ] **Step 5: Commit**
```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): accountEntries — optional period filter"
git push
```

### Task 2.2: `trialBalance` selector (TDD)

**Files:** Modify: `src/lib/treasury/v2selectors.js` (add `trialBalance` + the `normalSign` helper + class-order constants). Test: add to `src/lib/treasury/v2selectors.test.js`.

Context: `v2selectors.js` already has the non-exported `passesOfficeFilter(account, officeFilter)` helper. `ctx` shape used here: `{ accounts, balances, entries, transactions, toBase, officeFilter }`. `accounts[].type ∈ {asset, liability, equity, revenue, expense}`; asset/expense are Dr-normal, the rest Cr-normal. `ledger.balances` stores the magnitude on the account's normal side (verified prod) and an account can have multiple balance rows (per dimension) — sum them. Period attribution is by the entry's transaction `effectiveDate`.

- [ ] **Step 1: Failing test** — Append to `src/lib/treasury/v2selectors.test.js`:

```js
import { trialBalance } from "./v2selectors.js";

// Small purpose-built ctx where balances == Σ(signed entries) so opening/closing math is readable.
function makeTbCtx(overrides = {}) {
  const accounts = [
    { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "ofA" },
    { id: "bank", code: "1120", name: "Bank EUR", type: "asset", subtype: "bank", currency: "EUR", officeId: "ofB" },
    { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
    { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
    { id: "idle", code: "1199", name: "Idle account", type: "asset", subtype: "cash", currency: "USD", officeId: null }, // has a balance but no entries in any period
  ];
  // transactions: T1 effective 2026-03-10 (opening: Dr cash 1000 / Cr eq 1000),
  //               T2 effective 2026-05-15 (deal: Dr cash 200 / Cr rev 200)
  const transactions = [
    { id: "T1", effectiveDate: "2026-03-10T00:00:00Z", createdAt: "2026-03-10T00:00:00Z", kind: "opening", sourceRefId: null },
    { id: "T2", effectiveDate: "2026-05-15T00:00:00Z", createdAt: "2026-05-15T00:00:00Z", kind: "deal", sourceRefId: "D1" },
  ];
  const entries = [
    { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 1000, currency: "USD", createdAt: "2026-03-10T00:00:00Z" },
    { id: "e2", transactionId: "T1", accountId: "eq",   direction: "cr", amount: 1000, currency: "USD", createdAt: "2026-03-10T00:00:00Z" },
    { id: "e3", transactionId: "T2", accountId: "cash", direction: "dr", amount: 200,  currency: "USD", createdAt: "2026-05-15T00:00:00Z" },
    { id: "e4", transactionId: "T2", accountId: "rev",  direction: "cr", amount: 200,  currency: "USD", createdAt: "2026-05-15T00:00:00Z" },
  ];
  // current balances (magnitude on normal side): cash = 1200 (Dr-normal: 1200dr-0cr), eq = 1000 (Cr-normal), rev = 200 (Cr-normal), idle = 50
  const balances = [
    { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 1200 },
    { accountId: "eq",   currency: "USD", clientId: null, partnerId: null, balance: 1000 },
    { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 200 },
    { accountId: "idle", currency: "USD", clientId: null, partnerId: null, balance: 50 },
  ];
  const rate = (c) => ({ USD: 1, EUR: 1.1 }[String(c).toUpperCase()] ?? 0);
  return { accounts, transactions, entries, balances, toBase: (a, c) => Number(a) * rate(c), baseCurrency: "USD", officeFilter: "all", ...overrides };
}

describe("trialBalance", () => {
  it("computes opening / Dr turnover / Cr turnover / closing per account for a period (May)", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" }, "all");
    const findAcc = (id) => tb.classes.flatMap((c) => c.accounts).find((a) => a.accountId === id);
    // cash: current 1200; entries since 2026-05-01 = e3 (Dr 200, normalSign +200) ⇒ opening = 1200 - 200 = 1000;
    //       entries after 2026-05-31 = none ⇒ closing = 1200; Dr turnover in May = 200, Cr = 0
    expect(findAcc("cash")).toMatchObject({ opening: 1000, closing: 1200, debitTurnover: 200, creditTurnover: 0 });
    // rev: current 200; entries since 2026-05-01 = e4 (Cr 200, Cr-normal ⇒ normalSign +200) ⇒ opening = 200 - 200 = 0;
    //      after 2026-05-31 = none ⇒ closing = 200; Dr = 0, Cr turnover = 200
    expect(findAcc("rev")).toMatchObject({ opening: 0, closing: 200, debitTurnover: 0, creditTurnover: 200 });
    // eq: current 1000; no entries since 2026-05-01 ⇒ opening = 1000, closing = 1000; no turnover
    expect(findAcc("eq")).toMatchObject({ opening: 1000, closing: 1000, debitTurnover: 0, creditTurnover: 0 });
    // idle: has a balance (50) but no entries ⇒ opening = closing = 50, no turnover ⇒ still listed (nonzero balance)
    expect(findAcc("idle")).toMatchObject({ opening: 50, closing: 50, debitTurnover: 0, creditTurnover: 0 });
    // bank: zero everything everywhere ⇒ NOT listed
    expect(findAcc("bank")).toBeUndefined();
  });

  it("the period covering only T1 (March) shows cash opening 0 and Dr turnover 1000", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-03-01T00:00:00Z", to: "2026-03-31T00:00:00Z" }, "all");
    const cash = tb.classes.flatMap((c) => c.accounts).find((a) => a.accountId === "cash");
    // entries since 2026-03-01 = e1 (Dr 1000) + e3 (Dr 200) ⇒ opening = 1200 - 1200 = 0;
    // entries after 2026-03-31 = e3 (Dr 200) ⇒ closing = 1200 - 200 = 1000; Dr turnover in March = 1000 (only e1), Cr = 0
    expect(cash).toMatchObject({ opening: 0, closing: 1000, debitTurnover: 1000, creditTurnover: 0 });
  });

  it("classes are ordered asset, liability, equity, revenue, expense and carry labelKeys", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" }, "all");
    expect(tb.classes.map((c) => c.type)).toEqual(["asset", "equity", "revenue"]); // no liability/expense accounts in this fixture
    const asset = tb.classes.find((c) => c.type === "asset");
    expect(asset.labelKey).toBe("trv2_tab_assets");
    expect(tb.classes.find((c) => c.type === "revenue").labelKey).toBe("trv2_to_class_revenue");
    // accounts within a class sorted by code
    expect(asset.accounts.map((a) => a.code)).toEqual(["1110", "1199"]);
  });

  it("balance-identity checks: Σ Dr turnover (base) ≈ Σ Cr turnover (base); Σ opening/closing Dr side ≈ Cr side", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "all");
    // full year: turnover Dr base = e1 1000 + e3 200 = 1200; Cr base = e2 1000 + e4 200 = 1200 ⇒ ok
    expect(tb.totalInBase.debitTurnover).toBeCloseTo(1200, 6);
    expect(tb.totalInBase.creditTurnover).toBeCloseTo(1200, 6);
    expect(tb.check.turnoverOk).toBe(true);
    // openings for the year: all = 0 except idle (50, asset/Dr side); cash full-year opening = 1200 - 1200 = 0;
    //   so openingDr = 0 (cash) + 50 (idle) = 50 (Dr side: asset accounts); openingCr = 0 (eq) + 0 (rev) ... ⇒ NOT equal ⇒ openingOk false.
    // (The fixture's `idle` 50-balance has no offsetting entry, so the year's opening doesn't balance — that's fine, the check just reports it.)
    expect(tb.totalInBase.openingDr).toBeCloseTo(50, 6);
    expect(tb.check.openingOk).toBe(false);
  });

  it("office filter narrows the rows", () => {
    const ctx = makeTbCtx();
    const tb = trialBalance(ctx, { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "ofA");
    const codes = tb.classes.flatMap((c) => c.accounts).map((a) => a.code);
    // only `cash` has officeId "ofA"; `bank` is "ofB", others null (excluded by a specific office)
    expect(codes).toEqual(["1110"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/v2selectors.test.js -t "trialBalance"` → FAIL (`trialBalance` not exported).

- [ ] **Step 3: Implement** — In `src/lib/treasury/v2selectors.js` (after `accountEntries`, or near `pnlForPeriod`), add:

```js
const DR_NORMAL_TYPES = new Set(["asset", "expense"]);
function normalSign(account, entry) {
  const onNormalSide = DR_NORMAL_TYPES.has(account.type) ? entry.direction === "dr" : entry.direction === "cr";
  return (onNormalSide ? 1 : -1) * Number(entry.amount);
}

const TB_CLASS_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const TB_CLASS_LABEL_KEYS = {
  asset: "trv2_tab_assets", liability: "trv2_tab_liabilities", equity: "trv2_tab_equity",
  revenue: "trv2_to_class_revenue", expense: "trv2_to_class_expense",
};

// Оборотно-сальдовая ведомость over the period [period.from, period.to], attributing
// entries by their transaction's effectiveDate. opening/closing are derived from the
// current balance (magnitude on the account's normal side) minus the rollback of normalSign
// over entries since `from` (resp. after `to`).
export function trialBalance(ctx, period, officeFilter) {
  const { accounts, balances, entries, transactions, toBase } = ctx;
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const txEffMs = new Map(transactions.map((t) => [t.id, new Date(t.effectiveDate).getTime()]));

  const curBal = new Map();
  for (const b of balances) curBal.set(b.accountId, (curBal.get(b.accountId) || 0) + Number(b.balance));

  const agg = new Map(); // accId -> { sinceFrom, afterTo, drTurn, crTurn }
  for (const e of entries) {
    const acc = accById.get(e.accountId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const ts = txEffMs.get(e.transactionId);
    if (ts == null) continue;
    const rec = agg.get(e.accountId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    const s = normalSign(acc, e);
    if (ts >= fromMs) rec.sinceFrom += s;
    if (ts > toMs) rec.afterTo += s;
    if (ts >= fromMs && ts <= toMs) {
      if (e.direction === "dr") rec.drTurn += Number(e.amount); else rec.crTurn += Number(e.amount);
    }
    agg.set(e.accountId, rec);
  }

  const byClass = new Map();
  const candidates = new Set([...curBal.keys(), ...agg.keys()]);
  for (const accId of candidates) {
    const acc = accById.get(accId);
    if (!acc || !passesOfficeFilter(acc, officeFilter)) continue;
    const cur = curBal.get(accId) || 0;
    const rec = agg.get(accId) || { sinceFrom: 0, afterTo: 0, drTurn: 0, crTurn: 0 };
    const opening = cur - rec.sinceFrom;
    const closing = cur - rec.afterTo;
    const debitTurnover = rec.drTurn, creditTurnover = rec.crTurn;
    if (Math.abs(opening) < 1e-9 && Math.abs(closing) < 1e-9 && debitTurnover === 0 && creditTurnover === 0) continue;
    const ccy = acc.currency;
    const row = {
      accountId: accId, code: acc.code, name: acc.name, type: acc.type, subtype: acc.subtype || null, currency: ccy,
      opening, debitTurnover, creditTurnover, closing,
      openingInBase: toBase(opening, ccy) || 0,
      debitTurnoverInBase: toBase(debitTurnover, ccy) || 0,
      creditTurnoverInBase: toBase(creditTurnover, ccy) || 0,
      closingInBase: toBase(closing, ccy) || 0,
    };
    const cls = byClass.get(acc.type) || {
      type: acc.type, labelKey: TB_CLASS_LABEL_KEYS[acc.type] || "trv2_to_class_other", accounts: [],
      subtotalInBase: { opening: 0, debitTurnover: 0, creditTurnover: 0, closing: 0 },
    };
    cls.accounts.push(row);
    cls.subtotalInBase.opening += row.openingInBase;
    cls.subtotalInBase.debitTurnover += row.debitTurnoverInBase;
    cls.subtotalInBase.creditTurnover += row.creditTurnoverInBase;
    cls.subtotalInBase.closing += row.closingInBase;
    byClass.set(acc.type, cls);
  }
  for (const cls of byClass.values()) cls.accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const classes = TB_CLASS_ORDER.filter((t) => byClass.has(t)).map((t) => byClass.get(t));

  let openingDr = 0, openingCr = 0, debitTurnover = 0, creditTurnover = 0, closingDr = 0, closingCr = 0;
  for (const cls of classes) {
    const drSide = DR_NORMAL_TYPES.has(cls.type);
    if (drSide) { openingDr += cls.subtotalInBase.opening; closingDr += cls.subtotalInBase.closing; }
    else { openingCr += cls.subtotalInBase.opening; closingCr += cls.subtotalInBase.closing; }
    debitTurnover += cls.subtotalInBase.debitTurnover;
    creditTurnover += cls.subtotalInBase.creditTurnover;
  }
  return {
    classes,
    totalInBase: { openingDr, openingCr, debitTurnover, creditTurnover, closingDr, closingCr },
    check: {
      openingOk: Math.abs(openingDr - openingCr) < 0.01, openingDelta: openingDr - openingCr,
      turnoverOk: Math.abs(debitTurnover - creditTurnover) < 0.01, turnoverDelta: debitTurnover - creditTurnover,
      closingOk: Math.abs(closingDr - closingCr) < 0.01, closingDelta: closingDr - closingCr,
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/v2selectors.test.js` → all green.
- [ ] **Step 5: Commit**
```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): trialBalance selector (ОСВ)"
git push
```

### Task 2.3: `chessTurnover` selector (TDD)

**Files:** Modify: `src/lib/treasury/v2selectors.js` (add `chessTurnover`). Test: add to `src/lib/treasury/v2selectors.test.js`.

Context: builds the account×account base-currency matrix by iterating transactions in `[from, to]` (by `effectiveDate`) and allocating each Dr leg's base amount across the Cr legs proportionally. Office filter: keep a tx if any leg touches an account in the office (same as `transactionTree`).

- [ ] **Step 1: Failing test** — Append to `src/lib/treasury/v2selectors.test.js`:

```js
import { chessTurnover } from "./v2selectors.js";

function makeChessCtx() {
  const accounts = [
    { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: "ofA" },
    { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
    { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
    { id: "exp",  code: "5010", name: "Rent USD", type: "expense", subtype: "rent", currency: "USD", officeId: "ofB" },
  ];
  const transactions = [
    // T1: simple 2-leg, effective 2026-04-05 — Dr cash 1000 / Cr eq 1000
    { id: "T1", effectiveDate: "2026-04-05T00:00:00Z", createdAt: "2026-04-05T00:00:00Z", kind: "opening", sourceRefId: null },
    // T2: 3-leg balanced, effective 2026-04-20 — Dr cash 100 / Cr rev 30 / Cr eq 70
    { id: "T2", effectiveDate: "2026-04-20T00:00:00Z", createdAt: "2026-04-20T00:00:00Z", kind: "manual", sourceRefId: null },
    // T3: outside the test period (2026-08), should be ignored
    { id: "T3", effectiveDate: "2026-08-01T00:00:00Z", createdAt: "2026-08-01T00:00:00Z", kind: "deal", sourceRefId: "X" },
  ];
  const entries = [
    { id: "c1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 1000, currency: "USD", createdAt: "2026-04-05T00:00:00Z" },
    { id: "c2", transactionId: "T1", accountId: "eq",   direction: "cr", amount: 1000, currency: "USD", createdAt: "2026-04-05T00:00:00Z" },
    { id: "c3", transactionId: "T2", accountId: "cash", direction: "dr", amount: 100,  currency: "USD", createdAt: "2026-04-20T00:00:00Z" },
    { id: "c4", transactionId: "T2", accountId: "rev",  direction: "cr", amount: 30,   currency: "USD", createdAt: "2026-04-20T00:00:00Z" },
    { id: "c5", transactionId: "T2", accountId: "eq",   direction: "cr", amount: 70,   currency: "USD", createdAt: "2026-04-20T00:00:00Z" },
    { id: "c6", transactionId: "T3", accountId: "exp",  direction: "dr", amount: 999,  currency: "USD", createdAt: "2026-08-01T00:00:00Z" },
    { id: "c7", transactionId: "T3", accountId: "eq",   direction: "cr", amount: 999,  currency: "USD", createdAt: "2026-08-01T00:00:00Z" },
  ];
  return { accounts, transactions, entries, balances: [], toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all" };
}

describe("chessTurnover", () => {
  const P = { from: "2026-04-01T00:00:00Z", to: "2026-04-30T00:00:00Z" }; // captures T1 and T2, not T3

  it("a 2-leg transaction maps to one exact cell", () => {
    const ch = chessTurnover(makeChessCtx(), P, "all");
    // T1 alone: cell[cash][eq] = 1000 (×1000/1000). Plus T2's cell[cash][eq] = 100×70/100 = 70 ⇒ total 1070.
    expect(ch.rows.get("cash").get("eq")).toBeCloseTo(1070, 6);
  });

  it("a 3-leg transaction allocates the Dr leg across the Cr legs proportionally", () => {
    const ch = chessTurnover(makeChessCtx(), { from: "2026-04-15T00:00:00Z", to: "2026-04-30T00:00:00Z" }, "all"); // T2 only
    expect(ch.rows.get("cash").get("rev")).toBeCloseTo(30, 6);  // 100 × 30/100
    expect(ch.rows.get("cash").get("eq")).toBeCloseTo(70, 6);   // 100 × 70/100
    expect(ch.rowTotals.get("cash")).toBeCloseTo(100, 6);       // = cash's Dr turnover
    expect(ch.colTotals.get("rev")).toBeCloseTo(30, 6);
    expect(ch.colTotals.get("eq")).toBeCloseTo(70, 6);
    expect(ch.grandTotal).toBeCloseTo(100, 6);
  });

  it("only accounts with non-zero turnover appear, sorted by code; T3 outside the period is ignored", () => {
    const ch = chessTurnover(makeChessCtx(), P, "all");
    expect(ch.accounts.map((a) => a.code)).toEqual(["1110", "3100", "4010"]); // no 5010 (only in T3, out of period)
    expect(ch.accounts.find((a) => a.code === "1110")).toMatchObject({ accountId: "cash", name: "Cash USD" });
  });

  it("office filter keeps a tx only if a leg touches an account in the office", () => {
    const ch = chessTurnover(makeChessCtx(), { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }, "ofB");
    // only T3 touches `exp` (officeId ofB); T1/T2 touch `cash`(ofA)/`rev`(null)/`eq`(null) — no ofB ⇒ excluded.
    expect(ch.rows.get("exp")?.get("eq")).toBeCloseTo(999, 6);
    expect(ch.rows.has("cash")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/v2selectors.test.js -t "chessTurnover"` → FAIL (not exported).

- [ ] **Step 3: Implement** — In `src/lib/treasury/v2selectors.js`, add (after `trialBalance`):

```js
// Шахматка: account×account base-currency turnover matrix for the period [from,to]
// (transactions attributed by effectiveDate). For each tx, each Dr leg's base amount is
// allocated across the Cr legs in proportion to their base amounts. Row sums == Σ Dr
// turnover per account, column sums == Σ Cr turnover per account.
export function chessTurnover(ctx, period, officeFilter) {
  const { transactions, entries, accounts, toBase } = ctx;
  const fromMs = new Date(period.from).getTime();
  const toMs = new Date(period.to).getTime();
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const entriesByTx = new Map();
  for (const e of entries) {
    const arr = entriesByTx.get(e.transactionId) || [];
    arr.push(e);
    entriesByTx.set(e.transactionId, arr);
  }
  const rows = new Map();
  const add = (drId, crId, v) => {
    let m = rows.get(drId);
    if (!m) { m = new Map(); rows.set(drId, m); }
    m.set(crId, (m.get(crId) || 0) + v);
  };
  for (const t of transactions) {
    const ts = new Date(t.effectiveDate).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const txEntries = entriesByTx.get(t.id) || [];
    if (officeFilter !== "all" && officeFilter) {
      const touches = txEntries.some((e) => accById.get(e.accountId)?.officeId === officeFilter);
      if (!touches) continue;
    }
    const drLegs = [], crLegs = [];
    for (const e of txEntries) {
      const base = toBase(Number(e.amount), e.currency) || 0;
      if (e.direction === "dr") drLegs.push({ accId: e.accountId, base });
      else crLegs.push({ accId: e.accountId, base });
    }
    const totalCr = crLegs.reduce((s, c) => s + c.base, 0);
    if (totalCr === 0) continue;
    for (const d of drLegs) for (const c of crLegs) add(d.accId, c.accId, (d.base * c.base) / totalCr);
  }
  const rowTotals = new Map(), colTotals = new Map();
  const appearing = new Set();
  for (const [drId, m] of rows) {
    let rt = 0;
    for (const [crId, v] of m) {
      if (Math.abs(v) < 1e-9) continue;
      rt += v;
      appearing.add(crId);
      colTotals.set(crId, (colTotals.get(crId) || 0) + v);
    }
    if (Math.abs(rt) > 1e-9) { appearing.add(drId); rowTotals.set(drId, rt); }
  }
  let grandTotal = 0;
  for (const v of rowTotals.values()) grandTotal += v;
  const accList = [...appearing].map((id) => {
    const a = accById.get(id) || {};
    return { accountId: id, code: a.code || "?", name: a.name || "?", type: a.type, subtype: a.subtype || null };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return { accounts: accList, rows, rowTotals, colTotals, grandTotal };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/v2selectors.test.js` → all green.
- [ ] **Step 5: Commit**
```bash
git add src/lib/treasury/v2selectors.js src/lib/treasury/v2selectors.test.js
git commit -m "feat(treasury): chessTurnover selector (Шахматка matrix)"
git push
```

---

## Phase 3 — `<TrialBalanceTable>`

### Task 3.1: `src/pages/treasury_v2/parts/TrialBalanceTable.jsx` (+ test)

**Files:** Create: `src/pages/treasury_v2/parts/TrialBalanceTable.jsx`. Test: `src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx`.

Props: `{ ctx, window, officeFilter, formatBase, baseCurrency, onOpenTx }` — `window = { from, to }` ISO strings. Renders the ОСВ: per-class sections (header + rows), expandable rows → `AccountInlineEntries` filtered to the window, a balance-check footer, and an «Экспорт CSV» button (`exportCSV` from `src/utils/csv.js`).

- [ ] **Step 1: Failing test** — Create `src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k) => k }) }));
const exportCSVMock = vi.fn(() => true);
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));

import TrialBalanceTable from "./TrialBalanceTable.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const transactions = [
  { id: "T1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "deal", sourceRefId: "D1" },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 200, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 200, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
];
const balances = [
  { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 200 },
  { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 200 },
  { accountId: "eq",   currency: "USD", clientId: null, partnerId: null, balance: 0 },
];
const ctx = { accounts, transactions, entries, balances, toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all" };
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };

describe("TrialBalanceTable", () => {
  it("renders class sections and account rows with turnover", () => {
    render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByText("1110")).toBeInTheDocument();
    expect(screen.getByText("Cash USD")).toBeInTheDocument();
    expect(screen.getByText("4010")).toBeInTheDocument();
    // class headers
    expect(screen.getByText("trv2_tab_assets")).toBeInTheDocument();
    expect(screen.getByText("trv2_to_class_revenue")).toBeInTheDocument();
  });

  it("expands an account row to show its inline entries for the period", () => {
    const { container } = render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(container.textContent).not.toContain("D1");
    fireEvent.click(screen.getByText("1110"));
    expect(container.textContent).toContain("D1"); // AccountInlineEntries renders the source ref
  });

  it("Export CSV button calls exportCSV with rows", () => {
    render(<TrialBalanceTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_to_export_csv" }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const arg = exportCSVMock.mock.calls[0][0];
    expect(Array.isArray(arg.rows)).toBe(true);
    expect(arg.rows.some((r) => r.code === "1110")).toBe(true);
  });

  it("shows the empty state when no account has activity", () => {
    const emptyCtx = { ...ctx, entries: [], balances: [] };
    render(<TrialBalanceTable ctx={emptyCtx} window={win} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByText("trv2_to_empty_osv")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx` → FAIL (cannot resolve).

- [ ] **Step 3: Implement** — Create `src/pages/treasury_v2/parts/TrialBalanceTable.jsx`:

```jsx
// src/pages/treasury_v2/parts/TrialBalanceTable.jsx
// Оборотно-сальдовая ведомость for a period: per-class sections, expandable account
// rows (→ AccountInlineEntries filtered to the window), a balance-check footer, CSV export.
import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { trialBalance } from "../../../lib/treasury/v2selectors.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountInlineEntries from "./AccountInlineEntries.jsx";

const num = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function AccountRow({ ctx, window: win, row, onOpenTx }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="px-2 py-1.5 w-6 text-slate-400">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400 w-14">{row.code}</td>
        <td className="px-2 py-1.5 text-[12.5px] text-slate-900">{row.name}</td>
        <td className="px-2 py-1.5 text-slate-500 w-12">{row.currency}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28">{num(row.opening)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-emerald-700">{num(row.debitTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 text-rose-700">{num(row.creditTurnover)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums w-28 font-medium">{num(row.closing)}</td>
      </tr>
      {open && (
        <tr><td colSpan={8} className="p-0"><AccountInlineEntries ctx={ctx} accountId={row.accountId} period={win} onOpenTx={onOpenTx} /></td></tr>
      )}
    </>
  );
}

export default function TrialBalanceTable({ ctx, window: win, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const tb = useMemo(() => trialBalance(ctx, win, officeFilter), [ctx, win, officeFilter]);
  const allRows = tb.classes.flatMap((c) => c.accounts);

  function doExport() {
    exportCSV({
      filename: `osv_${(win.from || "").slice(0, 10)}_${(win.to || "").slice(0, 10)}.csv`,
      columns: [
        { key: "class", label: t("trv2_to_col_account") + " class" },
        { key: "code", label: "code" },
        { key: "name", label: t("trv2_to_col_account") },
        { key: "currency", label: t("trv2_to_col_currency") },
        { key: "opening", label: t("trv2_to_col_opening") },
        { key: "debit", label: t("trv2_to_col_debit") },
        { key: "credit", label: t("trv2_to_col_credit") },
        { key: "closing", label: t("trv2_to_col_closing") },
      ],
      rows: tb.classes.flatMap((c) => c.accounts.map((a) => ({
        class: t(c.labelKey), code: a.code, name: a.name, currency: a.currency,
        opening: a.opening, debit: a.debitTurnover, credit: a.creditTurnover, closing: a.closing,
      }))),
    });
  }

  if (allRows.length === 0) {
    return <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_to_empty_osv")}</div>;
  }

  const chip = (ok) => ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800";
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={doExport} className="text-[12px] px-2.5 py-1 rounded-[8px] bg-slate-100 text-slate-700 hover:bg-slate-200">{t("trv2_to_export_csv")}</button>
      </div>
      <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
              <th className="w-6" /><th className="text-left px-2 py-1.5">{t("trv2_to_col_account")}</th><th /><th className="text-left px-2 py-1.5">{t("trv2_to_col_currency")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_opening")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_debit")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_credit")}</th>
              <th className="text-right px-2 py-1.5">{t("trv2_to_col_closing")}</th>
            </tr>
          </thead>
          <tbody>
            {tb.classes.map((cls) => (
              <React.Fragment key={cls.type}>
                <tr className="bg-slate-100/70">
                  <td className="px-2 py-1.5" colSpan={4}><span className="font-bold text-[12px] text-slate-700">{t(cls.labelKey)}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-slate-500">{formatBase(cls.subtotalInBase.opening, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-slate-500">{formatBase(cls.subtotalInBase.debitTurnover, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-slate-500">{formatBase(cls.subtotalInBase.creditTurnover, baseCurrency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[11px] text-slate-500">{formatBase(cls.subtotalInBase.closing, baseCurrency)}</td>
                </tr>
                {cls.accounts.map((row) => <AccountRow key={row.accountId} ctx={ctx} window={win} row={row} onOpenTx={onOpenTx} />)}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 text-white">
              <td className="px-2 py-2" colSpan={4}><span className="font-bold text-[12px]">{t("trv2_to_total")}</span></td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.openingDr, baseCurrency)} / {formatBase(tb.totalInBase.openingCr, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.debitTurnover, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.creditTurnover, baseCurrency)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[12px]">{formatBase(tb.totalInBase.closingDr, baseCurrency)} / {formatBase(tb.totalInBase.closingCr, baseCurrency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        <span className={`px-2 py-1 rounded ${chip(tb.check.turnoverOk)}`}>{t("trv2_to_check_turnover")} {tb.check.turnoverOk ? "✓" : `(Δ ${formatBase(tb.check.turnoverDelta, baseCurrency)})`}</span>
        <span className={`px-2 py-1 rounded ${chip(tb.check.openingOk)}`}>{t("trv2_to_check_opening")} {tb.check.openingOk ? "✓" : `(Δ ${formatBase(tb.check.openingDelta, baseCurrency)})`}</span>
        <span className={`px-2 py-1 rounded ${chip(tb.check.closingOk)}`}>{t("trv2_to_check_closing")} {tb.check.closingOk ? "✓" : `(Δ ${formatBase(tb.check.closingDelta, baseCurrency)})`}</span>
      </div>
    </div>
  );
}
```

  IMPORTANT — about the `<AccountInlineEntries>` period filter: the spec wants the expanded rows to show only the period's entries, via `accountEntries(ctx, accountId, 50, period)`. But `AccountInlineEntries` currently calls `accountEntries(ctx, accountId, 50)` with no period. Pick ONE of these (do whichever is cleaner — the simpler is the second):
  - **(a)** Add an optional `period` prop to `AccountInlineEntries` and forward it to `accountEntries`; pass `period={win}` from `AccountRow` here. (One small edit to `AccountInlineEntries.jsx`; the existing balance-tab callers pass no `period` → unchanged.)
  - **(b)** Leave `AccountInlineEntries` alone — the expanded row shows all of the account's entries (newest 50), not just the period's. Acceptable for v1; the row's numbers are still period-scoped, only the drill-down list is broader.
  Recommend **(a)**. If you do (a): in `AccountInlineEntries.jsx` change the component signature to accept an optional `period` prop and call `accountEntries(ctx, accountId, 50, period)`; in `TrialBalanceTable`'s `AccountRow` pass `period={win}` to `<AccountInlineEntries>` (you'll need to thread `win` through to `AccountRow` — it already receives `window: win`). The existing balance-tab callers of `<AccountInlineEntries>` pass no `period` → `accountEntries(ctx, accountId, 50, undefined)` → identical behaviour. The test's "expands … shows D1" assertion still passes for this fixture either way (the only entry on `cash` is in the window).

- [ ] **Step 4: Run, expect PASS + build** — `npx vitest run src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx` then `npm run build` → tests green, build clean.
- [ ] **Step 5: Commit**
```bash
git add src/pages/treasury_v2/parts/TrialBalanceTable.jsx src/pages/treasury_v2/parts/TrialBalanceTable.test.jsx src/pages/treasury_v2/parts/AccountInlineEntries.jsx
git commit -m "feat(treasury): TrialBalanceTable (ОСВ view) + period-scoped inline entries"
git push
```

---

## Phase 4 — `<ChessSheetTable>`

### Task 4.1: `src/pages/treasury_v2/parts/ChessSheetTable.jsx` (+ test)

**Files:** Create: `src/pages/treasury_v2/parts/ChessSheetTable.jsx`. Test: `src/pages/treasury_v2/parts/ChessSheetTable.test.jsx`.

Props: `{ ctx, window, officeFilter, formatBase, baseCurrency }`. Renders the chess matrix in a horizontally-scrollable container.

- [ ] **Step 1: Failing test** — Create `src/pages/treasury_v2/parts/ChessSheetTable.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, p) => k }) }));

import ChessSheetTable from "./ChessSheetTable.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
  { id: "eq",   code: "3100", name: "Opening Equity USD", type: "equity", subtype: "opening_balance", currency: "USD", officeId: null },
];
const transactions = [
  { id: "T1", effectiveDate: "2026-05-10T00:00:00Z", createdAt: "2026-05-10T00:00:00Z", kind: "manual", sourceRefId: null },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 100, currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 30,  currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
  { id: "e3", transactionId: "T1", accountId: "eq",   direction: "cr", amount: 70,  currency: "USD", createdAt: "2026-05-10T00:00:00Z" },
];
const ctx = { accounts, transactions, entries, balances: [], toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all" };
const win = { from: "2026-05-01T00:00:00Z", to: "2026-05-31T00:00:00Z" };

describe("ChessSheetTable", () => {
  it("renders the matrix: account codes on both axes and the allocated cell values", () => {
    const { container } = render(<ChessSheetTable ctx={ctx} window={win} officeFilter="all" formatBase={(n) => String(n)} baseCurrency="USD" />);
    // codes appear as headers (row + col) — 1110 is a Dr row, 4010 and 3100 are Cr cols
    expect(screen.getAllByText("1110").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("4010").length).toBeGreaterThanOrEqual(1);
    // cells: cash→rev = 30, cash→eq = 70 ; row total cash = 100, grand total = 100
    expect(container.textContent).toContain("30");
    expect(container.textContent).toContain("70");
    expect(container.textContent).toContain("100");
    expect(screen.getByText("trv2_to_chess_row_total")).toBeInTheDocument();
    expect(screen.getByText("trv2_to_chess_col_total")).toBeInTheDocument();
  });

  it("shows the empty state when no transactions in the period", () => {
    render(<ChessSheetTable ctx={{ ...ctx, transactions: [], entries: [] }} window={win} officeFilter="all" formatBase={(n) => String(n)} baseCurrency="USD" />);
    expect(screen.getByText("trv2_to_empty_chess")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/treasury_v2/parts/ChessSheetTable.test.jsx` → FAIL (cannot resolve).

- [ ] **Step 3: Implement** — Create `src/pages/treasury_v2/parts/ChessSheetTable.jsx`:

```jsx
// src/pages/treasury_v2/parts/ChessSheetTable.jsx
// Шахматка: account×account base-currency turnover matrix for a period. Rows = Dr accounts,
// columns = Cr accounts. Multi-leg transactions are allocated proportionally (see selector).
import React, { useMemo } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { chessTurnover } from "../../../lib/treasury/v2selectors.js";

export default function ChessSheetTable({ ctx, window: win, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const ch = useMemo(() => chessTurnover(ctx, win, officeFilter), [ctx, win, officeFilter]);

  if (ch.accounts.length === 0) {
    return <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_to_empty_chess")}</div>;
  }
  const cols = ch.accounts;
  const rowsAccts = ch.accounts;
  const cell = (drId, crId) => {
    const v = ch.rows.get(drId)?.get(crId) || 0;
    return Math.abs(v) < 1e-9 ? "" : formatBase(v, baseCurrency);
  };
  return (
    <div className="space-y-2">
      <div className="bg-white rounded-[14px] border border-slate-200/70 overflow-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-100 px-2 py-1.5 border border-slate-200 text-slate-400 text-[10px] uppercase">Дт ╲ Кт</th>
              {cols.map((c) => (
                <th key={c.accountId} title={c.name} className="bg-slate-100 px-2 py-1.5 border border-slate-200 font-mono text-[10px] text-slate-600 whitespace-nowrap">{c.code}</th>
              ))}
              <th className="bg-slate-100 px-2 py-1.5 border border-slate-200 text-[10px] text-slate-500 whitespace-nowrap">{t("trv2_to_chess_row_total")}</th>
            </tr>
          </thead>
          <tbody>
            {rowsAccts.map((r) => (
              <tr key={r.accountId}>
                <th title={r.name} className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 border border-slate-200 font-mono text-[10px] text-slate-600 text-left whitespace-nowrap">{r.code}</th>
                {cols.map((c) => (
                  <td key={c.accountId} className="px-2 py-1.5 border border-slate-100 text-right tabular-nums">{cell(r.accountId, c.accountId)}</td>
                ))}
                <td className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{formatBase(ch.rowTotals.get(r.accountId) || 0, baseCurrency)}</td>
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 border border-slate-200 text-[10px] text-slate-500 text-left whitespace-nowrap">{t("trv2_to_chess_col_total")}</th>
              {cols.map((c) => (
                <td key={c.accountId} className="px-2 py-1.5 border border-slate-200 text-right tabular-nums font-medium bg-slate-50">{formatBase(ch.colTotals.get(c.accountId) || 0, baseCurrency)}</td>
              ))}
              <td className="px-2 py-1.5 border border-slate-300 text-right tabular-nums font-bold bg-slate-900 text-white">{formatBase(ch.grandTotal, baseCurrency)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">{t("trv2_to_chess_note").replace("{cur}", baseCurrency)}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS + build** — `npx vitest run src/pages/treasury_v2/parts/ChessSheetTable.test.jsx` then `npm run build` → tests green, build clean.
- [ ] **Step 5: Commit**
```bash
git add src/pages/treasury_v2/parts/ChessSheetTable.jsx src/pages/treasury_v2/parts/ChessSheetTable.test.jsx
git commit -m "feat(treasury): ChessSheetTable (Шахматка view)"
git push
```

---

## Phase 5 — `<TurnoverTab>`

### Task 5.1: `src/pages/treasury_v2/tabs/TurnoverTab.jsx` (+ test)

**Files:** Create: `src/pages/treasury_v2/tabs/TurnoverTab.jsx`. Test: `src/pages/treasury_v2/tabs/TurnoverTab.test.jsx`.

Props (from `TreasuryShell` — same as the other tabs): `{ ctx, officeFilter, formatBase, baseCurrency, onOpenTx, onOpenSource }`. Mirrors `JournalTab`/`PnLTab`: a `PeriodPicker` (default `"month"`, persisted), `extendWindow` wiring + the `trv2_window_partial` notice, plus a sub-view toggle (ОСВ / Шахматка, persisted).

- [ ] **Step 1: Failing test** — Create `src/pages/treasury_v2/tabs/TurnoverTab.test.jsx`:

```jsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../i18n/translations.jsx", () => ({ useTranslation: () => ({ t: (k, p) => k }) }));

import TurnoverTab from "./TurnoverTab.jsx";

const accounts = [
  { id: "cash", code: "1110", name: "Cash USD", type: "asset", subtype: "cash", currency: "USD", officeId: null },
  { id: "rev",  code: "4010", name: "Spread USD", type: "revenue", subtype: "spread", currency: "USD", officeId: null },
];
const transactions = [
  { id: "T1", effectiveDate: new Date().toISOString(), createdAt: new Date().toISOString(), kind: "manual", sourceRefId: null },
];
const entries = [
  { id: "e1", transactionId: "T1", accountId: "cash", direction: "dr", amount: 50, currency: "USD", createdAt: new Date().toISOString() },
  { id: "e2", transactionId: "T1", accountId: "rev",  direction: "cr", amount: 50, currency: "USD", createdAt: new Date().toISOString() },
];
const balances = [
  { accountId: "cash", currency: "USD", clientId: null, partnerId: null, balance: 50 },
  { accountId: "rev",  currency: "USD", clientId: null, partnerId: null, balance: 50 },
];
const ctx = { accounts, transactions, entries, balances, toBase: (a) => Number(a), baseCurrency: "USD", officeFilter: "all", sinceIso: "2000-01-01T00:00:00.000Z", extendWindow: () => {} };

describe("TurnoverTab", () => {
  it("renders the ОСВ view by default, with the sub-view toggle", () => {
    render(<TurnoverTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    expect(screen.getByRole("button", { name: "trv2_to_view_osv" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trv2_to_view_chess" })).toBeInTheDocument();
    // ОСВ table shows the account code
    expect(screen.getByText("1110")).toBeInTheDocument();
  });

  it("toggles to the Шахматка view", () => {
    render(<TurnoverTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" onOpenTx={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "trv2_to_view_chess" }));
    expect(screen.getByText("trv2_to_chess_row_total")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/treasury_v2/tabs/TurnoverTab.test.jsx` → FAIL (cannot resolve).

- [ ] **Step 3: Implement** — Create `src/pages/treasury_v2/tabs/TurnoverTab.jsx`:

```jsx
// src/pages/treasury_v2/tabs/TurnoverTab.jsx
// «Обороты» tab: a period turnover report with two views — ОСВ (trial balance) and
// Шахматка (account×account cross-tab). Read-only. Mirrors JournalTab/PnLTab patterns.
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import TrialBalanceTable from "../parts/TrialBalanceTable.jsx";
import ChessSheetTable from "../parts/ChessSheetTable.jsx";

const VIEWS = ["osv", "chess"];

export default function TurnoverTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_turnover_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_turnover_period", v); } catch {} };
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_turnover_view") || "osv"; } catch { return "osv"; }
  });
  const setV = (v) => { setView(v); try { localStorage.setItem("coinplata.treasury_turnover_view", v); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex items-center gap-1.5">
          {VIEWS.map((v) => (
            <button key={v} onClick={() => setV(v)}
              className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium ${view === v ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {t(v === "osv" ? "trv2_to_view_osv" : "trv2_to_view_chess")}
            </button>
          ))}
        </div>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      {view === "osv"
        ? <TrialBalanceTable ctx={ctx} window={win} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} onOpenTx={onOpenTx} />
        : <ChessSheetTable ctx={ctx} window={win} officeFilter={officeFilter} formatBase={formatBase} baseCurrency={baseCurrency} />}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS + build** — `npx vitest run src/pages/treasury_v2/tabs/TurnoverTab.test.jsx` then `npm run build` → tests green, build clean.
- [ ] **Step 5: Commit**
```bash
git add src/pages/treasury_v2/tabs/TurnoverTab.jsx src/pages/treasury_v2/tabs/TurnoverTab.test.jsx
git commit -m "feat(treasury): TurnoverTab — period turnover report (ОСВ + Шахматка)"
git push
```

---

## Phase 6 — Wire into `TreasuryShell`

### Task 6.1: Add the «Обороты» tab between `pnl` and `journal`

**Files:** Modify: `src/pages/treasury_v2/TreasuryShell.jsx`, `src/pages/treasury_v2/TreasuryShell.test.jsx`.

Context: `TreasuryShell` has a module-level `BASE_TABS` array (after the Posting Master change) with 5 entries: `assets, liabilities, equity, pnl, journal`, and inside the component conditionally appends a `posting` tab when `can("accounting","edit")`. We insert `turnover` between `pnl` and `journal` in `BASE_TABS` (so it's always there — no permission gating beyond the Treasury page itself).

- [ ] **Step 1: Edit `TreasuryShell.jsx`** — Add the import near the other tab imports:

```jsx
import TurnoverTab from "./tabs/TurnoverTab.jsx";
```

In the module-level `BASE_TABS` array, insert between the `pnl` entry and the `journal` entry:

```jsx
  { id: "turnover", labelKey: "trv2_tab_turnover", component: TurnoverTab },
```

(So `BASE_TABS` becomes `[assets, liabilities, equity, pnl, turnover, journal]`. The conditional `posting` append and everything else stays as-is.)

- [ ] **Step 2: Build** — `npm run build` → succeeds.

- [ ] **Step 3: Extend `TreasuryShell.test.jsx`** — Add a test in the existing file (it already mocks `i18n`, `offices`, `baseCurrency`, `ledger`, `permissions`, `toast`, `newLedger`). Add a new `it` inside an existing or new `describe`:

```jsx
describe("TreasuryShell — Обороты tab", () => {
  it("renders the Обороты tab and opening it shows the ОСВ view", () => {
    render(<TreasuryShell />);
    const tab = screen.getByRole("button", { name: "trv2_tab_turnover" });
    expect(tab).toBeInTheDocument();
    fireEvent.click(tab);
    // the ОСВ/Шахматка sub-view toggle is visible
    expect(screen.getByRole("button", { name: "trv2_to_view_osv" })).toBeInTheDocument();
  });
});
```

Note: the existing `TreasuryShell.test.jsx` mocks `useLedger` to return a fixture ctx (`fx` with `accounts/balances/transactions/entries`, `sinceIso`, `extendWindow`). `TurnoverTab` only reads `ctx.accounts/balances/transactions/entries/toBase/sinceIso/extendWindow` and `officeFilter` — all provided by the existing mock + the props `TreasuryShell` passes. If `trialBalance`/`chessTurnover` choke on the existing `fx` fixture (e.g. an entry referencing a missing account), they already guard with `if (!acc) continue` / `?.` — should be fine. If the test errors, the most likely cause is the `fx` fixture's transactions lacking `effectiveDate` — verify `fx.transactions[].effectiveDate` exists (it does in the version added by the Spec B `TreasuryShell.test.jsx`); if not, add it to the mock.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/TreasuryShell.test.jsx` → all green (existing + 1 new).
- [ ] **Step 5: Commit**
```bash
git add src/pages/treasury_v2/TreasuryShell.jsx src/pages/treasury_v2/TreasuryShell.test.jsx
git commit -m "feat(treasury): wire the Обороты tab into TreasuryShell"
git push
```

---

## Phase 7 — Final integration + PR

### Task 7.1: Full suite + build

**Files:** none.

- [ ] **Step 1: Full test suite** — `npx vitest run --no-file-parallelism` → all green. New since baseline: `accountEntries` +2, `trialBalance` +5, `chessTurnover` +4, `TrialBalanceTable` +4, `ChessSheetTable` +2, `TurnoverTab` +2, `TreasuryShell` +1. Totals only increase.
- [ ] **Step 2: Production build** — `npm run build` → clean.
- [ ] **Step 3: Local smoke (manual — note in the PR if skipped)** — `npm run dev`, open `/treasury` → there's an «Обороты» tab between «P&L» and «Журнал». ОСВ view: per-class account rows with opening/Dr/Cr/closing, expand a row → period entries, the three balance-check chips, Export CSV downloads a file. Toggle to Шахматка → a matrix grid with row/col totals + a corner grand total + the allocation note. Change the period preset → numbers change; pick «Год» → the "showing the most recent data only" notice appears briefly while the window extends. Change the office picker → the report re-filters.
- [ ] **Step 4: Commit any stragglers** — `git add -A && git commit -m "test(treasury): turnover test fixups" && git push` (skip if clean).

### Task 7.2: Open the PR

**Files:** none.

- [ ] **Step 1: Open PR via gh**

```bash
gh pr create --base main --head feat/turnover --title "feat(treasury): Turnover report — ОСВ + Шахматка (Spec C.2)" --body "$(cat <<'EOF'
## Summary
Adds a read-only «Обороты» tab to the Treasury section (between «P&L» and «Журнал»), Spec C.2, building on Spec B + C.1.

- New `trialBalance` selector — Оборотно-сальдовая ведомость: per account, for a period, opening / Σ debit turnover / Σ credit turnover / closing (native + base), grouped by class with subtotals + grand total + three balance-identity checks. Period attribution by transaction `effectiveDate`; opening/closing derived from current `ledger.balances` rolled back over entries.
- New `chessTurnover` selector — account×account base-currency turnover matrix; multi-leg transactions are allocated proportionally (each Dr leg spread across the Cr legs by size); row sums = Σ Dr turnover, column sums = Σ Cr turnover.
- `accountEntries` gained an optional period filter (backward-compatible).
- `TurnoverTab` (period picker + ОСВ/Шахматка sub-view toggle, `extendWindow` wiring + "partial data" notice — same patterns as JournalTab/PnLTab); `TrialBalanceTable` (expandable rows → period entries, CSV export via `utils/csv.js`); `ChessSheetTable` (scrollable matrix grid + totals + allocation footnote).
- i18n `trv2_to_*` + `trv2_tab_turnover` (en/ru/tr). No DB changes. No new permission (read-only, behind the Treasury page's existing `capital` view).

## Test plan
- [x] Full suite green (new: accountEntries 2, trialBalance 5, chessTurnover 4, TrialBalanceTable 4, ChessSheetTable 2, TurnoverTab 2, TreasuryShell 1)
- [x] `npm run build` clean
- [ ] Local smoke: «Обороты» tab renders; ОСВ rows + expand + CSV; Шахматка matrix + totals; period/office changes re-filter

## Out of scope (Spec C.3+)
Native-currency Шахматка matrices; subconto-level ОСВ/Шахматка (per-client/partner); drill from a Шахматка cell to transactions; saved report configs / scheduled exports; period-close logic.

Spec: `docs/superpowers/specs/2026-05-10-turnover-osv-chess-design.md`
Plan: `docs/superpowers/plans/2026-05-10-turnover-osv-chess.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the PR URL.

---

## Self-review checklist (run before declaring the plan complete)

**Spec coverage:**
- ✅ `trialBalance` selector (opening/Dr/Cr/closing, class grouping, totals, three checks, office filter, effectiveDate attribution, omit-zero-accounts) → Task 2.2
- ✅ `chessTurnover` selector (proportional allocation, row/col totals, grand total, only-appearing accounts, office filter, effectiveDate window) → Task 2.3
- ✅ `accountEntries` optional period filter → Task 2.1
- ✅ `TurnoverTab` (period picker, ОСВ/Шахматка toggle, extendWindow + partial-notice, persisted prefs) → Task 5.1
- ✅ `TrialBalanceTable` (class sections, expandable rows → period AccountInlineEntries, balance-check footer, CSV export) → Task 3.1
- ✅ `ChessSheetTable` (scrollable matrix, row/col totals, grand total, allocation footnote, empty state) → Task 4.1
- ✅ New «Обороты» tab in TreasuryShell between pnl and journal, no new permission → Task 6.1
- ✅ i18n `trv2_to_*` + `trv2_tab_turnover` (en/ru/tr) → Task 1.1
- ✅ Tests for selectors + all three components + TreasuryShell wiring → Tasks 2, 3, 4, 5, 6
- ⏸ Native-currency matrices / subconto ОСВ / cell drill / saved configs — deferred (noted in Out of scope & PR body)

**Type/name consistency:** `trialBalance(ctx, period, officeFilter)` → returns `{ classes:[{type,labelKey,accounts:[{accountId,code,name,type,subtype,currency,opening,debitTurnover,creditTurnover,closing,openingInBase,...}],subtotalInBase}], totalInBase:{openingDr,openingCr,debitTurnover,creditTurnover,closingDr,closingCr}, check:{openingOk,openingDelta,turnoverOk,turnoverDelta,closingOk,closingDelta} }` — consumed by `TrialBalanceTable` ✓. `chessTurnover(ctx, period, officeFilter)` → `{ accounts:[{accountId,code,name,type,subtype}], rows:Map<drId,Map<crId,base>>, rowTotals:Map, colTotals:Map, grandTotal }` — consumed by `ChessSheetTable` ✓. `accountEntries(ctx, accountId, limit=50, period=null)` — `AccountInlineEntries` may pass `period` (Task 3.1 option a) ✓. `presetWindow` imported from `../PeriodPicker.jsx` (existing) ✓. `exportCSV({filename, columns, rows})` from `../../../utils/csv.js` (existing) ✓. `<TurnoverTab>` props match what `TreasuryShell` passes every tab (`ctx, officeFilter, formatBase, baseCurrency, onOpenTx, onOpenSource`) ✓.

**Placeholder scan:** the only judgment-call note is Task 3.1's (a)/(b) for the inline-entries period filter — (a) is recommended and fully specified; the `{ ...ctx, accountEntriesPeriod: win }` leftover is explicitly flagged for removal. Otherwise every code step has full code and every command has expected output.

## Execution Handoff

(See the skill's handoff prompt — choose subagent-driven or inline execution before starting Phase 0.)
