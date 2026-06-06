// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
// «Пассивы» — tree-table 1:1 с Активами:
//   Контрагент → Валюта → Source-account.
// Клик по строке-контрагенту → AccountDetailModal в CP-mode (мульти-валютный).
// Клик по строке-листу → AccountDetailModal account+dim mode.
// Chevron на левом краю каждого уровня — отдельный кнопка-тогл для expand.
//
// Toolbar (как было): CP-type filter, sort, nonzero, search, +Обязательство.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Plus, Download, ChevronRight, ChevronDown, Building2, Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { useRates } from "../../../store/rates.jsx";
import { exportCSV } from "../../../utils/csv.js";
import { liabilitiesByCounterparty } from "../../../lib/treasury/v2selectors.js";
import { leafLabel } from "../../../lib/treasury/leafLabel.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { convert } from "../../../utils/convert.js";
import AccountDetailModal from "../parts/AccountDetailModal.jsx";
import ChartAccountModal from "../parts/ChartAccountModal.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const NONZERO_KEY = "coinplata:liabilities-nonzero";
const DISPLAY_BASE_KEY = "coinplata:liabilities-display-base";
const BASE_OPTIONS = ["EUR", "TRY", "RUB", "USD"];

function nativeFmt(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}

function fmtIn(amount, ccy) {
  const sign = (Number(amount) || 0) < 0 ? "-" : "";
  return `${sign}${curSymbol(ccy)}${Math.round(Math.abs(Number(amount) || 0)).toLocaleString("en-US")}`;
}

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const can = useCan();
  const { getRate } = useRates();
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [detailOpen, setDetailOpen] = useState(null);

  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => { setNonZeroOnly(v); try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {} };

  // Поиск по имени контрагента, debounced 150ms — не пересчитываем на каждый keystroke.
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  // ≈USD-колонка фикс, вторая ≈-колонка — пикер (default EUR).
  const [displayBase, setDisplayBase] = useState(() => {
    try {
      const v = localStorage.getItem(DISPLAY_BASE_KEY);
      return BASE_OPTIONS.includes(v) ? v : "EUR";
    } catch { return "EUR"; }
  });
  const setDisplayBasePersist = (v) => { setDisplayBase(v); try { localStorage.setItem(DISPLAY_BASE_KEY, v); } catch {} };
  const usdCtx = useMemo(() => (
    { ...ctx, baseCurrency: "USD", toBase: (amt, ccy) => convert(Number(amt) || 0, ccy, "USD", getRate) || 0 }
  ), [ctx, getRate]);
  const toAlt = useMemo(() => (amt, ccy) => convert(Number(amt) || 0, ccy, displayBase, getRate) || 0, [getRate, displayBase]);

  // Селектор ВСЕГДА возвращает полный список CP (includeZero=true) — фильтрация
  // «Ненулевые» применяется ниже к visibleGroups. Так UI всегда видит сколько
  // всего контрагентов есть в системе и может предложить сбросить фильтр.
  const clientGroups = useMemo(() => liabilitiesByCounterparty(usdCtx, "client", { includeZero: true }), [usdCtx]);
  const partnerGroups = useMemo(() => liabilitiesByCounterparty(usdCtx, "partner", { includeZero: true }), [usdCtx]);

  // Реферал сверху → потом |totalInBase| desc; все типы CP вместе (как Активы — все офисы вместе).
  const visibleGroups = useMemo(() => {
    let list = [...clientGroups, ...partnerGroups];
    if (nonZeroOnly) list = list.filter((g) => Math.abs(g.totalInBase) > 0.005);
    if (search) {
      list = list.filter((g) => {
        const hay = [g.name, g.telegram, g.tag, g.full_name].filter(Boolean).map((s) => String(s).toLowerCase());
        return hay.some((s) => s.includes(search));
      });
    }
    list.sort((a, b) => {
      if (a.isReferral !== b.isReferral) return a.isReferral ? -1 : 1;
      return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
    });
    return list;
  }, [clientGroups, partnerGroups, nonZeroOnly, search]);

  const grandTotalUsd = useMemo(
    () => visibleGroups.reduce((s, g) => s + g.totalInBase, 0),
    [visibleGroups]
  );
  const grandTotalAlt = useMemo(
    () => visibleGroups.reduce(
      (s, g) => s + g.byCurrency.reduce((s2, cur) => s2 + toAlt(cur.balance, cur.currency), 0),
      0
    ),
    [visibleGroups, toAlt]
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
            ≈ {fmtIn(grandTotalUsd, "USD")} · {fmtIn(grandTotalAlt, displayBase)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft pointer-events-none" strokeWidth={2.2} />
            <input
              type="text"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Поиск по клиенту"
              className="h-9 pl-8 pr-3 w-[220px] rounded-button bg-surface-sunk text-ink text-body-sm placeholder:text-muted-soft border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
            />
          </div>
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
            onClick={() => doExport(visibleGroups, toAlt, displayBase, (amt, ccy) => convert(Number(amt) || 0, ccy, "USD", getRate) || 0)}
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
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black hover:-translate-y-px shadow-cta-glow transition-all"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              {t("trv2_chart_add_btn")}
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
            <div className="text-body font-semibold text-ink mb-2">
              {nonZeroOnly
                ? "Нет контрагентов с ненулевым обязательством"
                : t("trv2_no_accounts")}
            </div>
            {nonZeroOnly && (clientGroups.length + partnerGroups.length) > 0 && (
              <div className="space-y-2">
                <div className="text-caption text-muted-soft">
                  Всего в системе: {clientGroups.length} клиентов, {partnerGroups.length} партнёров — но у всех баланс 0.
                </div>
                <button
                  type="button"
                  onClick={() => setNonZeroPersist(false)}
                  className="h-9 px-4 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black transition-colors"
                >
                  Показать всех контрагентов
                </button>
              </div>
            )}
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
                  Контрагент
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
              {visibleGroups.map((cp) => {
                const cpKey = `cp:${cp.kind}:${cp.id}`;
                const cpOpen = expanded.has(cpKey);
                const cpAlt = cp.byCurrency.reduce((s, c) => s + toAlt(c.balance, c.currency), 0);
                return (
                  <React.Fragment key={cpKey}>
                    {/* Level 1 — counterparty: click anywhere on row → CP-modal
                        (даже когда баланс 0). Chevron-кнопка слева — отдельный
                        toggle для expand (рисуется только если есть валюты). */}
                    <tr
                      className="border-t border-border-soft hover:bg-surface-soft cursor-pointer bg-surface-soft/40 transition-colors"
                      onClick={() => openCp(cp)}
                      title="Открыть карточку контрагента"
                    >
                      <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="px-card py-2.5 border-r border-border-soft">
                        <div className="flex items-center gap-2">
                          {cp.byCurrency.length > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggle(cpKey); }}
                              className="p-0.5 -m-0.5 rounded hover:bg-surface-sunk transition-colors"
                              title={cpOpen ? "Свернуть" : "Развернуть валюты"}
                            >
                              {cpOpen
                                ? <ChevronDown className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />
                                : <ChevronRight className="w-3.5 h-3.5 text-muted" strokeWidth={2.2} />}
                            </button>
                          ) : (
                            <span className="w-3.5 h-3.5 inline-block" aria-hidden />
                          )}
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
                      <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                      <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap border-r border-border-soft ${
                        cp.totalInBase < 0 ? "text-danger" : "text-ink"
                      }`}>
                        {fmtIn(cp.totalInBase, "USD")}
                      </td>
                      <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap ${
                        cpAlt < 0 ? "text-danger" : "text-ink"
                      }`}>
                        {fmtIn(cpAlt, displayBase)}
                      </td>
                    </tr>

                    {cpOpen && cp.byCurrency.map((cur) => {
                      const curKey = `${cpKey}|cur:${cur.currency}`;
                      const curExpanded = expanded.has(curKey);
                      const isBase = cur.currency === baseCurrency;
                      // Если у этого CP в валюте один source-аккаунт — мерж в одну строку.
                      if ((cur.sourceAccounts || []).length === 1) {
                        const a = cur.sourceAccounts[0];
                        const accUsd = convert(Number(a.balance) || 0, cur.currency, "USD", getRate) || 0;
                        const accAlt = toAlt(a.balance, cur.currency);
                        return (
                          <tr
                            key={curKey}
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => openLeaf(cp, a.accountId)}
                            title="Открыть детали счёта"
                          >
                            <td className="px-card py-2 font-mono text-body-sm text-ink-soft border-r border-border-soft whitespace-nowrap">{a.code}</td>
                            <td className="pl-9 pr-card py-2 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                <ChevronRight className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
                                <CurrencyIcon ccy={cur.currency} size="sm" />
                                <span className="text-body-sm text-ink truncate">{leafLabel({ ...a, currency: cur.currency }, t)}</span>
                              </div>
                            </td>
                            <td className="px-card py-2 text-body-sm text-ink-soft tracking-wider border-r border-border-soft">{cur.currency}</td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm font-semibold whitespace-nowrap border-r border-border-soft ${
                              a.balance < 0 ? "text-danger" : "text-ink"
                            }`}>
                              {nativeFmt(a.balance, cur.currency)}
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm whitespace-nowrap border-r border-border-soft ${
                              accUsd < 0 ? "text-danger" : "text-ink-soft"
                            }`}>
                              {fmtIn(accUsd, "USD")}
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm whitespace-nowrap ${
                              accAlt < 0 ? "text-danger" : "text-ink-soft"
                            }`}>
                              {fmtIn(accAlt, displayBase)}
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <React.Fragment key={curKey}>
                          {/* Level 2 — currency: click row → expand source accounts */}
                          <tr
                            className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                            onClick={() => toggle(curKey)}
                          >
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
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
                            <td className="px-card py-2 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm font-semibold whitespace-nowrap border-r border-border-soft ${
                              cur.balance < 0 ? "text-danger" : "text-ink"
                            }`}>
                              {nativeFmt(cur.balance, cur.currency)}
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm whitespace-nowrap border-r border-border-soft ${
                              cur.balanceInBase < 0 ? "text-danger" : "text-ink-soft"
                            }`}>
                              {fmtIn(cur.balanceInBase, "USD")}
                            </td>
                            <td className={`text-right px-card py-2 font-mono tabular text-body-sm whitespace-nowrap ${
                              toAlt(cur.balance, cur.currency) < 0 ? "text-danger" : "text-ink-soft"
                            }`}>
                              {fmtIn(toAlt(cur.balance, cur.currency), displayBase)}
                            </td>
                          </tr>

                          {curExpanded && cur.sourceAccounts.map((a) => {
                            const accKey = `${curKey}|acc:${a.accountId}`;
                            const accUsd = convert(Number(a.balance) || 0, cur.currency, "USD", getRate) || 0;
                            const accAlt = toAlt(a.balance, cur.currency);
                            return (
                              <tr
                                key={accKey}
                                className="border-t border-border-soft hover:bg-surface-soft cursor-pointer transition-colors"
                                onClick={() => openLeaf(cp, a.accountId)}
                                title="Открыть детали счёта"
                              >
                                <td className="px-card py-1.5 font-mono text-body-sm text-ink-soft border-r border-border-soft whitespace-nowrap">{a.code}</td>
                                <td className="pl-16 pr-card py-1.5 border-r border-border-soft">
                                  <div className="flex items-center gap-2">
                                    <ChevronRight className="w-3 h-3 text-muted-soft" strokeWidth={2.2} />
                                    <span className="text-body-sm text-ink truncate">{leafLabel({ ...a, currency: cur.currency }, t)}</span>
                                  </div>
                                </td>
                                <td className="px-card py-1.5 text-body-sm text-ink-soft tracking-wider border-r border-border-soft">{cur.currency}</td>
                                <td className={`text-right px-card py-1.5 font-mono tabular text-body-sm whitespace-nowrap border-r border-border-soft ${
                                  a.balance < 0 ? "text-danger" : "text-ink-soft"
                                }`}>
                                  {nativeFmt(a.balance, cur.currency)}
                                </td>
                                <td className={`text-right px-card py-1.5 font-mono tabular text-body-sm whitespace-nowrap border-r border-border-soft ${
                                  accUsd < 0 ? "text-danger" : "text-ink-soft"
                                }`}>
                                  {fmtIn(accUsd, "USD")}
                                </td>
                                <td className={`text-right px-card py-1.5 font-mono tabular text-body-sm whitespace-nowrap ${
                                  accAlt < 0 ? "text-danger" : "text-ink-soft"
                                }`}>
                                  {fmtIn(accAlt, displayBase)}
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
                  ИТОГО
                </td>
                <td className="px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className="text-right px-card py-2.5 border-r border-border-soft"><span className="text-tiny text-muted-soft">—</span></td>
                <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap border-r border-border-soft ${
                  grandTotalUsd < 0 ? "text-danger" : "text-ink"
                }`}>
                  {fmtIn(grandTotalUsd, "USD")}
                </td>
                <td className={`text-right px-card py-2.5 font-mono tabular font-bold text-body-sm whitespace-nowrap ${
                  grandTotalAlt < 0 ? "text-danger" : "text-ink"
                }`}>
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
          defaultType="liability"
          lockType
        />
      )}

      <AccountDetailModal
        open={!!detailOpen}
        onClose={() => setDetailOpen(null)}
        ctx={ctx}
        accountId={detailOpen?.accountId || null}
        clientId={detailOpen?.clientId || null}
        partnerId={detailOpen?.partnerId || null}
        formatBase={(amt) => fmtIn(amt, "USD")}
        baseCurrency="USD"
        onOpenTx={onOpenTx}
      />
    </div>
  );
}

function doExport(groups, toAlt, altCurrency, toUsd) {
  const rows = [];
  for (const cp of groups) {
    for (const cur of cp.byCurrency) {
      if (!cur.sourceAccounts || cur.sourceAccounts.length === 0) {
        rows.push({
          kind: cp.kind, name: cp.name, telegram: cp.telegram || "",
          isReferral: cp.isReferral ? "true" : "false",
          currency: cur.currency, balance: cur.balance,
          balanceInUsd: cur.balanceInBase,
          balanceInAlt: toAlt(cur.balance, cur.currency),
          accountCode: "", accountName: "",
        });
        continue;
      }
      for (const acc of cur.sourceAccounts) {
        rows.push({
          kind: cp.kind, name: cp.name, telegram: cp.telegram || "",
          isReferral: cp.isReferral ? "true" : "false",
          currency: cur.currency, balance: acc.balance,
          balanceInUsd: toUsd(acc.balance, cur.currency),
          balanceInAlt: toAlt(acc.balance, cur.currency),
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
    { key: "balanceInUsd", label: "balance_usd" },
    { key: "balanceInAlt", label: `balance_${altCurrency.toLowerCase()}` },
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  exportCSV({ filename: `liabilities_${stamp}.csv`, columns: cols, rows });
}
