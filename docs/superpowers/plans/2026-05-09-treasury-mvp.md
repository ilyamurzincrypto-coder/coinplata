# Treasury Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three placeholder treasury tabs with a single working `Dashboard` page for the current office, surfacing alert bar / 4 KPI cards / balances-by-type / currency breakdown / 50-movement timeline. Built on legacy data (no v2 ledger dependency).

**Architecture:** Pure-function selectors in `src/lib/treasury/selectors.js` — fixture-tested. Subcomponents under `src/pages/treasury/components/` are dumb presenters. `Dashboard.jsx` is the orchestrator that pulls hooks, runs selectors via `useMemo`, and renders subcomponents. `TreasuryPage.jsx` drops its tab UI and renders `Dashboard` with `currentOffice` prop. No DB migrations, no new providers, no v2 dependencies.

**Tech Stack:** React 18, Vitest 4, Tailwind 3, lucide-react. Hooks: `useAccounts`, `useObligations`, `useTransactions`, `useRates`, `useOffices`, `useBaseCurrency`.

**Branch:** `feat/treasury-mvp` (already exists, off `main` post-#18 squash, contains spec commit).

**Spec:** `docs/superpowers/specs/2026-05-09-treasury-mvp-design.md`.

---

## Phase 0 — Setup

### Task 0.1: Verify branch + baseline

**Files:** none (git only)

- [ ] **Step 1: Confirm branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status
```

Expected: `feat/treasury-mvp`. Working tree clean (only the spec commit `9dc03c1`).

- [ ] **Step 2: Run baseline test suite**

```bash
npm run test
```

Expected: **137 passed**. If any fail, STOP — surface to owner before continuing.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: succeeds with single warning about chunk size (existing).

---

## Phase 1 — i18n keys

### Task 1.1: Add Treasury Dashboard i18n keys (en / ru / tr)

**Files:**
- Modify: `src/i18n/translations.jsx`

All Dashboard UI strings flow through `t("tr_…")`. Must add to all three locales.

- [ ] **Step 1: Locate the en/ru/tr blocks**

```bash
grep -nE "^\s*(en|ru|tr):\s*\{" src/i18n/translations.jsx
```

Note line numbers of the three blocks. Add new keys near existing `tr_title` / `tr_subtitle` keys.

- [ ] **Step 2: Add English keys**

In the `en:` block, locate `tr_title:` and insert new keys before it (or after — order doesn't matter):

```js
    tr_dashboard_title: "Treasury",
    tr_dashboard_subtitle_office: "Office",
    tr_data_freshness: "as of {time}",
    tr_kpi_total_balance: "Total balance",
    tr_kpi_liabilities: "Liabilities",
    tr_kpi_available_funds: "Available funds",
    tr_kpi_activity24h: "Activity (24h)",
    tr_kpi_delta_vs_yesterday: "vs yesterday",
    tr_kpi_no_baseline: "—",
    tr_kpi_count_deals: "deals",
    tr_alert_overdue_obligations: "{n} obligation(s) open longer than 7 days",
    tr_alert_negative_balance: "{n} account(s) in negative balance",
    tr_alert_stuck_pending: "{n} pending transaction(s) older than 24h",
    tr_alert_stale_rates: "Currency rates are stale or unconfirmed",
    tr_balances_section_title: "Balances by type",
    tr_balances_col_type: "Type",
    tr_balances_col_count: "Accounts",
    tr_balances_col_available: "Available",
    tr_balances_col_reserved: "Reserved",
    tr_balances_col_total: "Total",
    tr_balances_col_total_in_base: "In base",
    tr_account_type_cash: "Cash",
    tr_account_type_bank: "Bank",
    tr_account_type_crypto: "Crypto wallet",
    tr_account_type_other: "Other",
    tr_currency_section_title: "By currency",
    tr_currency_col_code: "Currency",
    tr_currency_col_total: "Total",
    tr_currency_col_in_base: "In base",
    tr_timeline_section_title: "Recent movements",
    tr_timeline_empty: "No movements in this period.",
    tr_timeline_relative_now: "now",
    tr_timeline_relative_minutes: "{n}m ago",
    tr_timeline_relative_hours: "{n}h ago",
    tr_timeline_relative_days: "{n}d ago",
    tr_empty_state_title: "No accounts in this office yet",
    tr_empty_state_cta: "Create account",
```

- [ ] **Step 3: Add Russian keys**

In the `ru:` block, insert:

```js
    tr_dashboard_title: "Казначейство",
    tr_dashboard_subtitle_office: "Офис",
    tr_data_freshness: "на {time}",
    tr_kpi_total_balance: "Общий баланс",
    tr_kpi_liabilities: "Обязательства",
    tr_kpi_available_funds: "Доступные средства",
    tr_kpi_activity24h: "Активность (24ч)",
    tr_kpi_delta_vs_yesterday: "ко вчера",
    tr_kpi_no_baseline: "—",
    tr_kpi_count_deals: "сделок",
    tr_alert_overdue_obligations: "{n} обязательств открыто > 7 дней",
    tr_alert_negative_balance: "{n} счёт(ов) в минусе",
    tr_alert_stuck_pending: "{n} pending-сделок старше 24ч",
    tr_alert_stale_rates: "Курсы устарели или не подтверждены",
    tr_balances_section_title: "Балансы по типу",
    tr_balances_col_type: "Тип",
    tr_balances_col_count: "Счетов",
    tr_balances_col_available: "Доступно",
    tr_balances_col_reserved: "Зарезервировано",
    tr_balances_col_total: "Всего",
    tr_balances_col_total_in_base: "В base",
    tr_account_type_cash: "Касса",
    tr_account_type_bank: "Банк",
    tr_account_type_crypto: "Крипто-кошелёк",
    tr_account_type_other: "Прочее",
    tr_currency_section_title: "По валютам",
    tr_currency_col_code: "Валюта",
    tr_currency_col_total: "Всего",
    tr_currency_col_in_base: "В base",
    tr_timeline_section_title: "Последние движения",
    tr_timeline_empty: "Движений нет.",
    tr_timeline_relative_now: "сейчас",
    tr_timeline_relative_minutes: "{n} мин назад",
    tr_timeline_relative_hours: "{n} ч назад",
    tr_timeline_relative_days: "{n} дн назад",
    tr_empty_state_title: "В этом офисе пока нет счетов",
    tr_empty_state_cta: "Создать счёт",
```

- [ ] **Step 4: Add Turkish keys**

In the `tr:` block (Turkish locale, NOT the `tr_` prefix), insert:

```js
    tr_dashboard_title: "Hazine",
    tr_dashboard_subtitle_office: "Ofis",
    tr_data_freshness: "{time} itibarıyla",
    tr_kpi_total_balance: "Toplam bakiye",
    tr_kpi_liabilities: "Yükümlülükler",
    tr_kpi_available_funds: "Kullanılabilir fonlar",
    tr_kpi_activity24h: "Aktivite (24s)",
    tr_kpi_delta_vs_yesterday: "düne göre",
    tr_kpi_no_baseline: "—",
    tr_kpi_count_deals: "işlem",
    tr_alert_overdue_obligations: "{n} yükümlülük 7 günden uzun süredir açık",
    tr_alert_negative_balance: "{n} hesap negatif bakiyede",
    tr_alert_stuck_pending: "{n} bekleyen işlem 24 saatten eski",
    tr_alert_stale_rates: "Döviz kurları eskimiş veya onaysız",
    tr_balances_section_title: "Türe göre bakiyeler",
    tr_balances_col_type: "Tür",
    tr_balances_col_count: "Hesap",
    tr_balances_col_available: "Kullanılabilir",
    tr_balances_col_reserved: "Rezerve",
    tr_balances_col_total: "Toplam",
    tr_balances_col_total_in_base: "Baz",
    tr_account_type_cash: "Nakit",
    tr_account_type_bank: "Banka",
    tr_account_type_crypto: "Kripto cüzdan",
    tr_account_type_other: "Diğer",
    tr_currency_section_title: "Para birimine göre",
    tr_currency_col_code: "Para birimi",
    tr_currency_col_total: "Toplam",
    tr_currency_col_in_base: "Baz",
    tr_timeline_section_title: "Son hareketler",
    tr_timeline_empty: "Hareket yok.",
    tr_timeline_relative_now: "şimdi",
    tr_timeline_relative_minutes: "{n}d önce",
    tr_timeline_relative_hours: "{n}s önce",
    tr_timeline_relative_days: "{n}g önce",
    tr_empty_state_title: "Bu ofiste henüz hesap yok",
    tr_empty_state_cta: "Hesap oluştur",
```

- [ ] **Step 5: Build sanity-check**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 6: Commit + push**

```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): Dashboard MVP keys (en/ru/tr)"
git push
```

---

## Phase 2 — Pure selectors (TDD)

All selectors live in `src/lib/treasury/selectors.js`. Tests in the sibling `selectors.test.js` use a shared `makeCtx()` fixture. Each selector follows the same TDD rhythm: write failing test → run → implement → run → commit.

### Task 2.1: Selectors module + fixture

**Files:**
- Create: `src/lib/treasury/selectors.js`
- Create: `src/lib/treasury/selectors.test.js`

- [ ] **Step 1: Create empty selectors module**

Write `src/lib/treasury/selectors.js`:

```js
// src/lib/treasury/selectors.js
// Pure-function selectors for Treasury Dashboard MVP.
//
// Each takes a `ctx` object built up from hook outputs:
//   { officeId, accounts, movements, obligations, transactions,
//     rates, lastConfirmedAt, modifiedAfterConfirmation,
//     balanceOf, reservedOf, toBase, baseCurrency, now? }
//
// All filtering by officeId happens here so subcomponents stay dumb.
// `now` is optional injectable Date factory for tests; defaults to Date.now.
```

- [ ] **Step 2: Create test fixture**

Write `src/lib/treasury/selectors.test.js`:

```js
// src/lib/treasury/selectors.test.js
import { describe, it, expect } from "vitest";

// Fixture builder. One office "mark" with 3 accounts (cash USD, bank TRY,
// crypto USDT). Mirrors store/data.js seed structure. Includes one
// non-mark account to verify office-filter.
export function makeCtx(overrides = {}) {
  const NOW = new Date("2026-05-09T12:00:00Z");
  const yesterday = new Date(NOW.getTime() - 26 * 3600 * 1000); // > 24h ago
  const accounts = [
    { id: "a_mark_cash_usd",   officeId: "mark",  type: "cash",   currency: "USD",  name: "Cash USD",  active: true, balance: 1000  },
    { id: "a_mark_bank_try",   officeId: "mark",  type: "bank",   currency: "TRY",  name: "Bank TRY",  active: true, balance: 50000 },
    { id: "a_mark_crypto_usdt",officeId: "mark",  type: "crypto", currency: "USDT", name: "TRC20",     active: true, balance: 500   },
    { id: "a_other_cash_usd",  officeId: "terra", type: "cash",   currency: "USD",  name: "Other Cash",active: true, balance: 9999  },
  ];
  const movements = [
    { id: "m1", accountId: "a_mark_cash_usd",    amount: 1000,  direction: "in",  currency: "USD",  reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m2", accountId: "a_mark_bank_try",    amount: 50000, direction: "in",  currency: "TRY",  reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m3", accountId: "a_mark_crypto_usdt", amount: 500,   direction: "in",  currency: "USDT", reserved: false, source: { kind: "opening" }, timestamp: yesterday.toISOString() },
    { id: "m4", accountId: "a_mark_cash_usd",    amount: 100,   direction: "out", currency: "USD",  reserved: true,  source: { kind: "exchange_out", refId: "tx1" }, timestamp: NOW.toISOString() },
  ];
  // balanceOf semantics from CLAUDE.md "Balance engine":
  //   balanceOf = Σ signed amounts where reserved=false
  //   reservedOf = Σ OUT movements where reserved=true
  const balanceOf = (id) =>
    movements
      .filter((m) => m.accountId === id && !m.reserved)
      .reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
  const reservedOf = (id) =>
    movements
      .filter((m) => m.accountId === id && m.reserved && m.direction === "out")
      .reduce((s, m) => s + m.amount, 0);
  const obligations = [
    { id: "o1", officeId: "mark", currency: "USD", amount: 200, direction: "we_owe", status: "open", createdAt: yesterday.toISOString() },
  ];
  const transactions = [
    { id: "tx1", officeId: "mark", status: "pending", time: "11:00", date: "May 9", createdAt: NOW.toISOString() },
  ];
  // Simple rate function: USD=base, TRY=0.03 USD, USDT=1 USD, EUR=1.1 USD
  const rate = (from) => ({ USD: 1, TRY: 0.03, USDT: 1, EUR: 1.1 }[String(from).toUpperCase()] ?? 0);
  const toBase = (amount, from) => Number(amount) * rate(from);

  return {
    officeId: "mark",
    accounts,
    movements,
    obligations,
    transactions,
    rates: [],
    lastConfirmedAt: NOW.toISOString(),
    modifiedAfterConfirmation: false,
    balanceOf,
    reservedOf,
    toBase,
    baseCurrency: "USD",
    now: () => NOW,
    ...overrides,
  };
}

describe("makeCtx fixture sanity", () => {
  it("balanceOf computes from non-reserved movements", () => {
    const ctx = makeCtx();
    expect(ctx.balanceOf("a_mark_cash_usd")).toBe(1000);
    expect(ctx.reservedOf("a_mark_cash_usd")).toBe(100);
  });

  it("balanceOf for non-existent account is 0", () => {
    const ctx = makeCtx();
    expect(ctx.balanceOf("missing")).toBe(0);
    expect(ctx.reservedOf("missing")).toBe(0);
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 2 sanity tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/treasury/
git commit -m "test(treasury): selector fixture + balanceOf sanity"
git push
```

### Task 2.2: groupByCurrency

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
import { groupByCurrency } from "./selectors.js";

describe("groupByCurrency", () => {
  it("groups office accounts, sorted by totalInBase desc", () => {
    const ctx = makeCtx();
    const rows = groupByCurrency(ctx);
    // USD total = 1000 (balanceOf includes reserved-source amount but not reserved-marked).
    // Wait: m1 in 1000 (reserved=false) → +1000. m4 out 100 (reserved=true) → excluded by balanceOf.
    // So balanceOf(a_mark_cash_usd) = 1000.
    // toBase: USD 1000→1000, TRY 50000→1500, USDT 500→500.
    // Sorted: TRY (1500) > USD (1000) > USDT (500).
    expect(rows).toHaveLength(3);
    expect(rows[0].currency).toBe("TRY");
    expect(rows[0].totalInBase).toBe(1500);
    expect(rows[0].available).toBe(50000);
    expect(rows[0].reserved).toBe(0);
    expect(rows[0].total).toBe(50000);
    expect(rows[1].currency).toBe("USD");
    expect(rows[1].available).toBe(900);
    expect(rows[1].reserved).toBe(100);
    expect(rows[1].total).toBe(1000);
    expect(rows[2].currency).toBe("USDT");
  });

  it("filters by officeId — does not leak terra account", () => {
    const ctx = makeCtx();
    const rows = groupByCurrency(ctx);
    // If officeId filter were broken, USD total would be 1000 + 9999 = 10999.
    expect(rows.find((r) => r.currency === "USD").total).toBe(1000);
  });

  it("returns empty array if office has no accounts", () => {
    const ctx = makeCtx({ officeId: "nonexistent" });
    expect(groupByCurrency(ctx)).toEqual([]);
  });

  it("normalizes currency case", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "cash", currency: "usd", balance: 100 },
        { id: "a2", officeId: "mark", type: "cash", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
        { id: "m2", accountId: "a2", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    // Re-bind balanceOf to new movements
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByCurrency(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("USD");
    expect(rows[0].total).toBe(200);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 4 fails — `groupByCurrency is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/treasury/selectors.js`:

```js
export function groupByCurrency(ctx) {
  const { officeId, accounts, balanceOf, reservedOf, toBase } = ctx;
  const officeAccounts = accounts.filter((a) => a.officeId === officeId);
  const byCcy = new Map();
  for (const a of officeAccounts) {
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const total = balanceOf(a.id) || 0;
    const reserved = reservedOf(a.id) || 0;
    const available = total - reserved;
    const totalInBase = toBase(total, ccy) || 0;
    const row = byCcy.get(ccy) || { currency: ccy, available: 0, reserved: 0, total: 0, totalInBase: 0 };
    row.available += available;
    row.reserved += reserved;
    row.total += total;
    row.totalInBase += totalInBase;
    byCcy.set(ccy, row);
  }
  return [...byCcy.values()].sort((x, y) => y.totalInBase - x.totalInBase);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 6 tests pass (2 sanity + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): groupByCurrency selector"
git push
```

### Task 2.3: groupByAccountType

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
import { groupByAccountType } from "./selectors.js";

describe("groupByAccountType", () => {
  it("groups office accounts by type with counts and base totals", () => {
    const ctx = makeCtx();
    const rows = groupByAccountType(ctx);
    // 3 mark accounts: 1 cash (USD 1000), 1 bank (TRY 50000), 1 crypto (USDT 500).
    // toBase: cash 1000, bank 1500, crypto 500. Sorted by totalInBase desc.
    expect(rows).toHaveLength(3);
    const types = rows.map((r) => r.type);
    expect(types).toEqual(["bank", "cash", "crypto"]);
    const cash = rows.find((r) => r.type === "cash");
    expect(cash.count).toBe(1);
    expect(cash.totalInBase).toBe(1000);
    expect(cash.total).toBe(1000);
    expect(cash.reserved).toBe(100);
    expect(cash.available).toBe(900);
  });

  it("hides empty types (no accounts of that type)", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByAccountType(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("cash");
  });

  it("buckets unknown type as 'other'", () => {
    const ctx = makeCtx({
      accounts: [
        { id: "a1", officeId: "mark", type: "weird_type", currency: "USD", balance: 100 },
      ],
      movements: [
        { id: "m1", accountId: "a1", amount: 100, direction: "in", reserved: false, timestamp: new Date().toISOString() },
      ],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const rows = groupByAccountType(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("other");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 3 fails.

- [ ] **Step 3: Implement**

Append to `src/lib/treasury/selectors.js`:

```js
const KNOWN_TYPES = new Set(["cash", "bank", "crypto"]);

export function groupByAccountType(ctx) {
  const { officeId, accounts, balanceOf, reservedOf, toBase } = ctx;
  const officeAccounts = accounts.filter((a) => a.officeId === officeId);
  const byType = new Map();
  for (const a of officeAccounts) {
    const type = KNOWN_TYPES.has(a.type) ? a.type : "other";
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    const total = balanceOf(a.id) || 0;
    const reserved = reservedOf(a.id) || 0;
    const available = total - reserved;
    const totalInBase = ccy ? (toBase(total, ccy) || 0) : 0;
    const row = byType.get(type) || { type, count: 0, available: 0, reserved: 0, total: 0, totalInBase: 0 };
    row.count += 1;
    row.available += available;
    row.reserved += reserved;
    row.total += total;
    row.totalInBase += totalInBase;
    byType.set(type, row);
  }
  return [...byType.values()].sort((x, y) => y.totalInBase - x.totalInBase);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): groupByAccountType selector"
git push
```

### Task 2.4: lastNMovements

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
import { lastNMovements } from "./selectors.js";

describe("lastNMovements", () => {
  it("returns office movements sorted desc, limited to N", () => {
    const ctx = makeCtx();
    // 4 movements total, all 3 'mark' accounts have movements.
    // Expect 4 rows (m4 newest, m3/m2/m1 yesterday — sort by timestamp desc).
    const rows = lastNMovements(ctx, 50);
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe("m4");
  });

  it("filters out movements for other-office accounts", () => {
    const ctx = makeCtx({
      movements: [
        ...makeCtx().movements,
        { id: "m_other", accountId: "a_other_cash_usd", amount: 1, direction: "in", reserved: false, timestamp: "2027-01-01T00:00:00Z" },
      ],
    });
    const rows = lastNMovements(ctx, 50);
    expect(rows.find((m) => m.id === "m_other")).toBeUndefined();
  });

  it("limits to N", () => {
    const ctx = makeCtx();
    expect(lastNMovements(ctx, 2)).toHaveLength(2);
  });

  it("attaches account name for display", () => {
    const ctx = makeCtx();
    const rows = lastNMovements(ctx, 1);
    expect(rows[0].accountName).toBeDefined();
    expect(typeof rows[0].accountName).toBe("string");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 4 fails — `lastNMovements is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/treasury/selectors.js`:

```js
export function lastNMovements(ctx, n) {
  const { officeId, accounts, movements } = ctx;
  const officeAccountIds = new Set(
    accounts.filter((a) => a.officeId === officeId).map((a) => a.id)
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return movements
    .filter((m) => officeAccountIds.has(m.accountId))
    .sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
    .slice(0, n)
    .map((m) => ({ ...m, accountName: accountById.get(m.accountId)?.name || "—" }));
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): lastNMovements selector"
git push
```

### Task 2.5: computeKPIs (no deltas first)

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

This task lands KPIs without yesterday-delta. Task 2.6 layers delta on top.

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
import { computeKPIs } from "./selectors.js";

describe("computeKPIs", () => {
  it("totalBalance = Σ balanceOf in base over office accounts", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // toBase: USD 1000 + TRY 1500 + USDT 500 = 3000.
    expect(k.totalBalance.valueInBase).toBe(3000);
  });

  it("liabilities = Σ open we_owe obligations in base", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // 200 USD we_owe → 200 in base.
    expect(k.liabilities.valueInBase).toBe(200);
  });

  it("availableFunds = Σ availableOf in base", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // USD: 1000 - 100 reserved = 900. TRY 50000-0 = 50000 (1500 base). USDT 500-0 = 500.
    // Total available in base: 900 + 1500 + 500 = 2900.
    expect(k.availableFunds.valueInBase).toBe(2900);
  });

  it("activity24h counts office transactions in last 24h", () => {
    const ctx = makeCtx();
    const k = computeKPIs(ctx);
    // tx1 created NOW → within 24h → count = 1.
    expect(k.activity24h.count).toBe(1);
  });

  it("filters all by officeId", () => {
    const ctx = makeCtx({ officeId: "terra" });
    const k = computeKPIs(ctx);
    // Only a_other_cash_usd exists for terra, but no movements for it in fixture.
    expect(k.totalBalance.valueInBase).toBe(0);
    expect(k.liabilities.valueInBase).toBe(0);
    expect(k.availableFunds.valueInBase).toBe(0);
    expect(k.activity24h.count).toBe(0);
  });

  it("baseCurrency is propagated", () => {
    const ctx = makeCtx();
    expect(computeKPIs(ctx).baseCurrency).toBe("USD");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 6 fails.

- [ ] **Step 3: Implement (no deltas yet)**

Append to `src/lib/treasury/selectors.js`:

```js
function txTimestamp(tx) {
  // Real supabase rows have ISO `createdAt`. Seed-mode rows have `time` + `date`
  // strings. Fall back to "now" if absent (so the row isn't dropped from "today").
  if (tx.createdAt) return new Date(tx.createdAt);
  if (tx.timestamp) return new Date(tx.timestamp);
  return new Date(); // fallback — caller treats as "now"
}

function sumBalancesInBase(ctx, accountFilter) {
  const { accounts, balanceOf, toBase, officeId } = ctx;
  let total = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    if (accountFilter && !accountFilter(a)) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    total += toBase(balanceOf(a.id) || 0, ccy) || 0;
  }
  return total;
}

function sumAvailableInBase(ctx) {
  const { accounts, balanceOf, reservedOf, toBase, officeId } = ctx;
  let total = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const avail = (balanceOf(a.id) || 0) - (reservedOf(a.id) || 0);
    total += toBase(avail, ccy) || 0;
  }
  return total;
}

function sumLiabilitiesInBase(ctx) {
  const { obligations, officeId, toBase } = ctx;
  let total = 0;
  for (const o of obligations) {
    if (o.officeId !== officeId) continue;
    if (o.status !== "open") continue;
    if (o.direction !== "we_owe") continue;
    const ccy = String(o.currency || "").toUpperCase();
    total += toBase(o.amount || 0, ccy) || 0;
  }
  return total;
}

function activityCount(ctx, sinceMs, untilMs) {
  const { transactions, officeId } = ctx;
  let count = 0;
  for (const t of transactions) {
    if (t.officeId !== officeId) continue;
    const ts = txTimestamp(t).getTime();
    if (ts >= sinceMs && ts < untilMs) count += 1;
  }
  return count;
}

export function computeKPIs(ctx) {
  const nowDate = (ctx.now ? ctx.now() : new Date());
  const nowMs = nowDate.getTime();
  const since24hMs = nowMs - 24 * 3600 * 1000;
  const totalBalance = sumBalancesInBase(ctx);
  const liabilities = sumLiabilitiesInBase(ctx);
  const availableFunds = sumAvailableInBase(ctx);
  const activity = activityCount(ctx, since24hMs, nowMs + 1);
  return {
    totalBalance:   { valueInBase: totalBalance,   delta: null },
    liabilities:    { valueInBase: liabilities,    delta: null },
    availableFunds: { valueInBase: availableFunds, delta: null },
    activity24h:    { count: activity,             delta: null },
    baseCurrency: ctx.baseCurrency,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): computeKPIs (totals, no deltas yet)"
git push
```

### Task 2.6: KPI deltas vs yesterday

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

Yesterday-snapshot is computed by replaying movements with `timestamp < startOfTodayUTC`. We do this by re-deriving balanceOf/reservedOf from the truncated movement set.

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
describe("computeKPIs deltas", () => {
  it("delta is computed against yesterday's balances", () => {
    // Custom fixture: yesterday total = 500 (1 movement for 500 yesterday),
    // today add another 500 → today total = 1000.
    const NOW = new Date("2026-05-09T12:00:00Z");
    const yesterday = new Date(NOW.getTime() - 26 * 3600 * 1000);
    const accounts = [
      { id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 0 },
    ];
    const movements = [
      { id: "m_old",  accountId: "a1", amount: 500, direction: "in", currency: "USD", reserved: false, timestamp: yesterday.toISOString() },
      { id: "m_new",  accountId: "a1", amount: 500, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() },
    ];
    const balanceOf = (id) => movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    const ctx = makeCtx({
      accounts,
      movements,
      balanceOf,
      reservedOf: () => 0,
      obligations: [],
      transactions: [],
    });
    const k = computeKPIs(ctx);
    expect(k.totalBalance.valueInBase).toBe(1000);
    expect(k.totalBalance.delta).toBeCloseTo(1.0); // (1000-500)/500 = 1.0 (= +100%)
  });

  it("delta is null if yesterday baseline is 0", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const accounts = [{ id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 0 }];
    const movements = [
      { id: "m1", accountId: "a1", amount: 100, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() },
    ];
    const ctx = makeCtx({
      accounts,
      movements,
      balanceOf: (id) => movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0),
      reservedOf: () => 0,
      obligations: [],
      transactions: [],
    });
    expect(computeKPIs(ctx).totalBalance.delta).toBeNull();
  });

  it("activity24h delta is absolute count delta vs prior 24-48h window", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const sixHrAgo = new Date(NOW.getTime() - 6 * 3600 * 1000).toISOString();
    const thirtyHrAgo = new Date(NOW.getTime() - 30 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      transactions: [
        { id: "t1", officeId: "mark", status: "completed", createdAt: sixHrAgo },
        { id: "t2", officeId: "mark", status: "completed", createdAt: sixHrAgo },
        { id: "t3", officeId: "mark", status: "completed", createdAt: thirtyHrAgo },
      ],
      obligations: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    // last 24h: t1, t2 → count=2. prior 24-48h: t3 → 1. delta = 2-1 = 1.
    const k = computeKPIs(ctx);
    expect(k.activity24h.count).toBe(2);
    expect(k.activity24h.delta).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 3 fails (`delta` is `null` when test expects a number).

- [ ] **Step 3: Implement deltas**

In `src/lib/treasury/selectors.js`, replace the existing `computeKPIs` body with:

```js
function balanceOfAtCutoff(ctx, accountId, cutoffMs) {
  const { movements } = ctx;
  return movements
    .filter((m) => m.accountId === accountId && !m.reserved && new Date(m.timestamp).getTime() < cutoffMs)
    .reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
}

function reservedOfAtCutoff(ctx, accountId, cutoffMs) {
  const { movements } = ctx;
  return movements
    .filter((m) => m.accountId === accountId && m.reserved && m.direction === "out" && new Date(m.timestamp).getTime() < cutoffMs)
    .reduce((s, m) => s + m.amount, 0);
}

function snapshotInBase(ctx, cutoffMs) {
  const { accounts, toBase, officeId } = ctx;
  let total = 0;
  let avail = 0;
  for (const a of accounts) {
    if (a.officeId !== officeId) continue;
    const ccy = String(a.currency || a.currency_code || "").toUpperCase();
    if (!ccy) continue;
    const bal = balanceOfAtCutoff(ctx, a.id, cutoffMs);
    const res = reservedOfAtCutoff(ctx, a.id, cutoffMs);
    total += toBase(bal, ccy) || 0;
    avail += toBase(bal - res, ccy) || 0;
  }
  return { totalInBase: total, availableInBase: avail };
}

function liabilitiesInBaseAtCutoff(ctx, cutoffMs) {
  const { obligations, officeId, toBase } = ctx;
  let total = 0;
  for (const o of obligations) {
    if (o.officeId !== officeId) continue;
    if (o.direction !== "we_owe") continue;
    if (!o.createdAt) continue;
    const created = new Date(o.createdAt).getTime();
    if (created >= cutoffMs) continue;
    if (o.status !== "open") {
      // If closed, it counts only if closure happened after cutoff.
      const closed = o.closedAt ? new Date(o.closedAt).getTime() : 0;
      if (closed && closed < cutoffMs) continue;
    }
    const ccy = String(o.currency || "").toUpperCase();
    total += toBase(o.amount || 0, ccy) || 0;
  }
  return total;
}

function pctDelta(today, yesterday) {
  if (yesterday === 0 || yesterday === null || yesterday === undefined) return null;
  return (today - yesterday) / yesterday;
}

export function computeKPIs(ctx) {
  const nowDate = (ctx.now ? ctx.now() : new Date());
  const nowMs = nowDate.getTime();
  const ms24h = 24 * 3600 * 1000;
  const since24hMs = nowMs - ms24h;
  const since48hMs = nowMs - 2 * ms24h;

  const today = snapshotInBase(ctx, nowMs + 1);
  const yesterday = snapshotInBase(ctx, since24hMs);
  const todayLiab = sumLiabilitiesInBase(ctx);
  const yestLiab = liabilitiesInBaseAtCutoff(ctx, since24hMs);
  const todayActivity = activityCount(ctx, since24hMs, nowMs + 1);
  const priorActivity = activityCount(ctx, since48hMs, since24hMs);

  return {
    totalBalance: {
      valueInBase: today.totalInBase,
      delta: pctDelta(today.totalInBase, yesterday.totalInBase),
    },
    liabilities: {
      valueInBase: todayLiab,
      delta: pctDelta(todayLiab, yestLiab),
    },
    availableFunds: {
      valueInBase: today.availableInBase,
      delta: pctDelta(today.availableInBase, yesterday.availableInBase),
    },
    activity24h: {
      count: todayActivity,
      delta: todayActivity - priorActivity, // absolute delta for activity
    },
    baseCurrency: ctx.baseCurrency,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 22 tests pass. (Note: existing computeKPIs tests from Task 2.5 may need re-verification — they expected `delta: null`, which is still the result for them since their fixture has no yesterday data > cutoff.)

If a Task 2.5 test fails, inspect the fixture timing and adjust assertions if needed (the original Task 2.5 fixture has all opening movements at "yesterday" so they're INCLUDED in the yesterday snapshot — the totalBalance delta should be 0 / null, not a number).

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): computeKPIs deltas vs yesterday"
git push
```

### Task 2.7: computeAlerts

**Files:**
- Modify: `src/lib/treasury/selectors.js`
- Modify: `src/lib/treasury/selectors.test.js`

- [ ] **Step 1: Failing test**

Append to `src/lib/treasury/selectors.test.js`:

```js
import { computeAlerts } from "./selectors.js";

describe("computeAlerts", () => {
  it("returns empty when nothing is wrong", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const ctx = makeCtx({
      obligations: [],
      transactions: [],
      lastConfirmedAt: NOW.toISOString(),
      modifiedAfterConfirmation: false,
      accounts: [{ id: "a1", officeId: "mark", type: "cash", currency: "USD", balance: 100 }],
      movements: [{ id: "m1", accountId: "a1", amount: 100, direction: "in", currency: "USD", reserved: false, timestamp: NOW.toISOString() }],
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    expect(computeAlerts(ctx)).toEqual([]);
  });

  it("emits overdue_obligations when open obligations are > 7 days old", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const oldDate = new Date(NOW.getTime() - 8 * 24 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      obligations: [
        { id: "o1", officeId: "mark", currency: "USD", amount: 100, direction: "we_owe", status: "open", createdAt: oldDate },
        { id: "o2", officeId: "mark", currency: "USD", amount: 50,  direction: "we_owe", status: "open", createdAt: oldDate },
      ],
      transactions: [],
      modifiedAfterConfirmation: false,
    });
    const a = computeAlerts(ctx);
    const overdue = a.find((x) => x.id === "overdue_obligations");
    expect(overdue).toBeDefined();
    expect(overdue.severity).toBe("error");
    expect(overdue.count).toBe(2);
  });

  it("emits negative_balance for accounts with balanceOf < 0", () => {
    const ctx = makeCtx({
      accounts: [{ id: "a_neg", officeId: "mark", type: "cash", currency: "USD", balance: 0 }],
      movements: [{ id: "m_out", accountId: "a_neg", amount: 50, direction: "out", currency: "USD", reserved: false, timestamp: new Date().toISOString() }],
      obligations: [],
      transactions: [],
      modifiedAfterConfirmation: false,
    });
    ctx.balanceOf = (id) => ctx.movements.filter((m) => m.accountId === id && !m.reserved).reduce((s, m) => s + (m.direction === "in" ? m.amount : -m.amount), 0);
    ctx.reservedOf = () => 0;
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "negative_balance")?.count).toBe(1);
  });

  it("emits stuck_pending for pending tx older than 24h", () => {
    const NOW = new Date("2026-05-09T12:00:00Z");
    const oldTs = new Date(NOW.getTime() - 26 * 3600 * 1000).toISOString();
    const ctx = makeCtx({
      transactions: [
        { id: "t_stuck", officeId: "mark", status: "pending", createdAt: oldTs },
        { id: "t_fresh", officeId: "mark", status: "pending", createdAt: NOW.toISOString() },
      ],
      obligations: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
      modifiedAfterConfirmation: false,
    });
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "stuck_pending")?.count).toBe(1);
  });

  it("emits stale_rates when modifiedAfterConfirmation=true", () => {
    const ctx = makeCtx({
      modifiedAfterConfirmation: true,
      obligations: [],
      transactions: [],
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    const a = computeAlerts(ctx);
    expect(a.find((x) => x.id === "stale_rates")).toBeDefined();
  });

  it("ignores other-office data", () => {
    const ctx = makeCtx({
      obligations: [
        { id: "o1", officeId: "terra", currency: "USD", amount: 100, direction: "we_owe", status: "open", createdAt: "2020-01-01T00:00:00Z" },
      ],
      transactions: [],
      modifiedAfterConfirmation: false,
      accounts: [],
      movements: [],
      balanceOf: () => 0,
      reservedOf: () => 0,
    });
    expect(computeAlerts(ctx).find((x) => x.id === "overdue_obligations")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 6 fails — `computeAlerts is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/treasury/selectors.js`:

```js
export function computeAlerts(ctx) {
  const nowDate = (ctx.now ? ctx.now() : new Date());
  const nowMs = nowDate.getTime();
  const ms24h = 24 * 3600 * 1000;
  const ms7d = 7 * 24 * 3600 * 1000;
  const alerts = [];

  // 1. overdue_obligations: open we_owe obligations older than 7 days
  const overdue = ctx.obligations.filter((o) =>
    o.officeId === ctx.officeId &&
    o.status === "open" &&
    o.direction === "we_owe" &&
    o.createdAt &&
    (nowMs - new Date(o.createdAt).getTime()) > ms7d
  );
  if (overdue.length > 0) {
    alerts.push({ id: "overdue_obligations", severity: "error", count: overdue.length });
  }

  // 2. negative_balance: office accounts with balanceOf < 0
  const officeAccounts = ctx.accounts.filter((a) => a.officeId === ctx.officeId);
  const negCount = officeAccounts.filter((a) => (ctx.balanceOf(a.id) || 0) < 0).length;
  if (negCount > 0) {
    alerts.push({ id: "negative_balance", severity: "error", count: negCount });
  }

  // 3. stuck_pending: pending tx older than 24h
  const stuck = ctx.transactions.filter((t) =>
    t.officeId === ctx.officeId &&
    t.status === "pending" &&
    (nowMs - txTimestamp(t).getTime()) > ms24h
  );
  if (stuck.length > 0) {
    alerts.push({ id: "stuck_pending", severity: "warning", count: stuck.length });
  }

  // 4. stale_rates: lastConfirmedAt > 24h ago OR modifiedAfterConfirmation
  const staleAge = ctx.lastConfirmedAt && (nowMs - new Date(ctx.lastConfirmedAt).getTime()) > ms24h;
  if (staleAge || ctx.modifiedAfterConfirmation) {
    alerts.push({ id: "stale_rates", severity: "info" });
  }

  return alerts;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
npm run test -- src/lib/treasury/selectors.test.js
```

Expected: 28 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/treasury/
git commit -m "feat(treasury): computeAlerts selector"
git push
```

---

## Phase 3 — Subcomponents

Each subcomponent is a small dumb presenter. We test them by smoke-render only (`@testing-library/react`). The hard logic was tested in Phase 2.

### Task 3.1: EmptyState component

**Files:**
- Create: `src/pages/treasury/components/EmptyState.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/EmptyState.jsx
import React from "react";
import { Wallet } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function EmptyState({ officeName }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 p-10 text-center">
      <Wallet className="w-8 h-8 mx-auto text-slate-300 mb-3" />
      <h2 className="text-[15px] font-bold text-slate-900 mb-1">
        {t("tr_empty_state_title")}
      </h2>
      {officeName && (
        <p className="text-[12.5px] text-slate-500">
          {t("tr_dashboard_subtitle_office")}: {officeName}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build sanity-check**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/EmptyState.jsx
git commit -m "feat(treasury): EmptyState component"
git push
```

### Task 3.2: AlertBar component

**Files:**
- Create: `src/pages/treasury/components/AlertBar.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/AlertBar.jsx
import React from "react";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

const SEVERITY_STYLE = {
  error:   { wrap: "bg-rose-50 border-rose-200 text-rose-900",   icon: AlertCircle,   iconCls: "text-rose-600"   },
  warning: { wrap: "bg-amber-50 border-amber-200 text-amber-900",icon: AlertTriangle, iconCls: "text-amber-600"  },
  info:    { wrap: "bg-sky-50 border-sky-200 text-sky-900",      icon: Info,          iconCls: "text-sky-600"    },
};

const ALERT_KEY = {
  overdue_obligations: "tr_alert_overdue_obligations",
  negative_balance:    "tr_alert_negative_balance",
  stuck_pending:       "tr_alert_stuck_pending",
  stale_rates:         "tr_alert_stale_rates",
};

export default function AlertBar({ alerts }) {
  const { t } = useTranslation();
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {alerts.map((a) => {
        const sev = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.info;
        const Icon = sev.icon;
        const tplKey = ALERT_KEY[a.id];
        const msg = tplKey
          ? t(tplKey).replace("{n}", String(a.count ?? ""))
          : a.id;
        return (
          <div
            key={a.id}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border text-[12.5px] font-medium ${sev.wrap}`}
          >
            <Icon className={`w-4 h-4 shrink-0 ${sev.iconCls}`} />
            <span>{msg}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/AlertBar.jsx
git commit -m "feat(treasury): AlertBar component"
git push
```

### Task 3.3: KPICards component

**Files:**
- Create: `src/pages/treasury/components/KPICards.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/KPICards.jsx
import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

function DeltaBadge({ delta, isPercent }) {
  const { t } = useTranslation();
  if (delta === null || delta === undefined) {
    return <span className="text-slate-400 text-[11px]">{t("tr_kpi_no_baseline")}</span>;
  }
  const positive = delta > 0;
  const negative = delta < 0;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : null;
  const cls = positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-slate-400";
  const sign = positive ? "+" : "";
  const text = isPercent
    ? `${sign}${(delta * 100).toFixed(1)}%`
    : `${sign}${delta}`;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cls}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {text} {t("tr_kpi_delta_vs_yesterday")}
    </span>
  );
}

function Card({ title, value, delta, isPercent, suffix }) {
  return (
    <div className="bg-white rounded-[14px] border border-slate-200/70 p-4 flex flex-col gap-1.5 min-h-[88px]">
      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</span>
      <span className="text-[20px] font-bold text-slate-900 tabular-nums">
        {value}
        {suffix && <span className="text-[12px] font-semibold text-slate-400 ml-1">{suffix}</span>}
      </span>
      <DeltaBadge delta={delta} isPercent={isPercent} />
    </div>
  );
}

export default function KPICards({ kpis, formatBase }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        title={t("tr_kpi_total_balance")}
        value={formatBase(kpis.totalBalance.valueInBase, kpis.baseCurrency)}
        delta={kpis.totalBalance.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_liabilities")}
        value={formatBase(kpis.liabilities.valueInBase, kpis.baseCurrency)}
        delta={kpis.liabilities.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_available_funds")}
        value={formatBase(kpis.availableFunds.valueInBase, kpis.baseCurrency)}
        delta={kpis.availableFunds.delta}
        isPercent
      />
      <Card
        title={t("tr_kpi_activity24h")}
        value={kpis.activity24h.count}
        suffix={t("tr_kpi_count_deals")}
        delta={kpis.activity24h.delta}
        isPercent={false}
      />
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/KPICards.jsx
git commit -m "feat(treasury): KPICards component with deltas"
git push
```

### Task 3.4: BalancesByTypeTable component

**Files:**
- Create: `src/pages/treasury/components/BalancesByTypeTable.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/BalancesByTypeTable.jsx
import React from "react";
import { Banknote, Landmark, Coins, Layers } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

const TYPE_ICON = { cash: Banknote, bank: Landmark, crypto: Coins, other: Layers };
const TYPE_LABEL_KEY = {
  cash: "tr_account_type_cash",
  bank: "tr_account_type_bank",
  crypto: "tr_account_type_crypto",
  other: "tr_account_type_other",
};

export default function BalancesByTypeTable({ rows, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_balances_section_title")}</h3>
      </header>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="text-left px-4 py-2">{t("tr_balances_col_type")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_count")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_available")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_reserved")}</th>
            <th className="text-right px-3 py-2">{t("tr_balances_col_total_in_base")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400">—</td>
            </tr>
          )}
          {rows.map((row) => {
            const Icon = TYPE_ICON[row.type] || Layers;
            return (
              <tr key={row.type} className="border-t border-slate-100">
                <td className="px-4 py-2.5 inline-flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{t(TYPE_LABEL_KEY[row.type] || "tr_account_type_other")}</span>
                </td>
                <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{row.count}</td>
                <td className="text-right px-3 py-2.5 tabular-nums">{formatBase(row.available, baseCurrency)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{formatBase(row.reserved, baseCurrency)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums font-semibold">{formatBase(row.totalInBase, baseCurrency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

Note: `row.available` and `row.reserved` are in the account's native currency (summed across multiple currencies of same type — imperfect for MVP but readable; for accuracy of the "in base" column we use `row.totalInBase`).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/BalancesByTypeTable.jsx
git commit -m "feat(treasury): BalancesByTypeTable component"
git push
```

### Task 3.5: CurrencyBreakdownTable component

**Files:**
- Create: `src/pages/treasury/components/CurrencyBreakdownTable.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/CurrencyBreakdownTable.jsx
import React from "react";
import { useTranslation } from "../../../i18n/translations.jsx";

export default function CurrencyBreakdownTable({ rows, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_currency_section_title")}</h3>
      </header>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            <th className="text-left px-4 py-2">{t("tr_currency_col_code")}</th>
            <th className="text-right px-3 py-2">{t("tr_currency_col_total")}</th>
            <th className="text-right px-3 py-2">{t("tr_currency_col_in_base")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">—</td></tr>
          )}
          {rows.map((row) => (
            <tr key={row.currency} className="border-t border-slate-100">
              <td className="px-4 py-2.5 font-semibold text-slate-900">{row.currency}</td>
              <td className="text-right px-3 py-2.5 tabular-nums">
                {row.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </td>
              <td className="text-right px-3 py-2.5 tabular-nums font-semibold">
                {formatBase(row.totalInBase, baseCurrency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/CurrencyBreakdownTable.jsx
git commit -m "feat(treasury): CurrencyBreakdownTable component"
git push
```

### Task 3.6: MovementTimeline component

**Files:**
- Create: `src/pages/treasury/components/MovementTimeline.jsx`

- [ ] **Step 1: Write component**

```jsx
// src/pages/treasury/components/MovementTimeline.jsx
import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";

function relativeTime(t, isoTimestamp) {
  if (!isoTimestamp) return "";
  const ts = new Date(isoTimestamp).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t("tr_timeline_relative_now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("tr_timeline_relative_minutes").replace("{n}", String(diffMin));
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("tr_timeline_relative_hours").replace("{n}", String(diffHr));
  const diffDay = Math.floor(diffHr / 24);
  return t("tr_timeline_relative_days").replace("{n}", String(diffDay));
}

export default function MovementTimeline({ items }) {
  const { t } = useTranslation();
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-[13px] font-bold text-slate-900">{t("tr_timeline_section_title")}</h3>
      </header>
      {items.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-slate-400">
          {t("tr_timeline_empty")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((m) => {
            const isIn = m.direction === "in";
            const Icon = isIn ? ArrowDown : ArrowUp;
            return (
              <li key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-[12.5px]">
                <span className="text-slate-400 w-20 shrink-0">{relativeTime(t, m.timestamp)}</span>
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isIn ? "text-emerald-500" : "text-rose-500"}`} />
                <span className="flex-1 truncate font-medium text-slate-900">{m.accountName}</span>
                <span className={`tabular-nums ${isIn ? "text-emerald-600" : "text-rose-600"}`}>
                  {isIn ? "+" : "−"}{Number(m.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {m.currency}
                </span>
                {m.source?.kind && (
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider hidden md:inline">
                    {m.source.kind}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/components/MovementTimeline.jsx
git commit -m "feat(treasury): MovementTimeline component"
git push
```

---

## Phase 4 — Orchestrator

### Task 4.1: Dashboard.jsx

**Files:**
- Create: `src/pages/treasury/Dashboard.jsx`

- [ ] **Step 1: Write the component**

```jsx
// src/pages/treasury/Dashboard.jsx
import React, { useMemo } from "react";
import { useAccounts } from "../../store/accounts.jsx";
import { useObligations } from "../../store/obligations.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useRates } from "../../store/rates.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import {
  computeKPIs,
  computeAlerts,
  groupByAccountType,
  groupByCurrency,
  lastNMovements,
} from "../../lib/treasury/selectors.js";
import AlertBar from "./components/AlertBar.jsx";
import KPICards from "./components/KPICards.jsx";
import BalancesByTypeTable from "./components/BalancesByTypeTable.jsx";
import CurrencyBreakdownTable from "./components/CurrencyBreakdownTable.jsx";
import MovementTimeline from "./components/MovementTimeline.jsx";
import EmptyState from "./components/EmptyState.jsx";

export default function Dashboard({ officeId }) {
  const { t } = useTranslation();
  const { accounts, balanceOf, reservedOf, movements } = useAccounts();
  const { obligations } = useObligations();
  const { transactions } = useTransactions();
  const ratesCtx = useRates();
  const lastConfirmedAt = ratesCtx.lastConfirmedAt || null;
  const modifiedAfterConfirmation = !!ratesCtx.modifiedAfterConfirmation;
  const { findOffice } = useOffices();
  const { toBase, formatBase, baseCurrency } = useBaseCurrency();

  const office = findOffice(officeId);
  const officeAccounts = useMemo(
    () => accounts.filter((a) => a.officeId === officeId),
    [accounts, officeId]
  );

  const ctx = useMemo(() => ({
    officeId,
    accounts,
    movements,
    obligations,
    transactions,
    rates: ratesCtx.rates || [],
    lastConfirmedAt,
    modifiedAfterConfirmation,
    balanceOf,
    reservedOf,
    toBase,
    baseCurrency,
  }), [officeId, accounts, movements, obligations, transactions, ratesCtx.rates,
       lastConfirmedAt, modifiedAfterConfirmation, balanceOf, reservedOf, toBase, baseCurrency]);

  const alerts        = useMemo(() => computeAlerts(ctx),       [ctx]);
  const kpis          = useMemo(() => computeKPIs(ctx),         [ctx]);
  const byType        = useMemo(() => groupByAccountType(ctx),  [ctx]);
  const byCurrency    = useMemo(() => groupByCurrency(ctx),     [ctx]);
  const timeline      = useMemo(() => lastNMovements(ctx, 50),  [ctx]);

  if (officeAccounts.length === 0) {
    return (
      <main className="max-w-[1300px] mx-auto px-6 py-6">
        <EmptyState officeName={office?.name} />
      </main>
    );
  }

  const freshTime = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="max-w-[1300px] mx-auto px-6 py-6 space-y-5">
      <header>
        <h1 className="text-[24px] font-bold tracking-tight">
          {t("tr_dashboard_title")}{office?.name ? ` · ${office.name}` : ""}
        </h1>
        <p className="text-[13px] text-slate-500 mt-1">
          {t("tr_data_freshness").replace("{time}", freshTime)} · base: {baseCurrency}
        </p>
      </header>

      <AlertBar alerts={alerts} />

      <KPICards kpis={kpis} formatBase={formatBase} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <BalancesByTypeTable rows={byType} formatBase={formatBase} baseCurrency={baseCurrency} />
        <CurrencyBreakdownTable rows={byCurrency} formatBase={formatBase} baseCurrency={baseCurrency} />
      </div>

      <MovementTimeline items={timeline} />
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/Dashboard.jsx
git commit -m "feat(treasury): Dashboard orchestrator"
git push
```

### Task 4.2: Dashboard smoke test

**Files:**
- Create: `src/pages/treasury/Dashboard.test.jsx`

- [ ] **Step 1: Write smoke test**

```jsx
// src/pages/treasury/Dashboard.test.jsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../i18n/translations.jsx";

// Mock the store hooks Dashboard pulls from. We pass enough shape to render
// without throwing — actual selector logic is unit-tested in selectors.test.js.
import { vi } from "vitest";

vi.mock("../../store/accounts.jsx", () => ({
  useAccounts: () => ({
    accounts: [],
    balanceOf: () => 0,
    reservedOf: () => 0,
    movements: [],
  }),
}));
vi.mock("../../store/obligations.jsx", () => ({
  useObligations: () => ({ obligations: [] }),
}));
vi.mock("../../store/transactions.jsx", () => ({
  useTransactions: () => ({ transactions: [] }),
}));
vi.mock("../../store/rates.jsx", () => ({
  useRates: () => ({ rates: [], lastConfirmedAt: new Date().toISOString(), modifiedAfterConfirmation: false }),
}));
vi.mock("../../store/offices.jsx", () => ({
  useOffices: () => ({ findOffice: () => ({ id: "mark", name: "Mark Antalya" }) }),
}));
vi.mock("../../store/baseCurrency.js", () => ({
  useBaseCurrency: () => ({
    toBase: (a) => a,
    formatBase: (a) => `${a}`,
    baseCurrency: "USD",
  }),
}));

import Dashboard from "./Dashboard.jsx";

describe("Dashboard smoke render", () => {
  it("renders EmptyState when office has no accounts", () => {
    const { container } = render(
      <I18nProvider>
        <Dashboard officeId="mark" />
      </I18nProvider>
    );
    expect(container.textContent).toMatch(/No accounts|Нет счетов|Hesap yok|пока нет счетов/i);
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npm run test -- src/pages/treasury/Dashboard.test.jsx
```

Expected: 1 test passes.

If the test fails, the I18nProvider import path may differ — check `src/i18n/translations.jsx` for the actual provider name (might be `IntlProvider`, `LanguageProvider`, etc.). Update accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/pages/treasury/Dashboard.test.jsx
git commit -m "test(treasury): Dashboard smoke render"
git push
```

---

## Phase 5 — Wire-up

### Task 5.1: Modify TreasuryPage.jsx

**Files:**
- Modify: `src/pages/TreasuryPage.jsx`

Drop the tab UI and render `Dashboard` directly. Accept `currentOffice` as a prop.

- [ ] **Step 1: Replace file content**

Overwrite `src/pages/TreasuryPage.jsx` with:

```jsx
// src/pages/TreasuryPage.jsx
//
// Раздел «Казначейство». MVP — единый Dashboard, scoped to currentOffice.
// Раньше тут было 3 заглушки-таба (Nostro/Loro/Capital) — заменены на Dashboard
// (см. docs/superpowers/specs/2026-05-09-treasury-mvp-design.md).

import React from "react";
import Dashboard from "./treasury/Dashboard.jsx";

export default function TreasuryPage({ currentOffice }) {
  return <Dashboard officeId={currentOffice} />;
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: succeeds. Notice that the old tab-related imports are gone, so the placeholder tab files are now unreferenced.

- [ ] **Step 3: Commit**

```bash
git add src/pages/TreasuryPage.jsx
git commit -m "refactor(treasury): replace tabs with Dashboard"
git push
```

### Task 5.2: Pass currentOffice to TreasuryPage in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Find the existing TreasuryPage render**

```bash
grep -n "TreasuryPage" src/App.jsx
```

Expected: one render line near `page === "treasury"`.

- [ ] **Step 2: Add currentOffice prop**

In `src/App.jsx`, change:

```jsx
{page === "treasury" && canShow("capital") && <TreasuryPage />}
```

to:

```jsx
{page === "treasury" && canShow("capital") && <TreasuryPage currentOffice={currentOffice} />}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(treasury): pass currentOffice into TreasuryPage"
git push
```

### Task 5.3: Delete placeholder tab files

**Files:**
- Delete: `src/pages/treasury/NostroTab.jsx`
- Delete: `src/pages/treasury/LoroTab.jsx`
- Delete: `src/pages/treasury/CapitalTab.jsx`

After Task 5.1 these files are unimported. Time to remove.

- [ ] **Step 1: Verify they're orphaned**

```bash
grep -rE "NostroTab|LoroTab|CapitalTab" src/ docs/ 2>/dev/null
```

Expected: zero matches (the only files containing these names are the files themselves).

If anything matches outside of those files, STOP and fix the reference first.

- [ ] **Step 2: Delete the three files**

```bash
git rm src/pages/treasury/NostroTab.jsx src/pages/treasury/LoroTab.jsx src/pages/treasury/CapitalTab.jsx
```

- [ ] **Step 3: Build + tests**

```bash
npm run build && npm run test
```

Expected: build succeeds; tests pass (137 baseline + new selector tests + Dashboard smoke = ~165).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(treasury): remove placeholder Nostro/Loro/Capital tab files"
git push
```

### Task 5.4: Manual smoke in dev mode

**Files:** none

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Wait until Vite reports `Local: http://localhost:5173`.

- [ ] **Step 2: Open browser**

Navigate to `http://localhost:5173`. Log in as `u_adm` (admin) if prompted. Click **Казначейство** in the navigation (German `Treasury` / English `Treasury` — depends on locale).

Expected:
- Page header: "Казначейство · {office name}" (Russian locale) or "Treasury · {office name}".
- Subtitle showing `as of HH:MM · base: USD`.
- AlertBar visible if any of the 4 alert conditions are true (or hidden if none).
- 4 KPI cards with numeric values (or `0` and `—` if no data).
- BalancesByType table on the left, CurrencyBreakdown on the right.
- MovementTimeline at the bottom with up to 50 entries.

- [ ] **Step 3: Switch office in Header**

Click the office switcher (top-right of Header). Pick a different office.

Expected: Dashboard re-renders for the new office. Header updates to new name.

- [ ] **Step 4: Verify EmptyState**

Pick an office that has no accounts in seed (e.g., delete or rename `currentOffice` value via DevTools → `localStorage.setItem("coinplata.office", "no-such-office")`, then refresh).

Expected: EmptyState card with "В офисе ... пока нет счетов".

Reset:

```js
localStorage.setItem("coinplata.office", "mark");
location.reload();
```

- [ ] **Step 5: Stop dev server**

`Ctrl+C` in the terminal.

If anything in steps 2-4 didn't work, fix the issue in the most recently-touched task and re-run smoke. Otherwise proceed.

---

## Phase 6 — PR

### Task 6.1: Open PR

**Files:** none (gh only)

- [ ] **Step 1: Verify branch is up-to-date**

```bash
git status
```

Expected: clean tree, `feat/treasury-mvp` ahead of `origin/feat/treasury-mvp` by zero commits.

- [ ] **Step 2: Create PR via gh**

```bash
gh pr create --base main --title "feat(treasury): Dashboard MVP — alerts + 4 KPI + balances + timeline" --body "$(cat <<'EOF'
## Summary
Replace three placeholder tabs (Nostro/Loro/Capital) with a single working Dashboard for the current office:
- Alert bar (overdue obligations, negative balances, stuck pending tx, stale rates)
- 4 KPI cards with vs-yesterday delta (Total balance / Liabilities / Available funds / Activity 24h)
- Balances by account type (cash/bank/crypto) — totals in base currency
- Currency breakdown — sorted by base value desc
- Last 50 movements timeline

Pure-function selectors in `src/lib/treasury/selectors.js`, fixture-tested. Subcomponents under `src/pages/treasury/components/`.

Built on legacy data (account_movements + obligations + public.accounts). v2 ledger killed by VITE_FORCE_V2 kill-switch — this MVP works regardless.

## Test plan
- [x] `npm run test` — selectors + smoke test pass; baseline 137 + new tests stay green.
- [x] `npm run build` — production bundle builds.
- [ ] After merge: open coinplata.vercel.app/treasury → header shows current office, KPIs populated, alert bar visible if any condition is met.
- [ ] After merge: switch office in Header → Dashboard re-renders.
- [ ] After merge: office without accounts → EmptyState renders.

## Out of scope (deferred)
- Multi-office aggregation, partner-account view, drill-down per account, CSV export, charts, period comparisons beyond yesterday, external-platform reconciliation. See spec `docs/superpowers/specs/2026-05-09-treasury-mvp-design.md` for the full deferral list.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Print PR URL**

The previous command prints the URL. Capture it for the user.

---

## Self-review checklist (run before declaring plan complete)

**Spec coverage:**
- ✅ Single-office Dashboard replacing 3 placeholders → Phase 5 (5.1, 5.3)
- ✅ Legacy data source → all selectors in Phase 2
- ✅ Alert bar 4 types → Task 2.7 + Task 3.2
- ✅ 4 KPI with deltas → Tasks 2.5, 2.6, 3.3
- ✅ Balances by type → Tasks 2.3, 3.4
- ✅ Currency breakdown → Tasks 2.2, 3.5
- ✅ 50-movement timeline → Tasks 2.4, 3.6
- ✅ EmptyState → Task 3.1
- ✅ Office filter via currentOffice prop → Tasks 4.1, 5.1, 5.2
- ✅ Pure-function selectors with unit tests → Phase 2
- ✅ i18n en/ru/tr → Task 1.1
- ✅ Push after every commit (memory rule) → every commit step
- ⏸ Reconciliation drift columns — explicitly deferred (no external integrations)
- ⏸ Partner accounts — explicitly deferred (no officeId scope)
- ⏸ Drill-down, CSV — explicitly deferred (Phase 2 ideas in spec)

**Placeholder scan:**
- No `TBD` / `TODO` / `implement later`. Every step has either complete code or an exact command.
- "Add appropriate error handling" → not present (we have explicit edge-case handling in selectors).

**Type / signature consistency:**
- `groupByCurrency`, `groupByAccountType`, `lastNMovements`, `computeKPIs`, `computeAlerts` — names match across plan, spec, Dashboard.jsx imports.
- Row shapes (`{ currency, available, reserved, total, totalInBase }`, `{ type, count, available, reserved, total, totalInBase }`) consistent across selector + table component.
- `computeKPIs` returns `{ totalBalance, liabilities, availableFunds, activity24h, baseCurrency }` and `KPICards` consumes those exact keys.
- Alert IDs (`overdue_obligations`, `negative_balance`, `stuck_pending`, `stale_rates`) match between `computeAlerts`, `AlertBar`, and i18n keys.

No issues found in self-review.
