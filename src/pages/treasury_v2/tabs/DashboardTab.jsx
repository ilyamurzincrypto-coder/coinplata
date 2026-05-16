// src/pages/treasury_v2/tabs/DashboardTab.jsx
// Treasury landing tab — a click-through «funds» dashboard built from the v2 ledger.
//
// Top: a 3-level drill-down tree
//   ДОСТУПНЫЕ СРЕДСТВА (наши активы) → by currency → by office/account
//   СРЕДСТВА КЛИЕНТОВ (мы должны клиентам) → by currency → by client
//   ИТОГО (в базовой): Активы · Обязательства клиентам · Чистый капитал
// Below: small support cards — P&L for a period, open obligations, recent deals,
// and the Σ Дт = Σ Кт identity indicator. Read-only, no mutations.
import React, { useState, useMemo, useEffect } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useOffices } from "../../../store/offices.jsx";
import { useOpenObligations } from "../../../store/openObligations.js";
import { balanceCheckTotals, pnlForPeriod, transactionTree } from "../../../lib/treasury/v2selectors.js";
import { dealSummary } from "../../../lib/treasury/dealSummary.js";
import { bucketObligations, obligationLegTotals } from "../../../lib/treasury/paymentCalendar.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import PeriodPicker, { presetWindow } from "../PeriodPicker.jsx";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
// «Доступные средства» = cash & cash equivalents по IAS 7: наличные,
// банковские счета (демандо-депозиты), крипто-кошельки. Inter-office
// и clearing-счета — внутренние, в available не входят.
const AVAILABLE_SUBTYPES = new Set(["cash", "bank", "crypto_input", "crypto_output"]);

const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtBaseAmount = (n, baseCurrency) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baseCurrency}`;
const fmtSignedBase = (n, baseCurrency) => `${n < 0 ? "−" : ""}${fmtBaseAmount(Math.abs(n), baseCurrency)}`;
const fmtCur = (amount, currency) => `${curSymbol(currency)}${fmt(amount, currency)}${curSymbol(currency) ? "" : ` ${currency}`}`;
const fmtSignedCur = (amount, currency) => `${amount < 0 ? "−" : ""}${fmtCur(Math.abs(amount), currency)}`;

function Card({ className = "", children }) {
  return <div className={`bg-white rounded-[14px] border border-slate-200/70 p-4 ${className}`}>{children}</div>;
}

// ── Funds tree ─────────────────────────────────────────────────────────────
// Builds the per-currency / per-leaf breakdown for one «kind» of money.
//   kind="available": asset accounts with subtype ∈ {cash, crypto_input, crypto_output},
//                     leaves grouped by office (account name + native balance).
//   kind="client":    customer_liab accounts (type liability), leaves grouped by client.
function buildFundsTree(ctx, kind, officeFilter, findOffice, counterpartyName, t) {
  const accById = new Map((ctx.accounts || []).map((a) => [a.id, a]));
  const byCur = new Map(); // currency -> { currency, native, inBase, leaves: Map<leafKey,{key,label,native,inBase}> }

  for (const b of ctx.balances || []) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    if (officeFilter !== "all" && officeFilter && acc.officeId !== officeFilter) continue;
    if (kind === "available") {
      if (acc.type !== "asset" || !AVAILABLE_SUBTYPES.has(acc.subtype)) continue;
    } else {
      if (acc.type !== "liability" || acc.subtype !== "customer_liab") continue;
      if (b.clientId === ZERO_UUID) continue;
    }
    const native = Number(b.balance) || 0;
    if (Math.abs(native) < 1e-9) continue;
    const inBase = ctx.toBase(native, b.currency) || 0;
    const cur = b.currency;
    const bucket = byCur.get(cur) || { currency: cur, native: 0, inBase: 0, leaves: new Map() };
    bucket.native += native;
    bucket.inBase += inBase;

    let leafKey, leafLabel;
    if (kind === "available") {
      leafKey = `${acc.officeId || "_none"}|${acc.id}`;
      const officeName = acc.officeId ? (findOffice(acc.officeId)?.name || acc.officeId) : t("trv2_dash_no_office");
      leafLabel = `${officeName} · ${acc.name}`;
    } else {
      leafKey = b.clientId || "_none";
      leafLabel = b.clientId ? (counterpartyName ? counterpartyName(b.clientId) || b.clientId : b.clientId) : t("trv2_dash_no_office");
    }
    const leaf = bucket.leaves.get(leafKey) || { key: leafKey, label: leafLabel, native: 0, inBase: 0 };
    leaf.native += native;
    leaf.inBase += inBase;
    bucket.leaves.set(leafKey, leaf);
    byCur.set(cur, bucket);
  }

  const currencies = [...byCur.values()]
    .map((c) => ({ ...c, leaves: [...c.leaves.values()].sort((a, b) => Math.abs(b.inBase) - Math.abs(a.inBase)) }))
    .sort((a, b) => Math.abs(b.inBase) - Math.abs(a.inBase));
  const totalInBase = currencies.reduce((s, c) => s + c.inBase, 0);
  return { currencies, totalInBase };
}

// `displayMul` — display-sign multiplier (1 for our assets; −1 for the client-funds
// section, so what we owe clients reads as a negative figure). Presentation only.
function FundsSection({ id, titleKey, subKey, tree, baseCurrency, expanded, toggle, displayMul = 1 }) {
  const { t } = useTranslation();
  const open = expanded.has(id);
  const baseAmt = (n) => (displayMul < 0 ? fmtSignedBase(n * displayMul, baseCurrency) : fmtBaseAmount(n, baseCurrency));
  const curAmt = (n, ccy) => (displayMul < 0 ? fmtSignedCur(n * displayMul, ccy) : fmtCur(n, ccy));
  return (
    <div>
      <div
        onClick={() => toggle(id)}
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-slate-50 rounded-[8px] -mx-1"
      >
        {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-slate-900 uppercase tracking-wide">{t(titleKey)}</div>
          <div className="text-[11px] text-slate-400">{t(subKey)}</div>
        </div>
        <div className="text-[18px] font-bold tabular-nums text-slate-900 shrink-0">{baseAmt(tree.totalInBase)}</div>
      </div>
      {open && (
        <div className="pl-7 pr-1 pb-1">
          {tree.currencies.length === 0 ? (
            <div className="py-2 text-[12px] text-slate-400">{t("trv2_dash_empty_funds")}</div>
          ) : (
            tree.currencies.map((c) => {
              const ckey = `${id}:${c.currency}`;
              const copen = expanded.has(ckey);
              return (
                <div key={c.currency}>
                  <div
                    onClick={() => toggle(ckey)}
                    className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-slate-50 rounded-[6px] -mx-1 px-1"
                  >
                    {copen ? <ChevronDown className="w-3.5 h-3.5 text-slate-300 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                    <span className="text-[12.5px] font-semibold text-slate-700 w-12 shrink-0">{c.currency}</span>
                    <span className="text-[12.5px] tabular-nums text-slate-800">{curAmt(c.native, c.currency)}</span>
                    <span className="text-[11.5px] text-slate-400 tabular-nums ml-2">(≈ {baseAmt(c.inBase)})</span>
                  </div>
                  {copen && (
                    <div className="pl-6">
                      {c.leaves.map((leaf) => (
                        <div key={leaf.key} className="flex items-baseline gap-3 py-1 text-[12px]">
                          <span className="text-slate-500 flex-1 truncate">{leaf.label}</span>
                          <span className="tabular-nums text-slate-700 shrink-0">{curAmt(leaf.native, c.currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// Преобразуем pnl-класс (revenue / expense) в дерево по валюте → счетам.
// pnlClass: { total, accounts: [{code, name, currency, amountInBase, entryCount}] }
function pnlClassToTree(pnlClass) {
  const byCur = new Map();
  for (const a of pnlClass.accounts || []) {
    const bucket = byCur.get(a.currency) || { currency: a.currency, native: 0, inBase: 0, leaves: [] };
    bucket.inBase += a.amountInBase;
    bucket.leaves.push({
      key: a.code,
      label: `${a.code} · ${a.name}`,
      native: a.amountInBase, // native не хранится в aggregateClass — показываем base
      inBase: a.amountInBase,
    });
    byCur.set(a.currency, bucket);
  }
  const currencies = [...byCur.values()]
    .map((c) => ({ ...c, leaves: c.leaves.slice().sort((x, y) => Math.abs(y.inBase) - Math.abs(x.inBase)) }))
    .sort((x, y) => Math.abs(y.inBase) - Math.abs(x.inBase));
  return { currencies, totalInBase: pnlClass.total || 0 };
}

function FundsTreeCard({ ctx, officeFilter, baseCurrency, period, setPeriod }) {
  const { t } = useTranslation();
  const { findOffice } = useOffices();
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const available = useMemo(
    () => buildFundsTree(ctx, "available", officeFilter, findOffice, ctx.counterpartyName, t),
    [ctx, officeFilter, findOffice, t]
  );
  const client = useMemo(
    () => buildFundsTree(ctx, "client", officeFilter, findOffice, ctx.counterpartyName, t),
    [ctx, officeFilter, findOffice, t]
  );

  // P&L за период — для секций «Доходы» / «Расходы».
  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const pnl = useMemo(
    () => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter),
    [ctx, win.from, win.to, officeFilter]
  );
  const revenueTree = useMemo(() => pnlClassToTree(pnl.revenue), [pnl]);
  const expenseTree = useMemo(() => pnlClassToTree(pnl.expense), [pnl]);

  // Пассивы shown signed ("we owe" = minus); identity reads literally Капитал = Активы + Пассивы.
  const passives = -client.totalInBase;
  const netCapital = available.totalInBase + passives;
  const netProfit = (pnl.revenue.total || 0) - (pnl.expense.total || 0) + (pnl.fxNet || 0);

  return (
    <Card className="md:col-span-2 lg:col-span-3">
      <div className="space-y-1">
        <FundsSection
          id="available"
          titleKey="trv2_dash_available_funds"
          subKey="trv2_dash_available_sub"
          tree={available}
          baseCurrency={baseCurrency}
          expanded={expanded}
          toggle={toggle}
        />
        <div className="border-t border-slate-100" />
        <FundsSection
          id="client"
          titleKey="trv2_dash_client_funds"
          subKey="trv2_dash_client_sub"
          tree={client}
          baseCurrency={baseCurrency}
          expanded={expanded}
          toggle={toggle}
          displayMul={-1}
        />
        <div className="border-t border-slate-100" />
        {/* Период для доход/расход — общий с PnLCard ниже. */}
        <div className="px-3 py-2 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-bold uppercase tracking-wide">Период доходов/расходов:</span>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        <FundsSection
          id="revenue"
          titleKey="trv2_dash_revenue"
          subKey="trv2_dash_revenue_sub"
          tree={revenueTree}
          baseCurrency={baseCurrency}
          expanded={expanded}
          toggle={toggle}
        />
        <div className="border-t border-slate-100" />
        <FundsSection
          id="expense"
          titleKey="trv2_dash_expense"
          subKey="trv2_dash_expense_sub"
          tree={expenseTree}
          baseCurrency={baseCurrency}
          expanded={expanded}
          toggle={toggle}
          displayMul={-1}
        />
      </div>
      <div className="mt-3 pt-3 border-t border-slate-200 rounded-[10px] bg-slate-50 px-3 py-2.5 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t("trv2_dash_totals")}</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_total_assets")}</span> <span className="font-bold tabular-nums text-slate-900">{fmtBaseAmount(available.totalInBase, baseCurrency)}</span></span>
          <span className="text-slate-400">+</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_total_client_liab")}</span> <span className="font-bold tabular-nums text-slate-900">{fmtSignedBase(passives, baseCurrency)}</span></span>
          <span className="text-slate-400">=</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_net_capital")}</span> <span className={`font-bold tabular-nums ${netCapital < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(netCapital, baseCurrency)}</span></span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] pt-1 border-t border-slate-200/70">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">За период</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_revenue")}</span> <span className="font-bold tabular-nums text-emerald-700">+{fmtBaseAmount(pnl.revenue.total || 0, baseCurrency)}</span></span>
          <span className="text-slate-400">−</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_expense")}</span> <span className="font-bold tabular-nums text-rose-700">{fmtBaseAmount(pnl.expense.total || 0, baseCurrency)}</span></span>
          {Math.abs(pnl.fxNet || 0) > 0.005 && (
            <>
              <span className="text-slate-400">+</span>
              <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_fx")}</span> <span className="font-bold tabular-nums text-slate-700">{fmtSignedBase(pnl.fxNet, baseCurrency)}</span></span>
            </>
          )}
          <span className="text-slate-400">=</span>
          <span className="text-slate-600"><span className="text-slate-500">{t("trv2_dash_net_profit")}</span> <span className={`font-bold tabular-nums ${netProfit < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(netProfit, baseCurrency)}</span></span>
        </div>
      </div>
    </Card>
  );
}

// ── Support cards ──────────────────────────────────────────────────────────
function PnLCard({ ctx, officeFilter, baseCurrency, period, setPeriod }) {
  const { t } = useTranslation();
  const win = useMemo(() => presetWindow(period), [period]);
  useEffect(() => {
    if (ctx.extendWindow && ctx.sinceIso && new Date(win.from) < new Date(ctx.sinceIso)) ctx.extendWindow(win.from);
  }, [win.from, ctx.sinceIso, ctx.extendWindow]);
  const pnl = useMemo(() => pnlForPeriod(ctx, { from: win.from, to: win.to }, officeFilter), [ctx, win.from, win.to, officeFilter]);
  const net = pnl.netProfit;
  return (
    <Card>
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_pnl")}</h3>
      <div className="mb-3"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="text-[11px] text-slate-500">{t("trv2_dash_net_profit")}</div>
      <div className={`text-[22px] font-bold tabular-nums ${net < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedBase(net, baseCurrency)}</div>
      <div className="mt-3 space-y-1 text-[12px]">
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_revenue")}</span><span className="tabular-nums">+{fmtBaseAmount(pnl.revenue.total, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_expense")}</span><span className="tabular-nums">−{fmtBaseAmount(pnl.expense.total, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_fx")}</span><span className="tabular-nums">{fmtSignedBase(pnl.fxNet, baseCurrency)}</span></div>
      </div>
    </Card>
  );
}

function ObligationsCard({ officeFilter }) {
  const { t } = useTranslation();
  const { items, loading } = useOpenObligations();
  const filtered = useMemo(
    () => (items || []).filter((it) => !officeFilter || officeFilter === "all" || !it.office_id || it.office_id === officeFilter),
    [items, officeFilter]
  );
  const buckets = useMemo(() => bucketObligations(filtered), [filtered]);
  const legTotals = useMemo(() => {
    const byCur = new Map();
    for (const it of filtered) for (const lt of obligationLegTotals(it)) byCur.set(lt.currency, (byCur.get(lt.currency) || 0) + lt.amount);
    return [...byCur.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency));
  }, [filtered]);

  return (
    <Card>
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_open_oblig")}</h3>
      {loading ? (
        <div className="text-[12px] text-slate-400">…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[12px] text-slate-400">{t("trv2_dash_oblig_none")}</div>
      ) : (
        <>
          <div className="text-[22px] font-bold tabular-nums text-slate-900">{filtered.length}</div>
          <div className="text-[12px] text-slate-600 mt-0.5">
            {legTotals.length === 0 ? "—" : legTotals.map((lt, i) => <span key={lt.currency}>{i > 0 ? " · " : ""}{fmtNum(lt.amount)} {lt.currency}</span>)}
          </div>
          <div className="text-[11.5px] text-slate-500 mt-2">
            {t("trv2_dash_oblig_breakdown")
              .replace("{overdue}", String(buckets.overdue.length))
              .replace("{today}", String(buckets.today.length))
              .replace("{week}", String(buckets.week.length))
              .replace("{later}", String(buckets.later.length))
              .replace("{no_date}", String(buckets.no_date.length))}
          </div>
        </>
      )}
    </Card>
  );
}

const fmtAmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
function dealLine(node, accById) {
  const s = dealSummary(node, accById);
  if (!s) return null;
  const leg = (l) => `${fmtAmt(l.amount)} ${l.currency}`;
  const sides = [];
  if (s.in.length) sides.push(s.in.map(leg).join(" + "));
  if (s.out.length) sides.push(s.out.map(leg).join(" + "));
  return sides.join(" → ") || null;
}

function RecentDealsCard({ ctx, officeFilter, onOpenSource, period }) {
  const { t } = useTranslation();
  const win = useMemo(() => presetWindow(period), [period]);
  const tree = useMemo(
    () => transactionTree(ctx, { type: "deal", officeFilter, period: { from: win.from, to: win.to } }).slice(0, 6),
    [ctx, officeFilter, win.from, win.to]
  );
  const accById = useMemo(() => new Map((ctx.accounts || []).map((a) => [a.id, a])), [ctx.accounts]);
  const cpName = (tx) => tx?.metadata?.client_nickname || (ctx.counterpartyName ? ctx.counterpartyName(tx?.metadata?.counterparty_id) : null) || "—";

  return (
    <Card className="md:col-span-2 lg:col-span-3">
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_recent_deals")}</h3>
      {tree.length === 0 ? (
        <div className="text-[12px] text-slate-400">{t("trv2_dash_no_deals")}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {tree.map((node) => {
            const { tx } = node;
            const line = dealLine(node, accById);
            const date = new Date(tx.effectiveDate).toISOString().slice(0, 10);
            const clickable = !!onOpenSource;
            return (
              <div
                key={tx.id}
                onClick={clickable ? () => onOpenSource(tx) : undefined}
                className={`py-2 flex items-baseline gap-3 text-[12.5px] ${clickable ? "cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded" : ""}`}
              >
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0 w-20">{date}</span>
                <span className="text-slate-700 shrink-0 max-w-[160px] truncate">{cpName(tx)}</span>
                <span className="text-slate-500 truncate flex-1">{line || tx.description || "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function IdentityCard({ ctx, officeFilter, baseCurrency }) {
  const { t } = useTranslation();
  const totals = useMemo(() => balanceCheckTotals(ctx, officeFilter), [ctx, officeFilter]);
  const ok = totals.identityCheck.ok;
  return (
    <Card>
      <h3 className="text-[13px] font-bold text-slate-900 mb-2">{t("trv2_dash_capital")}</h3>
      <div className={`text-[12px] font-medium px-2.5 py-1.5 rounded-[8px] inline-block ${ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
        {ok ? t("trv2_dash_identity_ok") : t("trv2_dash_identity_off").replace("{delta}", fmtBaseAmount(totals.identityCheck.delta, baseCurrency))}
      </div>
      <div className="mt-3 space-y-1 text-[12px]">
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_assets")}</span><span className="tabular-nums">{fmtBaseAmount(totals.assets, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_liabilities")}</span><span className="tabular-nums">{fmtSignedBase(-totals.liabilities, baseCurrency)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">{t("trv2_dash_equity")}</span><span className="tabular-nums">{fmtBaseAmount(totals.equity, baseCurrency)}</span></div>
      </div>
    </Card>
  );
}

export default function DashboardTab({ ctx, officeFilter, baseCurrency, onOpenSource }) {
  const [period, setPeriodState] = useState(() => {
    try { return localStorage.getItem("coinplata.treasury_dash_period") || "month"; } catch { return "month"; }
  });
  const setPeriod = (v) => { setPeriodState(v); try { localStorage.setItem("coinplata.treasury_dash_period", v); } catch {} };
  return (
    <div className="space-y-4">
      <FundsTreeCard
        ctx={ctx}
        officeFilter={officeFilter}
        baseCurrency={baseCurrency}
        period={period}
        setPeriod={setPeriod}
      />
      {/* PnLCard убран — доходы/расходы и сводка прибыли теперь в верхней
          FundsTreeCard. Здесь оставляем только сопутствующие карточки. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ObligationsCard officeFilter={officeFilter} />
        <IdentityCard ctx={ctx} officeFilter={officeFilter} baseCurrency={baseCurrency} />
        <RecentDealsCard ctx={ctx} officeFilter={officeFilter} onOpenSource={onOpenSource} period={period} />
      </div>
    </div>
  );
}
