// src/components/deal-form/NewDealForm.jsx
//
// Корневой компонент новой формы сделки — Phase 1 минимальный каркас:
//   • Простой counterparty input (без autocomplete пока)
//   • Один IN-leg + один OUT-leg (без multi-leg)
//   • Чёрная rate-капсула с inline-edit
//   • Bottom summary + Cancel + Submit (чёрная с glow-em)
//
// БИЗНЕС-ЛОГИКА:
//   • Submit формирует payload в shape совместимый с ExchangeForm
//     ({ amtIn, curIn, outputs[], counterparty, ... }) и пробрасывает
//     через тот же `onSubmit` (CashierPage → createDeal)
//   • Курс берётся через useRates.getRate с office override
//   • OUT.amount автоматически считается из IN.amount × rate
//     (если оператор не правит OUT вручную)
//
// Что НЕ покрыто в Phase 1:
//   • Multi-leg (несколько IN или OUT)
//   • Balance hints под суммами
//   • Client autocomplete с dropdown
//   • Rate autocomplete с офисами
//   • Timing selector (4 карточки)
//   • Options pills (Реферал / Без мин. / Отложенная)
//   • Advanced panel
//   • Deferred legs → operations.deal_workflow
//   • Crypto-address resolution и wallet conflict warning
//   • Auto-fee, applyMinFee, partial mode
//
// → Эти куски в Phase 2-4.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useRates } from "../../store/rates.jsx";
import { useAccounts } from "../../store/accounts.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useOffices } from "../../store/offices.jsx";
import { multiplyAmount } from "../../utils/money.js";
import DealHeader from "./DealHeader.jsx";
import DealLeg from "./DealLeg.jsx";
import DealRateBlock from "./DealRateBlock.jsx";
import DealSummary from "./DealSummary.jsx";
import DealTimingSelector from "./DealTimingSelector.jsx";
import DealOptions from "./DealOptions.jsx";
import DealAdvanced from "./DealAdvanced.jsx";
import { displayRate, formatRate } from "../../lib/rates.js";
import { shortAge, freshnessOf } from "../../utils/rateFreshness.jsx";

export default function NewDealForm({
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { getRate: getRateRaw, pairs: ratePairs, channels: rateChannels } = useRates();
  const { accounts, balanceOf } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { findOffice } = useOffices();

  const getRate = useCallback(
    (from, to) => getRateRaw(from, to, currentOffice),
    [getRateRaw, currentOffice]
  );

  // ── State (минимальное подмножество ExchangeForm для Phase 1) ────────
  const [curIn, setCurIn] = useState(initialData?.curIn || "USDT");
  const [amtIn, setAmtIn] = useState(
    initialData?.amtIn != null ? String(initialData.amtIn) : ""
  );
  const [curOut, setCurOut] = useState(initialData?.curOut || "TRY");
  const [amtOut, setAmtOut] = useState(
    initialData?.amtOut != null ? String(initialData.amtOut) : ""
  );
  const [rate, setRate] = useState(
    initialData?.rate != null ? String(initialData.rate) : ""
  );
  const [rateTouched, setRateTouched] = useState(false);
  const [amtOutTouched, setAmtOutTouched] = useState(false);
  const [accountIdIn, setAccountIdIn] = useState(initialData?.accountIdIn || "");
  const [accountIdOut, setAccountIdOut] = useState(initialData?.accountIdOut || "");
  const [counterparty, setCounterparty] = useState(initialData?.counterparty || "");
  // rateSourceOffice — выбранный office из autocomplete dropdown.
  //   null = текущий office (default), "__global__" = Global без override,
  //   officeId = override другого офиса.
  const [rateSourceOffice, setRateSourceOffice] = useState(null);

  // Timing — производный state. Маппится в submit payload как
  //   now           → deferredIn=false, deferredOut=false, partialMode=false
  //   client_later  → deferredIn=true
  //   us_later      → deferredOut=true
  //   partial       → partialMode=true
  const [timing, setTiming] = useState(() => {
    if (initialData?.partialMode) return "partial";
    if (initialData?.deferredIn) return "client_later";
    if (initialData?.deferredOut) return "us_later";
    return "now";
  });

  // Options + advanced
  const [referral, setReferral] = useState(!!initialData?.referral);
  const [referralAuto, setReferralAuto] = useState(false);
  const [applyMinFee, setApplyMinFee] = useState(
    typeof initialData?.applyMinFee === "boolean" ? initialData.applyMinFee : true
  );
  const [comment, setComment] = useState(initialData?.comment || "");
  const [inTxHash, setInTxHash] = useState(initialData?.inTxHash || "");
  const [commissionUsd, setCommissionUsd] = useState(
    initialData?.commissionUsd != null ? String(initialData.commissionUsd) : ""
  );
  const [customFeeUsd, setCustomFeeUsd] = useState(
    initialData?.customFeeUsd != null ? String(initialData.customFeeUsd) : ""
  );
  const [plannedLocal, setPlannedLocal] = useState(initialData?.plannedLocal || "");
  const [backdateAt, setBackdateAt] = useState(initialData?.backdateAt || "");

  // ── Auto-fill rate из useRates когда юзер не правил его руками ────────
  useEffect(() => {
    if (rateTouched) return;
    if (!curIn || !curOut || curIn === curOut) return;
    const r = getRate(curIn, curOut);
    if (Number.isFinite(r) && r > 0) {
      // Применяем displayRate чтобы оператор видел читаемое значение
      const d = displayRate(r, curIn, curOut);
      if (d.rate != null) setRate(formatRate(d.rate));
    }
  }, [curIn, curOut, getRate, rateTouched]);

  // ── Auto-calc amtOut = amtIn × rate когда не правили вручную ──────────
  useEffect(() => {
    if (amtOutTouched) return;
    const amt = parseFloat(amtIn);
    const rt = parseFloat(rate);
    if (!Number.isFinite(amt) || !Number.isFinite(rt) || amt <= 0 || rt <= 0) {
      return;
    }
    try {
      const out = multiplyAmount(amt, rt, currencyDict[curOut]?.scale ?? 2);
      setAmtOut(String(out));
    } catch {
      // молча — если minor-units math упал
    }
  }, [amtIn, rate, amtOutTouched, curOut, currencyDict]);

  // ── Reset accountIdIn/Out при смене валюты (счёт должен быть в той же ccy) ──
  useEffect(() => {
    if (!accountIdIn) return;
    const acc = accounts.find((a) => a.id === accountIdIn);
    if (acc && acc.currency !== curIn) setAccountIdIn("");
  }, [curIn, accountIdIn, accounts]);
  useEffect(() => {
    if (!accountIdOut) return;
    const acc = accounts.find((a) => a.id === accountIdOut);
    if (acc && acc.currency !== curOut) setAccountIdOut("");
  }, [curOut, accountIdOut, accounts]);

  // ── Account options (только активные счета текущего офиса) ────────────
  const accountOptions = useMemo(
    () => accounts.filter((a) => a.officeId === currentOffice && a.active !== false),
    [accounts, currentOffice]
  );

  // ── Reverse rate handler — swap from/to + flip rate value ─────────────
  const reverseRate = useCallback(() => {
    setCurIn((prev) => {
      setCurOut(prev);
      return curOut;
    });
    setAmtIn((prev) => { setAmtOut(prev); return amtOut; });
    // rate сам пересчитается auto-effect (rateTouched=false после reset)
    setRateTouched(false);
  }, [curOut, amtOut]);

  // ── Source label для rate-капсулы ─────────────────────────────────────
  const sourceLabel = useMemo(() => {
    if (rateSourceOffice === "__global__") return "Global";
    const oid = rateSourceOffice || currentOffice;
    if (!oid) return "Global";
    const o = findOffice(oid);
    return o?.name || "Office";
  }, [rateSourceOffice, currentOffice, findOffice]);

  // ── Age label — для текущего источника курса ──────────────────────────
  const ageLabel = useMemo(() => {
    if (!ratePairs || !rateChannels) return null;
    const matches = ratePairs.filter((p) => {
      const fc = rateChannels.find((c) => c.id === p.fromChannelId)?.currencyCode;
      const tc = rateChannels.find((c) => c.id === p.toChannelId)?.currencyCode;
      return p.isDefault && ((fc === curIn && tc === curOut) || (fc === curOut && tc === curIn));
    });
    let latest = null;
    matches.forEach((m) => {
      if (!m.updatedAt) return;
      const t = new Date(m.updatedAt).getTime();
      if (Number.isFinite(t) && (!latest || t > latest)) latest = t;
    });
    if (!latest) return null;
    return shortAge(freshnessOf(new Date(latest)).ageMs);
  }, [ratePairs, rateChannels, curIn, curOut]);

  // ── Summary line ──────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!amtIn || !amtOut || !rate) return "";
    return `${amtIn} ${curIn} × ${rate} = ${amtOut} ${curOut}`;
  }, [amtIn, curIn, amtOut, curOut, rate]);

  // ── Margin (упрощённая: разница actual vs market в base USD) ──────────
  const marginInfo = useMemo(() => {
    const amt = parseFloat(amtIn);
    const userRate = parseFloat(rate);
    const market = getRate(curIn, curOut);
    if (![amt, userRate, market].every((v) => Number.isFinite(v) && v > 0)) {
      return { marginUsd: null, spreadPct: null };
    }
    const spreadPct = (userRate - market) / market;
    // Простое приближение margin в curIn (через спред), затем в USD
    const marginInIn = amt * spreadPct;
    const toUsd = curIn === "USD" ? 1 : getRate(curIn, "USD");
    const marginUsd = Number.isFinite(toUsd) ? marginInIn * toUsd : marginInIn;
    return { marginUsd, spreadPct };
  }, [amtIn, rate, curIn, curOut, getRate]);

  // ── Submit ─────────────────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    return (
      counterparty.trim().length > 0 &&
      Number.isFinite(parseFloat(amtIn)) && parseFloat(amtIn) > 0 &&
      Number.isFinite(parseFloat(amtOut)) && parseFloat(amtOut) > 0 &&
      Number.isFinite(parseFloat(rate)) && parseFloat(rate) > 0 &&
      curIn !== curOut
    );
  }, [counterparty, amtIn, amtOut, rate, curIn, curOut]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    // Payload в shape совместимом с ExchangeForm.onSubmit.
    // CashierPage.handleFormSubmit → createDeal(payload) → ledger.create_deal_v2.
    const payload = {
      amtIn: parseFloat(amtIn),
      curIn,
      outputs: [
        {
          id: "out_0",
          currency: curOut,
          amount: parseFloat(amtOut),
          rate: parseFloat(rate),
          manualRate: rateTouched,
          accountId: accountIdOut || "",
          address: "",
          applyFee: false,
          outKind: "ours",
          partnerAccountId: null,
        },
      ],
      counterparty: counterparty.trim(),
      accountId: accountIdIn || "",
      referral,
      comment,
      inTxHash,
      // Timing → ExchangeForm-совместимые булевы:
      deferredIn: timing === "client_later",
      deferredOut: timing === "us_later",
      partialMode: timing === "partial",
      partialPayNow: {},
      plannedLocal,
      backdateAt,
      applyMinFee,
      // Advanced numerics:
      commissionUsd: commissionUsd ? parseFloat(commissionUsd) : undefined,
      customFeeUsd: customFeeUsd ? parseFloat(customFeeUsd) : undefined,
    };
    onSubmit(payload);
  }, [
    canSubmit, amtIn, curIn, curOut, amtOut, rate, rateTouched,
    accountIdIn, accountIdOut, counterparty, timing,
    referral, applyMinFee, comment, inTxHash,
    commissionUsd, customFeeUsd, plannedLocal, backdateAt,
    onSubmit,
  ]);

  // ── Hotkey ⌘↵ — submit ────────────────────────────────────────────────
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

  return (
    <div className="bg-surface rounded-card overflow-hidden">
      <DealHeader
        counterparty={counterparty}
        onCounterpartyChange={(v) => {
          setCounterparty(v);
          // Если юзер очистил или поменял имя — авто-реферал сбрасываем
          if (referralAuto) {
            setReferral(false);
            setReferralAuto(false);
          }
        }}
        onSelectClient={(c) => {
          if (c?.tag && /referral|реферал/i.test(c.tag)) {
            setReferral(true);
            setReferralAuto(true);
          }
        }}
        onClose={onCancel}
      />

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

      <DealRateBlock
        rate={rate}
        onRateChange={(v) => { setRate(v); setRateTouched(true); }}
        onSelectSuggestion={(s) => {
          setRateTouched(true);
          setRateSourceOffice(s.key);
        }}
        fromCcy={curIn}
        toCcy={curOut}
        sourceLabel={sourceLabel}
        ageLabel={ageLabel}
        marginUsd={marginInfo.marginUsd}
        spreadPct={marginInfo.spreadPct}
        onReverse={reverseRate}
      />

      <DealLeg
        number="2"
        label="Мы отдаём"
        direction="out"
        amount={amtOut}
        onAmountChange={(v) => { setAmtOut(v); setAmtOutTouched(true); }}
        currency={curOut}
        currencyOptions={CURRENCIES}
        onCurrencyChange={setCurOut}
        accountId={accountIdOut}
        accountOptions={accountOptions}
        onAccountChange={setAccountIdOut}
      />

      <DealTimingSelector
        value={timing}
        onChange={setTiming}
      />

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
      />
    </div>
  );
}
