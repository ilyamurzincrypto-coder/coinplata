# P&L tab — CSV export + compare-with-previous-period (Spec C.3)

**Date:** 2026-05-11
**Status:** approved (brainstorm) → ready for implementation plan
**Depends on:** Spec B (Treasury, `src/pages/treasury_v2/`). Modifies the existing `PnLTab`.

## Overview

Two small additions to the existing Treasury «P&L» tab:

1. **CSV export** — a button that downloads the currently-shown P&L as a CSV (revenue accounts, expense accounts, FX gain/loss accounts, and a net-profit row), reusing `src/utils/csv.js`'s `exportCSV`.
2. **Compare with the previous period** — a toggle that, when on, runs `pnlForPeriod` for the immediately-preceding window of the same length as well, and adds a "previous" column and a "Δ" column to every account row, every section header, and the net-profit row.

No new selector logic beyond a tiny `previousWindow(win)` date helper; `pnlForPeriod` is unchanged and just called a second time. No DB changes, no new permission (the P&L tab is read-only behind the Treasury page's existing `capital` view).

## Data / helpers

- `pnlForPeriod(ctx, { from, to }, officeFilter)` (existing, `src/lib/treasury/v2selectors.js`) returns `{ revenue: { total, accounts: [{ code, name, currency, amountInBase, entryCount }] }, expense: { total, accounts: [...] }, fxNet, fxAccounts: [...], netProfit }`. Used as-is.
- New `previousWindow({ from, to })` → `{ from, to }` — the window immediately before `win`, same length: `prev.to = win.from`, `prev.from = ISO(toMs(win.from) − (toMs(win.to) − toMs(win.from)))`. Add it to `src/pages/treasury_v2/PeriodPicker.jsx` next to `presetWindow` (it's a pure date function, and `PeriodPicker.jsx` is where the period-window math already lives).
- `exportCSV({ filename, columns, rows })` (existing, `src/utils/csv.js`) — `columns` are `{ key, label }` objects; `rows` are plain objects. Reused.

## Behaviour

### CSV export

A "Экспорт CSV" button in the P&L tab header (next to / under the `PeriodPicker`). On click → `exportCSV` with:
- `filename`: `pnl_${from.slice(0,10)}_${to.slice(0,10)}.csv` (when compare is on, append `_vs_${prev.from.slice(0,10)}`).
- `rows`: one per account across the three sections (revenue / expense / fx) plus a final net-profit row. Each row: `{ section, code, name, currency, amount, entryCount }` where `amount` is `amountInBase` (the net-profit row has `section = "net_profit"`, `code/name/currency` blank, `amount = netProfit`, `entryCount` blank). Section subtotal rows are NOT included in the CSV (keep it flat per account; the consumer can subtotal).
- `columns`: `[{key:"section",label:t("...section")}, {key:"code",label:"code"}, {key:"name",label:t("trv2_pnl_col_account") or just "name"}, {key:"currency",label:t("trv2_to_col_currency")}, {key:"amount",label:t("...amount base")}, {key:"entryCount",label:"entries"}]` — and when compare is on, add `{key:"amountPrev",label:t("trv2_pnl_col_prev")}` and `{key:"delta",label:t("trv2_pnl_col_delta")}`.
  (Use existing keys where they exist — `trv2_to_col_currency`, `trv2_pnl_export_csv` already exist; for "section"/"amount"/"name" plain strings or existing keys are fine. Don't invent keys beyond the three new ones below.)

The CSV reflects exactly what's currently displayed (compare on/off).

### Compare toggle

A toggle (a small button styled like the other toggles in the Treasury tabs, e.g. the JournalTab type buttons) labelled `t("trv2_pnl_compare_toggle")` in the header. State persisted to `localStorage` key `coinplata.treasury_pnl_compare` (`"1"` / `"0"`). When ON:
- `prevWin = previousWindow(win)`; `pnlPrev = pnlForPeriod(ctx, prevWin, officeFilter)` (memoized on `[ctx, prevWin.from, prevWin.to, officeFilter]`).
- `extendWindow` effect: extend to `min(win.from, prevWin.from)` = `prevWin.from` (it's always earlier than `win.from`). The `trv2_window_partial` notice shows while `prevWin.from < ctx.sinceIso`.
- The `Section` component takes optional `prevAccounts` (the previous period's account list for that section) and `prevTotal`. When present, each account `<tr>` gains two cells: previous `amountInBase` (matched by `code`; 0 if the code isn't in `prevAccounts`) and `Δ = current.amountInBase − prev.amountInBase`. The section header shows `current total · prev total · Δ`. Δ is rendered with its literal sign (negative red, positive emerald-700 — no per-section sign flipping; an accountant reading "expense Δ +500" understands it grew).
- The net-profit row similarly shows `current netProfit · prev netProfit · Δ`.
- When compare is OFF, the UI is exactly as today (no extra columns), and `pnlPrev` is not computed (skip the second `pnlForPeriod` call).

A pure helper `pnlAccountDelta(currentAccounts, prevAccounts)` is **not** needed — the matching-by-code is a one-liner inside `Section` (build a `Map(prevAccounts.map(a => [a.code, a.amountInBase]))`, look up by `a.code`, default 0; also append any prev-only codes as rows with current 0). To keep `Section` from getting tangled, factor the row-merge into a small pure function `mergePnlSection(currentAccounts, prevAccounts) → [{ code, name, currency, entryCount, amountInBase, prevInBase, delta }]` exported from a new tiny module `src/lib/treasury/pnlCompare.js` (also exporting `csvRowsForPnl(pnl, pnlPrev|null) → rows[]` so the export and the UI agree, and re-exporting `previousWindow` is NOT done there — `previousWindow` stays in `PeriodPicker.jsx`). This module is what gets unit-tested.

## i18n

New keys (en / ru / tr): `trv2_pnl_compare_toggle` ("Compare with previous period" / "Сравнить с прошлым периодом" / "Önceki dönemle karşılaştır"), `trv2_pnl_col_prev` ("Previous" / "Прошл." / "Önceki"), `trv2_pnl_col_delta` ("Δ" / "Δ" / "Δ"). `trv2_pnl_export_csv` already exists (Spec B added it). 3 new keys × 3 locales.

## Testing

- `previousWindow` (in `PeriodPicker.test.js`): for a 31-day window `{from: 2026-05-01, to: 2026-06-01}` → `{from: 2026-03-31, to: 2026-05-01}` (length preserved, `prev.to === win.from`); for `{from: 2026-05-10T14:00, to: 2026-05-15T14:00}` (5 days) → `{from: 2026-05-05T14:00, to: 2026-05-10T14:00}`.
- `pnlCompare.js` unit tests: `mergePnlSection` — matches by code, adds prev-only codes as rows with current 0, current-only codes with prev 0, computes `delta` correctly, preserves `name/currency/entryCount` from whichever side has the row (prefer current). `csvRowsForPnl` — flattens revenue+expense+fx+net-profit rows; with `pnlPrev` provided, includes `prevInBase`/`delta` per row and a net-profit comparison row.
- `PnLTab.test.jsx` extension: the "Экспорт CSV" button calls `exportCSV` (mocked) with a `rows` array containing the revenue account code; toggling "Сравнить" on shows the prev/Δ columns (assert on a `t`-key for the column header) and that an account present only in the previous period appears as a row.

## Out of scope (Spec C.4+)

- Comparing against an arbitrary user-picked period or "same period last year" (v1 = the immediately-preceding same-length window only).
- Charts / trend lines / sparklines.
- XLSX export (CSV only; the repo has `utils/xlsxRates.js` but P&L stays CSV).
- A dedicated "Comparison" tab (two extra columns don't warrant it).
- CSV export for the other Treasury tabs (the ОСВ already got one in C.2; the rest are out of scope here).

## References

- Existing P&L tab: `src/pages/treasury_v2/tabs/PnLTab.jsx`; selector `pnlForPeriod` in `src/lib/treasury/v2selectors.js`.
- CSV helper: `src/utils/csv.js` (`exportCSV`).
- Period-window math: `src/pages/treasury_v2/PeriodPicker.jsx` (`presetWindow`).
- Pattern reuse: `extendWindow` + `trv2_window_partial` notice as in `JournalTab`/`PnLTab`/`TurnoverTab`; the ОСВ CSV export in `TrialBalanceTable.jsx` (Spec C.2) is the closest prior art for the export button.
