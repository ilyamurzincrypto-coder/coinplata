// src/pages/treasury_v2/parts/AccountDetailModal.jsx
// Детальный модал по счёту ИЛИ контрагенту.
//
// Режимы:
//  • account — один account (Активы/Капитал лист)
//  • account+dim — один account отфильтрованный по client/partner (лист Пассивов)
//  • counterparty — все liability-счета этого CP агрегированно, мульти-валютные KPI,
//    вкладки на валюту (клик по контрагенту в Пассивах)
//
// Props:
//   open, onClose, ctx, formatBase, baseCurrency, onOpenTx
//   accountId?           — если задан, режим account (опционально + dim)
//   clientId? partnerId? — dim или (без accountId) — CP-mode

import React, { useMemo, useState } from "react";
import { Search, Calendar } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import {
  accountEntries, counterpartyEntries, liabilitiesByCounterparty,
  accountGroupContext, groupEntries, SUBTYPE_LABEL_KEYS,
} from "../../../lib/treasury/v2selectors.js";
import InlineBalanceEditor from "./InlineBalanceEditor.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const TYPE_LABEL = {
  asset: "trv2_acctype_asset",
  liability: "trv2_acctype_liability",
  equity: "trv2_acctype_equity",
  revenue: "trv2_acctype_revenue",
  expense: "trv2_acctype_expense",
};
const CREDIT_NORMAL = new Set(["liability", "equity", "revenue"]);

const PRESETS = [
  { key: "today", labelKey: "trv2_period_today", days: 0 },
  { key: "week", labelKey: "trv2_period_week", days: 7 },
  { key: "month", labelKey: "trv2_period_month", days: 30 },
  { key: "quarter", labelKey: "trv2_period_quarter", days: 90 },
  { key: "year", labelKey: "trv2_period_year", days: 365 },
  { key: "all", labelKey: "trv2_period_all", days: null },
];

function presetToPeriod(preset) {
  if (preset === "all") return null;
  const to = new Date();
  if (preset === "today") {
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const days = PRESETS.find((p) => p.key === preset)?.days ?? 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmtAmount(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AccountDetailModal({
  open, onClose, ctx, formatBase, baseCurrency, onOpenTx,
  accountId = null, clientId = null, partnerId = null,
}) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const [preset, setPreset] = useState("month");
  const [search, setSearch] = useState("");
  const [activeCcy, setActiveCcy] = useState("__all__"); // для CP-mode

  const cpKind = clientId ? "client" : partnerId ? "partner" : null;
  const cpId = clientId || partnerId;
  const isCpMode = !accountId && !!cpId;
  const dim = cpId ? { clientId, partnerId } : null;

  // Resolve account (для account-mode/group-mode)
  const account = useMemo(() => {
    if (!accountId) return null;
    return (ctx?.accounts || []).find((a) => a.id === accountId) || null;
  }, [ctx, accountId]);

  // Group context — для asset/equity клик на лист → показываем всю кассу
  // (multi-currency). Для liability с dim — НЕ группируем (важен dim filter).
  const groupCtx = useMemo(() => {
    if (!account || isCpMode) return null;
    if (dim) return null; // liability+dim → account-mode, не group
    if (account.type !== "asset" && account.type !== "equity") return null;
    return accountGroupContext(ctx, account.id);
  }, [ctx, account, dim, isCpMode]);
  const isGroupMode = !!groupCtx && groupCtx.accounts.length > 1;

  // Resolve CP (для cp-mode)
  const cpData = useMemo(() => {
    if (!isCpMode) return null;
    const list = liabilitiesByCounterparty(ctx, cpKind);
    return list.find((g) => g.id === cpId) || null;
  }, [ctx, cpKind, cpId, isCpMode]);

  // Balance: account-mode → filter balances by accountId (+ dim если есть)
  const { balanceNative, balanceInBase } = useMemo(() => {
    if (!account) return { balanceNative: 0, balanceInBase: 0 };
    const rows = (ctx?.balances || []).filter((b) => {
      if (b.accountId !== account.id) return false;
      if (dim && dim.clientId && b.clientId !== dim.clientId) return false;
      if (dim && dim.partnerId && b.partnerId !== dim.partnerId) return false;
      return true;
    });
    let bn = 0, bb = 0;
    for (const b of rows) {
      const n = Number(b.balance) || 0;
      bn += n;
      bb += (ctx?.toBase ? ctx.toBase(n, b.currency) : n) || 0;
    }
    return { balanceNative: bn, balanceInBase: bb };
  }, [ctx, account, dim]);

  const period = useMemo(() => presetToPeriod(preset), [preset]);

  // Entries:
  //   CP mode    → counterpartyEntries (+ccy filter)
  //   Group mode → groupEntries для всех sibling accountIds (+ccy filter)
  //   Account    → accountEntries (+optional dim)
  const entries = useMemo(() => {
    if (isCpMode && cpKind && cpId) {
      const ccy = activeCcy === "__all__" ? null : activeCcy;
      return counterpartyEntries(ctx, cpKind, cpId, 500, period, ccy);
    }
    if (isGroupMode && groupCtx) {
      const ccy = activeCcy === "__all__" ? null : activeCcy;
      const ids = groupCtx.accounts.map((a) => a.accountId);
      return groupEntries(ctx, ids, 500, period, ccy);
    }
    if (account) {
      return accountEntries(ctx, account.id, 500, period, dim);
    }
    return [];
  }, [ctx, account, dim, period, isCpMode, cpKind, cpId, isGroupMode, groupCtx, activeCcy]);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    const cpName = (id) => {
      if (!id || !ctx?.counterpartyName) return "";
      try { return ctx.counterpartyName(id) || ""; } catch { return ""; }
    };
    return entries.filter((e) => {
      const hay = [
        e.note, e.txKind, e.sourceRefId, e.txId,
        e.currency, String(e.amount),
        e.accountCode, e.accountName,
        cpName(e.clientId), cpName(e.partnerId),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search, ctx]);

  // Turnover за период (по видимым после фильтра)
  const turnover = useMemo(() => {
    let dr = 0, cr = 0;
    for (const e of filteredEntries) {
      const amt = Number(e.amount) || 0;
      if (e.direction === "dr") dr += amt;
      else cr += amt;
    }
    const refType = account?.type || "liability"; // CP-mode = liability
    const incCr = CREDIT_NORMAL.has(refType);
    const delta = incCr ? cr - dr : dr - cr;
    return { dr, cr, delta };
  }, [filteredEntries, account]);

  if (!open) return null;
  if (!isCpMode && !account) return null;
  if (isCpMode && !cpData) return null;

  // === Header ===
  let titleNode;
  if (isCpMode) {
    titleNode = (
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-accent-bg text-accent flex items-center justify-center font-bold text-body-sm">
          {(cpData.name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[17px] font-bold tracking-tight text-ink">{cpData.name}</span>
            {cpData.isReferral && (
              <span className="text-tiny font-semibold text-success uppercase tracking-wider">реферал</span>
            )}
          </div>
          <div className="text-caption text-muted mt-0.5">
            {cpKind === "client" ? t("trv2_cp_kind_client") : t("trv2_cp_kind_partner")}
            {cpData.telegram ? ` · ${cpData.telegram}` : ""}
            {cpData.tag ? ` · ${cpData.tag}` : ""}
          </div>
        </div>
      </div>
    );
  } else {
    const officeName = account.officeId ? (findOffice(account.officeId)?.name || account.officeId) : null;
    const subtypeLabel = account.subtype ? t(SUBTYPE_LABEL_KEYS[account.subtype] || "trv2_subtype_other") : null;
    const typeLabel = t(TYPE_LABEL[account.type] || "trv2_acctype_asset");
    const cpName = dim && ctx?.counterpartyName ? (() => {
      try { return ctx.counterpartyName(cpId); } catch { return null; }
    })() : null;
    // В group-mode заголовок — название кассы (без " · CCY") + список валют
    if (isGroupMode) {
      titleNode = (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent-bg text-accent flex items-center justify-center font-bold text-body-sm">
            {(groupCtx.kassaName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[17px] font-bold tracking-tight text-ink">{groupCtx.kassaName}</span>
              <span className="text-tiny font-mono tabular text-muted-soft">{groupCtx.accounts.length} валют</span>
            </div>
            <div className="text-caption text-muted mt-0.5">
              {typeLabel}
              {subtypeLabel ? ` · ${subtypeLabel}` : ""}
              {officeName ? ` · ${officeName}` : ""}
            </div>
          </div>
        </div>
      );
    } else {
      titleNode = (
        <div className="flex items-center gap-3">
          <CurrencyIcon ccy={account.currency} size="md" />
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-tiny text-muted-soft">{account.code}</span>
              <span className="text-[17px] font-bold tracking-tight text-ink">
                {cpName ? `${cpName}` : account.name}
              </span>
              {cpName && <span className="text-caption text-muted">· {account.name}</span>}
            </div>
            <div className="text-caption text-muted mt-0.5">
              {typeLabel}
              {subtypeLabel ? ` · ${subtypeLabel}` : ""}
              {officeName ? ` · ${officeName}` : ""}
            </div>
          </div>
        </div>
      );
    }
  }

  // === Balance block ===
  let balanceNode;
  if (isCpMode) {
    // Multi-currency KPI grid
    balanceNode = (
      <div>
        <div className="text-tiny text-muted uppercase tracking-wider font-semibold mb-2">
          {t("trv2_detail_balance")} · {t("trv2_detail_total")}: <span className="font-mono tabular text-ink">{formatBase(cpData.totalInBase, baseCurrency)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {cpData.byCurrency.map((c) => (
            <div key={c.currency} className="bg-surface rounded-card p-2.5 border border-border-soft">
              <div className="flex items-center gap-1.5 mb-1">
                <CurrencyIcon ccy={c.currency} size="sm" />
                <span className="text-caption font-bold text-ink-soft tracking-wider">{c.currency}</span>
              </div>
              <div className="font-mono tabular text-body font-bold text-ink">{fmtAmount(c.balance)}</div>
              <div className="font-mono tabular text-tiny text-muted-soft mt-0.5">
                ≈ {formatBase(c.balanceInBase, baseCurrency)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (isGroupMode) {
    // Multi-currency KPI per sibling account — каждая ячейка кликабельна для inline-edit
    balanceNode = (
      <div>
        <div className="text-tiny text-muted uppercase tracking-wider font-semibold mb-2">
          {t("trv2_detail_balance")} · {t("trv2_detail_total")}: <span className="font-mono tabular text-ink">{formatBase(groupCtx.totalInBase, baseCurrency)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {groupCtx.accounts.map((a) => {
            const isBase = a.currency === baseCurrency;
            return (
              <div key={a.accountId} className="bg-surface rounded-card p-2.5 border border-border-soft">
                <div className="flex items-center gap-1.5 mb-1">
                  <CurrencyIcon ccy={a.currency} size="sm" />
                  <span className="text-caption font-bold text-ink-soft tracking-wider">{a.currency}</span>
                  <span className="text-tiny text-muted-soft font-mono ml-auto">{a.code}</span>
                </div>
                <div className="font-mono tabular text-body font-bold text-ink" onClick={(e) => e.stopPropagation()}>
                  <InlineBalanceEditor
                    account={{
                      code: a.code, currency: a.currency,
                      type: groupCtx.type, subtype: groupCtx.subtype,
                      balance: a.balance,
                    }}
                    displayMul={1}
                    accounts={ctx?.accounts || []}
                    suffix={a.currency}
                    balanceOverride={a.balance}
                  />
                </div>
                {!isBase && (
                  <div className="font-mono tabular text-tiny text-muted-soft mt-0.5">
                    ≈ {formatBase(a.balanceInBase, baseCurrency)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  } else {
    const isBaseCcy = account.currency === baseCurrency;
    balanceNode = (
      <div>
        <div className="text-tiny text-muted uppercase tracking-wider font-semibold mb-2">
          {t("trv2_detail_balance")}
        </div>
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="text-[26px] font-bold font-mono tabular text-ink">
            {fmtAmount(balanceNative)} <span className="text-body-sm text-muted ml-1">{account.currency}</span>
          </span>
          {!isBaseCcy && (
            <span className="text-body text-muted-soft font-mono tabular">
              ≈ {formatBase(balanceInBase, baseCurrency)}
            </span>
          )}
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <InlineBalanceEditor
              account={{
                code: account.code,
                currency: account.currency,
                type: account.type,
                subtype: account.subtype,
                balance: balanceNative,
              }}
              displayMul={1}
              accounts={ctx?.accounts || []}
              suffix={account.currency}
              clientId={clientId}
              partnerId={partnerId}
              balanceOverride={balanceNative}
            />
          </span>
        </div>
      </div>
    );
  }

  // Currency tabs (CP-mode и group-mode — multi-currency views)
  const tabCurrencies = isCpMode
    ? cpData.byCurrency.map((c) => c.currency)
    : isGroupMode
      ? groupCtx.currencies
      : null;
  const currencyTabs = tabCurrencies ? (
    <div className="px-5 py-2 border-b border-border-soft flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => setActiveCcy("__all__")}
        className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors ${
          activeCcy === "__all__" ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
        }`}
      >
        {t("trv2_detail_ccy_all")}
      </button>
      {tabCurrencies.map((ccy) => (
        <button
          key={ccy}
          type="button"
          onClick={() => setActiveCcy(ccy)}
          className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors inline-flex items-center gap-1.5 ${
            activeCcy === ccy ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
          }`}
        >
          <CurrencyIcon ccy={ccy} size="sm" />
          {ccy}
        </button>
      ))}
    </div>
  ) : null;

  // Дт/Кт display for an entry — visible на «прирост» зеленым.
  const refType = isCpMode ? "liability" : (account?.type || "asset");
  const incCr = CREDIT_NORMAL.has(refType);
  const ccyLabel = (isCpMode || isGroupMode)
    ? (activeCcy === "__all__" ? "" : activeCcy)
    : account.currency;

  return (
    <Modal open={open} onClose={onClose} width="4xl">
      <div className="px-5 py-4 border-b border-border-soft flex items-start justify-between gap-3">
        <div>{titleNode}</div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-button hover:bg-surface-sunk text-muted hover:text-ink transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Balance block */}
      <div className="px-5 py-4 border-b border-border-soft bg-surface-soft/40">
        {balanceNode}
      </div>

      {currencyTabs}

      {/* Period filter */}
      <div className="px-5 py-3 border-b border-border-soft flex items-center gap-2 flex-wrap">
        <Calendar className="w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
        <span className="text-caption text-muted font-semibold mr-1">{t("trv2_detail_period")}:</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`h-7 px-2.5 rounded-button text-caption font-semibold transition-colors ${
              preset === p.key ? "bg-ink text-white" : "bg-surface-sunk text-ink-soft hover:bg-surface-soft"
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-5 py-2 border-b border-border-soft">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-soft" strokeWidth={2.2} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("trv2_detail_search_ph")}
            className="w-full h-8 pl-8 pr-3 text-body-sm bg-surface-sunk rounded-button border border-transparent focus:border-border focus:bg-surface focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Entries table */}
      <div className="max-h-[420px] overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="px-5 py-10 text-center text-caption text-muted">
            {t("trv2_no_entries")}
          </div>
        ) : (
          <table className="w-full text-caption">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b border-border-soft">
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 w-24">{t("trv2_detail_col_date")}</th>
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2">{t("trv2_detail_col_descr")}</th>
                <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 w-28">{t("trv2_col_dr")}</th>
                <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 w-28">{t("trv2_col_cr")}</th>
                <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-2 w-24">{t("trv2_detail_col_doc")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((e) => {
                const isDr = e.direction === "dr";
                const grows = isDr === !incCr;
                const amtStr = `${fmtAmount(e.amount)} ${e.currency}`;
                const cpFromEntry = e.clientId || e.partnerId || null;
                const cpEntryName = (cpFromEntry && ctx?.counterpartyName) ? (() => {
                  try { return ctx.counterpartyName(cpFromEntry); } catch { return null; }
                })() : null;
                return (
                  <tr key={e.id} className="border-b border-border-soft hover:bg-surface-soft transition-colors">
                    <td className="px-3 py-1.5 text-muted font-mono tabular">
                      {new Date(e.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-body-sm text-ink truncate">{e.note || e.txKind}</div>
                      <div className="text-tiny text-muted-soft truncate">
                        {e.accountCode ? `${e.accountCode} · ${e.accountName || ""}` : ""}
                        {cpEntryName ? (e.accountCode ? ` · ${cpEntryName}` : cpEntryName) : ""}
                      </div>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular ${isDr ? (grows ? "text-success font-bold" : "text-danger font-semibold") : "text-muted-soft"}`}>
                      {isDr ? amtStr : "—"}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular ${!isDr ? (grows ? "text-success font-bold" : "text-danger font-semibold") : "text-muted-soft"}`}>
                      {!isDr ? amtStr : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenTx?.(e.txId)}
                        className="text-accent hover:text-accent-hover transition-colors font-mono text-tiny"
                      >
                        {e.sourceRefId || e.txId.slice(0, 8)} →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Turnover footer */}
      <div className="px-5 py-3 border-t border-border-soft bg-surface-sunk flex items-center justify-between gap-4 flex-wrap text-caption">
        <span className="text-muted">
          {t("trv2_detail_entries_count")}: <span className="font-bold text-ink font-mono tabular">{filteredEntries.length}</span>
        </span>
        <div className="flex items-center gap-4 font-mono tabular">
          <span className="text-muted-soft">{t("trv2_col_dr")}: <span className="text-ink font-bold">{fmtAmount(turnover.dr)} {ccyLabel}</span></span>
          <span className="text-muted-soft">{t("trv2_col_cr")}: <span className="text-ink font-bold">{fmtAmount(turnover.cr)} {ccyLabel}</span></span>
          <span className={`font-bold ${turnover.delta >= 0 ? "text-success" : "text-danger"}`}>
            Δ: {turnover.delta >= 0 ? "+" : ""}{fmtAmount(turnover.delta)} {ccyLabel}
          </span>
        </div>
      </div>
    </Modal>
  );
}
