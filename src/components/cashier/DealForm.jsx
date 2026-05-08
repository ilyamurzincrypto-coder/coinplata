// src/components/cashier/DealForm.jsx
// Новая форма создания сделки. Этап 2 + 2.5 + 3 + 4 (Submit).

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "../../i18n/translations.jsx";
import { useAuth } from "../../store/auth.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useTransactions } from "../../store/transactions.jsx";
import { useClientBalances } from "../../store/clientBalances.js";
import { emitToast } from "../../lib/toast.jsx";
import StickyTitle from "./StickyTitle.jsx";
import CounterpartyBar from "./CounterpartyBar.jsx";
import DealLegsTable from "./DealLegsTable.jsx";
import ConditionsBar from "./ConditionsBar.jsx";
import FooterBar from "./FooterBar.jsx";
import RatesPanel from "./RatesPanel.jsx";
import {
  useDealForm,
  tryLoadDraft,
  clearDraft,
} from "../../store/dealForm.js";
import { USE_NEW_LEDGER } from "../../lib/newLedger.js";
import { createDeal } from "../../lib/dealOperations.js";
import { buildTx } from "../../lib/dealForm/buildTx.js";
import { mapErrorToToast } from "../../lib/dealForm/errorMapper.js";

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
  const { accounts, balanceOf } = useAccounts();

  // accountCodeByLegacyId — карта public.accounts.id → ledger.accounts.code.
  const accountCodeByLegacyId = useMemo(() => {
    if (!USE_NEW_LEDGER) return null;
    return Object.fromEntries(
      accounts
        .filter((a) => a.ledgerAccountCode && !a.legacyOnly)
        .map((a) => [a.id, a.ledgerAccountCode])
    );
  }, [accounts]);

  const [draftPrompt, setDraftPrompt] = useState(() => {
    if (initialData) return null;
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
  const [loading, setLoading] = useState(false);
  const [activeOutLegId, setActiveOutLegId] = useState(null);

  useEffect(() => {
    if (counterpartyId) return;
    const match = counterparties?.find?.(
      (c) => c.nickname && c.nickname.toLowerCase() === counterparty.trim().toLowerCase()
    );
    if (match) setCounterpartyId(match.id);
  }, [counterparty, counterparties, counterpartyId]);

  const clientBalances = useClientBalances(counterpartyId);

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

  // ── 2.5.4 RatesPanel click-to-fill ──
  // Активная OUT leg выбирается:
  //   1. Last edited OUT leg (из reducer __lastUpdate)
  //   2. Fallback: first OUT leg
  const activeLeg = useMemo(() => {
    if (activeOutLegId) {
      const found = legs.find((l) => l.id === activeOutLegId);
      if (found && found.side === "out") return found;
    }
    return outLegs[0] || null;
  }, [activeOutLegId, legs, outLegs]);

  const handlePickRate = useCallback(
    (from, to, rate) => {
      if (!activeLeg) return;
      // Определяем какой direction matches active leg
      const inCurrency = inLegs[0]?.currency;
      // Стандартный сценарий: leg.currency = OUT side, IN side = inLegs[0].currency
      // Если leg.currency = to, fill rate (IN→OUT prices)
      if (activeLeg.currency === to && inCurrency === from) {
        updateLeg(activeLeg.id, { rate: String(rate), rateManual: false });
      } else if (activeLeg.currency === from && inCurrency === to) {
        // Inverse — rate в обратную сторону
        const inv = 1 / rate;
        updateLeg(activeLeg.id, { rate: String(inv), rateManual: false });
      } else {
        // Direction не совпадает — fill сырой rate как есть, мenager сам разберется
        updateLeg(activeLeg.id, { rate: String(rate), rateManual: true });
      }
    },
    [activeLeg, inLegs, updateLeg]
  );

  const activeLegSummary = useMemo(() => {
    if (!activeLeg) return null;
    const inCur = inLegs[0]?.currency;
    if (!inCur || !activeLeg.currency) return null;
    return `${inCur} → ${activeLeg.currency}`;
  }, [activeLeg, inLegs]);

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

  // ── Validation: hasOverdraft / hasShortage / submitDisabled ──
  const hasOverdraft = useMemo(() => {
    return inLegs.some((l) => {
      if (l.source !== "from_balance") return false;
      const amt = Number(l.amount);
      const bal = clientBalances[l.currency];
      return Number.isFinite(amt) && amt > 0 && Number.isFinite(bal) && amt > bal;
    });
  }, [inLegs, clientBalances]);

  const hasShortage = useMemo(() => {
    return outLegs.some((l) => {
      if (l.destination !== "physical" || !l.accountId) return false;
      const amt = Number(l.amount);
      const bal = balanceOf(l.accountId);
      return Number.isFinite(amt) && amt > 0 && Number.isFinite(bal) && amt > bal;
    });
  }, [outLegs, balanceOf]);

  // submitDisabled — base validation (без backend errors)
  const submitDisabled = useMemo(() => {
    if (!counterparty.trim()) return true;
    if (legs.length === 0) return true;
    // Должен быть хотя бы один IN с amount>0 и currency
    if (!inLegs.some((l) => Number(l.amount) > 0 && l.currency)) return true;
    // Должен быть хотя бы один OUT с amount>0 и currency
    if (!outLegs.some((l) => Number(l.amount) > 0 && l.currency)) return true;
    return false;
  }, [counterparty, legs, inLegs, outLegs]);

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

  // ── Submit handlers ──
  const buildPayload = useCallback(
    (extraMeta = {}) => {
      // Передаём legs/commission/conditions внутри state shape
      return buildTx({
        state: { legs, commission: [], conditions },
        clientId: counterpartyId,
        officeId: currentOffice,
        accountCodeByLegacyId,
        description: conditions?.on_demand?.comment || null,
        metadata: extraMeta,
      });
    },
    [legs, conditions, counterpartyId, currentOffice, accountCodeByLegacyId]
  );

  const doSubmit = useCallback(
    async (extraMeta = {}) => {
      if (submitDisabled || loading) return;
      if (!counterpartyId) {
        setShowRequiredError(true);
        emitToast("error", t("error_required_field"));
        return;
      }

      let payload;
      try {
        payload = buildPayload(extraMeta);
      } catch (buildErr) {
        const toast = mapErrorToToast(
          { code: "22000", message: buildErr.message },
          t
        );
        emitToast("error", toast.message + (toast.details ? ` · ${toast.details}` : ""));
        return;
      }

      setLoading(true);
      try {
        const result = await createDeal(payload);
        const txId =
          (result && (result.deal_tx_id || result)) || "";
        emitToast(
          "success",
          t("deal_created_success") + (txId ? ` · ${String(txId).slice(0, 8)}…` : "")
        );
        clearDraft();
        reset();
        onSubmit?.(result);
      } catch (error) {
        const toast = mapErrorToToast(error, t);
        emitToast(
          "error",
          toast.message + (toast.details ? ` · ${toast.details}` : "")
        );
        // eslint-disable-next-line no-console
        console.warn("[DealForm] submit failed", error);
      } finally {
        setLoading(false);
      }
    },
    [
      submitDisabled,
      loading,
      counterpartyId,
      buildPayload,
      t,
      reset,
      onSubmit,
    ]
  );

  const onSubmitPrimary = useCallback(
    () => doSubmit({ submission_kind: "create" }),
    [doSubmit]
  );
  const onSubmitDraft = useCallback(
    () => doSubmit({ submission_kind: "draft", legacy_status: "draft" }),
    [doSubmit]
  );
  const onSubmitAndNotify = useCallback(
    () => doSubmit({ submission_kind: "create_and_notify" }),
    [doSubmit]
  );

  return (
    <div className="flex gap-3 items-start">
    <div className="bg-white rounded-[var(--radius-section)] border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1 min-w-0">
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

      <div
        onFocusCapture={(e) => {
          // Trace last focused OUT leg для RatesPanel click-to-fill
          const row = e.target.closest("[data-leg-id]");
          if (!row) return;
          const id = row.getAttribute("data-leg-id");
          const side = row.getAttribute("data-leg-side");
          if (side === "out" && id) setActiveOutLegId(id);
        }}
      >
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
      </div>

      <ConditionsBar
        conditions={conditions}
        setCondition={setCondition}
        legs={legs}
      />

      <FooterBar
        legs={legs}
        totalIn={totalIn}
        totalOut={totalOut}
        conditions={conditions}
        hasOverdraft={hasOverdraft}
        hasShortage={hasShortage}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSubmit={onSubmitPrimary}
        onSubmitDraft={onSubmitDraft}
        onSubmitAndNotify={onSubmitAndNotify}
        submitDisabled={submitDisabled}
        loading={loading || submitting}
      />
    </div>

    {/* Right sidebar: RatesPanel (этап 4 — click-to-fill rate в active OUT) */}
    <div className="hidden xl:block">
      <RatesPanel
        officeId={currentOffice}
        onPickRate={handlePickRate}
        activeLegSummary={activeLegSummary}
      />
    </div>
    </div>
  );
}
