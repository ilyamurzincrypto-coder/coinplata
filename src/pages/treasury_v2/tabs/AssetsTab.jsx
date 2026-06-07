// src/pages/treasury_v2/tabs/AssetsTab.jsx
// «Активы» — вертикальное дерево Office → Currency → Account.
// Одна узкая колонка значений справа (≈ base на офисе/счёте, native на валюте).
// Sticky thead + tfoot ИТОГО, inline-edit на листе.
//
// История: 2026-05-26 пробовали горизонтальный pivot (валюты-колонками) —
// откатили после жалобы Кирилла что >5-6 валют не помещаются по ширине.

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus, Building2, Download } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useRates } from "../../../store/rates.jsx";
import { assetsByOfficeCurrency } from "../../../lib/treasury/v2selectors.js";
import { leafLabel } from "../../../lib/treasury/leafLabel.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { convert } from "../../../utils/convert.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import InlineBalanceEditor from "../parts/InlineBalanceEditor.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const NONZERO_KEY = "coinplata:assets-nonzero";
const DISPLAY_BASE_KEY = "coinplata:assets-display-base";
const BASE_OPTIONS = ["EUR", "TRY", "RUB", "USD"];

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

function fmtIn(amount, ccy) {
  const sign = (Number(amount) || 0) < 0 ? "-" : "";
  return `${sign}${curSymbol(ccy)}${Math.round(Math.abs(Number(amount) || 0)).toLocaleString("en-US")}`;
}

export default function AssetsTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { findOffice } = useOffices();
  const { getRate } = useRates();
  // ≈USD-колонка фикс, вторая ≈-колонка — пикер (default EUR). Дерево строим
  // под USD-base; вторую валюту пересчитываем из native через `convert`.
  const [displayBase, setDisplayBase] = useState(() => {
    try {
      const v = localStorage.getItem(DISPLAY_BASE_KEY);
      return BASE_OPTIONS.includes(v) ? v : "EUR";
    } catch { return "EUR"; }
  });
  const setDisplayBasePersist = (v) => {
    setDisplayBase(v);
    try { localStorage.setItem(DISPLAY_BASE_KEY, v); } catch {}
  };
  const usdCtx = useMemo(() => (
    { ...ctx, baseCurrency: "USD", toBase: (amt, ccy) => convert(Number(amt) || 0, ccy, "USD", getRate) || 0 }
  ), [ctx, getRate]);
  const toAlt = useMemo(() => (amt, ccy) => convert(Number(amt) || 0, ccy, displayBase, getRate) || 0, [getRate, displayBase]);
  const tree = useMemo(() => assetsByOfficeCurrency(usdCtx), [usdCtx]);
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
      .map((office) => ({
        ...office,
        currencies: office.currencies
          .map((cur) => ({
            ...cur,
            accounts: cur.accounts.filter((a) => isNonZero(a.balance)),
          }))
          .filter((cur) => isNonZero(cur.total) && cur.accounts.length > 0),
      }))
      .filter((office) => isNonZero(office.totalInBase) && office.currencies.length > 0);
  }, [tree, nonZeroOnly]);

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const grandTotalUsd = filteredTree.reduce((s, o) => s + o.totalInBase, 0);
  const grandTotalAlt = useMemo(
    () => filteredTree.reduce(
      (s, o) => s + o.currencies.reduce((s2, c) => s2 + toAlt(c.total, c.currency), 0),
      0
    ),
    [filteredTree, toAlt]
  );

  return (
    <div className="space-y-3">
      {/* Header — h2 + counter + ≈ total + действия */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_assets")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {filteredTree.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {fmtIn(grandTotalUsd, "USD")} · {fmtIn(grandTotalAlt, displayBase)}
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
            onClick={() => doExportAssets(filteredTree, toAlt, displayBase, findOffice, t)}
            disabled={filteredTree.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-button bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-soft transition-colors disabled:opacity-40"
            title="Экспорт всех видимых активов в CSV"
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
              <col className="w-[110px]" />
              <col />
              <col className="w-[80px]" />
              <col className="w-[170px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b-2 border-border-soft">
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  № счёта
                </th>
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 border-r border-border-soft">
                  {t("trv2_assets_col_office")}
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
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <span>≈</span>
                    <select
                      value={displayBase}
                      onChange={(e) => setDisplayBasePersist(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="appearance-none bg-surface-sunk text-ink font-bold tracking-wider px-2 py-0.5 rounded-button text-caption cursor-pointer hover:bg-surface-soft transition-colors border-0 focus:outline-none focus:ring-1 focus:ring-accent"
                      title="Сменить валюту приведения"
                    >
                      {BASE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTree.map((office) => {
                const officeKey = `office:${office.officeId || "none"}`;
                const officeOpen = expanded.has(officeKey);
                const officeName = office.officeId
                  ? (findOffice(office.officeId)?.name || office.officeId)
                  : t("trv2_assets_no_office");
                return (
                  <React.Fragment key={officeKey}>
                    {/* Level 1 — office */}
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => toggle(officeKey)}
                    >
                      <td className="px-card py-2.5 font-mono text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                        {office.cashboxCode || <span className="text-tiny text-muted-soft">—</span>}
                      </td>
                      <td className="px-card py-2.5 border-r border-border-soft">
                        <div className="flex items-center gap-2">
                          {officeOpen
                            ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                            : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                          <span className="text-h3 text-ink font-semibold truncate">{officeName}</span>
                        </div>
                      </td>
                      <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap border-r border-border-soft">
                        {fmtIn(office.totalInBase, "USD")}
                      </td>
                      <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap">
                        {fmtIn(office.currencies.reduce((s, c) => s + toAlt(c.total, c.currency), 0), displayBase)}
                      </td>
                    </tr>

                    {officeOpen && office.currencies.map((cur) => {
                      const curKey = `${officeKey}|cur:${cur.currency}`;
                      const curOpen = expanded.has(curKey);
                      // Если в валюте ровно один счёт — currency-row и leaf-row показывают
                      // одно и то же. Сливаем в одну строку с inline-edit и кликом → детали.
                      if (cur.accounts.length === 1) {
                        const a = cur.accounts[0];
                        return (
                          <tr
                            key={curKey}
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => setDetailAccountId(a.accountId)}
                            title="Открыть детали счёта"
                          >
                            <td className="px-card py-2 font-mono text-body-sm text-ink-soft border-r border-border-soft whitespace-nowrap">{a.code}</td>
                            <td className="pl-9 pr-card py-2 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                                <CurrencyIcon ccy={cur.currency} size="sm" />
                                <span className="text-body-sm text-ink truncate">{leafLabel({ ...a, officeName }, t)}</span>
                              </div>
                            </td>
                            <td className="px-card py-2 text-body-sm text-ink-soft tracking-wider border-r border-border-soft">{a.currency}</td>
                            <td
                              className="text-right px-card py-2 font-mono tabular text-body-sm font-semibold text-ink whitespace-nowrap border-r border-border-soft"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <InlineBalanceEditor
                                account={{ code: a.code, currency: a.currency, type: "asset", subtype: null, balance: a.balance }}
                                displayMul={1}
                                accounts={ctx?.accounts || []}
                              />
                            </td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                              {fmtIn(a.balanceInBase, "USD")}
                            </td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap">
                              {fmtIn(toAlt(a.balance, a.currency), displayBase)}
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <React.Fragment key={curKey}>
                          {/* Level 2 — currency (>1 счетов в валюте) */}
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggle(curKey)}
                          >
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className="pl-9 pr-card py-2 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                {curOpen
                                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                                  : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
                                <CurrencyIcon ccy={cur.currency} size="sm" />
                                <span className="text-caption font-semibold text-ink-soft tracking-wider">
                                  {cur.currency}
                                </span>
                              </div>
                            </td>
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm font-semibold text-ink whitespace-nowrap border-r border-border-soft">
                              {nativeFmt(cur.total, cur.currency)}
                            </td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                              {fmtIn(cur.totalInBase, "USD")}
                            </td>
                            <td className="text-right px-card py-2 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap">
                              {fmtIn(toAlt(cur.total, cur.currency), displayBase)}
                            </td>
                          </tr>

                          {curOpen && cur.accounts.map((a) => {
                            const accKey = `${curKey}|acc:${a.accountId}`;
                            return (
                              <tr
                                key={accKey}
                                className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                                onClick={() => setDetailAccountId(a.accountId)}
                                title="Открыть детали счёта"
                              >
                                <td className="px-card py-1.5 font-mono text-body-sm text-ink-soft border-r border-border-soft whitespace-nowrap">{a.code}</td>
                                <td className="pl-16 pr-card py-1.5 border-r border-border-soft">
                                  <div className="flex items-center gap-2">
                                    <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                    <span className="text-body-sm text-ink truncate">{leafLabel({ ...a, officeName }, t)}</span>
                                  </div>
                                </td>
                                <td className="px-card py-1.5 text-body-sm text-ink-soft tracking-wider border-r border-border-soft">{a.currency}</td>
                                <td
                                  className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <InlineBalanceEditor
                                    account={{
                                      code: a.code,
                                      currency: a.currency,
                                      type: "asset",
                                      subtype: null,
                                      balance: a.balance,
                                    }}
                                    displayMul={1}
                                    accounts={ctx?.accounts || []}
                                  />
                                </td>
                                <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap border-r border-border-soft">
                                  {fmtIn(a.balanceInBase, "USD")}
                                </td>
                                <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-ink-soft whitespace-nowrap">
                                  {fmtIn(toAlt(a.balance, a.currency), displayBase)}
                                </td>
                              </tr>
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
                <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="px-card py-2.5 text-body-sm font-bold text-ink uppercase tracking-wider border-r border-border-soft">
                  {t("trv2_assets_grand_total")}
                </td>
                <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap border-r border-border-soft">
                  {fmtIn(grandTotalUsd, "USD")}
                </td>
                <td className="text-right px-card py-2.5 font-mono tabular font-bold text-body-sm text-ink whitespace-nowrap">
                  {fmtIn(grandTotalAlt, displayBase)}
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
          defaultType="asset"
          lockType
        />
      )}

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

// Один row на каждый leaf account (office × currency × account). Native + USD + альт-валюта пикера.
function doExportAssets(tree, toAlt, altCurrency, findOffice, t) {
  const rows = [];
  for (const office of tree) {
    const officeName = office.officeId
      ? (findOffice(office.officeId)?.name || office.officeId)
      : t("trv2_assets_no_office");
    for (const cur of office.currencies) {
      for (const a of cur.accounts) {
        rows.push({
          office: officeName,
          accountCode: a.code,
          accountName: a.name,
          currency: cur.currency,
          balance: a.balance,
          balanceInBase: a.balanceInBase,
          balanceInAlt: toAlt(a.balance, a.currency),
        });
      }
    }
  }
  const cols = [
    { key: "office", label: "office" },
    { key: "accountCode", label: "account_code" },
    { key: "accountName", label: "account_name" },
    { key: "currency", label: "currency" },
    { key: "balance", label: "balance_native" },
    { key: "balanceInBase", label: "balance_usd" },
    { key: "balanceInAlt", label: `balance_${altCurrency.toLowerCase()}` },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `assets_${stamp}.csv`, columns: cols, rows });
}
