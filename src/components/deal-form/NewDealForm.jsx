// src/components/deal-form/NewDealForm.jsx
//
// Корневой компонент новой формы сделки. Phase 3b — multi-leg OUT.
//
// State: IN — одна нога (curIn/amtIn/accountIdIn — single, как у
// ExchangeForm). OUT — массив `outputs[]` (каждая нога со своим rate,
// account, amount). Primary output (idx=0) использует общую чёрную
// rate-капсулу; вложенные (idx>=1) имеют свой inline rate input.
//
// Submit: outputs[] фильтрованы по amount>0 && rate>0 → передаём
// существующему createDeal(payload), shape остаётся прежний (как у
// ExchangeForm), adapter дальше пере собирает в v2 inLegs/outLegs.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useRates } from "../../store/rates.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useOffices } from "../../store/offices.jsx";
import { multiplyAmount } from "../../utils/money.js";
import DealHeader from "./DealHeader.jsx";
import DealLeg from "./DealLeg.jsx";
import DealLegNested from "./DealLegNested.jsx";
import DealRateBlock from "./DealRateBlock.jsx";
import DealSummary from "./DealSummary.jsx";
import DealTimingSelector from "./DealTimingSelector.jsx";
import DealOptions from "./DealOptions.jsx";
import DealAdvanced from "./DealAdvanced.jsx";
import { displayRate, formatRate } from "../../lib/rates.js";
import { shortAge, freshnessOf } from "../../utils/rateFreshness.jsx";

// ── Helpers ────────────────────────────────────────────────────────────
const DRAFT_KEY = "coinplata.newDealFormDraft";
const newOutputId = () => `out_${Math.random().toString(36).slice(2, 8)}`;
const emptyOutput = (currency = "TRY") => ({
  id: newOutputId(),
  currency,
  amount: "",
  rate: "",
  manualRate: false,
  amountTouched: false,
  accountId: "",
  address: "",
});

function outputsFromInitial(initial) {
  if (Array.isArray(initial?.outputs) && initial.outputs.length > 0) {
    return initial.outputs.map((o) => ({
      id: o.id || newOutputId(),
      currency: o.currency,
      amount: o.amount != null ? String(o.amount) : "",
      rate: o.rate != null ? String(o.rate) : "",
      manualRate: !!o.manualRate,
      amountTouched: false,
      accountId: o.accountId || "",
      address: o.address || "",
    }));
  }
  if (initial?.curOut) {
    return [{
      id: newOutputId(),
      currency: initial.curOut,
      amount: initial.amtOut != null ? String(initial.amtOut) : "",
      rate: initial.rate != null ? String(initial.rate) : "",
      manualRate: false,
      amountTouched: false,
      accountId: initial.accountIdOut || "",
      address: initial.address || "",
    }];
  }
  return [emptyOutput("TRY")];
}

// ── Draft autosave (sessionStorage) ────────────────────────────────────
function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveDraft(data) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // ignore quota / private-mode
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}
function draftAgeText(savedAt) {
  if (!savedAt) return null;
  const ageSec = Math.floor((Date.now() - savedAt) / 1000);
  if (ageSec < 5) return "только что";
  if (ageSec < 60) return `${ageSec} сек назад`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)} мин назад`;
  return `${Math.floor(ageSec / 3600)} ч назад`;
}

export default function NewDealForm({
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { getRate: getRateRaw, pairs: ratePairs, channels: rateChannels } = useRates();
  const { accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { findOffice } = useOffices();

  const getRate = useCallback(
    (from, to) => getRateRaw(from, to, currentOffice),
    [getRateRaw, currentOffice]
  );

  // ── Draft (sessionStorage) — восстанавливаем если нет initialData ────
  const draft = useMemo(() => (initialData ? null : loadDraft()), [initialData]);
  const seed = initialData || draft;

  // ── IN state (single leg) ────────────────────────────────────────────
  const [curIn, setCurIn] = useState(seed?.curIn || "USDT");
  const [amtIn, setAmtIn] = useState(
    seed?.amtIn != null ? String(seed.amtIn) : ""
  );
  const [accountIdIn, setAccountIdIn] = useState(seed?.accountIdIn || "");

  // ── OUT state (multi-leg) ────────────────────────────────────────────
  const [outputs, setOutputs] = useState(() => outputsFromInitial(seed));
  const primary = outputs[0];

  const patchOutput = useCallback((idx, patch) => {
    setOutputs((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }, []);
  const addOutput = useCallback(() => {
    // Default currency для новой ноги — что не была в первой
    setOutputs((prev) => {
      const used = new Set(prev.map((o) => o.currency));
      const candidates = ["TRY", "EUR", "RUB", "USD", "USDT"];
      const next = candidates.find((c) => !used.has(c)) || "EUR";
      return [...prev, emptyOutput(next)];
    });
  }, []);
  const removeOutput = useCallback((idx) => {
    setOutputs((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }, []);

  // ── Counterparty + chip state ────────────────────────────────────────
  const [counterparty, setCounterparty] = useState(seed?.counterparty || "");
  // selectedClient — объект клиента когда юзер выбрал из dropdown.
  // null → autocomplete input в шапке; not null → chip с meta.
  const [selectedClient, setSelectedClient] = useState(null);
  const [rateSourceOffice, setRateSourceOffice] = useState(null);

  const [timing, setTiming] = useState(() => {
    if (seed?.partialMode) return "partial";
    if (seed?.deferredIn) return "client_later";
    if (seed?.deferredOut) return "us_later";
    return "now";
  });
  const [referral, setReferral] = useState(!!seed?.referral);
  const [referralAuto, setReferralAuto] = useState(false);
  const [applyMinFee, setApplyMinFee] = useState(
    typeof seed?.applyMinFee === "boolean" ? seed.applyMinFee : true
  );
  const [comment, setComment] = useState(seed?.comment || "");
  const [inTxHash, setInTxHash] = useState(seed?.inTxHash || "");
  const [commissionUsd, setCommissionUsd] = useState(
    seed?.commissionUsd != null ? String(seed.commissionUsd) : ""
  );
  const [customFeeUsd, setCustomFeeUsd] = useState(
    seed?.customFeeUsd != null ? String(seed.customFeeUsd) : ""
  );
  const [plannedLocal, setPlannedLocal] = useState(seed?.plannedLocal || "");
  const [backdateAt, setBackdateAt] = useState(seed?.backdateAt || "");
  // Дата последнего сохранения draft (для подписи в Summary)
  const [draftSavedAt, setDraftSavedAt] = useState(draft?.savedAt || null);

  // ── Draft autosave (debounced 600ms) ─────────────────────────────────
  // Сохраняем в sessionStorage чтобы переход между вкладками или случайное
  // закрытие формы не потеряли заполненный контент.
  useEffect(() => {
    const handle = setTimeout(() => {
      // Не сохраняем пустой draft (когда юзер ничего ещё не вводил)
      const hasAny =
        counterparty.trim() || amtIn || outputs.some((o) => o.amount || o.rate);
      if (!hasAny) {
        clearDraft();
        setDraftSavedAt(null);
        return;
      }
      saveDraft({
        curIn, amtIn, accountIdIn,
        outputs,
        counterparty,
        timing, referral, applyMinFee,
        comment, inTxHash,
        commissionUsd, customFeeUsd,
        plannedLocal, backdateAt,
      });
      setDraftSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(handle);
  }, [
    curIn, amtIn, accountIdIn, outputs, counterparty,
    timing, referral, applyMinFee, comment, inTxHash,
    commissionUsd, customFeeUsd, plannedLocal, backdateAt,
  ]);

  // ── Re-render для подписи «X секунд назад» каждые 5с ──────────────────
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!draftSavedAt) return undefined;
    const id = setInterval(() => forceTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, [draftSavedAt]);

  // ── Auto-fill rate для каждой ноги (если не вручную, rate пустой) ────
  useEffect(() => {
    outputs.forEach((o, i) => {
      if (o.manualRate) return;
      if (o.rate) return;
      if (!curIn || !o.currency || curIn === o.currency) return;
      const r = getRate(curIn, o.currency);
      if (Number.isFinite(r) && r > 0) {
        const d = displayRate(r, curIn, o.currency);
        if (d.rate != null) {
          patchOutput(i, { rate: formatRate(d.rate) });
        }
      }
    });
  }, [curIn, outputs, getRate, patchOutput]);

  // ── Auto-calc primary amount = amtIn × primary.rate (если не правили) ─
  useEffect(() => {
    if (!primary || primary.amountTouched) return;
    const amt = parseFloat(amtIn);
    const rt = parseFloat(primary.rate);
    if (!Number.isFinite(amt) || !Number.isFinite(rt) || amt <= 0 || rt <= 0) return;
    try {
      const out = multiplyAmount(amt, rt, currencyDict[primary.currency]?.scale ?? 2);
      const next = String(out);
      if (next !== primary.amount) {
        patchOutput(0, { amount: next });
      }
    } catch {
      // молча
    }
  }, [amtIn, primary, currencyDict, patchOutput]);

  // ── Reset accountIdIn при смене curIn (ccy mismatch) ────────────────
  useEffect(() => {
    if (!accountIdIn) return;
    const acc = accounts.find((a) => a.id === accountIdIn);
    if (acc && acc.currency !== curIn) setAccountIdIn("");
  }, [curIn, accountIdIn, accounts]);

  // ── Reset accountId per-output при смене currency ────────────────────
  useEffect(() => {
    outputs.forEach((o, i) => {
      if (!o.accountId) return;
      const acc = accounts.find((a) => a.id === o.accountId);
      if (acc && acc.currency !== o.currency) {
        patchOutput(i, { accountId: "" });
      }
    });
  }, [outputs, accounts, patchOutput]);

  // ── Account options ──────────────────────────────────────────────────
  const accountOptions = useMemo(
    () => accounts.filter((a) => a.officeId === currentOffice && a.active !== false),
    [accounts, currentOffice]
  );

  // ── Reverse rate (swap IN ↔ primary OUT) ────────────────────────────
  const reverseRate = useCallback(() => {
    const newCurIn = primary.currency;
    const newCurOut = curIn;
    const newAmtIn = primary.amount;
    setCurIn(newCurIn);
    setAmtIn(newAmtIn);
    patchOutput(0, {
      currency: newCurOut,
      amount: amtIn,
      rate: "",
      manualRate: false,
      amountTouched: false,
    });
  }, [primary, curIn, amtIn, patchOutput]);

  // ── Rate source label + age (на основе primary leg) ────────────────────
  const sourceLabel = useMemo(() => {
    if (rateSourceOffice === "__global__") return "Global";
    const oid = rateSourceOffice || currentOffice;
    if (!oid) return "Global";
    const o = findOffice(oid);
    return o?.name || "Office";
  }, [rateSourceOffice, currentOffice, findOffice]);

  const ageLabel = useMemo(() => {
    if (!primary || !ratePairs || !rateChannels) return null;
    const matches = ratePairs.filter((p) => {
      const fc = rateChannels.find((c) => c.id === p.fromChannelId)?.currencyCode;
      const tc = rateChannels.find((c) => c.id === p.toChannelId)?.currencyCode;
      return p.isDefault && ((fc === curIn && tc === primary.currency) || (fc === primary.currency && tc === curIn));
    });
    let latest = null;
    matches.forEach((m) => {
      if (!m.updatedAt) return;
      const t = new Date(m.updatedAt).getTime();
      if (Number.isFinite(t) && (!latest || t > latest)) latest = t;
    });
    if (!latest) return null;
    return shortAge(freshnessOf(new Date(latest)).ageMs);
  }, [ratePairs, rateChannels, curIn, primary]);

  // ── Summary line ─────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!amtIn || !primary?.amount || !primary?.rate) return "";
    const parts = outputs
      .filter((o) => parseFloat(o.amount) > 0)
      .map((o) => `${o.amount} ${o.currency}`)
      .join(" + ");
    return `${amtIn} ${curIn} → ${parts || "—"}`;
  }, [amtIn, curIn, outputs, primary]);

  // ── Margin (упрощённо — только по primary leg) ────────────────────────
  const marginInfo = useMemo(() => {
    if (!primary) return { marginUsd: null, spreadPct: null };
    const amt = parseFloat(amtIn);
    const userRate = parseFloat(primary.rate);
    const market = getRate(curIn, primary.currency);
    if (![amt, userRate, market].every((v) => Number.isFinite(v) && v > 0)) {
      return { marginUsd: null, spreadPct: null };
    }
    const spreadPct = (userRate - market) / market;
    const marginInIn = amt * spreadPct;
    const toUsd = curIn === "USD" ? 1 : getRate(curIn, "USD");
    const marginUsd = Number.isFinite(toUsd) ? marginInIn * toUsd : marginInIn;
    return { marginUsd, spreadPct };
  }, [amtIn, primary, curIn, getRate]);

  // ── Submit validation ─────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (!counterparty.trim()) return false;
    if (!Number.isFinite(parseFloat(amtIn)) || parseFloat(amtIn) <= 0) return false;
    const validOuts = outputs.filter(
      (o) => Number.isFinite(parseFloat(o.amount)) && parseFloat(o.amount) > 0 &&
             Number.isFinite(parseFloat(o.rate)) && parseFloat(o.rate) > 0 &&
             o.currency && o.currency !== curIn
    );
    return validOuts.length > 0;
  }, [counterparty, amtIn, outputs, curIn]);

  // ── Submit handler ────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const validOuts = outputs.filter(
      (o) => Number.isFinite(parseFloat(o.amount)) && parseFloat(o.amount) > 0 &&
             Number.isFinite(parseFloat(o.rate)) && parseFloat(o.rate) > 0
    );
    const payload = {
      amtIn: parseFloat(amtIn),
      curIn,
      outputs: validOuts.map((o, i) => ({
        id: `out_${i}`,
        currency: o.currency,
        amount: parseFloat(o.amount),
        rate: parseFloat(o.rate),
        manualRate: o.manualRate,
        accountId: o.accountId || "",
        address: "",
        applyFee: false,
        outKind: "ours",
        partnerAccountId: null,
      })),
      counterparty: counterparty.trim(),
      accountId: accountIdIn || "",
      referral,
      comment,
      inTxHash,
      deferredIn: timing === "client_later",
      deferredOut: timing === "us_later",
      partialMode: timing === "partial",
      partialPayNow: {},
      plannedLocal,
      backdateAt,
      applyMinFee,
      commissionUsd: commissionUsd ? parseFloat(commissionUsd) : undefined,
      customFeeUsd: customFeeUsd ? parseFloat(customFeeUsd) : undefined,
    };
    onSubmit(payload);
    clearDraft();
    setDraftSavedAt(null);
  }, [
    canSubmit, amtIn, curIn, outputs, accountIdIn, counterparty, timing,
    referral, applyMinFee, comment, inTxHash,
    commissionUsd, customFeeUsd, plannedLocal, backdateAt,
    onSubmit,
  ]);

  // ── Hotkeys: ⌘↵ submit, Esc cancel ─────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit && !submitting) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape" && onCancel) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmit, submitting, handleSubmit, onCancel]);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-surface rounded-card overflow-hidden">
      <DealHeader
        counterparty={counterparty}
        onCounterpartyChange={(v) => {
          setCounterparty(v);
          // Ручной ввод сбрасывает выбранного клиента и auto-referral
          if (selectedClient) setSelectedClient(null);
          if (referralAuto) {
            setReferral(false);
            setReferralAuto(false);
          }
        }}
        selectedClient={selectedClient}
        onSelectClient={(c) => {
          setSelectedClient(c);
          setCounterparty(c?.nickname || "");
          if (c?.tag && /referral|реферал/i.test(c.tag)) {
            setReferral(true);
            setReferralAuto(true);
          }
        }}
        onClearClient={() => {
          setSelectedClient(null);
          setCounterparty("");
          if (referralAuto) {
            setReferral(false);
            setReferralAuto(false);
          }
        }}
        onClose={onCancel}
      />

      {/* IN — одна нога */}
      <DealLeg
        number="1"
        label="Клиент даёт"
        direction="in"
        amount={amtIn}
        onAmountChange={setAmtIn}
        currency={curIn}
        currencyOptions={CURRENCIES}
        onCurrencyChange={setCurIn}
        accountId={accountIdIn}
        accountOptions={accountOptions}
        onAccountChange={setAccountIdIn}
      />

      {/* Чёрная rate-капсула — управляет primary.rate */}
      <DealRateBlock
        rate={primary?.rate || ""}
        onRateChange={(v) => patchOutput(0, { rate: v, manualRate: true })}
        onSelectSuggestion={(s) => {
          setRateSourceOffice(s.key);
          patchOutput(0, { rate: formatRate(s.display.rate), manualRate: true });
        }}
        fromCcy={curIn}
        toCcy={primary?.currency || "TRY"}
        sourceLabel={sourceLabel}
        ageLabel={ageLabel}
        marginUsd={marginInfo.marginUsd}
        spreadPct={marginInfo.spreadPct}
        onReverse={reverseRate}
      />

      {/* Primary OUT — большой блок */}
      <DealLeg
        number="2"
        label="Мы отдаём"
        direction="out"
        amount={primary?.amount || ""}
        onAmountChange={(v) => patchOutput(0, { amount: v, amountTouched: true })}
        currency={primary?.currency || "TRY"}
        currencyOptions={CURRENCIES}
        onCurrencyChange={(v) =>
          patchOutput(0, { currency: v, rate: "", manualRate: false, amountTouched: false })
        }
        accountId={primary?.accountId || ""}
        accountOptions={accountOptions}
        onAccountChange={(v) => patchOutput(0, { accountId: v })}
        address={primary?.address || ""}
        onAddressChange={(v) => patchOutput(0, { address: v })}
        onAddLeg={addOutput}
        addLegLabel="Ещё выдача"
      />

      {/* Nested OUT (от 2-й и далее) */}
      {outputs.length > 1 && (
        <div className="px-7 pb-5 space-y-2.5">
          {outputs.slice(1).map((o, idx) => (
            <DealLegNested
              key={o.id}
              legNumber={`Выдача №${idx + 2}`}
              direction="out"
              fromCcy={curIn}
              amount={o.amount}
              onAmountChange={(v) => patchOutput(idx + 1, { amount: v, amountTouched: true })}
              rate={o.rate}
              onRateChange={(v) => patchOutput(idx + 1, { rate: v, manualRate: true })}
              currency={o.currency}
              currencyOptions={CURRENCIES}
              onCurrencyChange={(v) =>
                patchOutput(idx + 1, { currency: v, rate: "", manualRate: false, amountTouched: false })
              }
              accountId={o.accountId}
              accountOptions={accountOptions}
              onAccountChange={(v) => patchOutput(idx + 1, { accountId: v })}
              address={o.address || ""}
              onAddressChange={(v) => patchOutput(idx + 1, { address: v })}
              onRemove={() => removeOutput(idx + 1)}
            />
          ))}
        </div>
      )}

      <DealTimingSelector value={timing} onChange={setTiming} />

      <DealOptions
        referral={referral}
        onReferralChange={(v) => { setReferral(v); if (!v) setReferralAuto(false); }}
        referralAuto={referralAuto}
        applyMinFee={applyMinFee}
        onApplyMinFeeChange={setApplyMinFee}
        deferredOut={timing === "us_later"}
        onDeferredOutChange={(v) => setTiming(v ? "us_later" : "now")}
      />

      <DealAdvanced
        comment={comment}
        onCommentChange={setComment}
        inTxHash={inTxHash}
        onInTxHashChange={setInTxHash}
        commissionUsd={commissionUsd}
        onCommissionUsdChange={setCommissionUsd}
        customFeeUsd={customFeeUsd}
        onCustomFeeUsdChange={setCustomFeeUsd}
        plannedLocal={plannedLocal}
        onPlannedLocalChange={setPlannedLocal}
        backdateAt={backdateAt}
        onBackdateAtChange={setBackdateAt}
      />

      <DealSummary
        summary={summary}
        marginUsd={marginInfo.marginUsd}
        spreadPct={marginInfo.spreadPct}
        canSubmit={canSubmit}
        submitting={submitting}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        draftAgeText={draftAgeText(draftSavedAt)}
      />
    </div>
  );
}
