// src/pages/treasury_v2/tabs/AssetsTab.jsx
// «Активы» — pivot-таблица Office × Currency. Строки — офисы (раскрываются
// в листья-счета), колонки — валюты (из набора asset-счетов; base первой,
// остальные по Σ|inBase| desc). Клик по заголовку колонки сортирует строки.
// Лист-счёт показывает native-баланс в своей колонке + InlineBalanceEditor;
// клик по нему разворачивает AccountInlineEntries.

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus, Building2, Download, ArrowUp, ArrowDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { assetsPivotByOffice } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountInlineEntries from "../parts/AccountInlineEntries.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import InlineBalanceEditor from "../parts/InlineBalanceEditor.jsx";

const NONZERO_KEY = "coinplata:assets-nonzero";
const SORT_KEY_BASE = "__inBase";

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

export default function AssetsTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { findOffice } = useOffices();
  const pivot = useMemo(() => assetsPivotByOffice(ctx), [ctx]);

  const [expandedOffices, setExpandedOffices] = useState(() => new Set());
  const [expandedAccounts, setExpandedAccounts] = useState(() => new Set());
  const [sort, setSort] = useState({ key: SORT_KEY_BASE, dir: "desc" });
  const [addOpen, setAddOpen] = useState(false);
  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => {
    setNonZeroOnly(v);
    try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {}
  };

  const isNonZero = (n) => Math.abs(Number(n) || 0) > 0.005;
  const filtered = useMemo(() => {
    if (!nonZeroOnly) return pivot;
    const rows = pivot.rows
      .map((r) => ({ ...r, accounts: r.accounts.filter((a) => isNonZero(a.balanceInBase)) }))
      .filter((r) => isNonZero(r.totalInBase));
    const grandTotals = { inBase: 0 };
    const ccyTotals = new Map();
    for (const r of rows) {
      grandTotals.inBase += r.totalInBase;
      for (const ccy of pivot.currencies) {
        if (r.totals[ccy] != null) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + r.totals[ccy]);
      }
    }
    const currencies = pivot.currencies.filter((ccy) => isNonZero(ccyTotals.get(ccy)));
    for (const ccy of currencies) grandTotals[ccy] = ccyTotals.get(ccy);
    return { currencies, rows, grandTotals };
  }, [pivot, nonZeroOnly]);

  const sortedRows = useMemo(() => {
    const rows = filtered.rows.slice();
    const dirMul = sort.dir === "asc" ? 1 : -1;
    const pinNullLast = sort.key === SORT_KEY_BASE; // default sort: null-office row pinned at bottom
    rows.sort((a, b) => {
      if (pinNullLast) {
        if (a.officeId === null && b.officeId !== null) return 1;
        if (b.officeId === null && a.officeId !== null) return -1;
      }
      if (sort.key === SORT_KEY_BASE) {
        return (Math.abs(a.totalInBase) - Math.abs(b.totalInBase)) * dirMul;
      }
      if (sort.key === "__office") {
        const aName = a.officeId ? (findOffice(a.officeId)?.name || a.officeId) : t("trv2_assets_no_office");
        const bName = b.officeId ? (findOffice(b.officeId)?.name || b.officeId) : t("trv2_assets_no_office");
        return String(aName).localeCompare(String(bName)) * dirMul;
      }
      const aV = a.totals[sort.key] || 0;
      const bV = b.totals[sort.key] || 0;
      return (Math.abs(aV) - Math.abs(bV)) * dirMul;
    });
    return rows;
  }, [filtered, sort, findOffice, t]);

  const toggleOffice = (key) => setExpandedOffices((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAccount = (key) => setExpandedAccounts((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const onSortClick = (key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "desc" };
      if (prev.dir === "desc") return { key, dir: "asc" };
      return { key: SORT_KEY_BASE, dir: "desc" };
    });
  };

  const SortArrow = ({ active, dir }) => {
    if (!active) return null;
    return dir === "asc"
      ? <ArrowUp className="inline w-3 h-3 ml-1 text-ink" strokeWidth={2.5} />
      : <ArrowDown className="inline w-3 h-3 ml-1 text-ink" strokeWidth={2.5} />;
  };

  const colCount = 1 + filtered.currencies.length + 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_assets")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {sortedRows.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {formatBase(filtered.grandTotals.inBase, baseCurrency)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNonZeroPersist(!nonZeroOnly)}
            className={`h-9 px-3 rounded-button text-body-sm font-semibold transition-all whitespace-nowrap ${
              nonZeroOnly ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
            }`}
            title="Скрыть нулевые балансы"
          >
            Ненулевые
          </button>
          <button
            type="button"
            onClick={() => doExportAssets(filtered, baseCurrency, findOffice, t)}
            disabled={sortedRows.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-button bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-soft transition-colors disabled:opacity-40"
            title="Экспорт pivot-таблицы в CSV"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={2.5} />
            CSV
          </button>
          {can("accounting", "edit") && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black hover:-translate-y-px shadow-cta-glow transition-all"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              {t("trv2_chart_add_btn")}
            </button>
          )}
        </div>
      </div>

      {sortedRows.length === 0 ? (
        <div className="bg-surface rounded-card p-card">
          <div className="py-10 text-center">
            <div className="inline-flex w-11 h-11 rounded-full bg-surface-sunk text-muted-soft items-center justify-center mb-3">
              <Building2 className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="text-body font-semibold text-ink mb-1">{t("trv2_no_accounts")}</div>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border-soft">
                <th
                  className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => onSortClick("__office")}
                >
                  {t("trv2_assets_col_office")}
                  <SortArrow active={sort.key === "__office"} dir={sort.dir} />
                </th>
                {filtered.currencies.map((ccy) => (
                  <th
                    key={ccy}
                    className="text-right text-caption font-semibold text-muted tracking-wider px-3 py-2.5 cursor-pointer select-none hover:text-ink transition-colors font-mono"
                    onClick={() => onSortClick(ccy)}
                  >
                    {ccy}
                    <SortArrow active={sort.key === ccy} dir={sort.dir} />
                  </th>
                ))}
                <th
                  className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 cursor-pointer select-none hover:text-ink transition-colors"
                  onClick={() => onSortClick(SORT_KEY_BASE)}
                >
                  {t("trv2_assets_col_base")} {baseCurrency}
                  <SortArrow active={sort.key === SORT_KEY_BASE} dir={sort.dir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const officeKey = `office:${row.officeId || "none"}`;
                const open = expandedOffices.has(officeKey);
                const officeName = row.officeId
                  ? (findOffice(row.officeId)?.name || row.officeId)
                  : t("trv2_assets_no_office");
                return (
                  <React.Fragment key={officeKey}>
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => toggleOffice(officeKey)}
                    >
                      <td className="px-card py-2.5">
                        <div className="flex items-center gap-2">
                          {open
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                          <span className="text-h3 text-ink font-semibold truncate">{officeName}</span>
                        </div>
                      </td>
                      {filtered.currencies.map((ccy) => (
                        <td key={ccy} className="text-right px-3 py-2.5 font-mono tabular text-body-sm text-ink-soft">
                          {row.totals[ccy] != null && Math.abs(row.totals[ccy]) > 0.005
                            ? nativeFmt(row.totals[ccy], ccy)
                            : <span className="text-muted-soft">—</span>}
                        </td>
                      ))}
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink">
                        {formatBase(row.totalInBase, baseCurrency)}
                      </td>
                    </tr>

                    {open && row.accounts.map((a) => {
                      const accKey = `${officeKey}|acc:${a.accountId}`;
                      const accOpen = expandedAccounts.has(accKey);
                      return (
                        <React.Fragment key={accKey}>
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggleAccount(accKey)}
                          >
                            <td className="pl-9 pr-card py-1.5">
                              <div className="flex items-center gap-2">
                                {accOpen
                                  ? <ChevronDown className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                  : <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />}
                                <span className="font-mono text-tiny text-muted-soft">{a.code}</span>
                                <span className="text-body-sm text-ink truncate">{a.name}</span>
                              </div>
                            </td>
                            {filtered.currencies.map((ccy) => (
                              <td key={ccy} className="text-right px-3 py-1.5 font-mono tabular text-body-sm">
                                {ccy === a.currency ? (
                                  <span onClick={(e) => e.stopPropagation()}>
                                    <InlineBalanceEditor
                                      account={{ code: a.code, currency: a.currency, type: "asset", subtype: null, balance: a.balance }}
                                      displayMul={1}
                                      accounts={ctx?.accounts || []}
                                      suffix={a.currency}
                                    />
                                  </span>
                                ) : (
                                  <span className="text-muted-soft">—</span>
                                )}
                              </td>
                            ))}
                            <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft">
                              {formatBase(a.balanceInBase, baseCurrency)}
                            </td>
                          </tr>
                          {accOpen && (
                            <tr>
                              <td colSpan={colCount} className="p-0">
                                <AccountInlineEntries ctx={ctx} accountId={a.accountId} onOpenTx={onOpenTx} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-surface-sunk">
              <tr className="border-t border-border-soft">
                <td className="px-card py-2.5 text-body-sm font-bold text-ink uppercase tracking-wider">
                  {t("trv2_assets_grand_total")}
                </td>
                {filtered.currencies.map((ccy) => (
                  <td key={ccy} className="text-right px-3 py-2.5 font-mono tabular font-semibold text-body-sm text-ink">
                    {filtered.grandTotals[ccy] != null && Math.abs(filtered.grandTotals[ccy]) > 0.005
                      ? nativeFmt(filtered.grandTotals[ccy], ccy)
                      : <span className="text-muted-soft">—</span>}
                  </td>
                ))}
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink">
                  {formatBase(filtered.grandTotals.inBase, baseCurrency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {addOpen && (
        <ChartAccountModal
          open
          onClose={() => setAddOpen(false)}
          defaultOfficeId={officeFilter && officeFilter !== "all" ? officeFilter : null}
        />
      )}
    </div>
  );
}

function doExportAssets(filtered, baseCurrency, findOffice, t) {
  const baseKey = `base_${baseCurrency.toLowerCase()}`;
  const columns = [
    { key: "office", label: "office" },
    ...filtered.currencies.map((ccy) => ({ key: ccy, label: ccy })),
    { key: baseKey, label: baseKey },
  ];
  const rows = filtered.rows.map((r) => {
    const officeName = r.officeId
      ? (findOffice(r.officeId)?.name || r.officeId)
      : t("trv2_assets_no_office");
    const out = { office: officeName, [baseKey]: r.totalInBase };
    for (const ccy of filtered.currencies) out[ccy] = r.totals[ccy] ?? "";
    return out;
  });
  const totalRow = { office: t("trv2_assets_grand_total"), [baseKey]: filtered.grandTotals.inBase };
  for (const ccy of filtered.currencies) totalRow[ccy] = filtered.grandTotals[ccy] ?? "";
  rows.push(totalRow);

  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `assets_${stamp}.csv`, columns, rows });
}
