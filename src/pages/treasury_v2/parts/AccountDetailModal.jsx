// src/pages/treasury_v2/parts/AccountDetailModal.jsx
// Детальный модал по счёту (открывается из дерева Активов/Капитала).
// 1С-стиль: шапка с кодом+названием, баланс-блок с inline-edit,
// период-фильтр (пресеты), таблица проводок с Дт/Кт и оборотами за период.
//
// v1 — на один счёт (одна валюта). v2 (будущая итерация) добавит
// мульти-валютный режим для контрагентов (Пассивы).

import React, { useMemo, useState } from "react";
import { Search, Calendar } from "lucide-react";
import Modal from "../../../components/ui/Modal.jsx";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { accountEntries, SUBTYPE_LABEL_KEYS } from "../../../lib/treasury/v2selectors.js";
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

// Период: from/to ISO strings, или null для «всё время».
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

export default function AccountDetailModal({ open, onClose, ctx, accountId, formatBase, baseCurrency, onOpenTx }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const [preset, setPreset] = useState("month");
  const [search, setSearch] = useState("");

  const account = useMemo(() => {
    if (!accountId) return null;
    return (ctx?.accounts || []).find((a) => a.id === accountId) || null;
  }, [ctx, accountId]);

  // Текущий native + base баланс — Σ balances по этому accountId.
  const { balanceNative, balanceInBase } = useMemo(() => {
    if (!account) return { balanceNative: 0, balanceInBase: 0 };
    const rows = (ctx?.balances || []).filter((b) => b.accountId === account.id);
    let bn = 0, bb = 0;
    for (const b of rows) {
      const n = Number(b.balance) || 0;
      bn += n;
      bb += (ctx?.toBase ? ctx.toBase(n, b.currency) : n) || 0;
    }
    return { balanceNative: bn, balanceInBase: bb };
  }, [ctx, account]);

  const period = useMemo(() => presetToPeriod(preset), [preset]);

  const entries = useMemo(() => {
    if (!account) return [];
    // accountEntries уже фильтрует по period (effectiveDate транзакции)
    return accountEntries(ctx, account.id, 500, period);
  }, [ctx, account, period]);

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
        cpName(e.clientId), cpName(e.partnerId),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search, ctx]);

  // Обороты за период
  const turnover = useMemo(() => {
    let dr = 0, cr = 0;
    for (const e of filteredEntries) {
      const amt = Number(e.amount) || 0;
      if (e.direction === "dr") dr += amt;
      else cr += amt;
    }
    const incCr = CREDIT_NORMAL.has(account?.type);
    const delta = incCr ? cr - dr : dr - cr;
    return { dr, cr, delta };
  }, [filteredEntries, account]);

  if (!open || !account) return null;

  const officeName = account.officeId ? (findOffice(account.officeId)?.name || account.officeId) : null;
  const subtypeLabel = account.subtype ? t(SUBTYPE_LABEL_KEYS[account.subtype] || "trv2_subtype_other") : null;
  const typeLabel = t(TYPE_LABEL[account.type] || "trv2_acctype_asset");
  const isBaseCcy = account.currency === baseCurrency;
  const incCr = CREDIT_NORMAL.has(account.type);

  const titleNode = (
    <div className="flex items-center gap-3">
      <CurrencyIcon ccy={account.currency} size="md" />
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-tiny text-muted-soft">{account.code}</span>
          <span className="text-[17px] font-bold tracking-tight text-ink">{account.name}</span>
        </div>
        <div className="text-caption text-muted mt-0.5">
          {typeLabel}
          {subtypeLabel ? ` · ${subtypeLabel}` : ""}
          {officeName ? ` · ${officeName}` : ""}
        </div>
      </div>
    </div>
  );

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
            />
          </span>
        </div>
      </div>

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
                const cpId = e.clientId || e.partnerId || null;
                const cpName = (cpId && ctx?.counterpartyName) ? (() => {
                  try { return ctx.counterpartyName(cpId); } catch { return null; }
                })() : null;
                return (
                  <tr key={e.id} className="border-b border-border-soft hover:bg-surface-soft transition-colors">
                    <td className="px-3 py-1.5 text-muted font-mono tabular">
                      {new Date(e.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="text-body-sm text-ink truncate">{e.note || e.txKind}</div>
                      {cpName && <div className="text-tiny text-muted-soft truncate">{cpName}</div>}
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
          <span className="text-muted-soft">{t("trv2_col_dr")}: <span className="text-ink font-bold">{fmtAmount(turnover.dr)} {account.currency}</span></span>
          <span className="text-muted-soft">{t("trv2_col_cr")}: <span className="text-ink font-bold">{fmtAmount(turnover.cr)} {account.currency}</span></span>
          <span className={`font-bold ${turnover.delta >= 0 ? "text-success" : "text-danger"}`}>
            Δ: {turnover.delta >= 0 ? "+" : ""}{fmtAmount(turnover.delta)} {account.currency}
          </span>
        </div>
      </div>
    </Modal>
  );
}
