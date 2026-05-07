// src/components/cashier/DealForm.jsx
// Новая форма создания сделки. На этапе 1 — только shell:
// StickyTitle + CounterpartyBar. Остальные секции (DealLegsTable,
// ConditionsBar, FooterBar) приходят в этапах 2-4.
//
// Активируется через VITE_USE_NEW_DEAL_FORM=true. Пока default false,
// CashierPage показывает старый ExchangeForm.

import React, { useState, useMemo } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import StickyTitle from "./StickyTitle.jsx";
import CounterpartyBar from "./CounterpartyBar.jsx";

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

  // Минимальный state для этапа 1: counterparty + manager + office.
  // Полный legs[] state приходит в этапе 2.
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

  // hasUnsavedChanges — для close-confirm. На этапе 1 любое изменение
  // counterparty считается unsaved.
  const hasUnsavedChanges = useMemo(() => {
    return counterparty.trim().length > 0;
  }, [counterparty]);

  // dealId stable across re-renders (для StickyTitle title-attr UUID).
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

      {/* TODO этап 2: DealLegsTable */}
      {/* TODO этап 3: ConditionsBar */}
      {/* TODO этап 4: FooterBar */}

      <div
        className="px-4 py-8 text-center text-hint"
        style={{ minHeight: 200 }}
      >
        {t("cashier_stage1_placeholder")}
      </div>
    </div>
  );
}
