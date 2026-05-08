// src/components/cashier/DealForm.jsx
// Новая форма создания сделки. Этап 2: + DealLegsTable + legs[] state.
//
// Активируется через VITE_USE_NEW_DEAL_FORM=true. Default false — CashierPage
// показывает legacy ExchangeForm.

import React, { useState, useMemo, useCallback } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import StickyTitle from "./StickyTitle.jsx";
import CounterpartyBar from "./CounterpartyBar.jsx";
import DealLegsTable from "./DealLegsTable.jsx";
import { useDealForm } from "../../store/dealForm.js";

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

  // Counterparty + manager state (этап 1)
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

  // Legs state (этап 2)
  const {
    state: dealFormState,
    legs,
    inLegs,
    outLegs,
    addLeg,
    removeLeg,
    updateLeg,
    totalIn,
    totalOut,
  } = useDealForm();

  const onToggleSide = useCallback(
    (legId) => {
      const leg = legs.find((l) => l.id === legId);
      if (!leg) return;
      const next = leg.side === "in" ? "out" : "in";
      const patch = {
        side: next,
        // Перенастраиваем source/destination в зависимости от side
        source: next === "in" ? (leg.source || "fresh") : null,
        destination: next === "out" ? (leg.destination || "physical") : null,
      };
      updateLeg(legId, patch);
    },
    [legs, updateLeg]
  );

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
      />

      {/* TODO этап 3: ConditionsBar */}
      {/* TODO этап 4: FooterBar — здесь будет SubmitCTA */}
      <div className="px-4 py-3 text-hint border-t border-slate-200 bg-slate-50/40 flex justify-between items-center">
        <span>
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
