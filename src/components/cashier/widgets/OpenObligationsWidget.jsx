// src/components/cashier/widgets/OpenObligationsWidget.jsx
// Widget «Открытые обязательства» — список deferred сделок где деньги
// ещё не отданы клиенту. Real-time через Supabase Realtime channel.
//
// Data source: operations.v_open_deals + subscribe на operations.deal_workflow
// Actions: Mark paid / Complete release / Cancel (через CancelDealModal)

import React, { useMemo, useState, useEffect } from "react";
import {
  CheckCircle2,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";
import { useTranslation } from "../../../i18n/translations.jsx";
import { useAuth } from "../../../store/auth.jsx";
import { useOpenObligations, formatAge } from "../../../store/openObligations.js";
import {
  rpcUpdateWorkflowStatusV2,
  rpcCancelWorkflowV2,
} from "../../../lib/newLedger.js";
import { supabase } from "../../../lib/supabase.js";
import { emitToast } from "../../../lib/toast.jsx";
import { fmt } from "../../../utils/money.js";
import CancelDealModal from "./CancelDealModal.jsx";
import ObligationsFilterPanel, {
  defaultFilters,
  loadFiltersFromStorage,
  applyFilters,
} from "./ObligationsFilterPanel.jsx";

const STATUS_STYLES = {
  draft:             { bg: "bg-slate-100",   text: "text-slate-600",   border: "border-slate-200" },
  awaiting_payment:  { bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200" },
  awaiting_release:  { bg: "bg-indigo-50",   text: "text-indigo-700",  border: "border-indigo-200" },
  partial:           { bg: "bg-violet-50",   text: "text-violet-700",  border: "border-violet-200" },
};

export default function OpenObligationsWidget({ officeId }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { items, loading, refetch } = useOpenObligations();
  const [cancelTarget, setCancelTarget] = useState(null);

  const [filters, setFilters] = useState(() =>
    loadFiltersFromStorage(currentUser?.id) || defaultFilters()
  );

  // Hydrate filters при изменении user (login/switch)
  useEffect(() => {
    if (!currentUser?.id) return;
    const stored = loadFiltersFromStorage(currentUser.id);
    if (stored) setFilters(stored);
  }, [currentUser?.id]);

  // Apply officeId prop как pre-filter (legacy mode), потом user filters
  const preFiltered = useMemo(() => {
    if (!officeId) return items;
    return items.filter((it) => !it.office_id || it.office_id === officeId);
  }, [items, officeId]);

  const filtered = useMemo(
    () => applyFilters(preFiltered, filters, currentUser?.id),
    [preFiltered, filters, currentUser]
  );

  const staleCount = useMemo(
    () => preFiltered.filter((it) => it.is_stale).length,
    [preFiltered]
  );

  const handleConfirmCancel = async (reason) => {
    if (!cancelTarget) return;
    await rpcCancelWorkflowV2({
      workflowId: cancelTarget.id,
      reason,
    });
    emitToast("success", t("open_obligations_action_cancel"));
    setCancelTarget(null);
    refetch();
  };

  return (
    <>
      <section className="bg-white border border-slate-200 rounded-[var(--radius-section)] flex flex-col">
        <header className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50/50">
          <span className="text-label">{t("open_obligations_title")}</span>
          <span className="text-[11px] text-slate-500 tabular-nums">
            {t("open_obligations_count").replace("{{n}}", String(filtered.length))}
          </span>
        </header>

        <ObligationsFilterPanel
          filters={filters}
          setFilters={setFilters}
          staleCount={staleCount}
        />

        {loading ? (
          <div className="px-4 py-6 text-center text-hint">…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            t={t}
            hasItems={preFiltered.length > 0}
            onClearFilters={() => setFilters(defaultFilters())}
          />
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[480px] overflow-auto">
            {filtered.map((row) => (
              <ObligationRow
                key={row.id}
                row={row}
                t={t}
                onChanged={refetch}
                onCancel={() => setCancelTarget(row)}
              />
            ))}
          </ul>
        )}
      </section>

      <CancelDealModal
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
        workflow={cancelTarget}
      />
    </>
  );
}

function EmptyState({ t, hasItems, onClearFilters }) {
  if (hasItems) {
    return (
      <div className="px-4 py-6 text-center space-y-2">
        <span className="text-hint">{t("open_obligations_filter_no_match")}</span>
        <button
          type="button"
          onClick={onClearFilters}
          className="block mx-auto text-[11px] text-indigo-600 hover:text-indigo-800 underline"
        >
          {t("open_obligations_filter_clear_all")}
        </button>
      </div>
    );
  }
  return (
    <div className="px-4 py-8 text-center">
      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
      <span className="text-hint">{t("open_obligations_empty")}</span>
    </div>
  );
}

function ObligationRow({ row, t, onChanged, onCancel }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const style = STATUS_STYLES[row.status] || STATUS_STYLES.draft;
  const statusLabel = t(`open_obligations_status_${row.status}`);
  const ageLabel = formatAge(row.created_at, t);

  const handleMarkPaid = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rpcUpdateWorkflowStatusV2({
        workflowId: row.id,
        newStatus: "awaiting_release",
        note: "Marked paid via widget",
      });
      emitToast("success", t("open_obligations_action_mark_paid"));
      onChanged();
    } catch (err) {
      emitToast("error", err.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (busy) return;
    const leg = (row.open_legs || [])[0];
    if (!leg) return;
    setBusy(true);
    try {
      const idem = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
      const { error } = await supabase.rpc("complete_deal_leg", {
        p_idempotency_key: idem,
        p_request_hash: `widget:complete:${row.id}:${leg.leg_id}`,
        p_deal_id: row.ledger_tx_id,
        p_currency_code: leg.currency,
        p_amount: leg.amount,
        p_account_code: leg.account_code,
      });
      if (error) throw error;
      emitToast("success", t("open_obligations_action_complete"));
      onChanged();
    } catch (err) {
      emitToast("error", err.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const canMarkPaid = row.status === "awaiting_payment";
  const canComplete = ["awaiting_release", "partial"].includes(row.status)
    && (row.open_legs || []).length > 0;

  return (
    <li className={`px-3 py-2 hover:bg-slate-50/40 ${row.is_stale ? "border-l-2 border-rose-300" : ""}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-800 truncate">
              {row.counterparty_name || "—"}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
              <Clock className="w-3 h-3" />{ageLabel}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums">
            {row.open_count} legs · {fmt(row.pending_out_total, "USD")}
            {row.open_legs?.[0]?.currency ? ` ${row.open_legs[0].currency}` : ""}
          </div>
        </div>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-cell)] border text-[10px] font-bold uppercase tracking-wider ${style.bg} ${style.text} ${style.border}`}
        >
          {statusLabel}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {canMarkPaid && (
            <ActionBtn onClick={handleMarkPaid} disabled={busy} icon={CheckCircle2} tone="amber">
              {t("open_obligations_action_mark_paid")}
            </ActionBtn>
          )}
          {canComplete && (
            <ActionBtn onClick={handleComplete} disabled={busy} icon={CheckCircle2} tone="indigo">
              {t("open_obligations_action_complete")}
            </ActionBtn>
          )}
          <ActionBtn onClick={onCancel} disabled={busy} icon={Ban} tone="rose">
            {t("open_obligations_action_cancel")}
          </ActionBtn>
        </div>
      )}
    </li>
  );
}

function ActionBtn({ onClick, disabled, icon: Icon, tone, children }) {
  const tones = {
    amber:  "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700",
    indigo: "bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700",
    rose:   "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-cell)] border text-[11px] font-semibold ${tones[tone] || tones.indigo} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <Icon className="w-3 h-3" />
      {children}
    </button>
  );
}
