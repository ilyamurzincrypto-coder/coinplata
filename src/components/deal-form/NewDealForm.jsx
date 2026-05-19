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
import DealRateMatrix from "./DealRateMatrix.jsx";
import DealSummary from "./DealSummary.jsx";
import DealTimingSelector from "./DealTimingSelector.jsx";
import DealOptions from "./DealOptions.jsx";
import DealAdvanced from "./DealAdvanced.jsx";
import { displayRate, formatRate, formatRateCompact } from "../../lib/rates.js";
import { shortAge, freshnessOf } from "../../utils/rateFreshness.jsx";

// ── Helpers ────────────────────────────────────────────────────────────
const DRAFT_KEY = "coinplata.newDealFormDraft";
const LAST_IN_KEY = "coinplata:last-in-ccy";
const LAST_OUT_KEY = "coinplata:last-out-ccy";

function readLast(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v && typeof v === "string" && v.length <= 8) return v;
  } catch {}
  return fallback;
}
function writeLast(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

const newOutputId = () => `out_${Math.random().toString(36).slice(2, 8)}`;
const newInputId = () => `in_${Math.random().toString(36).slice(2, 8)}`;
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
const emptyInput = (currency = "USDT") => ({
  id: newInputId(),
  currency,
  amount: "",
  accountId: "",
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

  // ── IN state (multi-leg) ─────────────────────────────────────────────
  // Массив inputs[]: первая = primary (большой блок), остальные = nested.
  // inputs.length === 0 → withdrawal (без приёма): adapter автоматически
  // routes в withdrawal RPC.
  const [inputs, setInputs] = useState(() => {
    if (Array.isArray(seed?.inPayments) && seed.inPayments.length > 0) {
      return seed.inPayments.map((p) => ({
        id: newInputId(),
        currency: (p.currency || "USDT").toUpperCase(),
        amount: p.amount != null ? String(p.amount) : "",
        accountId: p.accountId || "",
      }));
    }
    if (seed?.curIn || seed?.amtIn != null || seed?.accountIdIn) {
      return [{
        id: newInputId(),
        currency: (seed.curIn || "USDT").toUpperCase(),
        amount: seed?.amtIn != null ? String(seed.amtIn) : "",
        accountId: seed.accountIdIn || "",
      }];
    }
    return [emptyInput(readLast(LAST_IN_KEY, "USDT"))];
  });
  const primaryIn = inputs[0];

  const patchInput = useCallback((idx, patch) => {
    setInputs((prev) => prev.map((i, j) => (j === idx ? { ...i, ...patch } : i)));
  }, []);
  const addInput = useCallback(() => {
    setInputs((prev) => {
      const used = new Set(prev.map((i) => i.currency));
      const candidates = ["USDT", "USD", "EUR", "TRY", "RUB"];
      const next = candidates.find((c) => !used.has(c)) || "USD";
      return [...prev, emptyInput(next)];
    });
  }, []);
  const removeInput = useCallback((idx) => {
    setInputs((prev) => prev.filter((_, i) => i !== idx));
  }, []);
  const restoreFirstInput = useCallback(() => {
    setInputs((prev) =>
      prev.length === 0
        ? [emptyInput(readLast(LAST_IN_KEY, "USDT"))]
        : prev
    );
  }, []);

  // Computed aliases — большая часть существующей логики writted для
  // single-IN; вместо рефактора каждой строки делаем computed proxy
  // через primaryIn. Если inputs.length === 0 → withdrawal mode, эти
  // алиасы дают safe fallbacks.
  const curIn = primaryIn?.currency || "";
  const amtIn = primaryIn?.amount || "";
  const accountIdIn = primaryIn?.accountId || "";
  const setCurIn = useCallback((v) => {
    if (inputs.length === 0) {
      // create new primary on demand
      setInputs([{ id: newInputId(), currency: v, amount: "", accountId: "" }]);
    } else {
      patchInput(0, { currency: v });
    }
  }, [inputs.length, patchInput]);
  const setAmtIn = useCallback((v) => {
    if (inputs.length === 0) {
      setInputs([{ id: newInputId(), currency: "USDT", amount: v, accountId: "" }]);
    } else {
      patchInput(0, { amount: v });
    }
  }, [inputs.length, patchInput]);
  const setAccountIdIn = useCallback((v) => {
    if (inputs.length === 0) return;
    patchInput(0, { accountId: v });
  }, [inputs.length, patchInput]);

  // ── OUT state (multi-leg) ────────────────────────────────────────────
  const [outputs, setOutputs] = useState(() => {
    const fromSeed = outputsFromInitial(seed);
    // Если seed пустой (нет outputs / нет curOut) — берём last-out-ccy
    if (!seed?.outputs && !seed?.curOut) {
      const lastOut = readLast(LAST_OUT_KEY, "TRY");
      fromSeed[0].currency = lastOut;
    }
    return fromSeed;
  });
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
  // partialPayNow: { [outputId]: amountString } — заполняется только когда timing='partial'.
  // На submit передаём только когда timing='partial' (иначе бек ругается).
  const [partialPayNow, setPartialPayNow] = useState(() => {
    if (seed?.partialPayNow && typeof seed.partialPayNow === "object") {
      return { ...seed.partialPayNow };
    }
    return {};
  });
  // Если юзер ушёл с timing='partial' — затираем accumulated map, иначе на
  // следующем сабмите со старым timing случайно передадутся pay-now значения.
  useEffect(() => {
    if (timing !== "partial" && Object.keys(partialPayNow).length > 0) {
      setPartialPayNow({});
    }
  }, [timing, partialPayNow]);
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
        counterparty.trim() ||
        inputs.some((i) => i.amount) ||
        outputs.some((o) => o.amount || o.rate);
      if (!hasAny) {
        clearDraft();
        setDraftSavedAt(null);
        return;
      }
      saveDraft({
        inPayments: inputs.map((i) => ({
          currency: i.currency,
          amount: i.amount,
          accountId: i.accountId,
        })),
        outputs,
        counterparty,
        timing, referral, applyMinFee,
        comment, inTxHash,
        commissionUsd, customFeeUsd,
        plannedLocal, backdateAt,
        partialPayNow: timing === "partial" ? partialPayNow : {},
      });
      setDraftSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(handle);
  }, [
    inputs, outputs, counterparty,
    timing, referral, applyMinFee, comment, inTxHash,
    commissionUsd, customFeeUsd, plannedLocal, backdateAt,
    partialPayNow,
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

  // ── Reset accountId для каждой IN-ноги при смене её currency ──────────
  useEffect(() => {
    inputs.forEach((leg, idx) => {
      if (!leg.accountId) return;
      const acc = accounts.find((a) => a.id === leg.accountId);
      if (acc && acc.currency !== leg.currency) {
        patchInput(idx, { accountId: "" });
      }
    });
  }, [inputs, accounts, patchInput]);

  // ── Если IN-валюта совпала с primary OUT — авто-flip primary на
  //    первую отличающуюся валюту. Юзер не должен видеть TRY→TRY.
  useEffect(() => {
    if (!primary || curIn !== primary.currency) return;
    const candidates = ["TRY", "EUR", "USDT", "USD", "RUB"];
    const next = candidates.find((c) => c !== curIn) || "USDT";
    patchOutput(0, { currency: next, rate: "", manualRate: false, amountTouched: false });
  }, [curIn, primary, patchOutput]);

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
  // Считаем новый курс как `1/old` в полном JS-precision (без round-trip
  // через formatRate). Так пара последовательных reverse'ов возвращает
  // ровно исходное значение: 1/(1/32.5) === 32.5 в IEEE 754. Поле
  // manualRate=true, чтобы auto-fill не перетёр введённый юзером курс
  // рыночным после смены направления.
  const reverseRate = useCallback(() => {
    const newCurIn = primary.currency;
    const newCurOut = curIn;
    const newAmtIn = primary.amount;
    const oldRate = parseFloat(primary.rate);
    // Короткое представление 1/x с обрезкой trailing-нулей. Precision
    // двойного reverse'а 1/(1/x)≈x сохраняется в пределах ~6 знаков —
    // достаточно для практики (курсы валют редко требуют больше).
    const newRateStr = Number.isFinite(oldRate) && oldRate > 0
      ? formatRateCompact(1 / oldRate)
      : "";
    setCurIn(newCurIn);
    setAmtIn(newAmtIn);
    patchOutput(0, {
      currency: newCurOut,
      amount: amtIn,
      rate: newRateStr,
      manualRate: !!newRateStr,
      amountTouched: !!amtIn,
    });
  }, [primary, curIn, amtIn, patchOutput, setCurIn, setAmtIn]);

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
  // Если IN-валюта совпадает с primary OUT — это невалидная сделка
  // (нельзя обменять валюту саму на себя), margin не вычисляется.
  // То же — для невалидных или нулевых значений.
  const marginInfo = useMemo(() => {
    if (!primary) return { marginUsd: null, spreadPct: null };
    if (curIn === primary.currency) return { marginUsd: null, spreadPct: null };
    const amt = parseFloat(amtIn);
    const userRate = parseFloat(primary.rate);
    const market = getRate(curIn, primary.currency);
    if (![amt, userRate, market].every((v) => Number.isFinite(v) && v > 0)) {
      return { marginUsd: null, spreadPct: null };
    }
    const spreadPct = (userRate - market) / market;
    // Если spread абсурдно большой (>30% по модулю) — скорее всего юзер
    // ввёл курс не той пары / валюты совпадают. Скрываем margin вместо
    // дикого +$940 на TRY→TRY с rate 44.6.
    if (Math.abs(spreadPct) > 0.3) return { marginUsd: null, spreadPct: null };
    const marginInIn = amt * spreadPct;
    const toUsd = curIn === "USD" ? 1 : getRate(curIn, "USD");
    const marginUsd = Number.isFinite(toUsd) ? marginInIn * toUsd : marginInIn;
    return { marginUsd, spreadPct };
  }, [amtIn, primary, curIn, getRate]);

  // Warning когда IN и primary OUT — одна валюта. Подсвечивается в
  // rate-капсуле и блокирует submit (через canSubmit ниже).
  const sameCurrencyWarning = primary && curIn === primary.currency;

  // ── Submit validation ─────────────────────────────────────────────────
  // Сделка валидна если:
  //   • есть контрагент
  //   • хотя бы один OUT валидный
  //   • если есть IN-ноги — все валидные (amount > 0); если 0 IN-ног —
  //     это withdrawal (adapter роутит автоматически).
  const canSubmit = useMemo(() => {
    if (!counterparty.trim()) return false;
    if (inputs.length > 0) {
      const validIns = inputs.filter(
        (i) => Number.isFinite(parseFloat(i.amount)) && parseFloat(i.amount) > 0 && i.currency
      );
      if (validIns.length === 0) return false;
    }
    const inCcySet = new Set(inputs.map((i) => i.currency));
    const validOuts = outputs.filter(
      (o) => Number.isFinite(parseFloat(o.amount)) && parseFloat(o.amount) > 0 &&
             Number.isFinite(parseFloat(o.rate)) && parseFloat(o.rate) > 0 &&
             o.currency && !inCcySet.has(o.currency)
    );
    return validOuts.length > 0;
  }, [counterparty, inputs, outputs]);

  // ── Submit handler ────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const validOuts = outputs.filter(
      (o) => Number.isFinite(parseFloat(o.amount)) && parseFloat(o.amount) > 0 &&
             Number.isFinite(parseFloat(o.rate)) && parseFloat(o.rate) > 0
    );
    const validIns = inputs.filter(
      (i) => Number.isFinite(parseFloat(i.amount)) && parseFloat(i.amount) > 0 && i.currency
    );
    // legacy single-IN поля заполняем primary IN-ногой (для adapter
    // fallback). inPayments[] передаём всегда — adapter возьмёт массив
    // если len>0, иначе fallback. Если validIns пустой → inPayments не
    // передаём и amtIn=0/curIn="" → adapter роутит в withdrawal.
    const primaryInLeg = validIns[0];
    const payload = {
      amtIn: primaryInLeg ? parseFloat(primaryInLeg.amount) : 0,
      curIn: primaryInLeg?.currency || "",
      inPayments: validIns.length > 1 ? validIns.map((i) => ({
        currency: i.currency,
        amount: parseFloat(i.amount),
        accountId: i.accountId,
      })) : undefined,
      outputs: validOuts.map((o, i) => ({
        id: `out_${i}`,
        currency: o.currency,
        amount: parseFloat(o.amount),
        rate: parseFloat(o.rate),
        manualRate: o.manualRate,
        accountId: o.accountId || "",
        address: o.address || "",
        applyFee: false,
        outKind: "ours",
        partnerAccountId: null,
      })),
      counterparty: counterparty.trim(),
      accountId: primaryInLeg?.accountId || "",
      referral,
      comment,
      inTxHash,
      deferredIn: timing === "client_later",
      deferredOut: timing === "us_later",
      partialMode: timing === "partial",
      partialPayNow: timing === "partial" ? partialPayNow : {},
      plannedLocal,
      backdateAt,
      applyMinFee,
      commissionUsd: commissionUsd ? parseFloat(commissionUsd) : undefined,
      customFeeUsd: customFeeUsd ? parseFloat(customFeeUsd) : undefined,
    };
    onSubmit(payload);
    clearDraft();
    setDraftSavedAt(null);
    // Запоминаем валюты для следующей сделки
    writeLast(LAST_IN_KEY, curIn);
    if (validOuts[0]?.currency) writeLast(LAST_OUT_KEY, validOuts[0].currency);
  }, [
    canSubmit, amtIn, curIn, outputs, accountIdIn, counterparty, timing,
    referral, applyMinFee, comment, inTxHash,
    commissionUsd, customFeeUsd, plannedLocal, backdateAt,
    partialPayNow, onSubmit,
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
          // Auto-detect referral по tag ИЛИ по [referral]-метке в note
          // (DB-tag constraint не пускает 'referral', поэтому quick-create
          // сохраняет признак в note).
          const tagHit = c?.tag && /referral|реферал/i.test(c.tag);
          const noteHit = c?.note && /\[referral\]/i.test(c.note);
          if (tagHit || noteHit) {
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

      {/* IN — multi-leg. Если inputs[] пуст — placeholder для withdrawal. */}
      {inputs.length === 0 ? (
        <div className="px-6 py-5 border-b border-border-soft">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-sunk text-muted text-[10px] font-bold font-mono">
                1
              </span>
              <span className="text-micro text-muted uppercase">Без приёма (выдача)</span>
            </div>
            <button
              type="button"
              onClick={restoreFirstInput}
              className="text-caption text-accent hover:text-accent-hover font-semibold"
              title="Добавить ногу приёма"
            >
              + Добавить приём
            </button>
          </div>
          <div className="text-body-sm text-muted">
            Эта сделка отдаст клиенту средства без встречного приёма (withdrawal).
            Будет создана через withdrawal RPC.
          </div>
        </div>
      ) : (
        <DealLeg
          number="1"
          label="Клиент даёт"
          direction="in"
          amount={primaryIn.amount}
          onAmountChange={(v) => patchInput(0, { amount: v })}
          currency={primaryIn.currency}
          currencyOptions={CURRENCIES}
          onCurrencyChange={(v) => patchInput(0, { currency: v, accountId: "" })}
          accountId={primaryIn.accountId}
          accountOptions={accountOptions}
          onAccountChange={(v) => patchInput(0, { accountId: v })}
          onAddLeg={addInput}
          addLegLabel="Ещё внесение"
          onRemoveLeg={() => removeInput(0)}
        />
      )}

      {/* Nested IN (от 2-й и далее) */}
      {inputs.length > 1 && (
        <div className="px-6 pb-4 space-y-2">
          {inputs.slice(1).map((leg, idx) => (
            <DealLegNested
              key={leg.id}
              legNumber={`Внесение №${idx + 2}`}
              direction="in"
              showRate={false}
              amount={leg.amount}
              onAmountChange={(v) => patchInput(idx + 1, { amount: v })}
              currency={leg.currency}
              currencyOptions={CURRENCIES}
              onCurrencyChange={(v) => patchInput(idx + 1, { currency: v, accountId: "" })}
              accountId={leg.accountId}
              accountOptions={accountOptions}
              onAccountChange={(v) => patchInput(idx + 1, { accountId: v })}
              onRemove={() => removeInput(idx + 1)}
            />
          ))}
        </div>
      )}

      {/* Чёрная rate-капсула — управляет primary.rate */}
      <DealRateBlock
        rate={primary?.rate || ""}
        onRateChange={(v) => {
          patchOutput(0, { rate: v, manualRate: true });
          setRateSourceOffice(null); // ручной ввод сбрасывает source
        }}
        onSelectSuggestion={(s) => {
          setRateSourceOffice(s.key);
          patchOutput(0, { rate: formatRate(s.display.rate), manualRate: false });
        }}
        fromCcy={curIn}
        toCcy={primary?.currency || "TRY"}
        sourceLabel={sourceLabel}
        ageLabel={ageLabel}
        manualMode={primary?.manualRate && !rateSourceOffice}
        marginUsd={marginInfo.marginUsd}
        spreadPct={marginInfo.spreadPct}
        onReverse={reverseRate}
        warning={sameCurrencyWarning ? "Выбери разные валюты для IN и OUT" : null}
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
        <div className="px-6 pb-4 space-y-2">
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

      {/* Матрица курсов для multi-IN × multi-OUT — рядом-справочник.
          При 1×1 не показывается (rate-капсула выше уже всё держит). */}
      <DealRateMatrix
        inputs={inputs}
        outputs={outputs}
        getRate={getRate}
        onApplyRate={(outIdx, rateStr) => {
          patchOutput(outIdx, { rate: rateStr, manualRate: false });
        }}
      />

      <DealTimingSelector value={timing} onChange={setTiming} />

      {/* Partial-split UI — только при timing='partial' */}
      {timing === "partial" && outputs.length > 0 && (
        <div className="px-6 py-3 border-b border-border-soft bg-accent-bg/30">
          <div className="text-micro text-accent uppercase font-semibold mb-2">
            К получению сейчас
          </div>
          <div className="space-y-1.5">
            {outputs.map((o, idx) => {
              const planned = parseFloat(o.amount) || 0;
              const nowVal = parseFloat(partialPayNow[o.id] ?? "0") || 0;
              const remaining = Math.max(0, planned - nowVal);
              return (
                <div key={o.id} className="flex items-center gap-2 text-caption">
                  <span className="text-tiny font-bold text-muted-soft font-mono tabular w-6">
                    #{idx + 1}
                  </span>
                  <span className="text-ink-soft font-mono text-caption min-w-[48px]">
                    {o.currency}
                  </span>
                  <span className="text-muted text-tiny">сейчас</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={partialPayNow[o.id] ?? ""}
                    placeholder="0"
                    onChange={(e) => {
                      const clean = e.target.value.replace(/[^\d.,]/g, "").replace(",", ".");
                      setPartialPayNow((prev) => ({ ...prev, [o.id]: clean }));
                    }}
                    className="flex-1 h-7 px-2 rounded-input bg-surface text-ink text-caption font-mono tabular font-semibold border-0 ring-1 ring-inset ring-accent/30 focus:ring-accent focus:outline-none transition-all"
                  />
                  {planned > 0 && remaining > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPartialPayNow((prev) => ({ ...prev, [o.id]: String(planned) }))
                      }
                      className="h-6 px-1.5 rounded-badge text-tiny font-bold text-accent bg-surface hover:bg-accent-bg ring-1 ring-accent/20 transition-colors whitespace-nowrap"
                      title={`Платим всё: ${planned} ${o.currency}`}
                    >
                      Всё
                    </button>
                  )}
                  <span className="text-tiny text-muted-soft whitespace-nowrap font-mono tabular">
                    / {planned || 0}
                  </span>
                  {remaining > 0 && (
                    <span className="text-tiny font-bold text-accent whitespace-nowrap font-mono tabular">
                      должны {remaining}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        summary={sameCurrencyWarning ? null : summary}
        marginUsd={sameCurrencyWarning ? null : marginInfo.marginUsd}
        spreadPct={sameCurrencyWarning ? null : marginInfo.spreadPct}
        canSubmit={canSubmit}
        submitting={submitting}
        onCancel={onCancel}
        onSubmit={handleSubmit}
        draftAgeText={draftAgeText(draftSavedAt)}
      />
    </div>
  );
}
