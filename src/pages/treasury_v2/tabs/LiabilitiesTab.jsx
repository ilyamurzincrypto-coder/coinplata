// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
//
// «Пассивы» — flat-list контрагентов с балансами по customer_liab/partner_liab/unearned.
// Group-by-counterparty единственный режим (legacy by-type-tabs убран).
// Фильтр client / partner / all + кнопка «+ Обязательство» → CreateLiabilityDialog.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Plus, Search } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { usePartners } from "../../../store/partners.jsx";
import { updateClientRow, rpcArchiveClient, rpcDeleteClient } from "../../../lib/supabaseWrite.js";
import { emitToast } from "../../../lib/toast.jsx";
import { liabilitiesByCounterparty } from "../../../lib/treasury/v2selectors.js";
import CounterpartyGroup from "../parts/CounterpartyGroup.jsx";
import CreateLiabilityDialog from "../parts/CreateLiabilityDialog.jsx";

const CP_FILTER_KEY = "coinplata:liabilities-cp-filter";
const SORT_KEY = "coinplata:liabilities-sort";
const NONZERO_KEY = "coinplata:liabilities-nonzero";
const SORT_OPTIONS = [
  { id: "balance", label: "По балансу" },
  { id: "name", label: "По имени" },
  { id: "referral", label: "Реферал first" },
];

export default function LiabilitiesTab({ ctx, formatBase, baseCurrency }) {
  const { t } = useTranslation();
  const can = useCan();
  const { updatePartner, removePartner } = usePartners();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Inline rename контрагента из карточки.
  const renameCounterparty = useCallback(async (cp, newName) => {
    try {
      if (cp.kind === "client") {
        await updateClientRow(cp.id, { nickname: newName });
      } else {
        await updatePartner(cp.id, { name: newName });
      }
      emitToast("success", "Имя обновлено");
    } catch (err) {
      emitToast("error", err?.message || "Не удалось переименовать");
      throw err;
    }
  }, [updatePartner]);

  // Archive — мягкое скрытие, история остаётся.
  const archiveCounterparty = useCallback(async (cp) => {
    try {
      if (cp.kind === "client") {
        await rpcArchiveClient(cp.id, true);
      } else {
        // partners.update.archived нет — деактивируем через soft-delete RPC.
        await removePartner(cp.id);
      }
      emitToast("success", "Архивирован");
    } catch (err) {
      emitToast("error", err?.message || "Не удалось архивировать");
      throw err;
    }
  }, [removePartner]);

  // Delete — hard, RPC проверит наличие проводок и упадёт с понятной ошибкой.
  const deleteCounterparty = useCallback(async (cp) => {
    try {
      if (cp.kind === "client") {
        await rpcDeleteClient(cp.id);
      } else {
        await removePartner(cp.id);
      }
      emitToast("success", "Удалён");
    } catch (err) {
      emitToast("error", err?.message || "Не удалось удалить");
      throw err;
    }
  }, [removePartner]);

  const [cpFilter, setCpFilter] = useState(() => {
    try {
      const v = localStorage.getItem(CP_FILTER_KEY);
      return v === "client" || v === "partner" || v === "all" ? v : "all";
    } catch {
      return "all";
    }
  });
  const setCpFilterPersist = (v) => {
    setCpFilter(v);
    try { localStorage.setItem(CP_FILTER_KEY, v); } catch {}
  };

  const [sortMode, setSortMode] = useState(() => {
    try {
      const v = localStorage.getItem(SORT_KEY);
      return SORT_OPTIONS.some((o) => o.id === v) ? v : "balance";
    } catch {
      return "balance";
    }
  });
  const setSortModePersist = (v) => {
    setSortMode(v);
    try { localStorage.setItem(SORT_KEY, v); } catch {}
  };

  const [nonZeroOnly, setNonZeroOnly] = useState(() => {
    try { return localStorage.getItem(NONZERO_KEY) === "1"; } catch { return false; }
  });
  const setNonZeroPersist = (v) => {
    setNonZeroOnly(v);
    try { localStorage.setItem(NONZERO_KEY, v ? "1" : "0"); } catch {}
  };

  // Поиск debounce 150ms — для длинных списков. raw — что в input,
  // applied — что применяется к фильтру.
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw.trim().toLowerCase()), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  const clientGroups = useMemo(() => liabilitiesByCounterparty(ctx, "client"), [ctx]);
  const partnerGroups = useMemo(() => liabilitiesByCounterparty(ctx, "partner"), [ctx]);

  const visibleGroups = useMemo(() => {
    let list = cpFilter === "client" ? clientGroups
            : cpFilter === "partner" ? partnerGroups
            : [...clientGroups, ...partnerGroups];

    // Filter: только ненулевые балансы
    if (nonZeroOnly) {
      list = list.filter((g) => Math.abs(g.totalInBase) > 0.005);
    }

    // Filter: поиск по имени/telegram/tag
    if (search) {
      list = list.filter((g) => {
        const haystack = [g.name, g.telegram, g.tag].filter(Boolean).map((s) => String(s).toLowerCase());
        return haystack.some((s) => s.includes(search));
      });
    }

    // Sort
    const sorted = [...list];
    if (sortMode === "balance") {
      sorted.sort((a, b) => Math.abs(b.totalInBase) - Math.abs(a.totalInBase));
    } else if (sortMode === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      // referral first then balance
      sorted.sort((a, b) => {
        if (a.isReferral !== b.isReferral) return a.isReferral ? -1 : 1;
        return Math.abs(b.totalInBase) - Math.abs(a.totalInBase);
      });
    }
    return sorted;
  }, [cpFilter, clientGroups, partnerGroups, nonZeroOnly, search, sortMode]);

  const grandTotalInBase = useMemo(
    () => [...clientGroups, ...partnerGroups].reduce((s, g) => s + g.totalInBase, 0),
    [clientGroups, partnerGroups]
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-h2 text-ink font-semibold">{t("trv2_tab_liabilities")}</h2>
          <span className="text-body-sm font-mono tabular text-ink-soft">
            {formatBase(grandTotalInBase, baseCurrency)}
          </span>
          <span className="text-tiny text-muted-soft">
            {clientGroups.length} клиентов · {partnerGroups.length} партнёров
          </span>
        </div>
        {can("accounting", "edit") && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-button bg-ink text-white text-body-sm font-semibold hover:bg-black hover:-translate-y-px shadow-cta-glow transition-all"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Обязательство
          </button>
        )}
      </div>

      {/* Toolbar: CP-type filter + sort + non-zero toggle + search */}
      <div className="bg-surface rounded-card p-2.5 flex items-center gap-2 flex-wrap">
        <SegmentedSmall
          value={cpFilter}
          onChange={setCpFilterPersist}
          options={[
            { id: "all",     label: `Все · ${clientGroups.length + partnerGroups.length}` },
            { id: "client",  label: `Клиенты · ${clientGroups.length}` },
            { id: "partner", label: `Партнёры · ${partnerGroups.length}` },
          ]}
        />
        <SegmentedSmall
          value={sortMode}
          onChange={setSortModePersist}
          options={SORT_OPTIONS}
        />
        <button
          type="button"
          onClick={() => setNonZeroPersist(!nonZeroOnly)}
          className={`h-7 px-2.5 rounded-pill text-tiny font-semibold transition-all whitespace-nowrap ${
            nonZeroOnly
              ? "bg-ink text-white"
              : "bg-surface-sunk text-muted hover:text-ink"
          }`}
          title="Скрыть нулевые балансы"
        >
          Ненулевые
        </button>
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-muted-soft shrink-0" strokeWidth={2} />
          <input
            type="text"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Поиск по имени, telegram"
            className="flex-1 min-w-0 h-7 px-2 rounded-input bg-surface-sunk text-ink text-caption placeholder:text-muted-soft border-0 ring-1 ring-inset ring-transparent focus:bg-surface focus:ring-accent focus:outline-none transition-all"
          />
        </div>
      </div>

      <div className="text-tiny text-muted-soft">{t("trv2_liab_sign_note")}</div>

      {visibleGroups.length === 0 ? (
        <div className="bg-surface rounded-card px-card py-8 text-center text-body-sm text-muted">
          {t("trv2_no_accounts")}
        </div>
      ) : (
        <div className="bg-surface rounded-card overflow-hidden">
          {visibleGroups.map((cp) => (
            <CounterpartyGroup
              key={`${cp.kind}:${cp.id}`}
              cp={cp}
              formatBase={formatBase}
              baseCurrency={baseCurrency}
              canEdit={can("accounting", "edit")}
              accounts={ctx?.accounts || []}
              onRename={renameCounterparty}
              onArchive={archiveCounterparty}
              onDelete={deleteCounterparty}
            />
          ))}
        </div>
      )}

      <CreateLiabilityDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ctx={ctx}
        clients={ctx?.clients || []}
        partners={ctx?.partners || []}
      />
    </div>
  );
}

function SegmentedSmall({ value, onChange, options }) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 bg-surface-sunk rounded-pill">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`h-7 px-2.5 rounded-pill text-tiny font-semibold transition-all duration-150 ease-apple whitespace-nowrap ${
            value === opt.id
              ? "bg-surface text-ink shadow-seg"
              : "text-muted hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
