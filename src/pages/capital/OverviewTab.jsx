// src/pages/capital/OverviewTab.jsx
// Общая сводка за period. Все суммы в base currency.
//   • 4 KPI с momentum (vs prev period равной длины)
//   • Sparkline daily profit
//   • Office breakdown
//   • Top clients / Top currencies за период

import React, { useMemo } from "react";
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Receipt,
  Users,
  Coins,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";

// Считает prev period той же длины, что и текущий range (для momentum).
function prevRange(range) {
  if (!range?.from || !range?.to) return null;
  const from = new Date(range.from);
  const to = new Date(range.to);
  const ms = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - ms);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

function pctDelta(cur, prev) {
  if (!Number.isFinite(prev) || Math.abs(prev) < 1e-9) {
    // Prev был ~0: любое ненулевое cur = +∞, не показываем %
    return null;
  }
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// Группируем tx по дате → возвращаем массив [{date, profit}] в пределах range
function buildDailyProfitSeries(transactions, range, toBase) {
  if (!range?.from || !range?.to) return [];
  const from = new Date(range.from);
  const to = new Date(range.to);
  const days = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    days.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const map = new Map(days.map((d) => [d, 0]));
  transactions.forEach((tx) => {
    const d = toISODate(tx.date);
    if (!map.has(d)) return;
    map.set(d, map.get(d) + toBase(tx.profit || 0, "USD"));
  });
  return [...map.entries()].map(([date, profit]) => ({ date, profit }));
}

export default function OverviewTab({ range }) {
  const { t } = useTranslation();
  const { transactions, counterparties } = useTransactions();
  const { entries } = useIncomeExpense();
  const { base, toBase } = useBaseCurrency();

  const {
    txVolume,
    txProfit,
    txCount,
    income,
    expense,
    netProfit,
    prev,
    dailySeries,
    topClients,
    topCurrencies,
  } = useMemo(() => {
    const scopedTx = transactions.filter(
      (tx) => tx.status !== "deleted" && inRange(toISODate(tx.date), range)
    );
    const scopedIE = entries.filter((e) => inRange(e.date, range));

    const txVolume = scopedTx.reduce((s, tx) => s + toBase(tx.amtIn, tx.curIn), 0);
    const txProfit = scopedTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);

    const income = scopedIE
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);
    const expense = scopedIE
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);
    const netProfit = txProfit + income - expense;

    // Prev period
    const prevR = prevRange(range);
    let prevTxVolume = 0;
    let prevTxProfit = 0;
    let prevIncome = 0;
    let prevExpense = 0;
    if (prevR) {
      transactions.forEach((tx) => {
        if (tx.status === "deleted") return;
        if (!inRange(toISODate(tx.date), prevR)) return;
        prevTxVolume += toBase(tx.amtIn, tx.curIn);
        prevTxProfit += toBase(tx.profit || 0, "USD");
      });
      entries.forEach((e) => {
        if (!inRange(e.date, prevR)) return;
        if (e.type === "income") prevIncome += toBase(e.amount, e.currency);
        else if (e.type === "expense") prevExpense += toBase(e.amount, e.currency);
      });
    }
    const prevNet = prevTxProfit + prevIncome - prevExpense;

    // Daily profit series
    const dailySeries = buildDailyProfitSeries(scopedTx, range, toBase);

    // Top clients
    const clientsMap = new Map();
    scopedTx.forEach((tx) => {
      const key = (tx.counterparty || "").trim();
      if (!key) return;
      if (!clientsMap.has(key)) {
        clientsMap.set(key, { nickname: key, deals: 0, volume: 0, profit: 0 });
      }
      const c = clientsMap.get(key);
      c.deals += 1;
      c.volume += toBase(tx.amtIn, tx.curIn);
      c.profit += toBase(tx.profit || 0, "USD");
    });
    const topClients = [...clientsMap.values()]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    // Top currencies (по curIn)
    const curMap = new Map();
    scopedTx.forEach((tx) => {
      const key = tx.curIn;
      if (!curMap.has(key)) {
        curMap.set(key, { currency: key, deals: 0, volume: 0, profit: 0 });
      }
      const c = curMap.get(key);
      c.deals += 1;
      c.volume += toBase(tx.amtIn, tx.curIn);
      c.profit += toBase(tx.profit || 0, "USD");
    });
    const topCurrencies = [...curMap.values()]
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    return {
      txVolume,
      txProfit,
      txCount: scopedTx.length,
      income,
      expense,
      netProfit,
      prev: {
        txVolume: prevTxVolume,
        txProfit: prevTxProfit,
        income: prevIncome,
        expense: prevExpense,
        net: prevNet,
      },
      dailySeries,
      topClients,
      topCurrencies,
    };
  }, [transactions, entries, toBase, range]);

  const sym = curSymbol(base);

  return (
    <div className="space-y-4">
      {/* KPI ряд */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label={t("kpi_exchange_volume")}
          value={`${sym}${fmt(txVolume, base)}`}
          sub={`${txCount} ${t("kpi_deals_sub")}`}
          icon={<Briefcase className="w-3.5 h-3.5" />}
          delta={pctDelta(txVolume, prev.txVolume)}
        />
        <KPI
          label={t("kpi_deals_profit")}
          value={`${txProfit >= 0 ? "+" : ""}${sym}${fmt(txProfit, base)}`}
          accent={txProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          delta={pctDelta(txProfit, prev.txProfit)}
          sparkline={dailySeries}
        />
        <KPI
          label={t("kpi_income_expense")}
          value={`+${sym}${fmt(income, base)} / −${sym}${fmt(expense, base)}`}
          icon={<Receipt className="w-3.5 h-3.5" />}
          delta={pctDelta(income - expense, prev.income - prev.expense)}
        />
        <KPI
          label={t("kpi_net_profit")}
          value={`${netProfit >= 0 ? "+" : ""}${sym}${fmt(netProfit, base)}`}
          accent={netProfit >= 0 ? "emerald" : "rose"}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          delta={pctDelta(netProfit, prev.net)}
          big
        />
      </div>

      {/* Office breakdown */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-slate-500" />
          <h2 className="text-[15px] font-semibold tracking-tight">{t("office_breakdown")}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-5">
          {OFFICES.map((o) => {
            const officeTx = transactions.filter(
              (tx) =>
                tx.status !== "deleted" &&
                tx.officeId === o.id &&
                inRange(toISODate(tx.date), range)
            );
            const volume = officeTx.reduce((s, tx) => s + toBase(tx.amtIn, tx.curIn), 0);
            const profit = officeTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);
            const pct = txVolume > 0 ? (volume / txVolume) * 100 : 0;
            return (
              <div key={o.id} className="bg-slate-50/60 border border-slate-200 rounded-[12px] p-4">
                <div className="text-[12px] font-semibold text-slate-500 mb-0.5">{officeName(o.id)}</div>
                <div className="text-[22px] font-bold tabular-nums tracking-tight text-slate-900">
                  {sym}{fmt(volume, base)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                  {officeTx.length} {t("kpi_deals_sub")} · {t("kpi_profit_word")}{" "}
                  <span className={profit >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                    {sym}{fmt(profit, base)}
                  </span>
                </div>
                <div className="mt-3 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-900 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[10px] text-slate-400 mt-1 font-medium">{pct.toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Top clients / Top currencies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopCard
          title="Top clients"
          icon={<Users className="w-4 h-4 text-slate-500" />}
          rows={topClients.map((c) => ({
            key: c.nickname,
            primary: c.nickname,
            secondary: `${c.deals} ${t("kpi_deals_sub")}`,
            value: `${sym}${fmt(c.volume, base)}`,
            subValue: `${c.profit >= 0 ? "+" : ""}${sym}${fmt(c.profit, base)}`,
            tone: c.profit >= 0 ? "emerald" : "rose",
          }))}
          emptyText="No deals in this period"
        />
        <TopCard
          title="Top currencies"
          icon={<Coins className="w-4 h-4 text-slate-500" />}
          rows={topCurrencies.map((c) => ({
            key: c.currency,
            primary: c.currency,
            secondary: `${c.deals} ${t("kpi_deals_sub")}`,
            value: `${sym}${fmt(c.volume, base)}`,
            subValue: `${c.profit >= 0 ? "+" : ""}${sym}${fmt(c.profit, base)}`,
            tone: c.profit >= 0 ? "emerald" : "rose",
          }))}
          emptyText="No deals in this period"
        />
      </div>
    </div>
  );
}

function KPI({ label, value, sub, accent, icon, big, delta, sparkline }) {
  const accentCls =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "rose"
      ? "text-rose-700"
      : "text-slate-900";
  return (
    <div className={`bg-white border border-slate-200 rounded-[12px] p-4 ${big ? "ring-2 ring-emerald-100" : ""}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-[22px] font-bold tabular-nums tracking-tight ${accentCls}`}>{value}</div>
      <div className="flex items-center gap-2 mt-0.5">
        {sub && <span className="text-[11px] text-slate-500 tabular-nums">{sub}</span>}
        {delta !== null && delta !== undefined && <DeltaPill delta={delta} />}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mb-1">
          <Sparkline points={sparkline.map((d) => d.profit)} />
        </div>
      )}
    </div>
  );
}

function DeltaPill({ delta }) {
  const up = delta >= 0;
  const cls = up ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {Math.abs(delta).toFixed(1)}% vs prev
    </span>
  );
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 140;
  const h = 28;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const toY = (v) => h - ((v - min) / range) * h;

  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * stepX},${toY(v)}`)
    .join(" ");
  const areaPath = `${path} L ${w},${h} L 0,${h} Z`;
  const lastV = points[points.length - 1];
  const lastPositive = lastV >= 0;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="block">
      {/* Baseline при 0 (если 0 в диапазоне) */}
      {min < 0 && max > 0 && (
        <line x1={0} y1={toY(0)} x2={w} y2={toY(0)} stroke="#cbd5e1" strokeDasharray="2 2" />
      )}
      <path
        d={areaPath}
        fill={lastPositive ? "rgb(16 185 129 / 0.08)" : "rgb(225 29 72 / 0.08)"}
      />
      <path
        d={path}
        fill="none"
        stroke={lastPositive ? "rgb(16 185 129)" : "rgb(225 29 72)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TopCard({ title, icon, rows, emptyText }) {
  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        {icon}
        <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      </div>
      <div className="p-3">
        {rows.length === 0 ? (
          <div className="text-[12px] text-slate-400 italic text-center py-5">{emptyText}</div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.key}
              className="flex items-center gap-3 px-2 py-2 rounded-[8px] hover:bg-slate-50"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold tabular-nums">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 truncate">{r.primary}</div>
                <div className="text-[11px] text-slate-500">{r.secondary}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] font-bold tabular-nums text-slate-900">{r.value}</div>
                <div
                  className={`text-[11px] font-semibold tabular-nums ${
                    r.tone === "emerald" ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {r.subValue}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
