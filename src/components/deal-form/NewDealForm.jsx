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
import { multiplyAmount } from "../../utils/money.js";
import DealHeader from "./DealHeader.jsx";
import DealLeg from "./DealLeg.jsx";
import DealRateBlock from "./DealRateBlock.jsx";
import DealSummary from "./DealSummary.jsx";
import { displayRate, formatRate } from "../../lib/rates.js";

export default function NewDealForm({
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { getRate: getRateRaw } = useRates();
  const { accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();

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
    // Payload в shape совместимом с ExchangeForm.onSubmit:
    //   { amtIn, curIn, outputs: [{ currency, amount, rate, accountId, ... }],
    //     counterparty, accountId (IN account), referral, ... }
    // CashierPage.handleSubmit преобразует это в createDeal(payload).
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
      referral: false,
      comment: "",
      inTxHash: "",
      deferredIn: false,
      deferredOut: false,
      partialMode: false,
      partialPayNow: {},
      plannedLocal: "",
      applyMinFee: true,
    };
    onSubmit(payload);
  }, [
    canSubmit, amtIn, curIn, curOut, amtOut, rate, rateTouched,
    accountIdIn, accountIdOut, counterparty, onSubmit,
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
        onCounterpartyChange={setCounterparty}
        onClose={onCancel}
      />

      <DealLeg
        number="1"
        label="Клиент даёт"
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
        fromCcy={curIn}
        toCcy={curOut}
        sourceLabel={currentOffice ? "Office" : "Global"}
        marginUsd={marginInfo.marginUsd}
        spreadPct={marginInfo.spreadPct}
      />

      <DealLeg
        number="2"
        label="Мы отдаём"
        amount={amtOut}
        onAmountChange={(v) => { setAmtOut(v); setAmtOutTouched(true); }}
        currency={curOut}
        currencyOptions={CURRENCIES}
        onCurrencyChange={setCurOut}
        accountId={accountIdOut}
        accountOptions={accountOptions}
        onAccountChange={setAccountIdOut}
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
