// src/pages/capital/IncomeExpenseTab.jsx
// Таблица записей доходов/расходов + модалка Add income / Add expense с audit-логом.

import React, { useState, useMemo } from "react";
import { Receipt, Plus, ArrowDownLeft, ArrowUpRight, Trash2, Download, Tag } from "lucide-react";
import { exportCSV } from "../../utils/csv.js";
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
import { insertExpense, deleteExpenseById, insertCategory, withToast } from "../../lib/supabaseWrite.js";

export default function IncomeExpenseTab({ range }) {
  const { t } = useTranslation();
  const { entries, deleteEntry } = useIncomeExpense();
  const { findAccount } = useAccounts();
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { base, toBase } = useBaseCurrency();
  const sym = curSymbol(base);

  const [addType, setAddType] = useState(null); // null | "income" | "expense"
  // Filters
  const [typeFilter, setTypeFilter] = useState("all"); // all | income | expense
  const [officeFilter, setOfficeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");

  const scopedByRange = useMemo(
    () => entries.filter((e) => inRange(e.date, range)),
    [entries, range]
  );

  // Уникальные категории и офисы в scoped — для select options
  const uniqueCategories = useMemo(() => {
    const s = new Set();
    scopedByRange.forEach((e) => {
      if (e.category) s.add(e.category);
    });
    return [...s].sort();
  }, [scopedByRange]);

  const uniqueOffices = useMemo(() => {
    const s = new Set();
    scopedByRange.forEach((e) => {
      if (e.officeId) s.add(e.officeId);
    });
    return [...s];
  }, [scopedByRange]);

  // Apply filters
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedByRange.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (officeFilter !== "all" && e.officeId !== officeFilter) return false;
      if (categoryFilter !== "all" && (e.category || "") !== categoryFilter) return false;
      if (q) {
        const hay = `${e.category || ""} ${e.note || ""} ${e.currency}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedByRange, typeFilter, officeFilter, categoryFilter, search]);

  // Totals по отфильтрованным записям — для footer
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    scoped.forEach((e) => {
      const v = toBase(e.amount, e.currency);
      if (e.type === "income") income += v;
      else if (e.type === "expense") expense += v;
    });
    return { income, expense };
  }, [scoped, toBase]);

  const hasActiveFilters =
    typeFilter !== "all" || officeFilter !== "all" || categoryFilter !== "all" || search.trim();

  const clearFilters = () => {
    setTypeFilter("all");
    setOfficeFilter("all");
    setCategoryFilter("all");
    setSearch("");
  };

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
              {scoped.length} {t("pnl_entries")}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (scoped.length === 0) return;
                exportCSV({
                  filename: `coinplata-income-expense-${(range?.from || "").slice(0, 10)}_${(range?.to || "").slice(0, 10)}.csv`,
                  columns: [
                    { key: "date", label: "Date" },
                    { key: "type", label: "Type" },
                    { key: "category", label: "Category" },
                    { key: "amount", label: "Amount" },
                    { key: "currency", label: "Currency" },
                    { key: "office", label: "Office" },
                    { key: "account", label: "Account" },
                    { key: "note", label: "Note" },
                  ],
                  rows: scoped.map((e) => ({
                    date: e.date,
                    type: e.type,
                    category: e.category || "",
                    amount: e.amount,
                    currency: e.currency,
                    office: officeName(e.officeId) || "",
                    account: findAccount(e.accountId)?.name || "",
                    note: e.note || "",
                  })),
                });
              }}
              disabled={scoped.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={t("pnl_export_ie_tip")}
            >
              <Download className="w-3 h-3" />
              {t("export_csv")}
            </button>
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

        {/* Filter row */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap bg-slate-50/40">
          <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px]">
            {[
              { id: "all", label: t("oblig_all") },
              { id: "income", label: t("cat_type_income") },
              { id: "expense", label: t("cat_type_expense") },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-[6px] transition-all ${
                  typeFilter === f.id
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-[8px] px-2 py-1 text-[12px] font-medium outline-none hover:border-slate-300"
          >
            <option value="all">{t("oblig_all_offices")}</option>
            {uniqueOffices.map((oid) => (
              <option key={oid} value={oid}>
                {officeName(oid) || oid}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-[8px] px-2 py-1 text-[12px] font-medium outline-none hover:border-slate-300"
          >
            <option value="all">{t("ie_all_categories") || "All categories"}</option>
            {uniqueCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ie_search") || "Search category / note"}
            className="flex-1 min-w-[160px] bg-white border border-slate-200 rounded-[8px] px-2.5 py-1 text-[12px] outline-none focus:border-slate-400"
          />

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200"
            >
              {t("clear")}
            </button>
          )}

          <span className="text-[11px] text-slate-500 tabular-nums ml-auto">
            {scoped.length} / {scopedByRange.length} {t("pnl_entries")}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-500 tracking-[0.1em] uppercase border-b border-slate-100 bg-slate-50/40">
                <th className="px-5 py-2.5 font-bold">{t("ie_date")}</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_type")}</th>
                <th className="px-3 py-2.5 font-bold">{t("ie_category")}</th>
                <th className="px-3 py-2.5 font-bold">{t("oblig_col_office")}</th>
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
  const { categories: allCategories, addCategory: localAddCategory } = useCategories();

  const [officeId, setOfficeId] = useState(OFFICES[0].id);
  const [currency, setCurrency] = useState("USD");
  const [accountId, setAccountId] = useState("");
  // Category hierarchy: user picks parent → optionally picks subcategory
  const [parentCatId, setParentCatId] = useState("");
  const [subCatId, setSubCatId] = useState("");
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
      setParentCatId("");
      setSubCatId("");
      setAmount("");
      setNote("");
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [type]);

  // Parent categories фильтруются по type + parent_id IS NULL
  const parentCategories = useMemo(
    () => allCategories.filter((c) => c.type === type && !c.parentId),
    [allCategories, type]
  );
  // Subcategories — подчинённые текущему parent
  const subCategories = useMemo(
    () =>
      allCategories.filter(
        (c) => c.type === type && c.parentId && c.parentId === parentCatId
      ),
    [allCategories, type, parentCatId]
  );

  // Effective category: если subCatId выбран → его; иначе parent.
  const effectiveCategoryId = subCatId || parentCatId;
  const effectiveCategory = useMemo(
    () => allCategories.find((c) => c.id === effectiveCategoryId),
    [allCategories, effectiveCategoryId]
  );

  // При смене parent сбрасываем sub если он больше не принадлежит parent'у.
  React.useEffect(() => {
    if (subCatId && !subCategories.some((c) => c.id === subCatId)) {
      setSubCatId("");
    }
  }, [parentCatId, subCategories, subCatId]);

  // Inline create helpers
  const handleCreateCategory = async (name, parentId) => {
    const cleanName = (name || "").trim();
    if (!cleanName) return null;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => insertCategory({ name: cleanName, type, parentId: parentId || null }),
        { success: null, errorPrefix: "Failed to add category" }
      );
      return res.ok ? res.result : null;
    }
    const r = localAddCategory({ name: cleanName, type, parentId: parentId || null });
    return r.ok ? r.category : null;
  };

  // Auto-pick first matching account when filters change
  React.useEffect(() => {
    if (!availableAccounts.find((a) => a.id === accountId)) {
      setAccountId(availableAccounts[0]?.id || "");
    }
  }, [availableAccounts, accountId]);

  // effective category нужна для canSubmit + audit summary
  const canSubmit = amount && parseFloat(amount) > 0 && effectiveCategoryId && officeId;

  // ВАЖНО: useMemo до early-return, иначе React #310 (rules of hooks).
  const summaryPath = useMemo(() => {
    if (!effectiveCategory) return "";
    if (effectiveCategory.parentId) {
      const parent = allCategories.find((c) => c.id === effectiveCategory.parentId);
      return parent ? `${parent.name} / ${effectiveCategory.name}` : effectiveCategory.name;
    }
    return effectiveCategory.name;
  }, [effectiveCategory, allCategories]);

  // Early return ПОСЛЕ всех хуков — rules of hooks.
  if (!type) return null;

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    const amt = parseFloat(amount);

    if (isSupabaseConfigured) {
      setBusy(true);
      try {
        const res = await withToast(
          () =>
            insertExpense({
              type,
              officeId,
              accountId: accountId || null,
              categoryId: effectiveCategoryId,
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
            summary: `${summaryPath}: ${curSymbol(currency)}${fmt(amt, currency)} ${currency} (${officeName(officeId)})`,
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
      category: summaryPath,
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
        source: { kind: type, refId: entry.id, note: summaryPath },
        createdBy: currentUser.id,
      });
    }
    onLog({
      action: "create",
      entity: type,
      entityId: entry.id,
      summary: `${summaryPath}: ${curSymbol(currency)}${fmt(amt, currency)} ${currency} (${officeName(officeId)})`,
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
              {t("oblig_col_office")}
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
              {t("oblig_currency_label")}
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

        {/* Category + Subcategory */}
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-slate-500 tracking-wide uppercase">
            {t("ie_category") || "Category"}
          </label>
          <CategoryPicker
            label={t("cat_type") /* "Category" equivalent; reuse */}
            value={parentCatId}
            onChange={(v) => {
              setParentCatId(v);
              setSubCatId("");
            }}
            options={parentCategories}
            onCreate={async (name) => {
              const created = await handleCreateCategory(name, null);
              if (created) setParentCatId(created.id);
            }}
            placeholder={t("ie_select_category") || "Select category"}
          />
          {parentCatId && (
            <CategoryPicker
              label={t("cat_subcategory")}
              value={subCatId}
              onChange={setSubCatId}
              options={subCategories}
              onCreate={async (name) => {
                const created = await handleCreateCategory(name, parentCatId);
                if (created) setSubCatId(created.id);
              }}
              placeholder={t("ie_select_subcategory") || "No subcategory (optional)"}
              indent
              allowClear
            />
          )}
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

// ----------------------------------------
// CategoryPicker — dropdown + inline "+ New" создание
// ----------------------------------------
function CategoryPicker({
  label,
  value,
  onChange,
  options,
  onCreate,
  placeholder,
  indent = false,
  allowClear = false,
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onCreate(name);
      setNewName("");
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={indent ? "pl-4 border-l-2 border-slate-200" : ""}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {allowClear && value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors"
            >
              clear
            </button>
          )}
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-[10px] font-semibold text-slate-500 hover:text-slate-900 transition-colors inline-flex items-center gap-0.5"
            >
              + New
            </button>
          )}
        </div>
      </div>
      {creating ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              } else if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            autoFocus
            placeholder={`New ${label.toLowerCase()} name…`}
            className="flex-1 bg-white border border-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim() || saving}
            className={`px-3 py-2 rounded-[10px] text-[12px] font-semibold ${
              newName.trim() && !saving
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {saving ? "…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
            className="px-2 py-2 rounded-[10px] text-[12px] text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
      ) : (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] font-medium outline-none transition-colors"
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
