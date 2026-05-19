// src/pages/treasury_v2/tabs/LiabilitiesTab.jsx
//
// «Пассивы» — flat-list контрагентов с балансами по customer_liab/partner_liab/unearned.
// Group-by-counterparty единственный режим (legacy by-type-tabs убран).
// Фильтр client / partner / all + кнопка «+ Обязательство» → CreateLiabilityDialog.

import React, { useState, useMemo, useCallback } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useCan } from "../../../store/permissions.jsx";
import { usePartners } from "../../../store/partners.jsx";
import { updateClientRow, rpcArchiveClient, rpcDeleteClient } from "../../../lib/supabaseWrite.js";
import { emitToast } from "../../../lib/toast.jsx";
import { liabilitiesByCounterparty } from "../../../lib/treasury/v2selectors.js";
import CounterpartyGroup from "../parts/CounterpartyGroup.jsx";
import CreateLiabilityDialog from "../parts/CreateLiabilityDialog.jsx";

const CP_FILTER_KEY = "coinplata:liabilities-cp-filter";

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

  const clientGroups = useMemo(() => liabilitiesByCounterparty(ctx, "client"), [ctx]);
  const partnerGroups = useMemo(() => liabilitiesByCounterparty(ctx, "partner"), [ctx]);

  const visibleGroups = useMemo(() => {
    if (cpFilter === "client") return clientGroups;
    if (cpFilter === "partner") return partnerGroups;
    return [...clientGroups, ...partnerGroups];
  }, [cpFilter, clientGroups, partnerGroups]);

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

      {/* CP-type filter */}
      <div className="flex items-center gap-2">
        <SegmentedSmall
          value={cpFilter}
          onChange={setCpFilterPersist}
          options={[
            { id: "all",     label: `Все · ${clientGroups.length + partnerGroups.length}` },
            { id: "client",  label: `Клиенты · ${clientGroups.length}` },
            { id: "partner", label: `Партнёры · ${partnerGroups.length}` },
          ]}
        />
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
