// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
// «Пассивы» — tree-table 1:1 с Активами:
//   Контрагент → Валюта → Source-account.
// Клик по строке-контрагенту → AccountDetailModal в CP-mode (мульти-валютный).
// Клик по строке-листу → AccountDetailModal account+dim mode.
// Chevron на левом краю каждого уровня — отдельный кнопка-тогл для expand.
//
// Toolbar (как было): CP-type filter, sort, nonzero, search, +Обязательство.

import React, { useState, useMemo, useCallback } from "react";
import { Plus, Download, ChevronRight, ChevronDown, Building2 } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useRates } from "../../../store/rates.jsx";
import { exportCSV } from "../../../utils/csv.js";
import { liabilitiesByCounterparty } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { convert } from "../../../utils/convert.js";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";
import CreateLiabilityDialog from "../parts/CreateLiabilityDialog.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const NONZERO_KEY = "coinplata:liabilities-nonzero";
const DISPLAY_BASE_KEY = "coinplata:liabilities-display-base";
const BASE_OPTIONS = ["USD", "EUR", "TRY", "RUB"];

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { getRate } = useRates();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [detailOpen, setDetailOpen] = useState(null);

  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => { setNonZeroOnly(v); try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {} };

  const [displayBase, setDisplayBase] = useState(() => {
    try {
      const v = localStorage.getItem(DISPLAY_BASE_KEY);
      return BASE_OPTIONS.includes(v) ? v : (baseCurrency || "USD");
    } catch { return baseCurrency || "USD"; }
  });
  const setDisplayBasePersist = (v) => { setDisplayBase(v); try { localStorage.setItem(DISPLAY_BASE_KEY, v); } catch {} };

  const localCtx = useMemo(() => {
    if (displayBase === ctx?.baseCurrency) return ctx;
    return { ...ctx, baseCurrency: displayBase, toBase: (amt, ccy) => convert(Number(amt) || 0, ccy, displayBase, getRate) || 0 };
  }, [ctx, displayBase, getRate]);
  const fmtBase = useMemo(() => (amt) => `${curSymbol(displayBase)}${Math.round(Number(amt) || 0).toLocaleString("en-US")}`, [displayBase]);

  const clientGroups = useMemo(() => liabilitiesByCounterparty(localCtx, "client"), [localCtx]);
  const partnerGroups = useMemo(() => liabilitiesByCounterparty(localCtx, "partner"), [localCtx]);

  // Реферал сверху → потом |totalInBase| desc; все типы CP вместе (как Активы — все офисы вместе).
  const visibleGroups = useMemo(() => {
    let list = [...clientGroups, ...partnerGroups];
    if (nonZeroOnly) list = list.filter((g) => Math.abs(g.totalInBase) > 0.005);
    list.sort((a, b) => {
      if (a.isReferral !== b.isReferral) return a.isReferral ? -1 : 1;
      return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
    });
    return list;
  }, [clientGroups, partnerGroups, nonZeroOnly]);

  const grandTotalInBase = useMemo(
    () => visibleGroups.reduce((s, g) => s + g.totalInBase, 0),
    [visibleGroups]
  );

  const toggle = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const openCp = (cp) => setDetailOpen(
    cp.kind === "client" ? { clientId: cp.id } : { partnerId: cp.id }
  );

  const openLeaf = (cp, accountId) => setDetailOpen({
    accountId,
    clientId: cp.kind === "client" ? cp.id : null,
    partnerId: cp.kind === "partner" ? cp.id : null,
  });

  return (
    <div className="space-y-3">
      {/* Header — 1:1 со структурой шапки в AssetsTab */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-h2 text-ink flex items-center gap-2">
          {t("trv2_tab_liabilities")}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 bg-surface-sunk text-muted text-caption font-semibold rounded-md font-mono tabular">
            {visibleGroups.length}
          </span>
          <span className="text-caption text-muted font-normal ml-1 font-mono tabular">
            ≈ {fmtBase(grandTotalInBase)}
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
            onClick={() => doExport(visibleGroups, displayBase)}
            disabled={visibleGroups.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-button bg-surface-sunk text-ink-soft text-body-sm font-semibold hover:bg-surface-soft transition-colors disabled:opacity-40"
            title="Экспорт всех видимых контрагентов в CSV"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={2.5} />
            CSV
          </button>
          {can("accounting", "edit") && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black hover:-translate-y-px shadow-cta-glow transition-all"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              Обязательство
            </button>
          )}
        </div>
      </div>

      {visibleGroups.length === 0 ? (
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
              <col className="w-[240px]" />
              <col className="w-[160px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b-2 border-border-soft">
                <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2.5 border-r border-border-soft">
                  Контрагент
                </th>
                <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2.5 whitespace-nowrap border-r border-border-soft">
                  Native
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
              {visibleGroups.map((cp) => {
                const cpKey = `cp:${cp.kind}:${cp.id}`;
                const cpOpen = expanded.has(cpKey);
                return (
                  <React.Fragment key={cpKey}>
                    {/* Level 1 — counterparty: click row → open CP modal; chevron → expand */}
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => openCp(cp)}
                      title="Открыть карточку контрагента"
                    >
                      <td className="px-card py-2.5 border-r border-border-soft">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggle(cpKey); }}
                            className="p-0.5 -m-0.5 rounded hover:bg-surface-sunk transition-colors"
                            title={cpOpen ? "Свернуть" : "Развернуть"}
                          >
                            {cpOpen
                              ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                              : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                          </button>
                          <span className="text-h3 text-ink font-semibold truncate">{cp.name}</span>
                          {cp.isReferral && (
                            <span className="text-tiny font-semibold text-success uppercase tracking-wider shrink-0">реф</span>
                          )}
                          <span className="text-tiny text-muted-soft truncate">
                            {cp.kind === "client" ? "клиент" : "партнёр"}
                            {cp.telegram ? ` · ${cp.telegram}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="text-right px-card py-2.5 border-r border-border-soft">
                        <span className="text-tiny text-muted-soft">—</span>
                      </td>
                      <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap ${
                        cp.totalInBase < 0 ? "text-danger" : "text-ink"
                      }`}>
                        {fmtBase(cp.totalInBase)}
                      </td>
                    </tr>

                    {cpOpen && cp.byCurrency.map((cur) => {
                      const curKey = `${cpKey}|cur:${cur.currency}`;
                      const curExpanded = expanded.has(curKey);
                      const isBase = cur.currency === baseCurrency;
                      return (
                        <React.Fragment key={curKey}>
                          {/* Level 2 — currency: click row → expand source accounts */}
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggle(curKey)}
                          >
                            <td className="pl-9 pr-card py-2 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                {curExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                                  : <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />}
                                <CurrencyIcon ccy={cur.currency} size="sm" />
                                <span className="text-caption font-semibold text-ink-soft tracking-wider">
                                  {cur.currency}
                                </span>
                              </div>
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm font-semibold whitespace-nowrap border-r border-border-soft ${
                              cur.balance < 0 ? "text-danger" : "text-ink"
                            }`}>
                              {nativeFmt(cur.balance, cur.currency)}
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm whitespace-nowrap ${
                              cur.balanceInBase < 0 ? "text-danger" : "text-ink-soft"
                            }`}>
                              {fmtBase(cur.balanceInBase)}
                            </td>
                          </tr>

                          {curExpanded && cur.sourceAccounts.map((a) => {
                            const accKey = `${curKey}|acc:${a.accountId}`;
                            return (
                              <tr
                                key={accKey}
                                className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                                onClick={() => openLeaf(cp, a.accountId)}
                                title="Открыть детали счёта"
                              >
                                <td className="pl-16 pr-card py-1.5 border-r border-border-soft">
                                  <div className="flex items-center gap-2">
                                    <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                    <span className="font-mono text-tiny text-muted-soft">{a.code}</span>
                                    <span className="text-body-sm text-ink truncate">{a.name}</span>
                                  </div>
                                </td>
                                <td className={`text-right px-card py-1.5 font-mono tabular text-body-sm whitespace-nowrap border-r border-border-soft ${
                                  a.balance < 0 ? "text-danger" : "text-ink-soft"
                                }`}>
                                  {nativeFmt(a.balance, cur.currency)}
                                </td>
                                <td className="text-right px-card py-1.5 font-mono tabular text-body-sm text-muted-soft whitespace-nowrap">
                                  {/* per-account base — точно вычислять не строим, оставляем native */}
                                  —
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
                <td className="px-card py-2.5 text-body-sm font-bold text-ink uppercase tracking-wider border-r border-border-soft">
                  ИТОГО
                </td>
                <td className="text-right px-card py-2.5 border-r border-border-soft">
                  <span className="text-tiny text-muted-soft">—</span>
                </td>
                <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap ${
                  grandTotalInBase < 0 ? "text-danger" : "text-ink"
                }`}>
                  {fmtBase(grandTotalInBase)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <CreateLiabilityDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ctx={ctx}
        clients={ctx?.clients || []}
        partners={ctx?.partners || []}
      />

      <AccountDetailModal
        open={!!detailOpen}
        onClose={() => setDetailOpen(null)}
        ctx={ctx}
        accountId={detailOpen?.accountId || null}
        clientId={detailOpen?.clientId || null}
        partnerId={detailOpen?.partnerId || null}
        formatBase={fmtBase}
        baseCurrency={displayBase}
        onOpenTx={onOpenTx}
      />
    </div>
  );
}

function doExport(groups, baseCurrency) {
  const rows = [];
  for (const cp of groups) {
    for (const cur of cp.byCurrency) {
      if (!cur.sourceAccounts || cur.sourceAccounts.length === 0) {
        rows.push({
          kind: cp.kind, name: cp.name, telegram: cp.telegram || "",
          isReferral: cp.isReferral ? "true" : "false",
          currency: cur.currency, balance: cur.balance, balanceInBase: cur.balanceInBase,
          accountCode: "", accountName: "",
        });
        continue;
      }
      for (const acc of cur.sourceAccounts) {
        rows.push({
          kind: cp.kind, name: cp.name, telegram: cp.telegram || "",
          isReferral: cp.isReferral ? "true" : "false",
          currency: cur.currency, balance: acc.balance, balanceInBase: undefined,
          accountCode: acc.code, accountName: acc.name,
        });
      }
    }
  }
  const cols = [
    { key: "kind", label: "kind" },
    { key: "name", label: "name" },
    { key: "telegram", label: "telegram" },
    { key: "isReferral", label: "is_referral" },
    { key: "accountCode", label: "account_code" },
    { key: "accountName", label: "account_name" },
    { key: "currency", label: "currency" },
    { key: "balance", label: "balance_native" },
    { key: "balanceInBase", label: `balance_${baseCurrency.toLowerCase()}` },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `liabilities_${stamp}.csv`, columns: cols, rows });
}
