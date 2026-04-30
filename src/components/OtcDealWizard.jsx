// src/components/OtcDealWizard.jsx
//
// 6-step wizard для OTC сделок (Phase B refactor).
//
// Двухуровневая модель:
//   ── ПЛАН (что обещаем клиенту) ──
//     1) Тип        — kind ∈ {otc, broker}
//     2) Контрагент — партнёр + опциональный клиент
//     3) Клиент отдаёт   — currency, amount, in_kind. БЕЗ счёта.
//     4) Клиент получает — currency, amount, rate с smart-sync. БЕЗ счёта.
//                         Sidebar: Available balance по нашим счетам.
//   ── ИСПОЛНЕНИЕ ──
//     5) Реализация — IN account (если *_now) + legs editor для OUT
//                     с sum-validation legs == OUT amount + coverage check
//     6) Подтверждение — commission, comment, planned_at, summary, submit
//
// Smart IN/OUT/Rate sync (шаг 4): out = in × rate. Меняешь любое из трёх —
// автоматически пересчитывается зависимое поле.

import React, { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, Check, X, Plus, Trash2, Wallet,
  Handshake, Coins, Calculator, Calendar, Banknote, AlertCircle, ArrowDown,
  TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, ArrowLeftRight,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import PartnerAccountSelect from "./PartnerAccountSelect.jsx";
import PartnerSelect from "./PartnerSelect.jsx";
import CounterpartySelect from "./CounterpartySelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { usePartners } from "../store/partners.jsx";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateDeal, withToast, ensureClient, uuidOrNull } from "../lib/supabaseWrite.js";
import { useTranslation } from "../i18n/translations.jsx";

// ─── Constants ─────────────────────────────────────────────────────────

// STEP_KEYS — i18n keys; labels берутся через t() в Stepper'е.
const STEP_KEYS = [
  { id: "type",      key: "otc_step_type" },
  { id: "party",     key: "otc_step_party" },
  { id: "in",        key: "otc_step_in" },
  { id: "out",       key: "otc_step_out" },
  { id: "execution", key: "otc_step_exec" },
  { id: "confirm",   key: "otc_step_confirm" },
];

const IN_KIND_OPTIONS = [
  { id: "ours_now",     title: "Принимаем сейчас",      hint: "Клиент платит на наш счёт прямо сейчас",       tone: "emerald" },
  { id: "partner_now",  title: "Принимает партнёр",     hint: "Клиент платит на счёт партнёра прямо сейчас",  tone: "indigo" },
  { id: "ours_later",   title: "Клиент должен нам",     hint: "Клиент заплатит позже — фиксируем долг",       tone: "amber" },
  { id: "partner_later",title: "Партнёр должен нам",    hint: "Партнёр обещал зачислить позже — фиксируем",   tone: "amber" },
];

const OUT_KIND_OPTIONS = [
  { id: "ours_now",     title: "Наш счёт",          hint: "Выдаём со своего счёта",       tone: "emerald" },
  { id: "partner_now",  title: "Счёт партнёра",     hint: "Выдаёт партнёр",               tone: "indigo" },
  { id: "ours_later",   title: "Мы должны клиенту", hint: "Выдадим позже — обязательство",tone: "amber" },
  { id: "partner_later",title: "Партнёр клиенту",   hint: "Партнёр обязался — внешний долг", tone: "amber" },
];

const TONE_CLS = {
  emerald: "border-emerald-300 bg-emerald-50/60 text-emerald-900",
  indigo:  "border-indigo-300 bg-indigo-50/60 text-indigo-900",
  amber:   "border-amber-300 bg-amber-50/60 text-amber-900",
};
const TONE_DOT = {
  emerald: "bg-emerald-500",
  indigo:  "bg-indigo-500",
  amber:   "bg-amber-500",
};

// ─── Helpers ───────────────────────────────────────────────────────────

const numberOrZero = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// Округление до n знаков, без trailing zeros.
const fmtNum = (n, digits = 2) => {
  if (!Number.isFinite(n)) return "";
  const r = Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits);
  return String(r);
};

const cleanInput = (s) =>
  String(s || "").replace(/[^\d.,]/g, "").replace(",", ".");

const emptyLeg = (currency = "TRY", amount = "") => ({
  id: `l_${Math.random().toString(36).slice(2, 8)}`,
  amount,
  outKind: "ours_now",
  accountId: "",
  partnerAccountId: "",
  currency,  // duplicated с leg.currency для удобства
});

// ─── Main wizard ────────────────────────────────────────────────────────

export default function OtcDealWizard({ open, currentOffice, onClose, onCreated }) {
  const { t } = useTranslation();
  const STEPS = useMemo(() => STEP_KEYS.map((s) => ({ id: s.id, label: t(s.key) })), [t]);
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { accounts, balanceOf } = useAccounts();
  const { activePartners } = usePartners();
  const { getRate } = useRates();
  const { codes: currencyCodes } = useCurrencies();

  // currentOffice — string-id (см. App.jsx). Не объект.
  const officeId = typeof currentOffice === "string" ? currentOffice : currentOffice?.id;

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active && a.officeId === officeId),
    [accounts, officeId]
  );

  // ─── Step / busy ─────────────────────────────────────────────────
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  // ─── Plan-level state ────────────────────────────────────────────
  const [kind, setKind] = useState("otc");
  const [partnerName, setPartnerName] = useState("");
  const [clientNickname, setClientNickname] = useState("");

  // IN side (план)
  const [currencyIn, setCurrencyIn] = useState("USDT");
  const [amountIn, setAmountIn] = useState("");
  const [inKind, setInKind] = useState("ours_now");

  // OUT side (план) — single output, currency + amount + rate с smart sync
  const [currencyOut, setCurrencyOut] = useState("TRY");
  const [amountOut, setAmountOut] = useState("");
  const [rate, setRate] = useState("");
  // Кто выдаёт OUT (primary intent). Влияет на отображение баланса в Step 4
  // и default outKind для legs в Step 5. Per-leg можно переопределить.
  const [outKind, setOutKind] = useState("ours_now");

  // ─── Execution-level state ───────────────────────────────────────
  // IN account (только если in_kind ∈ {ours_now, partner_now})
  const [inAccountId, setInAccountId] = useState("");
  const [inPartnerAccountId, setInPartnerAccountId] = useState("");

  // OUT legs — массив [{id, amount, outKind, accountId, partnerAccountId}]
  const [legs, setLegs] = useState([]);

  // ─── Conditions / final ──────────────────────────────────────────
  const [commissionUsd, setCommissionUsd] = useState("");
  const [comment, setComment] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [referral, setReferral] = useState(false);

  // ─── Reset on open ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setKind("otc");
      setPartnerName("");
      setClientNickname("");
      setCurrencyIn("USDT");
      setAmountIn("");
      setInKind("ours_now");
      setCurrencyOut("TRY");
      setAmountOut("");
      setRate("");
      setOutKind("ours_now");
      setInAccountId("");
      setInPartnerAccountId("");
      setLegs([]);
      setCommissionUsd("");
      setComment("");
      setPlannedAt("");
      setReferral(false);
      setBusy(false);
    }
  }, [open]);

  // ─── Auto-fill rate from market on currency change ───────────────
  // ВСЕГДА перезаписываем market rate при смене валют — иначе старый rate
  // остаётся когда юзер меняет пару (Bug #4).
  useEffect(() => {
    if (!currencyIn || !currencyOut) return;
    if (currencyIn === currencyOut) {
      setRate("1");
      return;
    }
    const r = getRate(currencyIn, currencyOut);
    if (r > 0) {
      setRate(fmtNum(r, 6));
      // Если amountIn задан — пересчитываем amountOut через новый rate
      const inN = numberOrZero(amountIn);
      if (inN > 0) setAmountOut(fmtNum(inN * r, 4));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyIn, currencyOut]);

  // ─── Auto-init legs when entering Step 5 (Execution) ─────────────
  useEffect(() => {
    if (stepIdx === 4 && legs.length === 0 && amountOut) {
      setLegs([{ ...emptyLeg(currencyOut, amountOut), outKind }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, currencyOut, amountOut, outKind]);

  // Sync legs[].currency when currencyOut changes
  useEffect(() => {
    setLegs((arr) => arr.map((l) => ({ ...l, currency: currencyOut, accountId: "", partnerAccountId: "" })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyOut]);

  // При смене top-level outKind — сбрасываем legs к одному с новым default kind.
  // Так пользователь не путается со старыми account_id из прошлого режима.
  useEffect(() => {
    setLegs((arr) => {
      if (arr.length === 0) return arr;
      // Берём текущую сумму legs[0] чтобы не потерять введённое;
      // если ещё пусто — будет amountOut.
      const currAmount = arr[0].amount || amountOut;
      return [{
        ...emptyLeg(currencyOut, currAmount),
        outKind,
      }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outKind]);

  // ─── Smart IN/OUT/Rate sync ──────────────────────────────────────
  // out = in × rate.  Меняешь IN — если rate задан, пересчитываем OUT.
  // Меняешь rate — если IN задан, пересчитываем OUT.
  // Меняешь OUT — если IN задан, пересчитываем rate.
  const onChangeAmountIn = (val) => {
    const v = cleanInput(val);
    setAmountIn(v);
    const inN = numberOrZero(v);
    const rN = numberOrZero(rate);
    if (inN > 0 && rN > 0) {
      setAmountOut(fmtNum(inN * rN, 4));
    }
  };
  const onChangeRate = (val) => {
    const v = cleanInput(val);
    setRate(v);
    const inN = numberOrZero(amountIn);
    const rN = numberOrZero(v);
    if (inN > 0 && rN > 0) {
      setAmountOut(fmtNum(inN * rN, 4));
    }
  };
  const onChangeAmountOut = (val) => {
    const v = cleanInput(val);
    setAmountOut(v);
    const inN = numberOrZero(amountIn);
    const outN = numberOrZero(v);
    if (inN > 0 && outN > 0) {
      setRate(fmtNum(outN / inN, 6));
    }
  };

  // ─── Available balance display ───────────────────────────────────
  // Имеет смысл показывать только если хотя бы часть OUT уйдёт с НАШИХ
  // счетов. Если IN принимает партнёр И в OUT нет ours_* — наш баланс
  // нерелевантен.
  const availableOurOut = useMemo(() => {
    const matched = accounts.filter((a) => a.active && a.currency === currencyOut);
    const total = matched.reduce((s, a) => s + (balanceOf(a.id) || 0), 0);
    return { total, accounts: matched };
  }, [accounts, currencyOut, balanceOf]);

  // ─── Coverage check (split: наши vs партнёр) ─────────────────────
  // Considers где деньги ДОЛЖНЫ быть для каждого типа leg:
  //   ours_now    → наш счёт нужен. Available = sum(our accounts in currencyOut).
  //   partner_now → партнёрский счёт нужен. Available показываем отдельно.
  //   *_later     → не требует ликвидности здесь и сейчас.
  const coverage = useMemo(() => {
    const requiredOurs = legs
      .filter((l) => l.outKind === "ours_now")
      .reduce((s, l) => s + numberOrZero(l.amount), 0);
    const requiredPartner = legs
      .filter((l) => l.outKind === "partner_now")
      .reduce((s, l) => s + numberOrZero(l.amount), 0);

    const availableOurs = activeAccounts
      .filter((a) => a.currency === currencyOut)
      .reduce((s, a) => s + (balanceOf(a.id) || 0), 0);

    return {
      requiredOurs,
      requiredPartner,
      availableOurs,
      shortfallOurs: Math.max(0, requiredOurs - availableOurs),
      surplusOurs: Math.max(0, availableOurs - requiredOurs),
      okOurs: availableOurs + 0.00000001 >= requiredOurs,
      hasAnyRequirement: requiredOurs > 0 || requiredPartner > 0,
    };
  }, [legs, activeAccounts, currencyOut, balanceOf]);

  // ─── Legs sum validation ─────────────────────────────────────────
  const legsSum = useMemo(
    () => legs.reduce((s, l) => s + numberOrZero(l.amount), 0),
    [legs]
  );
  const legsValid = useMemo(
    () =>
      legs.length > 0 &&
      Math.abs(legsSum - numberOrZero(amountOut)) < 0.00000001 &&
      legs.every(
        (l) =>
          numberOrZero(l.amount) > 0 &&
          (l.outKind === "ours_now" ? !!l.accountId : true) &&
          (l.outKind === "partner_now" ? !!l.partnerAccountId : true)
      ),
    [legs, legsSum, amountOut]
  );

  // ─── Per-step validation ─────────────────────────────────────────
  const stepValid = useMemo(() => {
    const v = [false, false, false, false, false, false];
    v[0] = !!kind;
    v[1] = !!partnerName.trim();
    v[2] = !!currencyIn && numberOrZero(amountIn) > 0 && !!inKind;
    v[3] =
      !!currencyOut &&
      currencyIn !== currencyOut &&
      numberOrZero(amountOut) > 0 &&
      numberOrZero(rate) > 0;
    // Step 5: IN account if needed + legs valid
    const inAccValid =
      inKind === "ours_now"     ? !!inAccountId :
      inKind === "partner_now"  ? !!inPartnerAccountId :
      true;
    v[4] = inAccValid && legsValid;
    v[5] = v[0] && v[1] && v[2] && v[3] && v[4];
    return v;
  }, [
    kind, partnerName, currencyIn, amountIn, inKind, currencyOut, amountOut,
    rate, inAccountId, inPartnerAccountId, legsValid,
  ]);

  const canNext = stepValid[stepIdx];
  const canSubmit = stepValid[5];

  // ─── Profit preview ──────────────────────────────────────────────
  const profitPreview = useMemo(() => {
    if (kind === "broker") {
      return { margin: 0, commission: numberOrZero(commissionUsd), total: numberOrZero(commissionUsd) };
    }
    let margin = 0;
    const amt = numberOrZero(amountOut);
    const r = numberOrZero(rate);
    if (r > 0 && amt > 0) {
      const market = getRate(currencyIn, currencyOut);
      if (market > 0) {
        const marginInCurIn = amt / r - amt / market;
        if (currencyIn === "USD") margin = marginInCurIn;
        else {
          const toUsd = getRate(currencyIn, "USD");
          if (toUsd > 0) margin = marginInCurIn * toUsd;
        }
      }
    }
    margin = Math.round(margin * 100) / 100;
    const commission = numberOrZero(commissionUsd);
    return { margin, commission, total: margin + commission };
  }, [kind, currencyIn, currencyOut, amountOut, rate, commissionUsd, getRate]);

  // ─── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit || busy || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      let clientId = null;
      if (clientNickname.trim()) {
        try {
          clientId = await ensureClient(clientNickname.trim());
        } catch (e) {
          console.warn("[OtcWizard] ensureClient failed", e);
        }
      }

      // officeId: derive from selected accounts если есть, иначе currentOffice
      const inAcc = inKind === "ours_now" ? activeAccounts.find((a) => a.id === inAccountId) : null;
      const firstLegAcc = legs.find((l) => l.outKind === "ours_now" && l.accountId);
      const firstAcc = firstLegAcc ? activeAccounts.find((a) => a.id === firstLegAcc.accountId) : null;
      const resolvedOfficeId = inAcc?.officeId || firstAcc?.officeId || officeId;
      if (!resolvedOfficeId) {
        alert("Не выбран ни один наш счёт и текущий офис не задан.");
        setBusy(false);
        return;
      }

      const inPayments =
        (inKind === "ours_now" || inKind === "partner_now")
          ? [{
              amount: numberOrZero(amountIn),
              kind: inKind,
              accountId: inKind === "ours_now" ? inAccountId : null,
              partnerAccountId: inKind === "partner_now" ? inPartnerAccountId : null,
            }]
          : [];

      const outputs = legs.map((l) => {
        const isLater = l.outKind === "ours_later" || l.outKind === "partner_later";
        return {
          currency: currencyOut,
          amount: numberOrZero(l.amount),
          rate: numberOrZero(rate),
          outKind: l.outKind,
          accountId: l.outKind === "ours_now" ? l.accountId : null,
          partnerAccountId: l.outKind === "partner_now" ? l.partnerAccountId : null,
          payments: !isLater ? [{
            amount: numberOrZero(l.amount),
            kind: l.outKind,
            accountId: l.outKind === "ours_now" ? l.accountId : null,
            partnerAccountId: l.outKind === "partner_now" ? l.partnerAccountId : null,
          }] : [],
        };
      });

      const res = await withToast(
        () => rpcCreateDeal({
          officeId: resolvedOfficeId,
          managerId: currentUser.id,
          clientId,
          clientNickname: clientNickname.trim() || partnerName,
          currencyIn,
          amountIn: numberOrZero(amountIn),
          inAccountId: inKind === "ours_now" ? uuidOrNull(inAccountId) : null,
          inPartnerAccountId: inKind === "partner_now" ? uuidOrNull(inPartnerAccountId) : null,
          inKind,
          inPayments,
          kind,
          referral,
          comment: comment.trim() || `OTC · ${partnerName}`,
          status: "completed",
          outputs,
          plannedAt: plannedAt ? new Date(plannedAt).toISOString() : null,
          deferredIn: inKind === "ours_later" || inKind === "partner_later",
          commissionUsd: numberOrZero(commissionUsd),
          applyMinFee: kind !== "broker",
        }),
        { success: "OTC сделка создана", errorPrefix: "OTC failed" }
      );

      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${kind} · ${partnerName} · ${fmt(numberOrZero(amountIn), currencyIn)} ${currencyIn} → ${fmt(numberOrZero(amountOut), currencyOut)} ${currencyOut}`,
        });
        onCreated?.(res.result);
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const next = () => stepIdx < STEPS.length - 1 && canNext && setStepIdx((i) => i + 1);
  const back = () => stepIdx > 0 && setStepIdx((i) => i - 1);

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("otc_modal_title")}
      subtitle={t("otc_modal_subtitle")}
      width="3xl"
    >
      <Stepper currentIdx={stepIdx} steps={STEPS} stepValid={stepValid} onStepClick={setStepIdx} />

      <div className="px-5 py-4 min-h-[420px]">
        {stepIdx === 0 && <StepType kind={kind} setKind={setKind} />}
        {stepIdx === 1 && (
          <StepParty
            partnerName={partnerName} setPartnerName={setPartnerName}
            clientNickname={clientNickname} setClientNickname={setClientNickname}
            kind={kind}
          />
        )}
        {stepIdx === 2 && (
          <StepIn
            currencyIn={currencyIn} setCurrencyIn={setCurrencyIn}
            amountIn={amountIn} onChangeAmountIn={onChangeAmountIn}
            inKind={inKind} setInKind={setInKind}
            currencyCodes={currencyCodes}
          />
        )}
        {stepIdx === 3 && (
          <StepOut
            currencyIn={currencyIn} amountIn={amountIn}
            currencyOut={currencyOut} setCurrencyOut={setCurrencyOut}
            amountOut={amountOut} onChangeAmountOut={onChangeAmountOut}
            rate={rate} onChangeRate={onChangeRate}
            outKind={outKind} setOutKind={setOutKind}
            currencyCodes={currencyCodes}
            availableOurOut={availableOurOut}
            getRate={getRate}
          />
        )}
        {stepIdx === 4 && (
          <StepExecution
            inKind={inKind} currencyIn={currencyIn} amountIn={amountIn}
            inAccountId={inAccountId} setInAccountId={setInAccountId}
            inPartnerAccountId={inPartnerAccountId} setInPartnerAccountId={setInPartnerAccountId}
            outKind={outKind}
            currencyOut={currencyOut} amountOut={amountOut}
            legs={legs} setLegs={setLegs}
            legsSum={legsSum} legsValid={legsValid}
            activeAccounts={activeAccounts}
            balanceOf={balanceOf}
          />
        )}
        {stepIdx === 5 && (
          <StepConfirm
            kind={kind} partnerName={partnerName} clientNickname={clientNickname}
            currencyIn={currencyIn} amountIn={amountIn} inKind={inKind}
            currencyOut={currencyOut} amountOut={amountOut} rate={rate}
            legs={legs}
            commissionUsd={commissionUsd} setCommissionUsd={setCommissionUsd}
            comment={comment} setComment={setComment}
            plannedAt={plannedAt} setPlannedAt={setPlannedAt}
            referral={referral} setReferral={setReferral}
            profitPreview={profitPreview}
          />
        )}
      </div>

      <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-2">
        <button
          onClick={stepIdx === 0 ? onClose : back}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors disabled:opacity-60"
        >
          {stepIdx === 0 ? <X className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          {stepIdx === 0 ? "Отмена" : "Назад"}
        </button>

        <div className="text-[11px] font-bold text-slate-400 tabular-nums">
          Шаг {stepIdx + 1} / {STEPS.length}
        </div>

        {stepIdx < STEPS.length - 1 ? (
          <button
            onClick={next}
            disabled={!canNext}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canNext ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            Далее
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canSubmit && !busy ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            {busy ? t("otc_creating") : t("otc_create")}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ─── Stepper ───────────────────────────────────────────────────────────

function Stepper({ currentIdx, steps, stepValid, onStepClick }) {
  return (
    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60">
      <div className="flex items-center gap-1">
        {steps.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isPast = i < currentIdx;
          const isAccessible = i <= currentIdx || stepValid?.slice(0, i).every(Boolean);
          return (
            <React.Fragment key={s.id}>
              <button
                type="button"
                onClick={() => isAccessible && onStepClick(i)}
                disabled={!isAccessible}
                className={`flex items-center gap-1 px-1.5 py-1 rounded-[8px] text-[10.5px] font-bold transition-colors ${
                  isCurrent
                    ? "bg-slate-900 text-white"
                    : isPast
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      : "bg-white text-slate-400 border border-slate-200"
                } ${!isAccessible ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              >
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8.5px] font-bold ${
                  isCurrent ? "bg-white text-slate-900" : isPast ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  {isPast ? <Check className="w-2 h-2" strokeWidth={3} /> : i + 1}
                </div>
                <span className="hidden md:inline">{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px ${isPast ? "bg-emerald-300" : "bg-slate-200"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 1: Type ───────────────────────────────────────────────────────

function StepType({ kind, setKind }) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Coins} text="Тип сделки" hint="Прибыль = маржа курса (для OTC) или только комиссия (для брокериджа)." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KindCard
          selected={kind === "otc"}
          onClick={() => setKind("otc")}
          tone="indigo"
          title="OTC обмен"
          hint="Обмен валют с участием партнёра. Прибыль = маржа курса + комиссия."
          example="Клиент → партнёр USDT, партнёр → клиент TRY, мы свели."
        />
        <KindCard
          selected={kind === "broker"}
          onClick={() => setKind("broker")}
          tone="amber"
          title="Брокеридж"
          hint="Чистое сведение без маржи. Прибыль = только комиссия. Min-fee не применяется."
          example="Партнёр A → партнёр B, мы получаем фиксированную комиссию."
        />
      </div>
    </div>
  );
}

function KindCard({ selected, onClick, tone, title, hint, example }) {
  // Apple-style: soft surface на hover, без harsh ring. Selected состояние —
  // мягкий tint + аккуратный shadow.
  const selectedCls = {
    indigo: "bg-indigo-50/70 border-indigo-200 shadow-[0_2px_8px_rgba(99,102,241,0.08)]",
    amber: "bg-amber-50/70 border-amber-200 shadow-[0_2px_8px_rgba(245,158,11,0.08)]",
    emerald: "bg-emerald-50/70 border-emerald-200 shadow-[0_2px_8px_rgba(16,185,129,0.08)]",
  }[tone] || "bg-slate-50 border-slate-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 rounded-[14px] border transition-all duration-150 ${
        selected
          ? selectedCls
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-2 h-2 rounded-full ${TONE_DOT[tone]}`} />
        <div className="text-[13px] font-semibold text-slate-900 tracking-tight">{title}</div>
        {selected && <Check className="w-3.5 h-3.5 text-emerald-600 ml-auto" strokeWidth={2.5} />}
      </div>
      <div className="text-[11.5px] text-slate-600 leading-relaxed mb-1.5">{hint}</div>
      <div className="text-[10.5px] text-slate-500 italic">{example}</div>
    </button>
  );
}

// ─── Step 2: Counterparty ───────────────────────────────────────────────

function StepParty({ partnerName, setPartnerName, clientNickname, setClientNickname, kind }) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Handshake} text="Контрагент (партнёр)" hint="Кто на другой стороне сделки." />
      <PartnerSelect value={partnerName} onChange={setPartnerName} placeholder="Имя партнёра / @telegram" />
      {!partnerName.trim() && (
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          Без партнёра нельзя создать OTC сделку.
        </div>
      )}

      <SectionTitle icon={Banknote} text={kind === "broker" ? "Клиент (опционально)" : "Клиент"} hint={kind === "broker" ? "Для брокериджа клиент часто не нужен." : "Конечный получатель сделки. Можно выбрать существующего или создать."} />
      <CounterpartySelect value={clientNickname} onChange={setClientNickname} />
    </div>
  );
}

// ─── Step 3: Client pays (IN) — БЕЗ счёта ───────────────────────────────

function StepIn({ currencyIn, setCurrencyIn, amountIn, onChangeAmountIn, inKind, setInKind, currencyCodes }) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={ArrowDown} text="Что отдаёт клиент" hint="Только валюта и сумма. Счёт выберем на шаге Реализация." />

      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
        <CurrencyPicker value={currencyIn} onChange={setCurrencyIn} codes={currencyCodes} />
        <div className="relative flex items-baseline gap-2 bg-white rounded-[12px] border-2 border-slate-200 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-900/10 px-4 py-3 transition-colors">
          <span className="text-slate-400 text-[18px] font-semibold">{curSymbol(currencyIn)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountIn}
            onChange={(e) => onChangeAmountIn(e.target.value)}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[20px] font-bold tracking-tight min-w-0"
          />
          <span className="text-slate-400 text-[12px] font-bold tracking-wider">{currencyIn}</span>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-2">Способ получения (план)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {IN_KIND_OPTIONS.map((opt) => (
            <KindOption
              key={opt.id}
              selected={inKind === opt.id}
              onClick={() => setInKind(opt.id)}
              {...opt}
            />
          ))}
        </div>
      </div>

      {(inKind === "ours_later" || inKind === "partner_later") && (
        <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Денег пока нет — фиксируем как обязательство. Movement не будет создан.
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Client receives (OUT) — currency, amount, rate с smart sync ──

function StepOut({
  currencyIn, amountIn,
  currencyOut, setCurrencyOut,
  amountOut, onChangeAmountOut,
  rate, onChangeRate,
  outKind, setOutKind,
  currencyCodes,
  availableOurOut,
  getRate,
}) {
  const market = currencyIn !== currencyOut ? getRate(currencyIn, currencyOut) : 1;
  const userRate = numberOrZero(rate);
  const spread = userRate > 0 && market > 0 ? ((userRate - market) / market) * 100 : null;
  const isOurNow = outKind === "ours_now";
  const isPartnerNow = outKind === "partner_now";

  // Flip rate display — каноническое хранение остаётся out_per_in, меняется
  // только direction отображения. При вводе во flipped режиме конвертим обратно.
  const [rateFlipped, setRateFlipped] = React.useState(false);
  const displayedRate = useMemo(() => {
    if (!rateFlipped) return rate;
    if (!userRate || userRate <= 0) return "";
    return fmtNum(1 / userRate, 6);
  }, [rate, rateFlipped, userRate]);
  const handleRateChange = (val) => {
    if (!rateFlipped) {
      onChangeRate(val);
      return;
    }
    const v = numberOrZero(cleanInput(val));
    if (v <= 0) {
      onChangeRate(val);
      return;
    }
    onChangeRate(fmtNum(1 / v, 6));
  };
  const fromLabel = rateFlipped ? currencyOut : currencyIn;
  const toLabel = rateFlipped ? currencyIn : currencyOut;

  return (
    <div className="space-y-4">
      <SectionTitle icon={ArrowDown} text="Что получает клиент" hint="Валюта + сумма + курс. Любое поле меняешь — остальные пересчитаются." />

      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
        <CurrencyPicker value={currencyOut} onChange={setCurrencyOut} codes={currencyCodes} />
        <div className="relative flex items-baseline gap-2 bg-white rounded-[12px] border-2 border-slate-200 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-900/10 px-4 py-3 transition-colors">
          <span className="text-slate-400 text-[18px] font-semibold">{curSymbol(currencyOut)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountOut}
            onChange={(e) => onChangeAmountOut(e.target.value)}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[20px] font-bold tracking-tight min-w-0"
          />
          <span className="text-slate-400 text-[12px] font-bold tracking-wider">{currencyOut}</span>
        </div>
      </div>

      {/* Rate с flip-кнопкой (P2P-style direction toggle) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-bold text-slate-500 tracking-wide uppercase">
            Курс OTC ({fromLabel} → {toLabel})
          </label>
          <button
            type="button"
            onClick={() => setRateFlipped((f) => !f)}
            disabled={!userRate || userRate <= 0}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold transition-colors ${
              userRate > 0
                ? "text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 cursor-pointer"
                : "text-slate-300 cursor-not-allowed"
            }`}
            title="Перевернуть направление курса"
          >
            <ArrowLeftRight className="w-3 h-3" />
            Flip
          </button>
        </div>
        <div className="flex items-baseline gap-2 bg-slate-50 rounded-[12px] border-2 border-slate-200 px-4 py-3">
          <span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">1 {fromLabel} =</span>
          <input
            type="text"
            inputMode="decimal"
            value={displayedRate}
            onChange={(e) => handleRateChange(e.target.value)}
            placeholder="0.0000"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[16px] font-bold tracking-tight min-w-0"
          />
          <span className="text-slate-400 text-[10px] font-bold tracking-wider">{toLabel}</span>
        </div>
        {rateFlipped && userRate > 0 && (
          <div className="text-[10px] text-slate-400 mt-1 tabular-nums">
            каноническое: 1 {currencyIn} = {fmtNum(userRate, 6)} {currencyOut}
          </div>
        )}
      </div>

      {/* Market vs OTC rate comparison */}
      {currencyIn !== currencyOut && market > 0 && userRate > 0 && (
        <div className={`rounded-[10px] border p-3 grid grid-cols-3 gap-2 text-center ${
          spread === null
            ? "border-slate-200 bg-slate-50"
            : Math.abs(spread) < 0.01
              ? "border-slate-200 bg-slate-50"
              : spread > 0
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-200 bg-amber-50"
        }`}>
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">Рынок</div>
            <div className="text-[13px] font-bold text-slate-700 tabular-nums">{market.toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">OTC</div>
            <div className="text-[13px] font-bold text-slate-900 tabular-nums">{userRate.toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">Spread</div>
            <div className={`text-[13px] font-bold tabular-nums ${spread === null || Math.abs(spread) < 0.01 ? "text-slate-700" : spread > 0 ? "text-emerald-700" : "text-amber-700"}`}>
              {spread !== null ? `${spread > 0 ? "+" : ""}${spread.toFixed(2)}%` : "—"}
            </div>
          </div>
        </div>
      )}

      {currencyIn === currencyOut && currencyOut && (
        <div className="text-[11.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-[8px] px-3 py-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          Same-currency обмен: курс = 1.0
        </div>
      )}

      {/* Sent by selector — primary OUT execution intent */}
      <div>
        <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-2">
          Кто выдаёт клиенту
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {OUT_KIND_OPTIONS.map((opt) => (
            <KindOption
              key={opt.id}
              selected={outKind === opt.id}
              onClick={() => setOutKind(opt.id)}
              {...opt}
            />
          ))}
        </div>
      </div>

      {/* Условный баланс — только если выдаём со СВОЕГО счёта */}
      {currencyOut && isOurNow && (
        <div className="rounded-[12px] border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            <Wallet className="w-3 h-3" />
            Доступно на наших счетах в {currencyOut}
          </div>
          <div className="text-[18px] font-bold text-slate-900 tabular-nums">
            {curSymbol(currencyOut)}{fmt(availableOurOut.total, currencyOut)}
            <span className="ml-2 text-[12px] text-slate-400 font-semibold">{currencyOut}</span>
          </div>
          {numberOrZero(amountOut) > availableOurOut.total && (
            <div className="text-[10.5px] text-rose-700 font-bold mt-1">
              ⚠ Не хватает {fmt(numberOrZero(amountOut) - availableOurOut.total, currencyOut)} {currencyOut}
              — на шаге Реализация можно разбить на legs (часть нашими, часть через партнёра).
            </div>
          )}
        </div>
      )}
      {currencyOut && isPartnerNow && (
        <div className="rounded-[12px] border border-indigo-200 bg-indigo-50/40 p-3 text-[11.5px] text-indigo-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            Выдаёт партнёр со своего счёта.
            <span className="block opacity-80 mt-0.5">Конкретный счёт выберешь на шаге Реализация. Наш баланс к этой сделке не относится.</span>
          </div>
        </div>
      )}
      {currencyOut && (outKind === "ours_later" || outKind === "partner_later") && (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50/50 p-3 text-[11.5px] text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            {outKind === "ours_later"
              ? "Выдадим клиенту позже — будет создано обязательство «мы должны клиенту»."
              : "Партнёр обязался выдать клиенту позже — будет создано внешнее обязательство «партнёр → клиент»."}
            <span className="block opacity-70 mt-0.5">Деньги сейчас не двигаются. Никакой баланс не нужен.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Execution — IN account + legs editor + coverage ────────────

function StepExecution({
  inKind, currencyIn, amountIn,
  inAccountId, setInAccountId,
  inPartnerAccountId, setInPartnerAccountId,
  outKind,
  currencyOut, amountOut,
  legs, setLegs,
  legsSum, legsValid,
  activeAccounts,
  balanceOf,
}) {
  const filteredOurAccs = useMemo(
    () => activeAccounts.filter((a) => a.currency === currencyIn),
    [activeAccounts, currencyIn]
  );

  const updateLeg = (id, patch) => setLegs((arr) => arr.map((l) => l.id === id ? { ...l, ...patch } : l));
  const removeLeg = (id) => setLegs((arr) => arr.length > 1 ? arr.filter((l) => l.id !== id) : arr);

  // Total / Allocated / Remaining
  const total = numberOrZero(amountOut);
  const allocated = legsSum;
  const remaining = total - allocated;
  const overflow = remaining < -0.00000001;
  const ok = Math.abs(remaining) < 0.00000001 && allocated > 0;

  // Новый leg → default amount = remaining (положительный остаток),
  // outKind по умолчанию = top-level outKind (или последний leg.outKind).
  const addLeg = () => {
    const lastKind = legs.length > 0 ? legs[legs.length - 1].outKind : outKind;
    const defaultAmount = remaining > 0 ? fmtNum(remaining, 4) : "";
    setLegs((arr) => [...arr, {
      ...emptyLeg(currencyOut, defaultAmount),
      outKind: lastKind,
    }]);
  };

  return (
    <div className="space-y-4">
      <SectionTitle icon={Calculator} text="Реализация" hint="Откуда берём деньги для IN и как распределяем OUT." />

      {/* IN execution */}
      {(inKind === "ours_now" || inKind === "partner_now") && (
        <div className="rounded-[12px] border border-slate-200 bg-slate-50/50 p-3.5 space-y-2">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
            IN — куда поступает {fmt(numberOrZero(amountIn), currencyIn)} {currencyIn}
          </div>
          {inKind === "ours_now" ? (
            <GroupedAccountSelect
              accounts={filteredOurAccs}
              value={inAccountId}
              onChange={setInAccountId}
              placeholder={`Выбрать наш счёт в ${currencyIn}`}
            />
          ) : (
            <PartnerAccountSelect
              currency={currencyIn}
              value={inPartnerAccountId}
              onChange={setInPartnerAccountId}
              placeholder={`Счёт партнёра в ${currencyIn}`}
            />
          )}
        </div>
      )}
      {(inKind === "ours_later" || inKind === "partner_later") && (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50/40 p-3 text-[11.5px] text-amber-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          IN отложен — счёт не нужен. Будет создано обязательство на {fmt(numberOrZero(amountIn), currencyIn)} {currencyIn}.
        </div>
      )}

      {/* OUT legs — manual allocation */}
      <div className="rounded-[12px] border border-slate-200 bg-white p-3.5 space-y-2">
        <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
          OUT — распределение исполнения
        </div>

        {legs.map((leg, idx) => (
          <LegCard
            key={leg.id}
            leg={leg}
            idx={idx}
            canRemove={legs.length > 1}
            onRemove={() => removeLeg(leg.id)}
            onChange={(patch) => updateLeg(leg.id, patch)}
            currencyOut={currencyOut}
            activeAccounts={activeAccounts}
            balanceOf={balanceOf}
          />
        ))}

        <button
          type="button"
          onClick={addLeg}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[10px] border-2 border-dashed border-slate-300 text-slate-600 text-[12px] font-semibold hover:border-slate-400 hover:bg-slate-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Добавить leg
        </button>
      </div>

      {/* Allocation tile — Total / Allocated / Remaining */}
      <div className={`rounded-[12px] border-2 p-3 ${
        overflow
          ? "border-rose-300 bg-rose-50"
          : ok
            ? "border-emerald-300 bg-emerald-50"
            : "border-amber-300 bg-amber-50"
      }`}>
        <div className="flex items-center gap-2 mb-2">
          {overflow ? (
            <AlertTriangle className="w-4 h-4 text-rose-600" />
          ) : ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-600" />
          )}
          <span className="text-[12px] font-bold">
            {overflow
              ? "Превышение — сумма legs больше total"
              : ok
                ? "Распределение завершено"
                : "Нужно распределить остаток"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">Total required</div>
            <div className="text-[14px] font-bold text-slate-900 tabular-nums">
              {curSymbol(currencyOut)}{fmt(total, currencyOut)}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">Allocated</div>
            <div className="text-[14px] font-bold text-slate-900 tabular-nums">
              {curSymbol(currencyOut)}{fmt(allocated, currencyOut)}
            </div>
          </div>
          <div>
            <div className="text-[9.5px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">
              {overflow ? "Overflow" : "Remaining"}
            </div>
            <div className={`text-[14px] font-bold tabular-nums ${
              overflow ? "text-rose-700" : ok ? "text-emerald-700" : "text-amber-700"
            }`}>
              {overflow ? "+" : ""}{curSymbol(currencyOut)}{fmt(Math.abs(remaining), currencyOut)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegCard({ leg, idx, canRemove, onRemove, onChange, currencyOut, activeAccounts, balanceOf }) {
  const filteredOurAccs = useMemo(
    () => activeAccounts.filter((a) => a.currency === currencyOut),
    [activeAccounts, currencyOut]
  );

  // Available для отображения когда выбран ours_now счёт
  const selectedAcc = leg.outKind === "ours_now" && leg.accountId
    ? activeAccounts.find((a) => a.id === leg.accountId)
    : null;
  const accBalance = selectedAcc ? balanceOf(selectedAcc.id) : 0;
  const insufficient = selectedAcc && numberOrZero(leg.amount) > accBalance;

  useEffect(() => {
    if (leg.outKind !== "ours_now" && leg.accountId) onChange({ accountId: "" });
    if (leg.outKind !== "partner_now" && leg.partnerAccountId) onChange({ partnerAccountId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.outKind]);

  return (
    <div className="rounded-[10px] border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold text-slate-500 tracking-wide uppercase">Leg {idx + 1}</div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Amount + outKind в одной строке */}
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2">
        <div className="flex items-baseline gap-2 bg-slate-50 rounded-[10px] border-2 border-slate-200 px-3 py-2">
          <span className="text-slate-500 text-[14px] font-semibold">{curSymbol(currencyOut)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={leg.amount}
            onChange={(e) => onChange({ amount: cleanInput(e.target.value) })}
            placeholder="Сумма"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[14px] font-bold min-w-0"
          />
        </div>
        <select
          value={leg.outKind}
          onChange={(e) => onChange({ outKind: e.target.value })}
          className="bg-white border-2 border-slate-200 rounded-[10px] px-2.5 py-2 text-[12px] font-semibold text-slate-900 outline-none focus:border-slate-400"
        >
          {OUT_KIND_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.title}</option>
          ))}
        </select>
      </div>

      {/* Account selector только для *_now */}
      {leg.outKind === "ours_now" && (
        <>
          <GroupedAccountSelect
            accounts={filteredOurAccs}
            value={leg.accountId}
            onChange={(v) => onChange({ accountId: v })}
            placeholder={`Наш счёт в ${currencyOut}`}
          />
          {selectedAcc && (
            <div className={`text-[10.5px] tabular-nums ${insufficient ? "text-rose-600 font-bold" : "text-slate-500"}`}>
              Баланс счёта: {fmt(accBalance, selectedAcc.currency)} {selectedAcc.currency}
              {insufficient && ` · недостаёт ${fmt(numberOrZero(leg.amount) - accBalance, selectedAcc.currency)}`}
            </div>
          )}
        </>
      )}
      {leg.outKind === "partner_now" && (
        <PartnerAccountSelect
          currency={currencyOut}
          value={leg.partnerAccountId}
          onChange={(v) => onChange({ partnerAccountId: v })}
          placeholder={`Счёт партнёра в ${currencyOut}`}
        />
      )}
      {(leg.outKind === "ours_later" || leg.outKind === "partner_later") && (
        <div className="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[6px] px-2 py-1.5 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Без movement — фиксируем как obligation
        </div>
      )}
    </div>
  );
}

// ─── Step 6: Confirm ────────────────────────────────────────────────────

function StepConfirm({
  kind, partnerName, clientNickname,
  currencyIn, amountIn, inKind,
  currencyOut, amountOut, rate,
  legs,
  commissionUsd, setCommissionUsd, comment, setComment,
  plannedAt, setPlannedAt, referral, setReferral,
  profitPreview,
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Calculator} text="Условия и подтверждение" />

      <div className="rounded-[14px] border-2 border-slate-200 bg-slate-50/40 p-3.5 space-y-2">
        <Row label="Тип" value={kind === "broker" ? "Брокеридж (только комиссия)" : "OTC обмен"} />
        <Row label="Партнёр" value={partnerName || "—"} />
        {clientNickname && <Row label="Клиент" value={clientNickname} />}
        <hr className="border-slate-200" />
        <Row
          label="Клиент отдаёт"
          value={`${fmt(numberOrZero(amountIn), currencyIn)} ${currencyIn}`}
          sub={IN_KIND_OPTIONS.find((o) => o.id === inKind)?.title}
        />
        <Row
          label="Клиент получает"
          value={`${fmt(numberOrZero(amountOut), currencyOut)} ${currencyOut}`}
          sub={`Курс ${numberOrZero(rate).toFixed(6)}`}
        />
        <hr className="border-slate-200" />
        {legs.map((l, i) => (
          <Row
            key={l.id}
            label={`Leg ${i + 1}`}
            value={`${fmt(numberOrZero(l.amount), currencyOut)} ${currencyOut}`}
            sub={OUT_KIND_OPTIONS.find((o) => o.id === l.outKind)?.title}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-1.5">
            Комиссия (USD)
          </label>
          <div className="flex items-baseline gap-2 bg-slate-50 rounded-[10px] border border-slate-200 px-3 py-2.5">
            <span className="text-slate-400 text-[14px] font-semibold">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={commissionUsd}
              onChange={(e) => setCommissionUsd(cleanInput(e.target.value))}
              placeholder="0.00"
              className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[14px] font-semibold min-w-0"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-1.5">
            <Calendar className="w-3 h-3 inline mr-1" />
            Дата сделки
          </label>
          <input
            type="datetime-local"
            value={plannedAt}
            onChange={(e) => setPlannedAt(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
          />
        </div>
      </div>

      <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/50 p-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Маржа (preview)" value={`$${profitPreview.margin.toFixed(2)}`} tone="slate" />
        <Stat label="Комиссия" value={`$${profitPreview.commission.toFixed(2)}`} tone="indigo" />
        <Stat label="Прибыль" value={`$${profitPreview.total.toFixed(2)}`} tone="emerald" />
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-1.5">
          Комментарий
        </label>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Заметка о сделке (опционально)"
          className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
        />
      </div>

      <label className="inline-flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={referral}
          onChange={(e) => setReferral(e.target.checked)}
          className="rounded"
        />
        Реферальная сделка (минус бонус из прибыли)
      </label>
    </div>
  );
}

// ─── Reusable bits ─────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, text, hint }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
        {text}
      </div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function CurrencyPicker({ value, onChange, codes }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white border border-slate-200 rounded-[10px] px-2.5 py-2.5 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-400"
    >
      {(codes || []).map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}

function KindOption({ id, title, hint, tone, selected, onClick }) {
  const selectedCls = {
    indigo: "bg-indigo-50/70 border-indigo-200",
    amber: "bg-amber-50/70 border-amber-200",
    emerald: "bg-emerald-50/70 border-emerald-200",
  }[tone] || "bg-slate-50 border-slate-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2.5 rounded-[10px] border transition-all duration-150 ${
        selected ? selectedCls : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
        <div className="text-[12px] font-semibold text-slate-900 tracking-tight">{title}</div>
        {selected && <Check className="w-3 h-3 text-emerald-600 ml-auto" strokeWidth={2.5} />}
      </div>
      <div className="text-[10.5px] text-slate-500 leading-snug">{hint}</div>
    </button>
  );
}

function Row({ label, value, sub }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-[11.5px] text-slate-500">{label}</div>
      <div className="text-right">
        <div className="text-[13px] font-bold text-slate-900 tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const cls = {
    slate: "text-slate-700",
    indigo: "text-indigo-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
  }[tone] || "text-slate-700";
  return (
    <div>
      <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
