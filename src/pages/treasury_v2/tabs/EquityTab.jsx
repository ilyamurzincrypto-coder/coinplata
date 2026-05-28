// src/pages/treasury_v2/tabs/EquityTab.jsx
// «Капитал» — tree-table 1:1 с Активами/Пассивами:
//   Подтип (Opening Equity / Retained Earnings / FX Gain/Loss / …)
//   → Валюта → Счёт.
// Шапка как в Активах: counter + ≈ total + Ненулевые + CSV + +Счёт.
// Клик по листу → AccountDetailModal (group-mode по siblings подтипа+валюты).
// Открытие модала «+ Счёт» — с lockType=equity (тип залочен, не показывается).

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus, Building2, Download } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useRates } from "../../../store/rates.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { equityBySubtypeCurrency, balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { convert } from "../../../utils/convert.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import InlineBalanceEditor from "../parts/InlineBalanceEditor.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const NONZERO_KEY = "coinplata:equity-nonzero";

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

function fmtIn(amount, ccy) {
  const sign = (Number(amount) || 0) < 0 ? "-" : "";
  return `${sign}${curSymbol(ccy)}${Math.round(Math.abs(Number(amount) || 0)).toLocaleString("en-US")}`;
}

export default function EquityTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { getRate } = useRates();
  const { findOffice } = useOffices();
  // Дерево всегда строим под USD-base (≈USD-колонка); EUR пересчитываем из native через `convert`.
  const usdCtx = useMemo(() => (
    { ...ctx, baseCurrency: "USD", toBase: (amt, ccy) => convert(Number(amt) || 0, ccy, "USD", getRate) || 0 }
  ), [ctx, getRate]);
  const toEur = useMemo(() => (amt, ccy) => convert(Number(amt) || 0, ccy, "EUR", getRate) || 0, [getRate]);
  const tree = useMemo(() => equityBySubtypeCurrency(usdCtx), [usdCtx]);
  const totals = useMemo(() => balanceCheckTotals(usdCtx, officeFilter), [usdCtx, officeFilter]);

  const [expanded, setExpanded] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [detailAccountId, setDetailAccountId] = useState(null);
  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => {
    setNonZeroOnly(v);
    try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {}
  };

  const isNonZero = (n) => Math.abs(Number(n) || 0) > 0.005;
  const filteredTree = useMemo(() => {
    if (!nonZeroOnly) return tree;
    return tree
      .map((s) => ({
        ...s,
        offices: s.offices
          .map((o) => ({
            ...o,
            currencies: o.currencies
              .map((cur) => ({ ...cur, accounts: cur.accounts.filter((a) => isNonZero(a.balance)) }))
              .filter((cur) => isNonZero(cur.total) && cur.accounts.length > 0),
          }))
          .filter((o) => isNonZero(o.totalInBase) && o.currencies.length > 0),
      }))
      .filter((s) => isNonZero(s.totalInBase) && s.offices.length > 0);
  }, [tree, nonZeroOnly]);

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grandTotalUsd = filteredTree.reduce((s, x) => s + x.totalInBase, 0);
  const grandTotalEur = useMemo(
    () => filteredTree.reduce(
      (s, sect) => s + sect.offices.reduce(
        (s2, off) => s2 + off.currencies.reduce(
          (s3, cur) => s3 + toEur(cur.total, cur.currency), 0
        ), 0
      ), 0
    ),
    [filteredTree, toEur]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_equity")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {filteredTree.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {fmtIn(grandTotalUsd, "USD")} · {fmtIn(grandTotalEur, "EUR")}
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
            onClick={() => doExportEquity(filteredTree, toEur, t, findOffice)}
            disabled={filteredTree.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-button bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-soft transition-colors disabled:opacity-40"
            title="Экспорт капитала в CSV"
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

      {filteredTree.length === 0 ? (
        <div className="bg-surface rounded-card p-card">
          <div className="py-10 text-center">
            <div className="inline-flex w-11 h-11 rounded-full bg-surface-sunk text-muted-soft items-center justify-center mb-3">
              <Building2 className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="text-body font-semibold text-ink mb-1">{t("trv2_no_accounts")}</div>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-card overflow-hidden">
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col />
              <col className="w-[110px]" />
              <col className="w-[80px]" />
              <col className="w-[170px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b-2 border-border-soft">
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 border-r border-border-soft">
                  Подтип
                </th>
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  № счёта
                </th>
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  Валюта
                </th>
                <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  Остаток
                </th>
                <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  ≈ USD
                </th>
                <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap">
                  ≈ EUR
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTree.map((sect) => {
                const sKey = `sub:${sect.subtype}`;
                const sOpen = expanded.has(sKey);
                const sectEur = sect.offices.reduce(
                  (s, o) => s + o.currencies.reduce((s2, c) => s2 + toEur(c.total, c.currency), 0),
                  0
                );
                return (
                  <React.Fragment key={sKey}>
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => toggle(sKey)}
                    >
                      <td className="px-card py-2.5 border-r border-border-soft">
                        <div className="flex items-center gap-2">
                          {sOpen
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                          <span className="text-h3 text-ink font-semibold truncate">{t(sect.labelKey)}</span>
                        </div>
                      </td>
                      <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap border-r border-border-soft">
                        {fmtIn(sect.totalInBase, "USD")}
                      </td>
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap">
                        {fmtIn(sectEur, "EUR")}
                      </td>
                    </tr>

                    {sOpen && sect.offices.map((off) => {
                      const officeKey = `${sKey}|office:${off.officeId || "none"}`;
                      const officeOpen = expanded.has(officeKey);
                      const officeName = off.officeId
                        ? (findOffice(off.officeId)?.name || off.officeId)
                        : t("trv2_assets_no_office");
                      return (
                        <React.Fragment key={officeKey}>
                          {/* Level 2 — office */}
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggle(officeKey)}
                          >
                            <td className="pl-9 pr-card py-2 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                {officeOpen
                                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                                  : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
                                <span className="text-body-sm font-semibold text-ink-soft truncate">{officeName}</span>
                              </div>
                            </td>
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className="text-right px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm font-semibold text-ink whitespace-nowrap border-r border-border-soft">
                              {fmtIn(off.totalInBase, "USD")}
                            </td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm font-semibold text-ink whitespace-nowrap">
                              {fmtIn(off.currencies.reduce((s, c) => s + toEur(c.total, c.currency), 0), "EUR")}
                            </td>
                          </tr>

                          {officeOpen && off.currencies.map((cur) => {
                            const curKey = `${officeKey}|cur:${cur.currency}`;
                            const curOpen = expanded.has(curKey);
                            return (
                              <React.Fragment key={curKey}>
                                {/* Level 3 — currency */}
                                <tr
                                  className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                                  onClick={() => toggle(curKey)}
                                >
                                  <td className="pl-16 pr-card py-1.5 border-r border-border-soft">
                                    <div className="flex items-center gap-2">
                                      {curOpen
                                        ? <ChevronDown className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                        : <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />}
                                      <CurrencyIcon ccy={cur.currency} size="sm" />
                                      <span className="text-caption font-semibold text-ink-soft tracking-wider">
                                        {cur.currency}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-card py-1.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                                  <td className="px-card py-1.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                                  <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink whitespace-nowrap border-r border-border-soft">
                                    {nativeFmt(cur.total, cur.currency)}
                                  </td>
                                  <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                                    {fmtIn(cur.totalInBase, "USD")}
                                  </td>
                                  <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap">
                                    {fmtIn(toEur(cur.total, cur.currency), "EUR")}
                                  </td>
                                </tr>

                                {curOpen && cur.accounts.map((a) => (
                                  <tr
                                    key={`${curKey}|acc:${a.accountId}`}
                                    className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                                    onClick={() => setDetailAccountId(a.accountId)}
                                    title="Открыть детали счёта"
                                  >
                                    <td className="pl-[88px] pr-card py-1.5 border-r border-border-soft">
                                      <div className="flex items-center gap-2">
                                        <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                        <span className="text-body-sm text-ink truncate">{a.name}</span>
                                      </div>
                                    </td>
                                    <td className="px-card py-1.5 font-mono text-tiny text-muted-soft border-r border-border-soft whitespace-nowrap">{a.code}</td>
                                    <td className="px-card py-1.5 text-body-sm text-ink-soft tracking-wider border-r border-border-soft">{a.currency}</td>
                                    <td
                                      className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <InlineBalanceEditor
                                        account={{
                                          code: a.code,
                                          currency: a.currency,
                                          type: "equity",
                                          subtype: sect.subtype,
                                          balance: a.balance,
                                        }}
                                        displayMul={1}
                                        accounts={ctx?.accounts || []}
                                        suffix={a.currency}
                                      />
                                    </td>
                                    <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                                      {fmtIn(a.balanceInBase, "USD")}
                                    </td>
                                    <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap">
                                      {fmtIn(toEur(a.balance, a.currency), "EUR")}
                                    </td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-surface-sunk">
              <tr className="border-t-2 border-border-soft">
                <td className="px-card py-2.5 text-body-sm font-bold text-ink uppercase tracking-wider border-r border-border-soft">
                  ИТОГО
                </td>
                <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap border-r border-border-soft">
                  {fmtIn(grandTotalUsd, "USD")}
                </td>
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap">
                  {fmtIn(grandTotalEur, "EUR")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Балансовое тождество — отчёт в USD (приведение из ledger.balanceCheckTotals под USD-ctx). */}
      <div className={`rounded-card px-card py-3 text-body-sm font-medium font-mono tabular ${
        totals.identityCheck.ok
          ? "bg-success-soft text-success border border-success/20"
          : "bg-danger-soft text-danger border border-danger/20"
      }`}>
        {t("trv2_tab_equity")} {fmtIn(totals.equity, "USD")}
        {Math.abs(totals.pnl || 0) > 0.005 && (
          <span className="opacity-70"> ({t("trv2_balance_incl_pnl")} {fmtIn(totals.pnl, "USD")})</span>
        )}
        {" = "}{t("trv2_tab_assets")} {fmtIn(totals.assets, "USD")} + {t("trv2_tab_liabilities")} {fmtIn(-totals.liabilities, "USD")} {totals.identityCheck.ok ? "✓" : `(Δ ${fmtIn(totals.identityCheck.delta, "USD")})`}
      </div>

      {addOpen && <ChartAccountModal open defaultType="equity" lockType onClose={() => setAddOpen(false)} />}

      <AccountDetailModal
        open={!!detailAccountId}
        onClose={() => setDetailAccountId(null)}
        ctx={ctx}
        accountId={detailAccountId}
        formatBase={(amt) => fmtIn(amt, "USD")}
        baseCurrency="USD"
        onOpenTx={onOpenTx}
      />
    </div>
  );
}

function doExportEquity(tree, toEur, t, findOffice) {
  const rows = [];
  for (const sect of tree) {
    for (const off of sect.offices) {
      const officeName = off.officeId
        ? (findOffice?.(off.officeId)?.name || off.officeId)
        : t("trv2_assets_no_office");
      for (const cur of off.currencies) {
        for (const a of cur.accounts) {
          rows.push({
            subtype: t(sect.labelKey),
            office: officeName,
            accountCode: a.code,
            accountName: a.name,
            currency: cur.currency,
            balance: a.balance,
            balanceInUsd: a.balanceInBase,
            balanceInEur: toEur(a.balance, a.currency),
          });
        }
      }
    }
  }
  const cols = [
    { key: "subtype", label: "subtype" },
    { key: "office", label: "office" },
    { key: "accountCode", label: "account_code" },
    { key: "accountName", label: "account_name" },
    { key: "currency", label: "currency" },
    { key: "balance", label: "balance_native" },
    { key: "balanceInUsd", label: "balance_usd" },
    { key: "balanceInEur", label: "balance_eur" },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `equity_${stamp}.csv`, columns: cols, rows });
}
