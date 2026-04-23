// src/store/categories.jsx
// Категории для Income/Expense записей. Живут в отдельном store — редактируются
// из Settings → Master Data. Сделки обмена НЕ используют эти категории (их
// "revenue" считается напрямую из tx.profit).
//
// Модель:
//   { id, name, type: "income" | "expense", group: "operational" | "financial" | "other" }

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { loadCategories } from "../lib/supabaseReaders.js";
import { onDataBump } from "../lib/dataVersion.jsx";

const SEED_CATEGORIES = [
  // Expenses
  { id: "cat_rent",         name: "Office rent",     type: "expense", group: "operational" },
  { id: "cat_salary",       name: "Salary",          type: "expense", group: "operational" },
  { id: "cat_utilities",    name: "Utilities",       type: "expense", group: "operational" },
  { id: "cat_marketing",    name: "Marketing",       type: "expense", group: "operational" },
  { id: "cat_tax",          name: "Tax",             type: "expense", group: "financial"   },
  { id: "cat_equipment",    name: "Equipment",       type: "expense", group: "operational" },
  { id: "cat_other_exp",    name: "Other",           type: "expense", group: "other"       },
  // Income
  { id: "cat_capital_inj",  name: "Capital injection", type: "income",  group: "financial"   },
  { id: "cat_interest",     name: "Interest",          type: "income",  group: "financial"   },
  { id: "cat_other_inc",    name: "Other income",      type: "income",  group: "other"       },
  { id: "cat_partner_dep",  name: "Partner deposit",   type: "income",  group: "financial"   },
];

export const CATEGORY_GROUPS = [
  { id: "operational", label: "Operational" },
  { id: "financial",   label: "Financial"   },
  { id: "other",       label: "Other"       },
];

const CategoriesContext = createContext(null);

export function CategoriesProvider({ children }) {
  const [categories, setCategories] = useState(SEED_CATEGORIES);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const reload = () =>
      loadCategories()
        .then((rows) => {
          if (cancelled) return;
          if (Array.isArray(rows) && rows.length > 0) setCategories(rows);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[categories] load failed — keeping seed", err);
        });
    reload();
    const unsub = onDataBump(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const byType = useCallback(
    (type) => categories.filter((c) => c.type === type),
    [categories]
  );

  const byId = useCallback(
    (id) => categories.find((c) => c.id === id) || null,
    [categories]
  );

  const byName = useCallback(
    (name, type) =>
      categories.find(
        (c) =>
          c.name.toLowerCase() === String(name || "").toLowerCase() &&
          (type ? c.type === type : true)
      ) || null,
    [categories]
  );

  const addCategory = useCallback(({ name, type, group }) => {
    const n = String(name || "").trim();
    if (!n) return { ok: false, warning: "Name required" };
    if (type !== "income" && type !== "expense") {
      return { ok: false, warning: "Type must be income or expense" };
    }
    let created = null;
    setCategories((prev) => {
      const exists = prev.find(
        (c) => c.name.toLowerCase() === n.toLowerCase() && c.type === type
      );
      if (exists) {
        created = exists;
        return prev;
      }
      const cat = {
        id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: n,
        type,
        group: group || "other",
      };
      created = cat;
      return [...prev, cat];
    });
    return { ok: true, category: created };
  }, []);

  const updateCategory = useCallback((id, patch) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCategory = useCallback((id) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      categories,
      byType,
      byId,
      byName,
      addCategory,
      updateCategory,
      removeCategory,
    }),
    [categories, byType, byId, byName, addCategory, updateCategory, removeCategory]
  );

  return (
    <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
  );
}

export function useCategories() {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error("useCategories must be inside CategoriesProvider");
  return ctx;
}
