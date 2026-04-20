// src/components/TransactionsTable.jsx
import React, { useMemo, useState } from "react";
import {
  Search,
  Pencil,
  Filter,
  Calendar,
  X,
  ArrowLeftRight,
  UserPlus,
  Lock,
} from "lucide-react";
import Select from "./ui/Select.jsx";
import { CURRENCIES, TYPES, officeName } from "../store/data.js";
import { useTransactions } from "../store/transactions.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { fmt } from "../utils/money.js";

export default function TransactionsTable({ currentOffice, justCreatedId, onEdit }) {
  const { t } = useTranslation();
  const { transactions } = useTransactions();
  const { canEditTransaction, isAdmin } = useAuth();

  const [filterCurrency, setFilterCurrency] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [filterDate, setFilterDate] = useState(t("today"));
  const [search, setSearch] = useState("");

  const DATE_OPTIONS = [
    t("today"),
    t("yesterday"),
    t("last_7"),
    t("this_month"),
    t("all_time"),
  ];

  const hasActiveFilters =
    filterCurrency !== "All" ||
    filterType !== "All" ||
    filterDate !== DATE_OPTIONS[0] ||
    search !== "";

  const officeTxs = useMemo(
    () => transactions.filter((tx) => tx.officeId === currentOffice),
    [transactions, currentOffice]
  );

  const filtered = useMemo(() => {
    return officeTxs.filter((tx) => {
      if (filterCurrency !== "All") {
        const outCurrencies = (tx.outputs || []).map((o) => o.currency);
        if (tx.curIn !== filterCurrency && !outCurrencies.includes(filterCurrency)) return false;
      }
      if (filterType !== "All" && tx.type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !tx.manager.toLowerCase().includes(q) &&
          !String(tx.amtIn).includes(q) &&
          !String(tx.amtOut).includes(q) &&
          !(tx.counterparty || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [officeTxs, filterCurrency, filterType, search]);

  const clearFilters = () => {
    setFilterCurrency("All");
    setFilterType("All");
    setFilterDate(DATE_OPTIONS[0]);
    setSearch("");
  };

  return (
    <section className="bg-white rounded-[14px] border border-slate-200/70 shadow-sm shadow-slate-900/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{t("transactions")}</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {filtered.length} of {officeTxs.length} · {officeName(currentOffice)}
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_placeholder")}
            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/70 focus:bg-white focus:border-slate-300 rounded-[8px] text-[13px] outline-none w-56 transition-colors placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-slate-500 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold tracking-wide uppercase">{t("filters")}</span>
        </div>
        <div>
          <Select
            value={filterCurrency}
            onChange={setFilterCurrency}
            options={["All", ...CURRENCIES]}
            compact
            icon={<span className="text-[10px] font-bold text-slate-400 tracking-wider">CCY</span>}
          />
        </div>
        <div>
          <Select
            value={filterType}
            onChange={setFilterType}
            options={TYPES}
            compact
            icon={<span className="text-[10px] font-bold text-slate-400 tracking-wider">TYPE</span>}
          />
        </div>
        <div>
          <Select
            value={filterDate}
            onChange={setFilterDate}
            options={DATE_OPTIONS}
            compact
            icon={<Calendar className="w-3 h-3 text-slate-400" />}
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-colors"
          >
            <X className="w-3 h-3" /> {t("clear")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100">
              <th className="px-5 py-2.5 font-bold">{t("time")}</th>
              <th className="px-3 py-2.5 font-bold">{t("type")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("in")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("out")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("rate")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("fee")}</th>
              <th className="px-3 py-2.5 font-bold text-right">{t("profit")}</th>
              <th className="px-3 py-2.5 font-bold">{t("manager")}</th>
              <th className="px-5 py-2.5 font-bold w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => {
              const isNew = tx.id === justCreatedId;
              const profitUp = tx.profit >= 0;
              const canEdit = canEditTransaction(tx);
              const outputs = tx.outputs || [{ currency: tx.curOut, amount: tx.amtOut, rate: tx.rate }];
              const firstOut = outputs[0];
              return (
                <tr
                  key={tx.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors group ${
                    isNew ? "bg-emerald-50/60" : ""
                  }`}
                >
                  <td className="px-5 py-3 whitespace-nowrap">
                    <div className="font-semibold text-slate-900 tabular-nums">{tx.time}</div>
                    <div className="text-[11px] text-slate-400">{tx.date}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                          tx.type === "EXCHANGE"
                            ? "bg-slate-100 text-slate-700"
                            : tx.type === "IN"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {tx.type === "EXCHANGE" && <ArrowLeftRight className="w-2.5 h-2.5" />}
                        {tx.type}
                      </span>
                      {tx.referral && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-700"
                          title="Referral"
                        >
                          <UserPlus className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{fmt(tx.amtIn, tx.curIn)}</div>
                    <div className="text-[11px] text-slate-400 font-medium">{tx.curIn}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900">
                      {fmt(firstOut.amount, firstOut.currency)}
                    </div>
                    <div className="text-[11px] text-slate-400 font-medium">
                      {firstOut.currency}
                      {outputs.length > 1 && (
                        <span className="ml-1 text-slate-500 font-bold">+{outputs.length - 1}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                    {firstOut.rate?.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-600">${fmt(tx.fee)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-md text-[13px] font-bold tabular-nums ${
                        tx.profit === 0
                          ? "bg-slate-50 text-slate-500"
                          : profitUp
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                      }`}
                    >
                      {tx.profit === 0 ? "—" : (profitUp ? "+" : "") + "$" + fmt(tx.profit)}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-700">
                        {tx.manager.split(". ")[1]?.[0] || tx.manager[0]}
                      </div>
                      <span className="text-slate-700 text-[13px]">{tx.manager}</span>
                      {isAdmin && tx.managerId !== undefined && (
                        <span className="text-[9px] text-slate-400">·</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {canEdit ? (
                      <button
                        onClick={() => onEdit?.(tx)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-900"
                        title={t("edit")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <div
                        className="opacity-0 group-hover:opacity-60 p-1.5 text-slate-400"
                        title={t("not_your_tx")}
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-16 text-center">
                  <div className="text-slate-400 text-[13px]">{t("no_match")}</div>
                  <button
                    onClick={clearFilters}
                    className="mt-2 text-[12px] text-slate-900 font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> {t("clear_filters")}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-[12px] flex-wrap gap-2">
        <div className="text-slate-500">
          {t("showing")}{" "}
          <span className="font-semibold text-slate-900">{filtered.length}</span>{" "}
          {t("transactions").toLowerCase()}
        </div>
        <div className="flex items-center gap-5">
          <div>
            <span className="text-slate-500">{t("total_fees")}: </span>
            <span className="font-bold text-slate-900 tabular-nums">
              ${fmt(filtered.reduce((s, tx) => s + (tx.fee || 0), 0))}
            </span>
          </div>
          <div>
            <span className="text-slate-500">{t("net_profit")}: </span>
            <span
              className={`font-bold tabular-nums ${
                filtered.reduce((s, tx) => s + tx.profit, 0) >= 0
                  ? "text-emerald-600"
                  : "text-rose-600"
              }`}
            >
              {filtered.reduce((s, tx) => s + tx.profit, 0) >= 0 ? "+" : ""}$
              {fmt(filtered.reduce((s, tx) => s + tx.profit, 0))}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
