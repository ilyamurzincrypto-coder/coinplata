// src/components/cashier/DealForm.jsx
// Новая форма создания сделки. Этап 2 + 2.5.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useClientBalances } from "../../store/clientBalances.js";
import StickyTitle from "./StickyTitle.jsx";
import CounterpartyBar from "./CounterpartyBar.jsx";
import DealLegsTable from "./DealLegsTable.jsx";
import ConditionsBar from "./ConditionsBar.jsx";
import {
  useDealForm,
  tryLoadDraft,
  clearDraft,
} from "../../store/dealForm.js";
import { USE_NEW_LEDGER } from "../../lib/newLedger.js";

export default function DealForm({
  mode = "create",
  currentOffice,
  onChangeOffice,
  initialData,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { counterparties } = useTransactions();
  const { accounts } = useAccounts();

  // accountCodeByLegacyId — карта public.accounts.id → ledger.accounts.code
  // для buildTx resolve. Только под USE_NEW_LEDGER=true; иначе null →
  // legacy passthrough (buildTx отдаёт accountId как-есть).
  // Excludes legacy_only accounts (они не должны попасть в ledger v2 path).
  const accountCodeByLegacyId = useMemo(() => {
    if (!USE_NEW_LEDGER) return null;
    return Object.fromEntries(
      accounts
        .filter((a) => a.ledgerAccountCode && !a.legacyOnly)
        .map((a) => [a.id, a.ledgerAccountCode])
    );
  }, [accounts]);

  // Draft prompt — при mount проверяем localStorage
  const [draftPrompt, setDraftPrompt] = useState(() => {
    if (initialData) return null; // edit mode — не предлагаем draft
    return tryLoadDraft();
  });

  const [counterparty, setCounterparty] = useState(
    initialData?.counterparty || ""
  );
  const [counterpartyId, setCounterpartyId] = useState(
    initialData?.counterpartyId || null
  );
  const [selectedManagerId, setSelectedManagerId] = useState(
    initialData?.managerId || currentUser?.id || ""
  );
  const [showRequiredError, setShowRequiredError] = useState(false);

  // Resolve counterparty UUID если выбрали из списка по nickname
  useEffect(() => {
    if (counterpartyId) return;
    const match = counterparties?.find?.(
      (c) => c.nickname && c.nickname.toLowerCase() === counterparty.trim().toLowerCase()
    );
    if (match) setCounterpartyId(match.id);
  }, [counterparty, counterparties, counterpartyId]);

  const clientBalances = useClientBalances(counterpartyId);

  // Legs state с history + auto-save
  const {
    legs,
    inLegs,
    outLegs,
    addLeg,
    removeLeg,
    updateLeg,
    totalIn,
    totalOut,
    conditions,
    setCondition,
    undo,
    redo,
    canUndo,
    canRedo,
    hydrate,
    reset,
  } = useDealForm();

  const onToggleSide = useCallback(
    (legId) => {
      const leg = legs.find((l) => l.id === legId);
      if (!leg) return;
      const next = leg.side === "in" ? "out" : "in";
      updateLeg(legId, {
        side: next,
        source: next === "in" ? (leg.source || "fresh") : null,
        destination: next === "out" ? (leg.destination || "physical") : null,
      });
    },
    [legs, updateLeg]
  );

  const acceptDraft = () => {
    if (draftPrompt) hydrate(draftPrompt);
    setDraftPrompt(null);
  };
  const dismissDraft = () => {
    clearDraft();
    setDraftPrompt(null);
  };

  const hasUnsavedChanges = useMemo(() => {
    if (counterparty.trim().length > 0) return true;
    return legs.some(
      (l) => Number(l.amount) > 0 || l.currency || l.accountId
    );
  }, [counterparty, legs]);

  const dealId = useMemo(
    () => initialData?.id || crypto.randomUUID?.() || "",
    [initialData?.id]
  );

  return (
    <div className="bg-white rounded-[var(--radius-section)] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <StickyTitle
        mode={mode}
        dealId={dealId}
        selectedOfficeId={currentOffice}
        onChangeOffice={onChangeOffice}
        selectedManagerId={selectedManagerId}
        onChangeManager={setSelectedManagerId}
        hasUnsavedChanges={hasUnsavedChanges}
        onClose={onCancel}
      />

      {draftPrompt && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3">
          <span className="text-[12px] text-amber-900">
            Найден сохранённый черновик ({draftPrompt.legs.length} ноги). Восстановить?
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={acceptDraft}
              className="px-2.5 py-1 rounded-[var(--radius-cell)] bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold uppercase tracking-wider"
            >
              Восстановить
            </button>
            <button
              type="button"
              onClick={dismissDraft}
              className="px-2.5 py-1 rounded-[var(--radius-cell)] bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold"
            >
              Удалить
            </button>
          </div>
        </div>
      )}

      <CounterpartyBar
        value={counterparty}
        onChange={setCounterparty}
        showRequiredError={showRequiredError}
      />

      <DealLegsTable
        legs={legs}
        inLegs={inLegs}
        outLegs={outLegs}
        onUpdate={updateLeg}
        onRemove={removeLeg}
        onAddLeg={addLeg}
        onToggleSide={onToggleSide}
        officeId={currentOffice}
        clientBalances={clientBalances}
      />

      <ConditionsBar
        conditions={conditions}
        setCondition={setCondition}
        legs={legs}
      />

      {/* Footer summary + undo/redo */}
      <div className="px-4 py-3 text-hint border-t border-slate-200 bg-slate-50/40 flex justify-between items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Отменить (Ctrl/Cmd+Z)"
            className="p-1.5 rounded-[var(--radius-cell)] text-slate-500 hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Повторить (Ctrl/Cmd+Shift+Z)"
            className="p-1.5 rounded-[var(--radius-cell)] text-slate-500 hover:bg-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="flex-1 text-center">
          {Object.entries(totalIn).map(([cur, amt]) => `+${amt} ${cur}`).join(", ") || "—"}
          {" → "}
          {Object.entries(totalOut).map(([cur, amt]) => `−${amt} ${cur}`).join(", ") || "—"}
        </span>

        <button
          type="button"
          disabled
          className="px-3 py-1.5 rounded-[var(--radius-section)] bg-slate-200 text-slate-500 text-[12px] font-semibold cursor-not-allowed"
          title="Submit появится в этапе 4"
        >
          {t("cashier_stage1_placeholder")} → этап 4
        </button>
      </div>
    </div>
  );
}
