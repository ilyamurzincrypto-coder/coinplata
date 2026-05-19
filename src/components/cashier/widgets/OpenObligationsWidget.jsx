// src/components/cashier/widgets/OpenObligationsWidget.jsx
// Widget «Открытые обязательства» — список deferred сделок где деньги
// ещё не отданы клиенту. Real-time через Supabase Realtime channel.
//
// Data source: operations.v_open_deals + subscribe на operations.deal_workflow
// Actions: Mark paid / Complete release / Cancel (через CancelDealModal)
//
// Дизайн: те же DS-токены что Balances/RatesSidebar. Корневой контейнер —
// bg-surface rounded-card без border. Status badges через DS Badge.
// Action buttons компактные h-7 на токенах. Row hover на surface-soft.

import React, { useMemo, useState, useEffect } from "react";
import {
  CheckCircle2,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
  Inbox,
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
import Badge from "../../ui/Badge.jsx";

// Маппинг статусов на DS-tone Badge.
const STATUS_TONE = {
  draft:            "muted",
  awaiting_payment: "warning",
  awaiting_release: "info",
  partial:          "info",
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
      <section className="bg-surface rounded-card flex flex-col">
        {/* Header: h3 + counter + (опц.) stale-badge */}
        <header className="px-card pt-3.5 pb-3 flex items-center justify-between gap-2">
          <div className="text-h3 text-ink flex items-center gap-2">
            <span>{t("open_obligations_title")}</span>
            <Badge variant="counter">{filtered.length}</Badge>
          </div>
          {staleCount > 0 && (
            <Badge variant="status" tone="danger">
              {staleCount} stale
            </Badge>
          )}
        </header>

        <ObligationsFilterPanel
          filters={filters}
          setFilters={setFilters}
          staleCount={staleCount}
        />

        {loading ? (
          <div className="px-card py-6 text-center text-body-sm text-muted">…</div>
        ) : filtered.length === 0 ? (
          <ListEmpty
            t={t}
            hasItems={preFiltered.length > 0}
            onClearFilters={() => setFilters(defaultFilters())}
          />
        ) : (
          <ul className="max-h-[480px] overflow-y-auto">
            {filtered.map((row, i) => (
              <ObligationRow
                key={row.id}
                row={row}
                t={t}
                first={i === 0}
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

function ListEmpty({ t, hasItems, onClearFilters }) {
  if (hasItems) {
    return (
      <div className="px-card py-8 text-center">
        <div className="text-body-sm text-muted mb-2">
          {t("open_obligations_filter_no_match")}
        </div>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-caption text-accent hover:text-accent-hover font-semibold"
        >
          {t("open_obligations_filter_clear_all")}
        </button>
      </div>
    );
  }
  return (
    <div className="px-card py-10 text-center">
      <div className="inline-flex w-11 h-11 rounded-full bg-success-soft text-success items-center justify-center mb-3">
        <CheckCircle2 className="w-5 h-5" strokeWidth={2.2} />
      </div>
      <div className="text-body font-semibold text-ink mb-1">
        {t("open_obligations_empty")}
      </div>
      <div className="text-body-sm text-muted">
        Когда появится незавершённая сделка — она будет здесь
      </div>
    </div>
  );
}

function ObligationRow({ row, t, first, onChanged, onCancel }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const tone = STATUS_TONE[row.status] || "muted";
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
    <li
      className={`px-card py-2.5 transition-colors duration-150 ease-apple hover:bg-surface-soft ${
        first ? "" : "border-t border-border-soft"
      } ${row.is_stale ? "border-l-2 border-danger" : ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-body-sm font-semibold text-ink truncate">
              {row.counterparty_name || "—"}
            </span>
            <span className="inline-flex items-center gap-0.5 text-tiny text-muted-soft shrink-0">
              <Clock className="w-3 h-3" strokeWidth={2} />
              {ageLabel}
            </span>
          </div>
          <div className="text-tiny text-muted font-mono tabular mt-0.5">
            {row.open_count} legs · {fmt(row.pending_out_total, "USD")}
            {row.open_legs?.[0]?.currency ? ` ${row.open_legs[0].currency}` : ""}
          </div>
        </div>
        <Badge variant="status" tone={tone} showDot>
          {statusLabel}
        </Badge>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-soft shrink-0" strokeWidth={2.2} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-soft shrink-0" strokeWidth={2.2} />
        )}
      </button>

      {expanded && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {canMarkPaid && (
            <ActionBtn onClick={handleMarkPaid} disabled={busy} icon={CheckCircle2} tone="warning">
              {t("open_obligations_action_mark_paid")}
            </ActionBtn>
          )}
          {canComplete && (
            <ActionBtn onClick={handleComplete} disabled={busy} icon={CheckCircle2} tone="info">
              {t("open_obligations_action_complete")}
            </ActionBtn>
          )}
          <ActionBtn onClick={onCancel} disabled={busy} icon={Ban} tone="danger">
            {t("open_obligations_action_cancel")}
          </ActionBtn>
        </div>
      )}
    </li>
  );
}

// Action button — compact pill на DS-токенах.
function ActionBtn({ onClick, disabled, icon: Icon, tone, children }) {
  const tones = {
    warning: "bg-warning-soft hover:bg-warning-soft/70 text-warning",
    info:    "bg-info-soft hover:bg-info-soft/70 text-info",
    danger:  "bg-danger-soft hover:bg-danger-soft/70 text-danger",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-button text-caption font-semibold transition-colors duration-150 ${tones[tone] || tones.info} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <Icon className="w-3 h-3" strokeWidth={2.2} />
      {children}
    </button>
  );
}
