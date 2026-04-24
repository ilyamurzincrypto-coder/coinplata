// src/pages/settings/MasterDataTab.jsx
// Единая точка управления справочниками: Categories, Currencies, Channels, Client tags.
// Categories — полный CRUD. Currencies — полный CRUD (тот же store что и Rates).
// Channels — read-only (каноническое место создания осталось в Dashboard → Edit rates).
// Client tags — read-only (захардкожены как константы).

import React, { useState, useMemo } from "react";
import { Tag, Coins, Network as NetworkIcon, UserPlus as TagIcon, Plus, Trash2, Pencil, Info, Book } from "lucide-react";
import Modal from "../../components/ui/Modal.jsx";
import { useCategories, CATEGORY_GROUPS } from "../../store/categories.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useRates } from "../../store/rates.jsx";
import { useAudit } from "../../store/audit.jsx";
import { CLIENT_TAGS } from "../../store/data.js";
import { channelShortLabel } from "../../utils/accountChannel.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import {
  insertCategory,
  updateCategoryRow,
  deleteCategoryRow,
  insertCurrencyRow,
  updateCurrencyRow,
  deleteCurrencyRow,
  withToast,
} from "../../lib/supabaseWrite.js";
import { useTranslation } from "../../i18n/translations.jsx";

const SECTIONS = [
  { id: "categories", label: "Categories", icon: Tag },
  { id: "currencies", label: "Currencies", icon: Coins },
  { id: "channels", label: "Channels", icon: NetworkIcon },
  { id: "tags", label: "Client tags", icon: TagIcon },
];

export default function MasterDataTab() {
  const [section, setSection] = useState("categories");

  return (
    <div>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Book className="w-4 h-4 text-slate-500" />
        <h2 className="text-[16px] font-semibold tracking-tight">Master data</h2>
        <span className="text-[11px] text-slate-400">· unified reference dictionaries</span>
      </div>

      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-1 flex-wrap">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = s.id === section;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="w-3 h-3" />
              {s.label}
            </button>
          );
        })}
      </div>

      {section === "categories" && <CategoriesSection />}
      {section === "currencies" && <CurrenciesSection />}
      {section === "channels" && <ChannelsSection />}
      {section === "tags" && <TagsSection />}
    </div>
  );
}

// =========================================================================
// Categories — полный CRUD
// =========================================================================
function CategoriesSection() {
  const { t } = useTranslation();
  const { categories, addCategory, updateCategory, removeCategory } = useCategories();
  const { addEntry: logAudit } = useAudit();
  const [editing, setEditing] = useState(null); // null | { kind: 'new'|'edit', type, data?, parentId? }

  const grouped = useMemo(() => {
    const income = categories.filter((c) => c.type === "income");
    const expense = categories.filter((c) => c.type === "expense");
    return { income, expense };
  }, [categories]);

  const handleSave = async (payload) => {
    // payload = { name, type, group, parentId }
    if (editing?.kind === "new") {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () =>
            insertCategory({
              name: payload.name,
              type: payload.type,
              parentId: payload.parentId || null,
              groupName: payload.group,
            }),
          { success: t("cat_saved"), errorPrefix: t("cat_save_failed") }
        );
        if (res.ok && res.result) {
          logAudit({
            action: "create",
            entity: "category",
            entityId: res.result.id,
            summary: `Added ${payload.type} category "${payload.name}"${payload.parentId ? " (subcategory)" : ""}`,
          });
        }
      } else {
        const res = addCategory(payload);
        if (res.ok) {
          logAudit({
            action: "create",
            entity: "category",
            entityId: res.category.id,
            summary: `Added ${payload.type} category "${payload.name}"`,
          });
        }
      }
    } else if (editing?.data?.id) {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () =>
            updateCategoryRow(editing.data.id, {
              name: payload.name,
              type: payload.type,
              parentId: payload.parentId || null,
              groupName: payload.group,
            }),
          { success: t("cat_saved"), errorPrefix: t("cat_save_failed") }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "category",
            entityId: editing.data.id,
            summary: `Updated category "${payload.name}"`,
          });
        }
      } else {
        updateCategory(editing.data.id, payload);
        logAudit({
          action: "update",
          entity: "category",
          entityId: editing.data.id,
          summary: `Updated category "${payload.name}"`,
        });
      }
    }
    setEditing(null);
  };

  const handleDelete = async (cat) => {
    if (!confirm(t("cat_confirm_delete").replace("{name}", cat.name))) return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => deleteCategoryRow(cat.id),
        { success: t("cat_deleted"), errorPrefix: t("cat_delete_failed") }
      );
      if (res.ok) {
        logAudit({
          action: "delete",
          entity: "category",
          entityId: cat.id,
          summary: `Removed ${cat.type} category "${cat.name}"`,
        });
      }
      return;
    }
    removeCategory(cat.id);
    logAudit({
      action: "delete",
      entity: "category",
      entityId: cat.id,
      summary: `Removed ${cat.type} category "${cat.name}"`,
    });
  };

  return (
    <div className="p-5 space-y-5">
      <CategoryList
        title={t("cat_expense_heading")}
        toneClass="bg-rose-50 text-rose-700 ring-rose-100"
        items={grouped.expense}
        allCategories={categories}
        onAdd={() => setEditing({ kind: "new", type: "expense" })}
        onAddSub={(parent) => setEditing({ kind: "new", type: "expense", parentId: parent.id })}
        onEdit={(c) => setEditing({ kind: "edit", type: c.type, data: c })}
        onDelete={handleDelete}
        t={t}
      />
      <CategoryList
        title={t("cat_income_heading")}
        toneClass="bg-emerald-50 text-emerald-700 ring-emerald-100"
        items={grouped.income}
        allCategories={categories}
        onAdd={() => setEditing({ kind: "new", type: "income" })}
        onAddSub={(parent) => setEditing({ kind: "new", type: "income", parentId: parent.id })}
        onEdit={(c) => setEditing({ kind: "edit", type: c.type, data: c })}
        onDelete={handleDelete}
        t={t}
      />

      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2">
        <Info className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
        <div>{t("cat_info_hint")}</div>
      </div>

      <CategoryFormModal
        open={!!editing}
        initial={editing}
        allCategories={categories}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />
    </div>
  );
}

function CategoryList({ title, toneClass, items, allCategories, onAdd, onAddSub, onEdit, onDelete, t }) {
  // Строим tree: parents сначала, их children сразу под ними.
  const tree = React.useMemo(() => {
    const parents = items.filter((c) => !c.parentId);
    const childrenByParent = new Map();
    items.forEach((c) => {
      if (!c.parentId) return;
      if (!childrenByParent.has(c.parentId)) childrenByParent.set(c.parentId, []);
      childrenByParent.get(c.parentId).push(c);
    });
    const ordered = [];
    parents.forEach((p) => {
      ordered.push({ ...p, depth: 0 });
      (childrenByParent.get(p.id) || []).forEach((ch) => {
        ordered.push({ ...ch, depth: 1 });
      });
    });
    // Orphans (subcategory чей parent был удалён) — в конец как top-level
    items.forEach((c) => {
      if (c.parentId && !parents.find((p) => p.id === c.parentId)) {
        ordered.push({ ...c, depth: 0, orphan: true });
      }
    });
    return ordered;
  }, [items]);

  return (
    <section className="border border-slate-200 rounded-[12px] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/40">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${toneClass}`}>
            {items.length}
          </span>
          <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          {t("cat_add")}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-slate-400">{t("cat_none")}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {tree.map((c) => (
            <div
              key={c.id}
              className="px-4 py-2 flex items-center justify-between gap-2 group"
              style={{ paddingLeft: c.depth ? 32 : 16 }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {c.depth > 0 && (
                  <span className="text-slate-300 select-none text-[12px] font-mono">└</span>
                )}
                <div>
                  <div
                    className={`text-[13px] ${
                      c.depth === 0 ? "font-bold text-slate-900" : "font-medium text-slate-600"
                    }`}
                  >
                    {c.name}
                    {c.orphan && (
                      <span className="ml-2 text-[9px] font-bold text-amber-600 uppercase tracking-wider">
                        orphan
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                    {c.depth === 0 ? c.group : t("cat_subcategory")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {c.depth === 0 && onAddSub && (
                  <button
                    onClick={() => onAddSub(c)}
                    className="p-1 rounded-md text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                    title={t("cat_add_sub")}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => onEdit(c)}
                  className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  title={t("cat_edit")}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDelete(c)}
                  className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  title={t("cat_delete")}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryFormModal({ open, initial, allCategories, onClose, onSave }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState("expense");
  const [group, setGroup] = useState("operational");
  const [parentId, setParentId] = useState("");

  React.useEffect(() => {
    if (!open) return;
    if (initial?.kind === "edit" && initial.data) {
      setName(initial.data.name);
      setType(initial.data.type);
      setGroup(initial.data.group || "other");
      setParentId(initial.data.parentId || "");
    } else {
      setName("");
      setType(initial?.type || "expense");
      setGroup("operational");
      setParentId(initial?.parentId || "");
    }
  }, [open, initial]);

  // Родители — только top-level (parentId пуст) того же type, исключая саму
  // редактируемую категорию (нельзя быть родителем самой себе).
  const possibleParents = useMemo(() => {
    if (!allCategories) return [];
    return allCategories.filter(
      (c) => c.type === type && !c.parentId && (!initial?.data || c.id !== initial.data.id)
    );
  }, [allCategories, type, initial]);

  const canSubmit = name.trim().length > 0;
  const isSubcategory = !!parentId;

  // Есть ли у редактируемой категории дочерние подкатегории?
  // Если да — менять type нельзя (orphan'ы ломают иерархию).
  const hasChildren = useMemo(() => {
    if (initial?.kind !== "edit" || !initial?.data?.id || !allCategories) return false;
    return allCategories.some((c) => c.parentId === initial.data.id);
  }, [initial, allCategories]);

  // Тип-toggle заблокирован если:
  //   • Это subcategory (type должен совпадать с parent — парент фильтрован
  //     по type, поэтому смена type без сброса parent создаёт mismatch)
  //   • У редактируемой категории есть дети — смена type сделает их orphan
  const typeLocked = isSubcategory || hasChildren;
  const typeLockedReason = hasChildren
    ? t("cat_type_locked_children") || "У этой категории есть подкатегории — смена типа сделает их orphans"
    : t("cat_type_locked_subcategory") || "Тип подкатегории должен совпадать с родителем";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.kind === "edit" ? t("cat_edit_title") : isSubcategory ? t("cat_add_sub_title") : t("cat_add_title")}
      width="md"
    >
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">{t("cat_name")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder={t("cat_name_placeholder")}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">{t("cat_type")}</label>
            <div
              className={`inline-flex bg-slate-100 p-0.5 rounded-[10px] w-full ${
                typeLocked ? "opacity-60 cursor-not-allowed" : ""
              }`}
              title={typeLocked ? typeLockedReason : undefined}
            >
              {["expense", "income"].map((tp) => (
                <button
                  key={tp}
                  type="button"
                  disabled={typeLocked && type !== tp}
                  onClick={() => {
                    if (typeLocked) return;
                    setType(tp);
                    // Сбрасываем parent если поменяли тип
                    if (parentId) {
                      const parent = allCategories?.find((c) => c.id === parentId);
                      if (parent && parent.type !== tp) setParentId("");
                    }
                  }}
                  className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
                    type === tp ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  } ${typeLocked && type !== tp ? "cursor-not-allowed" : ""}`}
                >
                  {tp === "expense" ? t("cat_type_expense") : t("cat_type_income")}
                </button>
              ))}
            </div>
            {typeLocked && (
              <div className="text-[10px] text-amber-700 mt-1 flex items-start gap-1">
                <span>⚠</span>
                <span>{typeLockedReason}</span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">{t("cat_group")}</label>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            >
              {CATEGORY_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Parent category select — доступен всегда кроме случая когда у редактируемой категории есть дети */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">
            {t("cat_parent")}
          </label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
          >
            <option value="">— {t("cat_parent_none")} —</option>
            {possibleParents.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="text-[11px] text-slate-500 mt-1">
            {parentId ? t("cat_parent_hint_sub") : t("cat_parent_hint_top")}
          </div>
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors">{t("cancel")}</button>
        <button
          onClick={() => onSave({ name: name.trim(), type, group, parentId: parentId || null })}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >{t("save")}</button>
      </div>
    </Modal>
  );
}

// =========================================================================
// Currencies — full CRUD (same store as Rates, shared data)
// =========================================================================
function CurrenciesSection() {
  const { currencies, addCurrency, updateCurrency, removeCurrency } = useCurrencies();
  const { addEntry: logAudit } = useAudit();
  const [editing, setEditing] = useState(null);

  const handleSave = async (payload) => {
    if (editing?.kind === "new") {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () => insertCurrencyRow(payload),
          { success: "Currency added", errorPrefix: "Currency add failed" }
        );
        if (res.ok && res.result) {
          logAudit({
            action: "create",
            entity: "currency",
            entityId: res.result.code,
            summary: `Added currency ${res.result.code} (${res.result.type})`,
          });
        }
      } else {
        const res = addCurrency(payload);
        if (res.ok) {
          logAudit({
            action: "create",
            entity: "currency",
            entityId: res.currency.code,
            summary: `Added currency ${res.currency.code} (${res.currency.type})`,
          });
        } else {
          alert(res.warning);
        }
      }
    } else if (editing?.data?.code) {
      if (isSupabaseConfigured) {
        const res = await withToast(
          () => updateCurrencyRow(editing.data.code, payload),
          { success: "Currency updated", errorPrefix: "Update failed" }
        );
        if (res.ok) {
          logAudit({
            action: "update",
            entity: "currency",
            entityId: editing.data.code,
            summary: `Updated currency ${editing.data.code}`,
          });
        }
      } else {
        updateCurrency(editing.data.code, payload);
        logAudit({
          action: "update",
          entity: "currency",
          entityId: editing.data.code,
          summary: `Updated currency ${editing.data.code}`,
        });
      }
    }
    setEditing(null);
  };

  const handleDelete = async (cur) => {
    if (!confirm(`Delete currency ${cur.code}? Existing accounts will keep the currency code but no dictionary entry.`)) return;
    if (isSupabaseConfigured) {
      const res = await withToast(
        () => deleteCurrencyRow(cur.code),
        { success: "Currency deleted", errorPrefix: "Delete failed" }
      );
      if (!res.ok) return;
    } else {
      removeCurrency(cur.code);
    }
    logAudit({
      action: "delete",
      entity: "currency",
      entityId: cur.code,
      summary: `Removed currency ${cur.code}`,
    });
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          {currencies.length} currencies — shared with Dashboard → Rates.
        </div>
        <button
          onClick={() => setEditing({ kind: "new" })}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-slate-900 text-white text-[11px] font-semibold hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-2.5 h-2.5" />
          Add currency
        </button>
      </div>

      <section className="border border-slate-200 rounded-[12px] overflow-hidden">
        <div className="divide-y divide-slate-100">
          {currencies.map((c) => (
            <div key={c.code} className="px-4 py-2 flex items-center justify-between gap-2 group">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center text-[13px] font-bold ${
                  c.type === "crypto" ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" : "bg-slate-100 text-slate-700"
                }`}>
                  {c.symbol || c.code[0]}
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-slate-900 tracking-wide">{c.code}</div>
                  <div className="text-[11px] text-slate-500">
                    {c.name} · {c.type} · {c.decimals}d
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditing({ kind: "edit", data: c })} className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => handleDelete(c)} className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {currencies.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-slate-400">No currencies yet</div>
          )}
        </div>
      </section>

      <CurrencyFormModal
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />
    </div>
  );
}

function CurrencyFormModal({ open, initial, onClose, onSave }) {
  const [code, setCode] = useState("");
  const [type, setType] = useState("fiat");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [decimals, setDecimals] = useState(2);
  const isEdit = initial?.kind === "edit";

  React.useEffect(() => {
    if (!open) return;
    if (isEdit && initial?.data) {
      setCode(initial.data.code);
      setType(initial.data.type);
      setSymbol(initial.data.symbol || "");
      setName(initial.data.name || "");
      setDecimals(initial.data.decimals || 2);
    } else {
      setCode("");
      setType("fiat");
      setSymbol("");
      setName("");
      setDecimals(2);
    }
  }, [open, initial, isEdit]);

  const canSubmit = code.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit currency" : "Add currency"} width="md">
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="USDC"
              maxLength={6}
              disabled={isEdit}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-bold tracking-wider uppercase outline-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">Type</label>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px] w-full">
              {["fiat", "crypto"].map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setType(tp)}
                  className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
                    type === tp ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="$"
              maxLength={3}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="USD Coin"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide uppercase">Decimals</label>
          <input
            type="number"
            min={0}
            max={8}
            value={decimals}
            onChange={(e) => setDecimals(parseInt(e.target.value, 10) || 0)}
            className="w-24 bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
          />
        </div>
      </div>
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors">Cancel</button>
        <button
          onClick={() => onSave({ code: code.trim().toUpperCase(), type, symbol: symbol.trim(), name: name.trim() || code.trim().toUpperCase(), decimals })}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >Save</button>
      </div>
    </Modal>
  );
}

// =========================================================================
// Channels — read-only список. Создание и управление — в Dashboard → Rates.
// =========================================================================
function ChannelsSection() {
  const { channels } = useRates();
  const { currencies } = useCurrencies();
  const byCurrency = useMemo(() => {
    const m = new Map();
    channels.forEach((ch) => {
      if (!m.has(ch.currencyCode)) m.set(ch.currencyCode, []);
      m.get(ch.currencyCode).push(ch);
    });
    return m;
  }, [channels]);

  return (
    <div className="p-5 space-y-3">
      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2">
        <Info className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
        <div>
          Read-only view. Create or edit channels in{" "}
          <span className="font-semibold text-slate-700">Dashboard → Edit rates</span> to keep a single source of truth.
        </div>
      </div>
      <section className="border border-slate-200 rounded-[12px] overflow-hidden divide-y divide-slate-100">
        {currencies.map((c) => {
          const chs = byCurrency.get(c.code) || [];
          if (chs.length === 0) return null;
          return (
            <div key={c.code} className="px-4 py-2.5">
              <div className="text-[11px] font-bold tracking-wider text-slate-700 mb-1.5">
                {c.code} <span className="text-slate-400 font-normal">· {c.type}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {chs.map((ch) => (
                  <span
                    key={ch.id}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border ${
                      ch.kind === "network"
                        ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                        : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}
                  >
                    {channelShortLabel(ch)}
                    {ch.isDefaultForCurrency && (
                      <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1 rounded">default</span>
                    )}
                    {ch.gasFee != null && (
                      <span className="text-[9px] text-slate-500 tabular-nums">gas ${ch.gasFee}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// =========================================================================
// Client tags — read-only для существующей константы.
// =========================================================================
function TagsSection() {
  return (
    <div className="p-5 space-y-3">
      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2">
        <Info className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
        <div>Built-in set. Extend in <span className="font-mono text-slate-700">src/store/data.js → CLIENT_TAGS</span>.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {CLIENT_TAGS.map((tag) => (
          <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
