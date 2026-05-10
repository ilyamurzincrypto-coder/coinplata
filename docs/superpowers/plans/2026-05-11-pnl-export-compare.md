# P&L CSV Export + Compare-with-Previous-Period Implementation Plan (Spec C.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Export CSV" button and a "Compare with previous period" toggle to the existing Treasury «P&L» tab — the toggle adds previous-period and Δ columns to every account row, section header, and the net-profit row.

**Architecture:** A tiny pure date helper `previousWindow(win)` in `PeriodPicker.jsx`; a tiny pure module `src/lib/treasury/pnlCompare.js` (`mergePnlSection`, `csvRowsForPnl`) so the export and the comparison UI agree; the rest is wiring in `PnLTab.jsx` (reuses `pnlForPeriod` — called a second time when compare is on — and `exportCSV` from `src/utils/csv.js`). No DB changes, no new selector logic, no new permission.

**Tech Stack:** Vite + React 18 + Tailwind 3; Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-11-pnl-export-compare-design.md`.

---

## Phase 0 — Branch + baseline

### Task 0.1: Confirm branch and baseline green

**Files:** none.

- [ ] **Step 1:** `git branch --show-current` → expected `feat/pnl-export-compare` (created with the spec).
- [ ] **Step 2:** `npx vitest run --no-file-parallelism` → all green (31 files / 299 tests as of the Turnover merge). Note the counts.
- [ ] **Step 3:** `npm run build` → succeeds (pre-existing chunk-size warning is fine).

---

## Task 1: i18n keys

**Files:** Modify: `src/i18n/translations.jsx` (three locale blocks). `trv2_pnl_export_csv` already exists; add only the 3 new keys per locale.

- [ ] **Step 1:** In the EN block, find `trv2_pnl_export_csv: "Export CSV",` and right after it add:

```jsx
    trv2_pnl_compare_toggle: "Compare with previous period",
    trv2_pnl_col_prev: "Previous",
    trv2_pnl_col_delta: "Δ",
```

- [ ] **Step 2:** In the RU block, after `trv2_pnl_export_csv: "Экспорт CSV",` add:

```jsx
    trv2_pnl_compare_toggle: "Сравнить с прошлым периодом",
    trv2_pnl_col_prev: "Прошл.",
    trv2_pnl_col_delta: "Δ",
```

- [ ] **Step 3:** In the TR block, after `trv2_pnl_export_csv: "CSV dışa aktar",` add:

```jsx
    trv2_pnl_compare_toggle: "Önceki dönemle karşılaştır",
    trv2_pnl_col_prev: "Önceki",
    trv2_pnl_col_delta: "Δ",
```

- [ ] **Step 4:** `npm run build` → succeeds.
- [ ] **Step 5:** Commit:
```bash
git add src/i18n/translations.jsx
git commit -m "i18n(treasury): trv2_pnl_compare_toggle / _col_prev / _col_delta (en/ru/tr)"
git push
```

---

## Task 2: `previousWindow` helper (TDD)

**Files:** Modify: `src/pages/treasury_v2/PeriodPicker.jsx` (add `previousWindow` export, near `presetWindow`). Test: `src/pages/treasury_v2/PeriodPicker.test.js` (extend).

- [ ] **Step 1: Failing test** — append to `src/pages/treasury_v2/PeriodPicker.test.js`:

```js
import { previousWindow } from "./PeriodPicker.jsx";

describe("previousWindow", () => {
  it("returns the immediately-preceding window of the same length (prev.to === win.from)", () => {
    const win = { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }; // 31 days
    const prev = previousWindow(win);
    expect(prev.to).toBe("2026-05-01T00:00:00.000Z");
    expect(prev.from).toBe("2026-03-31T00:00:00.000Z"); // 2026-05-01 minus 31 days
  });
  it("works for a sub-day-aligned 5-day window", () => {
    const win = { from: "2026-05-10T14:00:00.000Z", to: "2026-05-15T14:00:00.000Z" };
    const prev = previousWindow(win);
    expect(prev.to).toBe("2026-05-10T14:00:00.000Z");
    expect(prev.from).toBe("2026-05-05T14:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/pages/treasury_v2/PeriodPicker.test.js -t "previousWindow"` → FAIL (`previousWindow` not exported).

- [ ] **Step 3: Implement** — in `src/pages/treasury_v2/PeriodPicker.jsx`, add (after the `presetWindow` export):

```js
// The window immediately preceding `win`, same length: prev.to == win.from.
export function previousWindow(win) {
  const fromMs = new Date(win.from).getTime();
  const toMs = new Date(win.to).getTime();
  const len = toMs - fromMs;
  return { from: new Date(fromMs - len).toISOString(), to: new Date(fromMs).toISOString() };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/PeriodPicker.test.js` → all green.
- [ ] **Step 5: Commit:**
```bash
git add src/pages/treasury_v2/PeriodPicker.jsx src/pages/treasury_v2/PeriodPicker.test.js
git commit -m "feat(treasury): previousWindow helper"
git push
```

---

## Task 3: `pnlCompare.js` — `mergePnlSection` + `csvRowsForPnl` (TDD)

**Files:** Create: `src/lib/treasury/pnlCompare.js`. Test: `src/lib/treasury/pnlCompare.test.js`.

Context: `pnlForPeriod(ctx, period, officeFilter)` returns `{ revenue: { total, accounts: [{ code, name, currency, amountInBase, entryCount }] }, expense: { total, accounts: [...] }, fxNet, fxAccounts: [...], netProfit }`. (Note: revenue/expense use `.accounts`, but FX uses `.fxAccounts` at the top level — there's no `pnl.fx.accounts`.)

- [ ] **Step 1: Failing test** — create `src/lib/treasury/pnlCompare.test.js`:

```js
import { describe, it, expect } from "vitest";
import { mergePnlSection, csvRowsForPnl } from "./pnlCompare.js";

const A = (code, name, amt, n = 1, cur = "USD") => ({ code, name, currency: cur, amountInBase: amt, entryCount: n });

describe("mergePnlSection", () => {
  it("matches by code, computes delta, fills missing sides with 0, prefers current for name/currency/entryCount", () => {
    const cur = [A("4010", "Spread", 100, 3), A("4020", "Commission", 40, 2)];
    const prev = [A("4010", "Spread (old name)", 70, 5), A("4099", "Bonus", 10, 1)];
    const m = mergePnlSection(cur, prev);
    const byCode = Object.fromEntries(m.map((r) => [r.code, r]));
    expect(byCode["4010"]).toMatchObject({ name: "Spread", entryCount: 3, amountInBase: 100, prevInBase: 70, delta: 30 });
    expect(byCode["4020"]).toMatchObject({ amountInBase: 40, prevInBase: 0, delta: 40 });
    expect(byCode["4099"]).toMatchObject({ name: "Bonus", entryCount: 1, amountInBase: 0, prevInBase: 10, delta: -10 });
    // sorted by |amountInBase| desc, then code asc
    expect(m.map((r) => r.code)).toEqual(["4010", "4020", "4099"]);
  });
  it("handles empty inputs", () => {
    expect(mergePnlSection([], [])).toEqual([]);
    expect(mergePnlSection([A("X", "x", 5)], undefined)).toMatchObject([{ code: "X", amountInBase: 5, prevInBase: 0, delta: 5 }]);
  });
});

describe("csvRowsForPnl", () => {
  const pnl = {
    revenue: { total: 100, accounts: [A("4010", "Spread", 100, 3)] },
    expense: { total: 30, accounts: [A("5010", "Rent", 30, 1)] },
    fxNet: -5, fxAccounts: [A("3210", "FX gain", -5, 2)],
    netProfit: 65,
  };
  it("without prev: flat per-account rows + a net_profit row, no prev/delta keys", () => {
    const rows = csvRowsForPnl(pnl, null);
    expect(rows.map((r) => r.section)).toEqual(["revenue", "expense", "fx", "net_profit"]);
    expect(rows[0]).toMatchObject({ section: "revenue", code: "4010", name: "Spread", currency: "USD", amount: 100, entryCount: 3 });
    expect(rows[3]).toMatchObject({ section: "net_profit", code: "", amount: 65 });
    expect(rows[0].amountPrev).toBeUndefined();
  });
  it("with prev: includes amountPrev + delta per row and on the net_profit row", () => {
    const pnlPrev = {
      revenue: { total: 70, accounts: [A("4010", "Spread", 70, 5)] },
      expense: { total: 20, accounts: [A("5010", "Rent", 20, 1)] },
      fxNet: 0, fxAccounts: [],
      netProfit: 50,
    };
    const rows = csvRowsForPnl(pnl, pnlPrev);
    expect(rows.find((r) => r.section === "revenue" && r.code === "4010")).toMatchObject({ amount: 100, amountPrev: 70, delta: 30 });
    expect(rows.find((r) => r.section === "fx" && r.code === "3210")).toMatchObject({ amount: -5, amountPrev: 0, delta: -5 });
    expect(rows.find((r) => r.section === "net_profit")).toMatchObject({ amount: 65, amountPrev: 50, delta: 15 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/treasury/pnlCompare.test.js` → FAIL (cannot resolve `./pnlCompare.js`).

- [ ] **Step 3: Implement** — create `src/lib/treasury/pnlCompare.js`:

```js
// src/lib/treasury/pnlCompare.js
// Pure helpers for the P&L tab's "compare with previous period" mode and CSV export.
// No React, no Supabase. Account shape (from pnlForPeriod): { code, name, currency, amountInBase, entryCount }.

// Merge a section's current-period accounts with the previous-period accounts, keyed by code.
// Returns rows { code, name, currency, entryCount, amountInBase, prevInBase, delta }, one per code
// appearing in either side. name/currency/entryCount come from the current row if present, else the prev row.
// Sorted by |amountInBase| desc, then code asc.
export function mergePnlSection(currentAccounts, prevAccounts) {
  const cur = currentAccounts || [];
  const prev = prevAccounts || [];
  const prevByCode = new Map(prev.map((a) => [a.code, a]));
  const curByCode = new Map(cur.map((a) => [a.code, a]));
  const codes = new Set([...curByCode.keys(), ...prevByCode.keys()]);
  const rows = [...codes].map((code) => {
    const c = curByCode.get(code) || null;
    const p = prevByCode.get(code) || null;
    const src = c || p;
    const amountInBase = c ? Number(c.amountInBase) || 0 : 0;
    const prevInBase = p ? Number(p.amountInBase) || 0 : 0;
    return {
      code,
      name: src.name,
      currency: src.currency,
      entryCount: c ? c.entryCount : (p ? p.entryCount : 0),
      amountInBase,
      prevInBase,
      delta: amountInBase - prevInBase,
    };
  });
  rows.sort((a, b) => {
    const d = Math.abs(b.amountInBase) - Math.abs(a.amountInBase);
    return d !== 0 ? d : String(a.code).localeCompare(String(b.code));
  });
  return rows;
}

const PNL_SECTIONS = [
  ["revenue", (p) => p.revenue.accounts],
  ["expense", (p) => p.expense.accounts],
  ["fx", (p) => p.fxAccounts],
];

// Flat CSV rows for the current P&L (and previous, if pnlPrev given): one row per account across
// revenue/expense/fx sections, then a net_profit row. With pnlPrev, each row gets amountPrev + delta.
export function csvRowsForPnl(pnl, pnlPrev) {
  const rows = [];
  for (const [section, pick] of PNL_SECTIONS) {
    const curAccts = pick(pnl) || [];
    if (pnlPrev) {
      const merged = mergePnlSection(curAccts, pick(pnlPrev) || []);
      for (const r of merged) {
        rows.push({ section, code: r.code, name: r.name, currency: r.currency, amount: r.amountInBase, entryCount: r.entryCount, amountPrev: r.prevInBase, delta: r.delta });
      }
    } else {
      for (const a of curAccts) {
        rows.push({ section, code: a.code, name: a.name, currency: a.currency, amount: Number(a.amountInBase) || 0, entryCount: a.entryCount });
      }
    }
  }
  const np = { section: "net_profit", code: "", name: "", currency: "", amount: Number(pnl.netProfit) || 0, entryCount: "" };
  if (pnlPrev) { np.amountPrev = Number(pnlPrev.netProfit) || 0; np.delta = np.amount - np.amountPrev; }
  rows.push(np);
  return rows;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/treasury/pnlCompare.test.js` → all green.
- [ ] **Step 5: Commit:**
```bash
git add src/lib/treasury/pnlCompare.js src/lib/treasury/pnlCompare.test.js
git commit -m "feat(treasury): pnlCompare — mergePnlSection + csvRowsForPnl"
git push
```

---

## Task 4: Wire `PnLTab.jsx` — export button + compare toggle + columns

**Files:** Modify: `src/pages/treasury_v2/tabs/PnLTab.jsx`. Test: `src/pages/treasury_v2/tabs/PnLTab.test.jsx` (extend).

Context: `PnLTab.jsx` currently: state `period` (localStorage `coinplata.treasury_pnl_period`), `win = useMemo(presetWindow(period))`, an `extendWindow` effect on `win.from`, `pnl = useMemo(pnlForPeriod(ctx, {from:win.from,to:win.to}, officeFilter))`, a `<PeriodPicker>` header, then three `<Section>`s + a net-profit bar. The `<Section>` component takes `{ titleKey, total, sign, formatBase, baseCurrency, accounts }` and renders `accounts.map(a => <tr> code·name | entryCount | amount </tr>)`. `PnLTab.test.jsx` exists (renders `<PnLTab>` inside `<I18nProvider>` with `makeLedgerCtx()` and asserts "Net Profit" renders) — read it first.

- [ ] **Step 1: Rewrite `PnLTab.jsx`** — replace the file with:

```jsx
// src/pages/treasury_v2/tabs/PnLTab.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { pnlForPeriod } from "../../../lib/treasury/v2selectors.js";
import { mergePnlSection, csvRowsForPnl } from "../../../lib/treasury/pnlCompare.js";
import { exportCSV } from "../../../utils/csv.js";
import PeriodPicker, { presetWindow, previousWindow } from "../PeriodPicker.jsx";

const fmtSigned = (formatBase, baseCurrency, n) => `${n < 0 ? "−" : ""}${formatBase(Math.abs(n), baseCurrency)}`;

function Section({ titleKey, total, prevTotal, sign, formatBase, baseCurrency, accounts, prevAccounts }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const compare = prevAccounts != null;
  const rows = compare ? mergePnlSection(accounts, prevAccounts) : null;
  const isEmpty = compare ? rows.length === 0 : accounts.length === 0;
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <h3 className="text-[13px] font-bold text-slate-900">{t(titleKey)}</h3>
        <span className="text-[13.5px] font-semibold tabular-nums flex items-center gap-3">
          <span>{sign}{formatBase(Math.abs(total), baseCurrency)}</span>
          {compare && (
            <>
              <span className="text-slate-400 text-[12px]">{t("trv2_pnl_col_prev")} {sign}{formatBase(Math.abs(prevTotal), baseCurrency)}</span>
              <span className={`text-[12px] ${total - prevTotal < 0 ? "text-rose-600" : "text-emerald-700"}`}>Δ {fmtSigned(formatBase, baseCurrency, total - prevTotal)}</span>
            </>
          )}
        </span>
      </header>
      {open && (isEmpty ? (
        <div className="px-4 py-3 text-[12px] text-slate-400">—</div>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {(compare ? rows : accounts).map((a) => (
              <tr key={a.code} className="border-t border-slate-100">
                <td className="px-4 py-2"><span className="font-mono text-[11px] text-slate-400 mr-2">{a.code}</span>{a.name}</td>
                <td className="px-4 py-2 text-right text-slate-400 text-[11px] w-16">{a.entryCount}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium w-32">{fmtSigned(formatBase, baseCurrency, a.amountInBase)}</td>
                {compare && <td className="px-4 py-2 text-right tabular-nums text-slate-400 w-32">{fmtSigned(formatBase, baseCurrency, a.prevInBase)}</td>}
                {compare && <td className={`px-4 py-2 text-right tabular-nums w-28 ${a.delta < 0 ? "text-rose-600" : "text-emerald-700"}`}>Δ {fmtSigned(formatBase, baseCurrency, a.delta)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

export default function PnLTab({ ctx, officeFilter, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_period") || "month"; } catch { return "month"; }
  });
  const setP = (v) => { setPeriod(v); try { localStorage.setItem("coinplata.treasury_pnl_period", v); } catch {} };
  const [compare, setCompare] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_pnl_compare") === "1"; } catch { return false; }
  });
  const toggleCompare = () => { const v = !compare; setCompare(v); try { localStorage.setItem("coinplata.treasury_pnl_compare", v ? "1" : "0"); } catch {} };

  const win = useMemo(() => presetWindow(period), [period]);
  const prevWin = useMemo(() => previousWindow(win), [win.from, win.to]);
  const needFrom = compare ? prevWin.from : win.from;
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(needFrom) < new Date(ctx.sinceIso)) ctx.extendWindow(needFrom);
  }, [needFrom, ctx.sinceIso, ctx.extendWindow]);
  const truncated = ctx.sinceIso && new Date(needFrom) < new Date(ctx.sinceIso);

  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);
  const pnlPrev = useMemo(() => (compare ? pnlForPeriod(ctx, { from: prevWin.from, to: prevWin.to }, officeFilter) : null), [compare, ctx, prevWin.from, prevWin.to, officeFilter]);
  const hasAnything = pnl.revenue.accounts.length || pnl.expense.accounts.length || pnl.fxAccounts.length;

  function doExport() {
    const cmp = compare && pnlPrev;
    const columns = [
      { key: "section", label: "section" }, { key: "code", label: "code" }, { key: "name", label: "name" },
      { key: "currency", label: t("trv2_to_col_currency") }, { key: "amount", label: "amount_base" }, { key: "entryCount", label: "entries" },
    ];
    if (cmp) { columns.push({ key: "amountPrev", label: t("trv2_pnl_col_prev") }, { key: "delta", label: t("trv2_pnl_col_delta") }); }
    const f = win.from.slice(0, 10), tt = win.to.slice(0, 10);
    exportCSV({ filename: cmp ? `pnl_${f}_${tt}_vs_${prevWin.from.slice(0, 10)}.csv` : `pnl_${f}_${tt}.csv`, columns, rows: csvRowsForPnl(pnl, cmp ? pnlPrev : null) });
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setP} />
        <div className="flex-1" />
        <button onClick={toggleCompare} className={`px-2.5 py-1 rounded-[8px] text-[12px] font-medium ${compare ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{t("trv2_pnl_compare_toggle")}</button>
        <button onClick={doExport} className="px-2.5 py-1 rounded-[8px] text-[12px] bg-slate-100 text-slate-700 hover:bg-slate-200">{t("trv2_pnl_export_csv")}</button>
      </div>
      {truncated && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] bg-amber-50 text-amber-800 border border-amber-200">{t("trv2_window_partial")}</div>
      )}
      {!hasAnything && !(compare && (pnlPrev.revenue.accounts.length || pnlPrev.expense.accounts.length || pnlPrev.fxAccounts.length)) ? (
        <div className="bg-white rounded-[14px] border border-slate-200/70 px-4 py-8 text-center text-[12.5px] text-slate-400">{t("trv2_pnl_no_data")}</div>
      ) : (
        <>
          <Section titleKey="trv2_pnl_revenue" total={pnl.revenue.total} prevTotal={pnlPrev?.revenue.total} sign="+" accounts={pnl.revenue.accounts} prevAccounts={compare ? (pnlPrev?.revenue.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_expense" total={pnl.expense.total} prevTotal={pnlPrev?.expense.total} sign="−" accounts={pnl.expense.accounts} prevAccounts={compare ? (pnlPrev?.expense.accounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <Section titleKey="trv2_pnl_fx" total={pnl.fxNet} prevTotal={pnlPrev?.fxNet} sign={pnl.fxNet < 0 ? "−" : "+"} accounts={pnl.fxAccounts} prevAccounts={compare ? (pnlPrev?.fxAccounts || []) : null} formatBase={formatBase} baseCurrency={baseCurrency} />
          <div className="bg-slate-900 text-white rounded-[14px] px-5 py-4 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[14px] font-bold">{t("trv2_pnl_net_profit")}</span>
            <span className="flex items-center gap-4">
              <span className={`text-[20px] font-bold tabular-nums ${pnl.netProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmtSigned(formatBase, baseCurrency, pnl.netProfit)}</span>
              {compare && pnlPrev && (
                <>
                  <span className="text-[12.5px] text-slate-400">{t("trv2_pnl_col_prev")} {fmtSigned(formatBase, baseCurrency, pnlPrev.netProfit)}</span>
                  <span className={`text-[12.5px] ${pnl.netProfit - pnlPrev.netProfit < 0 ? "text-rose-400" : "text-emerald-400"}`}>Δ {fmtSigned(formatBase, baseCurrency, pnl.netProfit - pnlPrev.netProfit)}</span>
                </>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
```

  (The `Section` columns are `[account | entryCount | current amount | (prev amount) | (Δ)]` — 3 cells when not comparing, 5 when comparing; no `<thead>` — the section header and the column positions are self-explanatory.)

- [ ] **Step 2: Build** — `npm run build` → succeeds.

- [ ] **Step 3: Extend `PnLTab.test.jsx`** — read the existing file first (it uses `import { I18nProvider } from "../../../i18n/translations.jsx"` and `makeLedgerCtx`, real i18n, real `formatBase`). Add at the top of the file, alongside the existing imports, a mock for `exportCSV`:

```jsx
const exportCSVMock = vi.fn(() => true);
vi.mock("../../../utils/csv.js", () => ({ exportCSV: (...a) => exportCSVMock(...a) }));
```

(If the existing file doesn't `import { vi } from "vitest"`, add `vi` to its vitest import.)

Then add new `it` cases (the fixture `makeLedgerCtx()` has a spread/revenue entry and a rent/expense entry in May 2026; `presetWindow("month")` from "now" — which in CI is ~May 2026 per the project date — captures them, so `pnl` is non-empty and the sections render):

```jsx
  it("renders the Export CSV and Compare buttons", () => {
    const ctx = makeLedgerCtx();
    render(<I18nProvider><PnLTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" /></I18nProvider>);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare with previous period" })).toBeInTheDocument();
  });

  it("Export CSV calls exportCSV with flat per-account rows + a net_profit row", () => {
    const ctx = makeLedgerCtx();
    render(<I18nProvider><PnLTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(exportCSVMock).toHaveBeenCalledTimes(1);
    const arg = exportCSVMock.mock.calls[0][0];
    expect(Array.isArray(arg.rows)).toBe(true);
    expect(arg.rows.some((r) => r.section === "net_profit")).toBe(true);
    // not comparing → no prev/delta columns
    expect(arg.columns.some((c) => c.key === "amountPrev")).toBe(false);
  });

  it("toggling Compare adds the Previous column and includes it in the CSV", () => {
    const ctx = makeLedgerCtx();
    render(<I18nProvider><PnLTab ctx={ctx} officeFilter="all" formatBase={(n) => `$${n}`} baseCurrency="USD" /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Compare with previous period" }));
    // "Previous" text appears (in section headers / net-profit row)
    expect(screen.getAllByText(/Previous/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const arg = exportCSVMock.mock.calls.at(-1)[0];
    expect(arg.columns.some((c) => c.key === "amountPrev")).toBe(true);
    expect(arg.columns.some((c) => c.key === "delta")).toBe(true);
  });
```

(`fireEvent` and `screen` are already imported in the existing test file; if not, add them to its `@testing-library/react` import. The existing "Net Profit" smoke test stays.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/pages/treasury_v2/tabs/PnLTab.test.jsx` → all green (existing + 3 new). If the new tests' English-string assertions fail, it means the i18n EN values differ from the plan's — fix the assertion to match the actual EN value (don't change the i18n keys). If "Previous" doesn't appear, check that `Section`'s compare-mode header renders `t("trv2_pnl_col_prev")` (= "Previous" in EN).
- [ ] **Step 5: Commit:**
```bash
git add src/pages/treasury_v2/tabs/PnLTab.jsx src/pages/treasury_v2/tabs/PnLTab.test.jsx
git commit -m "feat(treasury): P&L tab — CSV export + compare-with-previous-period"
git push
```

---

## Phase 7 — Final + PR

### Task 7.1: Full suite + build + PR

**Files:** none.

- [ ] **Step 1:** `npx vitest run --no-file-parallelism` → all green. New since baseline: `previousWindow` +2, `pnlCompare` +4, `PnLTab` +3.
- [ ] **Step 2:** `npm run build` → clean.
- [ ] **Step 3: Local smoke (manual — note in PR if skipped)** — `npm run dev`, `/treasury` → P&L tab: an "Export CSV" button (downloads a file) and a "Compare with previous period" toggle; toggling it adds Previous + Δ columns to each account row, the section headers, and the net-profit row; the CSV then includes those columns; changing the period updates both periods; picking "Year" briefly shows the "showing recent data only" notice while the wider window (covering the previous year too) loads.
- [ ] **Step 4: Open PR:**
```bash
gh pr create --base main --head feat/pnl-export-compare --title "feat(treasury): P&L CSV export + compare-with-previous-period (Spec C.3)" --body "$(cat <<'EOF'
## Summary
Two additions to the Treasury «P&L» tab (Spec C.3):
- **Export CSV** — downloads the shown P&L (revenue / expense / FX accounts + a net-profit row) via `utils/csv.js`; includes the previous-period and Δ columns when compare is on.
- **Compare with previous period** toggle — runs `pnlForPeriod` for the immediately-preceding same-length window too and adds "Previous" + "Δ" columns to every account row, section header, and the net-profit row. Persisted to localStorage; `extendWindow` covers the wider span.

New: `previousWindow()` date helper in `PeriodPicker.jsx`; `src/lib/treasury/pnlCompare.js` (`mergePnlSection`, `csvRowsForPnl`). No DB changes, no new permission, `pnlForPeriod` unchanged.

## Test plan
- [x] Full suite green (new: previousWindow 2, pnlCompare 4, PnLTab 3)
- [x] `npm run build` clean
- [ ] Local smoke: Export CSV downloads; Compare toggle adds columns; period change updates both

## Out of scope (Spec C.4+)
Arbitrary / same-period-last-year comparison; charts/trends; XLSX export; a dedicated comparison tab; CSV for the other tabs.

Spec: `docs/superpowers/specs/2026-05-11-pnl-export-compare-design.md`
Plan: `docs/superpowers/plans/2026-05-11-pnl-export-compare.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist

**Spec coverage:**
- ✅ CSV export button + `exportCSV` integration, reflects compare state → Task 4 (`doExport`), Task 3 (`csvRowsForPnl`)
- ✅ Compare toggle, persisted, runs `pnlForPeriod` twice → Task 4
- ✅ `previousWindow(win)` = preceding same-length window → Task 2
- ✅ prev/Δ columns on account rows, section headers, net-profit row → Task 4 (`Section`, net-profit bar), Task 3 (`mergePnlSection`)
- ✅ `extendWindow` covers `prevWin.from` when comparing + `trv2_window_partial` notice → Task 4
- ✅ i18n `trv2_pnl_compare_toggle` / `_col_prev` / `_col_delta` (en/ru/tr) → Task 1
- ✅ Tests: `previousWindow`, `pnlCompare`, `PnLTab` extension → Tasks 2, 3, 4
- ⏸ arbitrary/year-ago compare, charts, XLSX, comparison tab — deferred (Out of scope & PR body)

**Type/name consistency:** `previousWindow({from,to}) → {from,to}` (Task 2 ↔ Task 4 import). `mergePnlSection(currentAccounts, prevAccounts) → [{code,name,currency,entryCount,amountInBase,prevInBase,delta}]` (Task 3 ↔ Task 4 `Section`). `csvRowsForPnl(pnl, pnlPrev|null) → [{section,code,name,currency,amount,entryCount,(amountPrev,delta)}]` (Task 3 ↔ Task 4 `doExport`). `exportCSV({filename,columns,rows})` from `utils/csv.js` (existing). `pnlForPeriod` return shape (`revenue.accounts`, `expense.accounts`, `fxAccounts`, `fxNet`, `netProfit`) used consistently.

**Placeholder scan:** none — every code step is complete and every command has expected output.

## Execution Handoff

(See the skill's handoff prompt — choose subagent-driven or inline execution before starting Phase 0.)
