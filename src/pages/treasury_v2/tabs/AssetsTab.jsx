// src/pages/treasury_v2/tabs/AssetsTab.jsx
// «Активы» — иерархическое дерево Офис → Валюта → счета плана.
// Уровень 1 — офис (acc.officeId; null → «Без офиса»), total всех его asset-счетов в базе.
// Уровень 2 — валюта внутри офиса (native total + ≈ base).
// Уровень 3 (листья) — конкретные ledger.accounts; клик по листу разворачивает его проводки.
//
// Visual refresh на DS-токены (то же что Balances / Liabilities / RatesSidebar):
//   • bg-surface, text-ink/muted, border-border-soft
//   • text-h2/h3/caption/micro (без halfpixel)
//   • Корневая карточка без border (правило DS)
//   • CurrencyIcon на currency-row для единообразия с Balances
//
// Логика не тронута: expanded Set + ключи, permission checks, drill-down.

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Plus, Building2, Download } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { assetsByOfficeCurrency } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { exportCSV } from "../../../utils/csv.js";
import AccountInlineEntries from "../parts/AccountInlineEntries.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import InlineBalanceEditor from "../parts/InlineBalanceEditor.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const NONZERO_KEY = "coinplata:assets-nonzero";

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

export default function AssetsTab({ ctx, officeFilter, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { findOffice } = useOffices();
  const tree = useMemo(() => assetsByOfficeCurrency(ctx), [ctx]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => {
    setNonZeroOnly(v);
    try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {}
  };

  const filteredTree = useMemo(() => {
    if (!nonZeroOnly) return tree;
    const isNonZero = (n) => Math.abs(Number(n) || 0) > 0.005;
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

  const grandTotal = filteredTree.reduce((s, o) => s + o.totalInBase, 0);

  return (
    <div className="space-y-3">
      {/* Header — h2 + counter + ≈ total + primary action */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_assets")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {filteredTree.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {formatBase(grandTotal, baseCurrency)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNonZeroPersist(!nonZeroOnly)}
            className={`h-9 px-3 rounded-button text-body-sm font-semibold transition-all whitespace-nowrap ${
              nonZeroOnly
                ? "bg-ink text-white"
                : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
            }`}
            title="Скрыть нулевые балансы"
          >
            Ненулевые
          </button>
          <button
            type="button"
            onClick={() => doExportAssets(filteredTree, baseCurrency, findOffice, t)}
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
          {filteredTree.map((office) => {
            const officeKey = `office:${office.officeId || "none"}`;
            const officeOpen = expanded.has(officeKey);
            const officeName = office.officeId
              ? (findOffice(office.officeId)?.name || office.officeId)
              : t("trv2_assets_no_office");
            return (
              <div key={officeKey} className="border-t border-border-soft first:border-t-0">
                {/* Level 1 — office */}
                <button
                  type="button"
                  className="w-full grid grid-cols-[16px_1fr_auto] items-center gap-3 px-card py-2.5 hover:bg-surface-soft transition-colors text-left bg-surface-soft/40"
                  onClick={() => toggle(officeKey)}
                >
                  {officeOpen
                    ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                  <span className="text-h3 text-ink font-semibold truncate">{officeName}</span>
                  <span className="text-body-sm font-mono tabular font-bold text-ink">
                    {formatBase(office.totalInBase, baseCurrency)}
                  </span>
                </button>

                {officeOpen && office.currencies.map((cur) => {
                  const curKey = `${officeKey}|cur:${cur.currency}`;
                  const curOpen = expanded.has(curKey);
                  const isBase = cur.currency === baseCurrency;
                  return (
                    <div key={curKey}>
                      {/* Level 2 — currency */}
                      <button
                        type="button"
                        className="w-full grid grid-cols-[16px_18px_1fr_auto] items-center gap-2 pl-9 pr-card py-2 hover:bg-surface-soft transition-colors text-left border-t border-border-soft"
                        onClick={() => toggle(curKey)}
                      >
                        {curOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                          : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
                        <CurrencyIcon ccy={cur.currency} size="sm" />
                        <span className="text-caption font-semibold text-ink-soft tracking-wider">
                          {cur.currency}
                        </span>
                        <div className="text-right shrink-0 flex items-baseline gap-2">
                          <span className="text-body-sm font-mono tabular font-semibold text-ink">
                            {nativeFmt(cur.total, cur.currency)}
                          </span>
                          {!isBase && (
                            <span className="text-tiny text-muted-soft font-mono tabular">
                              (≈ {formatBase(cur.totalInBase, baseCurrency)})
                            </span>
                          )}
                        </div>
                      </button>

                      {curOpen && cur.accounts.map((a) => {
                        const accKey = `${curKey}|acc:${a.accountId}`;
                        const accOpen = expanded.has(accKey);
                        return (
                          <React.Fragment key={accKey}>
                            {/* Level 3 — leaf account */}
                            <div
                              className="grid grid-cols-[16px_48px_1fr_auto] items-center gap-2 pl-16 pr-card py-1.5 hover:bg-surface-soft transition-colors border-t border-border-soft cursor-pointer"
                              onClick={() => toggle(accKey)}
                            >
                              {accOpen
                                ? <ChevronDown className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                : <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />}
                              <span className="font-mono text-tiny text-muted-soft">{a.code}</span>
                              <span className="text-body-sm text-ink truncate">{a.name}</span>
                              <span
                                className="text-body-sm font-mono tabular text-ink-soft"
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
                                  suffix={a.currency}
                                />
                              </span>
                            </div>
                            {accOpen && <AccountInlineEntries ctx={ctx} accountId={a.accountId} onOpenTx={onOpenTx} />}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
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

// Один row на каждый leaf account (office × currency × account). Балансы
// в native + base. Polezno бухгалтеру для сверки.
function doExportAssets(tree, baseCurrency, findOffice, t) {
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
    { key: "balanceInBase", label: `balance_${baseCurrency.toLowerCase()}` },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `assets_${stamp}.csv`, columns: cols, rows });
}
