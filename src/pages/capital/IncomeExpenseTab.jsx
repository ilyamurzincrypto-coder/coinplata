// src/pages/capital/IncomeExpenseTab.jsx
// Таблица записей доходов/расходов + модалка Add income / Add expense с audit-логом.

import React, { useState, useMemo } from "react";
import { Receipt, Plus, ArrowDownLeft, ArrowUpRight, Trash2 } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import SegmentedControl from "../../components/ui/SegmentedControl.jsx";
import { useIncomeExpense } from "../../store/incomeExpense.jsx";
import { useCategories } from "../../store/categories.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAudit } from "../../store/audit.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { useTranslation } from "../../i18n/translations.jsx";
import { OFFICES, officeName } from "../../store/data.js";
import { useCurrencies } from "../../store/currencies.jsx";
import { fmt, curSymbol } from "../../utils/money.js";
import { toISODate } from "../../utils/date.js";
import { inRange } from "../../components/ui/DateRangePicker.jsx";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { insertExpense, deleteExpenseById, withToast } from "../../lib/supabaseWrite.js";

export default function IncomeExpenseTab({ range }) {
  const { t } = useTranslation();
  const { entries, deleteEntry } = useIncomeExpense();
  const { findAccount } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const [addType, setAddType] = useState(null); // null | "income" | "expense"

  const scoped = useMemo(
    () => entries.filter((e) => inRange(e.date, range)),
    [entries, range]
  );

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    scoped.forEach((e) => {
      // Складываем в base currency — нельзя просто суммировать amount из разных валют
      const v = toBase(e.amount, e.currency);
      if (e.type === "income") income += v;
      else expense += v;
    });
    return { income, expense };
  }, [scoped, toBase]);

  const handleDelete = async (entry) => {
    if (!confirm(`Delete ${entry.type} ${curSymbol(entry.currency)}${fmt(entry.amount, entry.currency)} ${entry.currency}?`))
      return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => deleteExpenseById(entry.id),
        { success: "Entry deleted", errorPrefix: "Delete failed" }
      );
      if (res.ok) {
        logAudit({
          action: "delete",
          entity: entry.type,
          entityId: entry.id,
          summary: `${entry.category}: ${curSymbol(entry.currency)}${fmt(entry.amount, entry.currency)} ${entry.currency}`,
        });
      }
      return;
    }
    deleteEntry(entry.id);
    logAudit({
      action: "delete",
      entity: entry.type,
      entityId: entry.id,
      summary: `${entry.category}: ${curSymbol(entry.currency)}${fmt(entry.amount, entry.currency)} ${entry.currency}`,
    });
  };

  return (
    <>
      <section className="bg-white rounded-[14px] border border-slate-200/70 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-slate-500" />
              <h2 className="text-[15px] font-semibold tracking-tight">{t("ie_title")}</h2>
            </div>
            <div className="text-[12px] text-slate-500 tabular-nums">
              {scoped.length} entries
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddType("income")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t("ie_add_income")}
            </button>
            <button
              onClick={() => setAddType("expense")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t("ie_add_expense")}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
                <th className="px-5 py-2.5 font-bold">{t("ie_date")}</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_type")}</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_category")}</th>
                <th className="px-3 py-2.5 font-bold">Office</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_account")}</th>
                <th className="px-3 py-2.5 font-bold text-right">{t("ie_amount")}</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_note")}</th>
                <th className="px-5 py-2.5 font-bold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {scoped.map((e) => {
                const acc = findAccount(e.accountId);
                const isIncome = e.type === "income";
                return (
                  <tr
                    key={e.id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors group"
                  >
                    <td className="px-5 py-3 whitespace-nowrap font-medium text-slate-700 tabular-nums">
                      {e.date}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${
                          isIncome
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {isIncome ? (
                          <ArrowDownLeft className="w-2.5 h-2.5" />
                        ) : (
                          <ArrowUpRight className="w-2.5 h-2.5" />
                        )}
                        {isIncome ? t("ie_income") : t("ie_expense")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{e.category}</td>
                    <td className="px-3 py-3 text-slate-600">{officeName(e.officeId)}</td>
                    <td className="px-3 py-3 text-slate-600">{acc?.name || "—"}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span
                        className={`font-bold tabular-nums ${
                          isIncome ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {isIncome ? "+" : "−"}
                        {curSymbol(e.currency)}
                        {fmt(e.amount, e.currency)}
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium ml-1">{e.currency}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-500 max-w-xs truncate">{e.note || "—"}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => handleDelete(e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {scoped.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    {t("ie_empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer totals */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between text-[12px] flex-wrap gap-2">
          <div className="text-slate-500">
            Showing <span className="font-semibold text-slate-900">{scoped.length}</span> entries
          </div>
          <div className="flex items-center gap-5">
            <div>
              <span className="text-slate-500">Income: </span>
              <span className="font-bold text-emerald-600 tabular-nums">+{sym}{fmt(totals.income, base)}</span>
            </div>
            <div>
              <span className="text-slate-500">Expense: </span>
              <span className="font-bold text-rose-600 tabular-nums">−{sym}{fmt(totals.expense, base)}</span>
            </div>
          </div>
        </div>
      </section>

      <AddEntryModal
        type={addType}
        onClose={() => setAddType(null)}
        currentUser={currentUser}
        onLog={logAudit}
      />
    </>
  );
}

// ---------- Add Entry Modal ----------
function AddEntryModal({ type, onClose, currentUser, onLog }) {
  const { t } = useTranslation();
  const { addEntry } = useIncomeExpense();
  const { accountsByOffice, addMovement } = useAccounts();
  const { codes: CURRENCIES } = useCurrencies();
  const { byType: categoriesByType, byName: findCategoryByName } = useCategories();

  const [officeId, setOfficeId] = useState(OFFICES[0].id);
  const [currency, setCurrency] = useState("USD");
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const availableAccounts = useMemo(
    () => accountsByOffice(officeId, { currency }),
    [accountsByOffice, officeId, currency]
  );

  // Reset when opened
  React.useEffect(() => {
    if (type) {
      setOfficeId(OFFICES[0].id);
      setCurrency("USD");
      setAccountId("");
      setCategory("");
      setAmount("");
      setNote("");
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [type]);

  // Auto-pick first matching account when filters change
  React.useEffect(() => {
    if (!availableAccounts.find((a) => a.id === accountId)) {
      setAccountId(availableAccounts[0]?.id || "");
    }
  }, [availableAccounts, accountId]);

  if (!type) return null;

  const categories = categoriesByType(type).map((c) => c.name);
  const canSubmit = amount && parseFloat(amount) > 0 && category && officeId;

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    const amt = parseFloat(amount);

    if (isSupabaseConfigured) {
      const cat = findCategoryByName(category, type);
      if (!cat) return; // категория не подгружена из БД
      setBusy(true);
      try {
        const res = await withToast(
          () =>
            insertExpense({
              type,
              officeId,
              accountId: accountId || null,
              categoryId: cat.id,
              amount: amt,
              currency,
              entryDate: date,
              note: note.trim(),
              createdBy: currentUser.id,
            }),
          { success: `${type} recorded`, errorPrefix: `${type} failed` }
        );
        if (res.ok) {
          onLog({
            action: "create",
            entity: type,
            entityId: res.result?.id || "",
            summary: `${category}: ${curSymbol(currency)}${fmt(amt, currency)} ${currency} (${officeName(officeId)})`,
          });
          onClose();
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const entry = addEntry({
      type,
      officeId,
      accountId,
      category,
      amount: amt,
      currency,
      note: note.trim(),
      createdBy: currentUser.id,
      date,
    });
    if (accountId) {
      addMovement({
        accountId,
        amount: amt,
        direction: type === "income" ? "in" : "out",
        currency,
        source: { kind: type, refId: entry.id, note: category },
        createdBy: currentUser.id,
      });
    }
    onLog({
      action: "create",
      entity: type,
      entityId: entry.id,
      summary: `${category}: ${curSymbol(currency)}${fmt(amt, currency)} ${currency} (${officeName(officeId)})`,
    });
    onClose();
  };

  const isIncome = type === "income";

  return (
    <Modal
      open={!!type}
      onClose={onClose}
      title={isIncome ? t("ie_add_income") : t("ie_add_expense")}
      width="lg"
    >
      <div className="p-5 space-y-3">
        {/* Office + Currency */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Office
            </label>
            <select
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            >
              {OFFICES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              Currency
            </label>
            <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`px-2.5 py-1 text-[12px] font-bold rounded-[8px] transition-all ${
                    currency === c
                      ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("ie_amount")}
          </label>
          <div
            className={`relative flex items-baseline gap-2 bg-slate-50 rounded-[12px] border-2 transition-all px-4 py-3 ${
              amount ? (isIncome ? "border-emerald-400" : "border-slate-400") : "border-slate-200"
            }`}
          >
            <span className="text-slate-400 text-[18px] font-semibold">{curSymbol(currency)}</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="0"
              autoFocus
              className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
            />
            <span className="text-slate-400 text-[12px] font-bold tracking-wider">{currency}</span>
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("ie_category")}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-all ${
                  category === c
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Account */}
        {availableAccounts.length > 0 && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("ie_account")}
            </label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            >
              {availableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date + Note */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("ie_date")}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
              {t("ie_note")}
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="—"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
            />
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
        >
          {t("cancel")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit && !busy
              ? isIncome
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Saving…" : isIncome ? t("ie_add_income") : t("ie_add_expense")}
        </button>
      </div>
    </Modal>
  );
}
