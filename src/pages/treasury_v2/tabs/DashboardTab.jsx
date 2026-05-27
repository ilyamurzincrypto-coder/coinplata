// src/pages/treasury_v2/tabs/DashboardTab.jsx
// Дашборд v2 — KPI + большая funds-table по валютам + sidebar (TOP-7 счетов,
// Crypto/Fiat split) + recent transactions + obligations + identity check.
// Стиль наш (rounded-card-lg, наши токены), информативность как у 1С.

import React, { useState, useMemo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useOpenObligations } from "../../../store/openObligations.js";
import { useRates } from "../../../store/rates.jsx";
import { balanceCheckTotals, pnlForPeriod, transactionTree } from "../../../lib/treasury/v2selectors.js";
import { dealSummary } from "../../../lib/treasury/dealSummary.js";
import { bucketObligations } from "../../../lib/treasury/paymentCalendar.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import { convert } from "../../../utils/convert.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const AVAILABLE_SUBTYPES = new Set(["cash", "bank", "crypto_input", "crypto_output"]);
const CRYPTO_SUBTYPES = new Set(["crypto_input", "crypto_output", "crypto"]);
const BASE_OPTIONS = ["USD", "EUR", "TRY", "RUB"];
const DISPLAY_BASE_KEY = "coinplata:dash-display-base";

function fmtNum(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtCur(amount, currency) {
  return `${curSymbol(currency)}${fmt(amount, currency)}`;
}
function fmtCompact(value) {
  const v = Math.abs(Number(value) || 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

export default function DashboardTab({ ctx, officeFilter, baseCurrency, formatBase, onOpenSource }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const { items: obligationItems } = useOpenObligations();
  const { getRate } = useRates();

  // Локальная валюта приведения (можно USD/EUR/TRY/RUB)
  const [displayBase, setDisplayBase] = useState(() => {
    try {
      const v = localStorage.getItem(DISPLAY_BASE_KEY);
      return BASE_OPTIONS.includes(v) ? v : (baseCurrency || "USD");
    } catch { return baseCurrency || "USD"; }
  });
  const setDisplayBasePersist = (v) => { setDisplayBase(v); try { localStorage.setItem(DISPLAY_BASE_KEY, v); } catch {} };

  // Период для P&L и recent deals
  const [period, setPeriodState] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_dash_period") || "month"; } catch { return "month"; }
  });
  const setPeriod = (v) => { setPeriodState(v); try { localStorage.setItem("coinplata.treasury_dash_period", v); } catch {} };
  const win = useMemo(() => presetWindow(period), [period]);

  // Локальный ctx с переопределённой базой (для всех ≈ вычислений)
  const localCtx = useMemo(() => {
    if (displayBase === ctx?.baseCurrency) return ctx;
    return { ...ctx, baseCurrency: displayBase, toBase: (amt, ccy) => convert(Number(amt) || 0, ccy, displayBase, getRate) || 0 };
  }, [ctx, displayBase, getRate]);
  const fmtBase = useMemo(() => (amt) => `${curSymbol(displayBase)}${Math.round(Number(amt) || 0).toLocaleString("en-US")}`, [displayBase]);
  // Компактный формат для KPI (₺19.9M вместо ₺19,900,296) — крупные числа
  // читаемее как короткие. Под капотом всё то же значение, тултип показывает full.
  const fmtBaseCompact = useMemo(() => (amt) => {
    const n = Number(amt) || 0;
    const a = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    const sym = curSymbol(displayBase);
    if (a >= 1_000_000_000) return `${sign}${sym}${(a / 1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000) return `${sign}${sym}${(a / 1_000_000).toFixed(2)}M`;
    if (a >= 10_000) return `${sign}${sym}${(a / 1_000).toFixed(1)}K`;
    return `${sign}${sym}${Math.round(a).toLocaleString("en-US")}`;
  }, [displayBase]);

  const totals = useMemo(() => balanceCheckTotals(localCtx, officeFilter), [localCtx, officeFilter]);
  const pnl = useMemo(() => pnlForPeriod(localCtx, { from: win.from, to: win.to }, officeFilter), [localCtx, win.from, win.to, officeFilter]);

  // Funds-table: для каждой валюты — наши деньги (Available subtypes) +
  // клиентские (customer_liab) + итого = наши − клиентские. native + base.
  const fundsTable = useMemo(() => {
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    const byCcy = new Map(); // ccy → { ourNat, ourBase, clientNat, clientBase, byOffice: Map }
    const NULL_OFFICE = "__none__";
    for (const b of ctx.balances || []) {
      const acc = accById.get(b.accountId);
      if (!acc) continue;
      if (officeFilter !== "all" && officeFilter && acc.officeId !== officeFilter) continue;
      const native = Number(b.balance) || 0;
      if (Math.abs(native) < 1e-9) continue;
      const ccy = b.currency;
      const inBase = convert(native, ccy, displayBase, getRate) || 0;
      const row = byCcy.get(ccy) || { ccy, ourNat: 0, ourBase: 0, clientNat: 0, clientBase: 0, byOffice: new Map() };
      const officeKey = acc.officeId || NULL_OFFICE;
      const officeBucket = row.byOffice.get(officeKey) || { officeId: acc.officeId || null, ourNat: 0, ourBase: 0, clientNat: 0, clientBase: 0 };
      if (acc.type === "asset" && AVAILABLE_SUBTYPES.has(acc.subtype)) {
        row.ourNat += native;
        row.ourBase += inBase;
        officeBucket.ourNat += native;
        officeBucket.ourBase += inBase;
      } else if (acc.type === "liability" && acc.subtype === "customer_liab") {
        row.clientNat += native;
        row.clientBase += inBase;
        officeBucket.clientNat += native;
        officeBucket.clientBase += inBase;
      }
      row.byOffice.set(officeKey, officeBucket);
      byCcy.set(ccy, row);
    }
    const rows = [...byCcy.values()].map((r) => ({
      ...r,
      offices: [...r.byOffice.values()].sort((a, b) => {
        if (a.officeId === null && b.officeId !== null) return 1;
        if (b.officeId === null && a.officeId !== null) return -1;
        return Math.abs(b.ourBase + b.clientBase) - Math.abs(a.ourBase + a.clientBase);
      }),
    })).sort((a, b) => Math.abs(b.ourBase) - Math.abs(a.ourBase));
    const total = rows.reduce((s, r) => ({
      ourBase: s.ourBase + r.ourBase,
      clientBase: s.clientBase + r.clientBase,
    }), { ourBase: 0, clientBase: 0 });
    return { rows, total };
  }, [ctx, officeFilter, displayBase, getRate]);

  // Раскрытие funds-table строк по валютам — клик → видим разбивку по офисам.
  const [expandedCcy, setExpandedCcy] = useState(() => new Set());
  const toggleCcy = (ccy) => setExpandedCcy((prev) => {
    const next = new Set(prev);
    if (next.has(ccy)) next.delete(ccy); else next.add(ccy);
    return next;
  });

  // Active clients count
  const activeClients = useMemo(() => {
    const set = new Set();
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    for (const b of ctx.balances || []) {
      const acc = accById.get(b.accountId);
      if (!acc || acc.type !== "liability" || acc.subtype !== "customer_liab") continue;
      if (officeFilter !== "all" && officeFilter && acc.officeId !== officeFilter) continue;
      if (!b.clientId || b.clientId === ZERO_UUID) continue;
      if (Math.abs(Number(b.balance) || 0) < 0.005) continue;
      set.add(b.clientId);
    }
    return set.size;
  }, [ctx, officeFilter]);

  // TOP-7 счетов по балансу в base
  const topAccounts = useMemo(() => {
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    const sums = new Map();
    for (const b of ctx.balances || []) {
      const acc = accById.get(b.accountId);
      if (!acc) continue;
      if (officeFilter !== "all" && officeFilter && acc.officeId !== officeFilter) continue;
      if (acc.type !== "asset" || !AVAILABLE_SUBTYPES.has(acc.subtype)) continue;
      const inBase = Math.abs(convert(b.balance, b.currency, displayBase, getRate) || 0);
      if (inBase < 0.005) continue;
      const cur = sums.get(acc.id) || { acc, inBase: 0 };
      cur.inBase += inBase;
      sums.set(acc.id, cur);
    }
    return [...sums.values()].sort((a, b) => b.inBase - a.inBase).slice(0, 7);
  }, [ctx, officeFilter, displayBase, getRate]);

  // Crypto/Fiat split
  const cryptoFiatSplit = useMemo(() => {
    const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
    let crypto = 0, fiat = 0;
    for (const b of ctx.balances || []) {
      const acc = accById.get(b.accountId);
      if (!acc) continue;
      if (officeFilter !== "all" && officeFilter && acc.officeId !== officeFilter) continue;
      if (acc.type !== "asset" || !AVAILABLE_SUBTYPES.has(acc.subtype)) continue;
      const inBase = Math.abs(convert(b.balance, b.currency, displayBase, getRate) || 0);
      if (CRYPTO_SUBTYPES.has(acc.subtype)) crypto += inBase;
      else fiat += inBase;
    }
    return { crypto, fiat, total: crypto + fiat };
  }, [ctx, officeFilter, displayBase, getRate]);

  // Recent transactions (10 последних за период)
  const recentTx = useMemo(() => {
    const tree = transactionTree(ctx, { type: "all", officeFilter, period: { from: win.from, to: win.to } });
    return tree.slice(0, 10);
  }, [ctx, officeFilter, win.from, win.to]);

  // Open obligations
  const obligationBuckets = useMemo(() => bucketObligations(obligationItems || [], officeFilter), [obligationItems, officeFilter]);

  const txCount = recentTx.length;

  return (
    <div className="space-y-4">
      {/* Top control bar: период + база */}
      <div className="bg-surface rounded-card-lg border border-border-soft p-3 flex items-center gap-3 flex-wrap">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-tiny text-muted-soft uppercase tracking-wider font-bold">Приведение:</span>
          <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
            {BASE_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDisplayBasePersist(c)}
                className={`h-7 px-2.5 rounded-pill text-tiny font-bold tracking-wider transition-colors ${
                  displayBase === c ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI grid — 4 крупных карточки. Используем compact-формат
          для крупных чисел (TRY-base даёт ₺-миллионы — компактный вид
          читается лучше). Full-значение — в tooltip. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label="Активы (наши)"
          value={fmtBaseCompact(totals.assets)}
          fullValue={fmtBase(totals.assets)}
          sub="касса · банк · крипто"
          tone="ink"
        />
        <KPI
          label="Клиенты (мы должны)"
          value={fmtBaseCompact(totals.liabilities)}
          fullValue={fmtBase(totals.liabilities)}
          sub={`${activeClients} активных клиентов`}
          tone={totals.liabilities > 0 ? "danger" : "muted"}
        />
        <KPI
          label="Капитал (чистый)"
          value={fmtBaseCompact(totals.equity)}
          fullValue={fmtBase(totals.equity)}
          sub="= Активы − Обязательства"
          tone="success"
        />
        <KPI
          label="Прибыль за период"
          value={fmtBaseCompact(pnl.netProfit)}
          fullValue={fmtBase(pnl.netProfit)}
          sub={`${txCount} транзакций`}
          tone={pnl.netProfit >= 0 ? "success" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
        {/* Funds-table */}
        <div className="bg-surface rounded-card-lg border border-border-soft overflow-hidden">
          <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
            <h3 className="text-body-sm font-bold text-ink">Доступные средства по валютам</h3>
            <span className="text-tiny text-muted-soft">{fundsTable.rows.length} валют</span>
          </div>
          {fundsTable.rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-caption text-muted">Балансов нет</div>
          ) : (
            <table className="w-full text-caption">
              <thead className="bg-surface-soft/40">
                <tr className="border-b border-border-soft">
                  <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">Валюта</th>
                  <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">Наши</th>
                  <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">≈ {displayBase}</th>
                  <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2 border-r border-border-soft">Клиентские</th>
                  <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-3 py-2">≈ {displayBase}</th>
                </tr>
              </thead>
              <tbody>
                {fundsTable.rows.map((r, idx) => {
                  const isOpen = expandedCcy.has(r.ccy);
                  const canExpand = r.offices && r.offices.length > 1;
                  return (
                    <React.Fragment key={r.ccy}>
                      <tr
                        className={`border-b border-border-soft transition-colors ${idx % 2 === 1 ? "bg-surface-soft/30" : ""} hover:bg-surface-soft ${canExpand ? "cursor-pointer" : ""}`}
                        onClick={() => canExpand && toggleCcy(r.ccy)}
                        title={canExpand ? "Раскрыть по офисам" : undefined}
                      >
                        <td className="px-3 py-2 border-r border-border-soft">
                          <div className="flex items-center gap-2">
                            {canExpand ? (
                              isOpen
                                ? <ChevronDown className="w-3 h-3 text-muted" strokeWidth={2.2} />
                                : <ChevronRight className="w-3 h-3 text-muted" strokeWidth={2.2} />
                            ) : <span className="w-3 h-3 inline-block" aria-hidden />}
                            <CurrencyIcon ccy={r.ccy} size="sm" />
                            <span className="font-bold text-ink-soft tracking-wider">{r.ccy}</span>
                            {canExpand && (
                              <span className="text-tiny text-muted-soft">· {r.offices.length} офисов</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular text-ink whitespace-nowrap border-r border-border-soft">
                          {Math.abs(r.ourNat) > 0.005 ? fmtCur(r.ourNat, r.ccy) : <span className="text-muted-soft">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular text-ink-soft whitespace-nowrap border-r border-border-soft">
                          {Math.abs(r.ourBase) > 0.005 ? fmtBase(r.ourBase) : <span className="text-muted-soft">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular whitespace-nowrap border-r border-border-soft">
                          {Math.abs(r.clientNat) > 0.005 ? <span className="text-danger">{fmtCur(r.clientNat, r.ccy)}</span> : <span className="text-muted-soft">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular whitespace-nowrap">
                          {Math.abs(r.clientBase) > 0.005 ? <span className="text-danger">{fmtBase(r.clientBase)}</span> : <span className="text-muted-soft">—</span>}
                        </td>
                      </tr>
                      {isOpen && r.offices.map((o) => {
                        const officeName = o.officeId
                          ? (findOffice(o.officeId)?.name || o.officeId)
                          : "Без офиса";
                        const share = r.ourBase > 0 ? (o.ourBase / r.ourBase) * 100 : 0;
                        return (
                          <tr key={`${r.ccy}|${o.officeId || "none"}`} className="border-b border-border-soft bg-surface-soft/20">
                            <td className="pl-10 pr-3 py-1.5 border-r border-border-soft">
                              <div className="flex items-center gap-2">
                                <span className="text-tiny text-muted-soft">{officeName}</span>
                                {share > 0 && (
                                  <span className="text-tiny text-muted-soft font-mono">· {share.toFixed(1)}%</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular text-tiny text-ink-soft whitespace-nowrap border-r border-border-soft">
                              {Math.abs(o.ourNat) > 0.005 ? fmtCur(o.ourNat, r.ccy) : <span className="text-muted-soft">—</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular text-tiny text-muted whitespace-nowrap border-r border-border-soft">
                              {Math.abs(o.ourBase) > 0.005 ? fmtBase(o.ourBase) : <span className="text-muted-soft">—</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular text-tiny whitespace-nowrap border-r border-border-soft">
                              {Math.abs(o.clientNat) > 0.005 ? <span className="text-danger">{fmtCur(o.clientNat, r.ccy)}</span> : <span className="text-muted-soft">—</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular text-tiny whitespace-nowrap">
                              {Math.abs(o.clientBase) > 0.005 ? <span className="text-danger">{fmtBase(o.clientBase)}</span> : <span className="text-muted-soft">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
                <tr className="bg-surface-sunk border-t-2 border-border-soft font-bold">
                  <td className="px-3 py-2 text-ink uppercase tracking-wider border-r border-border-soft">ИТОГО</td>
                  <td className="px-3 py-2 border-r border-border-soft">
                    <span className="text-tiny text-muted-soft">—</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-ink whitespace-nowrap border-r border-border-soft">
                    {fmtBase(fundsTable.total.ourBase)}
                  </td>
                  <td className="px-3 py-2 border-r border-border-soft">
                    <span className="text-tiny text-muted-soft">—</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-danger whitespace-nowrap">
                    {fmtBase(fundsTable.total.clientBase)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Sidebar — TOP-7 + Crypto/Fiat + Obligations */}
        <div className="space-y-3">
          <Card title={`TOP-7 счетов`}>
            {topAccounts.length === 0 ? (
              <div className="text-caption text-muted-soft text-center py-4">Активов нет</div>
            ) : (
              <div className="space-y-1.5">
                {topAccounts.map((it) => {
                  const officeName = it.acc.officeId ? (findOffice(it.acc.officeId)?.name || it.acc.officeId) : "Без офиса";
                  return (
                    <div key={it.acc.id} className="flex items-center justify-between gap-2 text-caption">
                      <div className="flex items-center gap-2 min-w-0">
                        <CurrencyIcon ccy={it.acc.currency} size="sm" />
                        <div className="min-w-0">
                          <div className="text-body-sm text-ink truncate">{it.acc.name}</div>
                          <div className="text-tiny text-muted-soft truncate">{it.acc.code} · {officeName}</div>
                        </div>
                      </div>
                      <span className="font-mono tabular font-bold text-ink whitespace-nowrap">{fmtBase(it.inBase)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          <Card title="Crypto / Fiat">
            {cryptoFiatSplit.total === 0 ? (
              <div className="text-caption text-muted-soft text-center py-4">—</div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: "Крипто", value: cryptoFiatSplit.crypto, color: "bg-accent" },
                  { label: "Фиат", value: cryptoFiatSplit.fiat, color: "bg-success" },
                ].map((it) => {
                  const pct = cryptoFiatSplit.total > 0 ? (it.value / cryptoFiatSplit.total) * 100 : 0;
                  return (
                    <div key={it.label}>
                      <div className="flex items-baseline justify-between text-caption mb-0.5">
                        <span className="font-bold text-ink-soft">{it.label}</span>
                        <span className="font-mono tabular text-ink">{fmtBase(it.value)} <span className="text-muted-soft">· {pct.toFixed(1)}%</span></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden">
                        <div className={`h-full ${it.color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          {(obligationItems || []).length > 0 && (
            <Card title="Открытые обязательства">
              <div className="space-y-1.5">
                {[
                  { key: "overdue", label: "Просрочено", n: obligationBuckets.overdue?.length || 0, tone: "danger" },
                  { key: "today", label: "Сегодня", n: obligationBuckets.today?.length || 0, tone: "warning" },
                  { key: "week", label: "На неделе", n: obligationBuckets.week?.length || 0, tone: "ink" },
                  { key: "later", label: "Позже", n: obligationBuckets.later?.length || 0, tone: "muted" },
                ].filter((b) => b.n > 0).map((b) => (
                  <div key={b.key} className="flex items-center justify-between text-caption">
                    <span className={b.tone === "danger" ? "text-danger" : b.tone === "warning" ? "text-warning" : "text-ink-soft"}>{b.label}</span>
                    <span className="font-mono tabular font-bold text-ink">{b.n}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <Card title="Последние транзакции за период" subtitle={`Период: ${win.from.slice(0,10)} — ${win.to.slice(0,10)}`}>
        {recentTx.length === 0 ? (
          <div className="text-caption text-muted-soft text-center py-4">За период транзакций нет</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-caption">
              <thead className="bg-surface-soft/40">
                <tr className="border-b border-border-soft">
                  <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-1.5 w-24">Дата</th>
                  <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-1.5 w-20">Тип</th>
                  <th className="text-left text-tiny font-bold text-muted uppercase tracking-wider px-2 py-1.5">Описание</th>
                  <th className="text-right text-tiny font-bold text-muted uppercase tracking-wider px-2 py-1.5 w-32">Док.</th>
                </tr>
              </thead>
              <tbody>
                {recentTx.map((node) => {
                  const dt = new Date(node.tx.effectiveDate);
                  const confirmed = !!node.tx.metadata?.confirmed_at;
                  return (
                    <tr key={node.tx.id} className="border-b border-border-soft hover:bg-surface-soft transition-colors">
                      <td className="px-2 py-1.5 text-muted-soft font-mono tabular text-tiny whitespace-nowrap">
                        {dt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-tiny font-bold uppercase tracking-wider text-ink-soft">{node.tx.kind}</span>
                      </td>
                      <td className="px-2 py-1.5 text-body-sm text-ink truncate">
                        {(() => {
                          const d = node.tx.description || `${node.tx.kind} #${node.tx.sourceRefId || node.tx.id.slice(0, 8)}`;
                          // Чистим Treasury-инлайн-корректировки: «Treasury · 1130: 0 → 12930» → «Корректировка остатка 1130»
                          const m = String(d).match(/^Treasury · (\S+):/);
                          if (m) return `Корректировка остатка ${m[1]}`;
                          return d;
                        })()}
                        {confirmed && <span className="ml-1.5 text-tiny font-bold text-success" title="Подтверждено">✓</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {node.tx.sourceRefId && onOpenSource ? (
                          <button type="button" onClick={() => onOpenSource(node.tx)} className="text-accent hover:text-accent-hover font-mono text-tiny">
                            {node.tx.sourceRefId} →
                          </button>
                        ) : (
                          <span className="text-muted-soft font-mono text-tiny">{node.tx.id.slice(0, 8)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Identity check */}
      <div className={`rounded-card-lg px-4 py-3 text-body-sm font-medium font-mono tabular ${
        totals.identityCheck.ok
          ? "bg-success-soft text-success border border-success/20"
          : "bg-danger-soft text-danger border border-danger/20"
      }`}>
        Σ Дт = Σ Кт · Капитал {fmtBase(totals.equity)} = Активы {fmtBase(totals.assets)} − Обязательства {fmtBase(-totals.liabilities)} {totals.identityCheck.ok ? "✓" : `(Δ ${fmtBase(totals.identityCheck.delta)})`}
      </div>
    </div>
  );
}

function KPI({ label, value, fullValue, sub, tone }) {
  const toneCls = tone === "success" ? "text-success"
    : tone === "danger" ? "text-danger"
    : tone === "muted" ? "text-muted"
    : "text-ink";
  return (
    <div className="bg-surface rounded-card-lg border border-border-soft p-4 hover:shadow-sm transition-shadow" title={fullValue || undefined}>
      <div className="text-tiny text-muted-soft uppercase tracking-wider font-bold mb-1.5">{label}</div>
      <div className={`text-[22px] font-bold font-mono tabular leading-tight ${toneCls}`}>{value}</div>
      <div className="text-tiny text-muted-soft mt-1 truncate">{sub}</div>
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-surface rounded-card-lg border border-border-soft overflow-hidden">
      <div className="px-4 py-3 border-b border-border-soft">
        <div className="text-body-sm font-bold text-ink">{title}</div>
        {subtitle && <div className="text-tiny text-muted-soft mt-0.5">{subtitle}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
