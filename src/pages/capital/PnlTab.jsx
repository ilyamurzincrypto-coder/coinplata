// src/pages/capital/PnlTab.jsx
// P&L: Revenue (exchange profit) + Income - Expenses = Net profit.
// Использует общий range из CapitalPage; внутри — локальный period-switcher
// Today / Week / Month / Custom (перезаписывает range).
// Default — Today (per task spec).

import React, { useMemo, useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, Building2, Coins, Tag, X, ChevronRight } from "lucide-react";
import { useTransactions } from "../../store/transactions.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { officeName } from "../../store/data.js";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import DateRangePicker, { rangeForPreset, inRange } from "../../components/ui/DateRangePicker.jsx";
import Modal from "../../components/ui/Modal.jsx";

// Получает пропс `range` из CapitalPage, но внутри мы сразу переопределяем
// на "Today" при первом рендере — per spec default. Дальнейшее переключение
// живёт здесь локально и синхронизируется назад (через onRangeChange если есть).
export default function PnlTab({ range, onRangeChange }) {
  const { transactions } = useTransactions();
  const { entries } = useIncomeExpense();
  const { offices } = useOffices();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  // Drill-down state. `drill` = { kind: "revenue"|"expenses"|"net"|"office", officeId? }
  const [drill, setDrill] = useState(null);

  // На первом рендере — если родитель даёт range с preset !== "today",
  // предлагаем (не форсим) переключиться через onRangeChange.
  useEffect(() => {
    if (onRangeChange && range?.preset && range.preset !== "today") {
      const r = rangeForPreset("today");
      onRangeChange({ preset: "today", ...r });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPreset = (preset) => {
    const r = rangeForPreset(preset);
    const next = { preset, ...r };
    onRangeChange?.(next);
  };

  const setRangeDirect = (next) => onRangeChange?.(next);

  const scopedTx = useMemo(
    () =>
      transactions.filter(
        (tx) => tx.status !== "deleted" && inRange(toISODate(tx.date), range)
      ),
    [transactions, range]
  );
  const scopedIE = useMemo(
    () => entries.filter((e) => inRange(e.date, range)),
    [entries, range]
  );

  const { revenueExchange, income, expense, net, byOffice, byCurrency, byCategory } = useMemo(() => {

    // Revenue = прибыль от обменных сделок (tx.profit в USD → в base).
    const revenueExchange = scopedTx.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);

    const income = scopedIE
      .filter((e) => e.type === "income")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);

    const expense = scopedIE
      .filter((e) => e.type === "expense")
      .reduce((s, e) => s + toBase(e.amount, e.currency), 0);

    const net = revenueExchange + income - expense;

    // Breakdown по офисам
    const byOfficeMap = new Map();
    offices.forEach((o) => {
      byOfficeMap.set(o.id, { revenue: 0, income: 0, expense: 0 });
    });
    scopedTx.forEach((tx) => {
      const bucket = byOfficeMap.get(tx.officeId);
      if (bucket) bucket.revenue += toBase(tx.profit || 0, "USD");
    });
    scopedIE.forEach((e) => {
      const bucket = byOfficeMap.get(e.officeId);
      if (!bucket) return;
      if (e.type === "income") bucket.income += toBase(e.amount, e.currency);
      else if (e.type === "expense") bucket.expense += toBase(e.amount, e.currency);
    });
    const byOffice = [...byOfficeMap.entries()]
      .map(([id, b]) => ({
        officeId: id,
        name: officeName(id) || id,
        revenue: b.revenue,
        income: b.income,
        expense: b.expense,
        net: b.revenue + b.income - b.expense,
      }))
      .sort((a, b) => b.net - a.net);

    // Breakdown по валютам (по curIn на сделке)
    const byCurMap = new Map();
    scopedTx.forEach((tx) => {
      const key = tx.curIn;
      if (!byCurMap.has(key)) byCurMap.set(key, { revenue: 0, count: 0, volume: 0 });
      const b = byCurMap.get(key);
      b.revenue += toBase(tx.profit || 0, "USD");
      b.count += 1;
      b.volume += toBase(tx.amtIn, tx.curIn);
    });
    const byCurrency = [...byCurMap.entries()]
      .map(([currency, b]) => ({ currency, ...b }))
      .sort((a, b) => b.revenue - a.revenue);

    // Breakdown по категориям (только расходы — per spec: "Expenses: Rent/Salaries/Marketing").
    // Income-категории показываем отдельно для полноты.
    const byCatMap = new Map();
    scopedIE.forEach((e) => {
      const key = `${e.type}|${e.category || "Uncategorized"}`;
      if (!byCatMap.has(key)) byCatMap.set(key, { type: e.type, category: e.category || "Uncategorized", amount: 0 });
      byCatMap.get(key).amount += toBase(e.amount, e.currency);
    });
    const byCategory = [...byCatMap.values()].sort((a, b) => b.amount - a.amount);

    return { revenueExchange, income, expense, net, byOffice, byCurrency, byCategory };
  }, [scopedTx, scopedIE, offices, toBase]);

  const revenueTotal = revenueExchange + income;

  return (
    <div className="space-y-4">
      {/* Period switcher */}
      <div className="bg-white border border-slate-200/70 rounded-[12px] p-3 flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5">
          {[
            { id: "today", label: "Today" },
            { id: "week", label: "Week" },
            { id: "month", label: "Month" },
          ].map((p) => {
            const active = range?.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 text-[12px] font-semibold rounded-[8px] transition-all ${
                  active ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPreset("custom")}
            className={`px-3 py-1.5 text-[12px] font-semibold rounded-[8px] transition-all ${
              range?.preset === "custom" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Custom
          </button>
        </div>
        <DateRangePicker value={range} onChange={setRangeDirect} />
      </div>

      {/* KPI: Revenue / Expenses / Net — все карточки кликабельны для drill-down */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PnlCard
          label="Revenue"
          value={`${sym}${fmt(revenueTotal, base)}`}
          sub={`Deals ${sym}${fmt(revenueExchange, base)} · Income ${sym}${fmt(income, base)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          tone="emerald"
          onClick={() => setDrill({ kind: "revenue" })}
        />
        <PnlCard
          label="Expenses"
          value={`${sym}${fmt(expense, base)}`}
          sub="Salaries, rent, utilities…"
          icon={<TrendingDown className="w-4 h-4" />}
          tone="rose"
          onClick={() => setDrill({ kind: "expenses" })}
        />
        <PnlCard
          label="Net profit"
          value={`${net >= 0 ? "+" : ""}${sym}${fmt(net, base)}`}
          sub="Revenue − Expenses"
          icon={<Wallet className="w-4 h-4" />}
          tone={net >= 0 ? "emerald" : "rose"}
          emphasize
          onClick={() => setDrill({ kind: "net" })}
        />
      </div>

      {/* Breakdown by office */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold">By office</h3>
        </div>
        {byOffice.filter((b) => b.revenue || b.income || b.expense).length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">No activity in this period</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {byOffice.map((b) => (
              <button
                key={b.officeId}
                type="button"
                onClick={() => setDrill({ kind: "office", officeId: b.officeId })}
                className="w-full px-5 py-3 flex items-center justify-between flex-wrap gap-2 hover:bg-slate-50 text-left transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{b.name}</span>
                </div>
                <div className="flex items-center gap-4 text-[12px] tabular-nums">
                  <Stat label="Rev" value={b.revenue} sym={sym} tone="emerald" />
                  <Stat label="Inc" value={b.income} sym={sym} tone="slate" />
                  <Stat label="Exp" value={b.expense} sym={sym} tone="rose" negate />
                  <Stat label="Net" value={b.net} sym={sym} tone={b.net >= 0 ? "emerald" : "rose"} bold />
                  <ChevronRight className="w-3 h-3 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Breakdown by category — только income/expense записи, не exchange profit */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Tag className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold">By category</h3>
          <span className="text-[11px] text-slate-400">· income/expense entries only (exchange profit not categorized)</span>
        </div>
        {byCategory.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">No categorized entries in this period</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {byCategory.map((c) => {
              const isIncome = c.type === "income";
              return (
                <div key={`${c.type}-${c.category}`} className="px-5 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      isIncome ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                    }`}>
                      {isIncome ? "INC" : "EXP"}
                    </span>
                    <span className="text-[13px] font-semibold text-slate-800">{c.category}</span>
                  </div>
                  <span className={`text-[13px] font-bold tabular-nums ${isIncome ? "text-emerald-700" : "text-rose-700"}`}>
                    {isIncome ? "+" : "−"}{sym}{fmt(c.amount, base)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <PnlDrillModal
        drill={drill}
        onClose={() => setDrill(null)}
        scopedTx={scopedTx}
        scopedIE={scopedIE}
        toBase={toBase}
        base={base}
        sym={sym}
      />

      {/* Breakdown by currency */}
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Coins className="w-4 h-4 text-slate-500" />
          <h3 className="text-[14px] font-semibold">By currency (by incoming leg)</h3>
        </div>
        {byCurrency.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-slate-400">No deals in this period</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {byCurrency.map((b) => (
              <div key={b.currency} className="px-5 py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold tracking-wider">
                    {b.currency}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {b.count} deals · vol {sym}{fmt(b.volume, base)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[12px] tabular-nums">
                  <Stat label="Rev" value={b.revenue} sym={sym} tone={b.revenue >= 0 ? "emerald" : "rose"} bold />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PnlCard({ label, value, sub, icon, tone, emphasize, onClick }) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
      ? "text-rose-700"
      : "text-slate-900";
  const clickable = typeof onClick === "function";
  const Comp = clickable ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-[12px] p-4 text-left w-full ${
        emphasize ? "ring-2 ring-emerald-100" : ""
      } ${clickable ? "hover:border-slate-300 hover:shadow-sm transition-colors" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
        {icon}
        {label}
        {clickable && <ChevronRight className="w-3 h-3 ml-auto text-slate-300" />}
      </div>
      <div className={`text-[22px] font-bold tabular-nums tracking-tight ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </Comp>
  );
}

// =========================================================================
// PnL drill-down modal. Показывает:
//   — для revenue: список всех exchange-сделок с in/out/fee/profit (accounting view)
//     + income-записи
//   — для expenses: expenses-записи по категориям
//   — для net: summary блок + список сделок
//   — для office: всё выше, но только для одного офиса
// =========================================================================
function PnlDrillModal({ drill, onClose, scopedTx, scopedIE, toBase, base, sym }) {
  if (!drill) return null;

  // Фильтрация по office если нужно.
  const txs = drill.officeId
    ? scopedTx.filter((tx) => tx.officeId === drill.officeId)
    : scopedTx;
  const ies = drill.officeId
    ? scopedIE.filter((e) => e.officeId === drill.officeId)
    : scopedIE;

  const revenueExchange = txs.reduce((s, tx) => s + toBase(tx.profit || 0, "USD"), 0);
  const income = ies.filter((e) => e.type === "income").reduce((s, e) => s + toBase(e.amount, e.currency), 0);
  const expense = ies.filter((e) => e.type === "expense").reduce((s, e) => s + toBase(e.amount, e.currency), 0);

  const title =
    drill.kind === "revenue"
      ? `Revenue · ${drill.officeId ? officeName(drill.officeId) : "All offices"}`
      : drill.kind === "expenses"
      ? `Expenses · ${drill.officeId ? officeName(drill.officeId) : "All offices"}`
      : drill.kind === "office"
      ? `P&L · ${officeName(drill.officeId)}`
      : `Net profit · ${drill.officeId ? officeName(drill.officeId) : "All offices"}`;

  const showRevenueBreakdown = drill.kind === "revenue" || drill.kind === "net" || drill.kind === "office";
  const showExpensesBreakdown = drill.kind === "expenses" || drill.kind === "net" || drill.kind === "office";
  const showTxList = drill.kind === "revenue" || drill.kind === "net" || drill.kind === "office";

  // Группировка expenses по категориям.
  const expenseByCat = new Map();
  ies.forEach((e) => {
    if (e.type !== "expense") return;
    if (!expenseByCat.has(e.category)) expenseByCat.set(e.category, { amount: 0, entries: [] });
    const b = expenseByCat.get(e.category);
    b.amount += toBase(e.amount, e.currency);
    b.entries.push(e);
  });
  const expenseCats = [...expenseByCat.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <Modal open={!!drill} onClose={onClose} title={title} width="2xl">
      <div className="p-5 max-h-[70vh] overflow-auto space-y-4">
        {/* Summary row — Level 1 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MiniKpi label="Exchange profit" value={revenueExchange} sym={sym} tone={revenueExchange >= 0 ? "emerald" : "rose"} />
          <MiniKpi label="Other income" value={income} sym={sym} tone="emerald" />
          <MiniKpi label="Expenses" value={expense} sym={sym} tone="rose" negate />
          <MiniKpi
            label="Net"
            value={revenueExchange + income - expense}
            sym={sym}
            tone={(revenueExchange + income - expense) >= 0 ? "emerald" : "rose"}
            bold
          />
        </div>

        {/* Level 2: Revenue breakdown */}
        {showRevenueBreakdown && (
          <div>
            <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Revenue sources
            </h4>
            <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
              <DrillRow label={`Exchange profit (${txs.length} deals)`} amount={revenueExchange} sym={sym} tone="emerald" />
              <DrillRow label={`Other income (${ies.filter((e) => e.type === "income").length} entries)`} amount={income} sym={sym} tone="emerald" />
            </div>
          </div>
        )}

        {/* Level 2: Expenses breakdown по категориям */}
        {showExpensesBreakdown && (
          <div>
            <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Expenses by category
            </h4>
            {expenseCats.length === 0 ? (
              <div className="text-[12px] text-slate-400 italic py-2">No expenses in this period</div>
            ) : (
              <div className="border border-slate-200 rounded-[10px] overflow-hidden divide-y divide-slate-100">
                {expenseCats.map((c) => (
                  <details key={c.category}>
                    <summary className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-50 list-none">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-slate-400 transition-transform group-open:rotate-90" />
                        <span className="font-semibold text-slate-800 text-[13px]">{c.category}</span>
                        <span className="text-[10px] text-slate-400">({c.entries.length})</span>
                      </div>
                      <span className="font-bold text-rose-700 tabular-nums">
                        −{sym}{fmt(c.amount, base)}
                      </span>
                    </summary>
                    <div className="bg-slate-50/50 divide-y divide-slate-100">
                      {c.entries.map((e) => (
                        <div key={e.id} className="px-6 py-1.5 flex items-center justify-between text-[12px]">
                          <span className="text-slate-600">
                            {e.date} · {e.note || "—"}
                          </span>
                          <span className="font-semibold text-rose-700 tabular-nums">
                            −{curSymbol(e.currency)}{fmt(e.amount, e.currency)} {e.currency}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Level 3: Exchange transactions (accounting view) */}
        {showTxList && (
          <div>
            <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Exchange transactions · accounting view
            </h4>
            {txs.length === 0 ? (
              <div className="text-[12px] text-slate-400 italic py-2">No deals in this period</div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-[10px]">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50/60">
                    <tr className="text-left text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">In</th>
                      <th className="px-3 py-2">Out</th>
                      <th className="px-3 py-2 text-right">Fee</th>
                      <th className="px-3 py-2 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map((tx) => {
                      const outs = tx.outputs || [{ currency: tx.curOut, amount: tx.amtOut }];
                      const profitBase = toBase(tx.profit || 0, "USD");
                      return (
                        <tr key={tx.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-600 tabular-nums whitespace-nowrap">
                            {tx.date} {tx.time}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            <span className="font-semibold text-slate-900">{fmt(tx.amtIn, tx.curIn)}</span>{" "}
                            <span className="text-slate-500">{tx.curIn}</span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {outs.map((o, i) => (
                              <div key={i}>
                                <span className="font-semibold text-slate-900">{fmt(o.amount, o.currency)}</span>{" "}
                                <span className="text-slate-500">{o.currency}</span>
                              </div>
                            ))}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">${fmt(tx.fee)}</td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                                profitBase >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {profitBase >= 0 ? "+" : ""}{sym}{fmt(profitBase, base)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Close
        </button>
      </div>
    </Modal>
  );
}

function MiniKpi({ label, value, sym, tone, negate, bold }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-700 bg-emerald-50 border-emerald-100"
    : tone === "rose" ? "text-rose-700 bg-rose-50 border-rose-100"
    : "text-slate-900 bg-slate-50/60 border-slate-200";
  const sign = negate && value > 0 ? "−" : value >= 0 && bold ? "+" : "";
  return (
    <div className={`rounded-[8px] border p-2.5 ${toneCls}`}>
      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-[16px] ${bold ? "font-bold" : "font-semibold"} tabular-nums tracking-tight mt-0.5`}>
        {sign}{sym}{fmt(value)}
      </div>
    </div>
  );
}

function DrillRow({ label, amount, sym, tone }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="px-4 py-2 flex items-center justify-between bg-white">
      <span className="text-[13px] font-medium text-slate-800">{label}</span>
      <span className={`font-bold tabular-nums ${cls}`}>
        {sym}{fmt(amount)}
      </span>
    </div>
  );
}

function Stat({ label, value, sym, tone, bold, negate }) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "rose"
      ? "text-rose-700"
      : "text-slate-600";
  const display = negate && value > 0 ? `−${sym}${fmt(value)}` : `${sym}${fmt(value)}`;
  return (
    <div className="inline-flex items-baseline gap-1">
      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      <span className={`${bold ? "font-bold" : "font-semibold"} ${toneCls}`}>{display}</span>
    </div>
  );
}
