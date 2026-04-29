// src/components/OtcDealWizard.jsx
//
// 5-step wizard для OTC сделок (Phase 9 / SQL 0081).
//
// Шаги:
//   1) Тип       — kind ∈ {otc, broker}
//   2) Стороны   — выбор партнёра + опциональный client_nickname
//   3) IN        — какую валюту/сумму отдаёт клиент
//                  in_kind ∈ {ours_now, ours_later, partner_now, partner_later}
//                  + счёт (если *_now)
//   4) OUT       — что получает клиент: одна или несколько leg
//                  каждая leg: currency, amount, rate, out_kind, account/partner
//   5) Подтв.    — commission_usd, planned_at, comment, summary, Создать
//
// Поддерживает все 16 IN×OUT комбинаций. Каждый ord side с *_now пока
// упрощён до одного полного платежа (multi-payment UI добавим после
// валидации). _later — без movement, только obligation.
//
// Calls rpcCreateDeal с new params: inKind, inPayments[], legs[].outKind, legs[].payments[].

import React, { useState, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, Check, X, Plus, Trash2,
  Handshake, Coins, Calculator, Calendar, Banknote, AlertCircle, ArrowDown,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import PartnerAccountSelect from "./PartnerAccountSelect.jsx";
import PartnerSelect from "./PartnerSelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { usePartners } from "../store/partners.jsx";
import { useRates } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { fmt, curSymbol, multiplyAmount } from "../utils/money.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateDeal, withToast, ensureClient, uuidOrNull } from "../lib/supabaseWrite.js";

// ─── Constants ─────────────────────────────────────────────────────────

const STEPS = [
  { id: "type",    label: "Тип" },
  { id: "party",   label: "Контрагент" },
  { id: "in",      label: "Клиент отдаёт" },
  { id: "out",     label: "Клиент получает" },
  { id: "confirm", label: "Подтверждение" },
];

const IN_KIND_OPTIONS = [
  { id: "ours_now",     title: "Принимаем сейчас",      hint: "Клиент платит на наш счёт прямо сейчас",       tone: "emerald" },
  { id: "partner_now",  title: "Принимает партнёр",     hint: "Клиент платит на счёт партнёра прямо сейчас",  tone: "indigo" },
  { id: "ours_later",   title: "Клиент должен нам",     hint: "Клиент заплатит позже — фиксируем долг",       tone: "amber" },
  { id: "partner_later",title: "Партнёр должен нам",    hint: "Партнёр обещал зачислить позже — фиксируем",   tone: "amber" },
];

const OUT_KIND_OPTIONS = [
  { id: "ours_now",     title: "Выдаём сейчас",         hint: "Мы переводим клиенту со своего счёта прямо сейчас",  tone: "emerald" },
  { id: "partner_now",  title: "Выдаёт партнёр",        hint: "Партнёр переводит клиенту со своего счёта",          tone: "indigo" },
  { id: "ours_later",   title: "Мы должны клиенту",     hint: "Мы выдадим клиенту позже — фиксируем долг",          tone: "amber" },
  { id: "partner_later",title: "Партнёр должен клиенту",hint: "Партнёр обязался выдать клиенту позже",              tone: "amber" },
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

const emptyLeg = (currency = "TRY") => ({
  id: `o_${Math.random().toString(36).slice(2, 8)}`,
  currency,
  amount: "",
  rate: "",
  outKind: "ours_now",
  accountId: "",
  partnerAccountId: "",
});

// ─── Main wizard ────────────────────────────────────────────────────────

export default function OtcDealWizard({ open, currentOffice, onClose, onCreated }) {
  const { currentUser } = useAuth();
  const { addEntry: logAudit } = useAudit();
  const { accounts } = useAccounts();
  const { activePartners } = usePartners();
  const { getRate } = useRates();
  const { codes: currencyCodes } = useCurrencies();

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.active && a.officeId === currentOffice?.id),
    [accounts, currentOffice?.id]
  );

  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  // ─── Draft state ────────────────────────────────────────────────────
  const [kind, setKind] = useState("otc");
  const [partnerName, setPartnerName] = useState("");
  const [clientNickname, setClientNickname] = useState("");

  const [currencyIn, setCurrencyIn] = useState("USDT");
  const [amountIn, setAmountIn] = useState("");
  const [inKind, setInKind] = useState("ours_now");
  const [inAccountId, setInAccountId] = useState("");
  const [inPartnerAccountId, setInPartnerAccountId] = useState("");

  const [legs, setLegs] = useState([emptyLeg("TRY")]);

  const [commissionUsd, setCommissionUsd] = useState("");
  const [comment, setComment] = useState("");
  const [plannedAt, setPlannedAt] = useState("");
  const [referral, setReferral] = useState(false);

  // Reset на open
  React.useEffect(() => {
    if (open) {
      setStepIdx(0);
      setKind("otc");
      setPartnerName("");
      setClientNickname("");
      setCurrencyIn("USDT");
      setAmountIn("");
      setInKind("ours_now");
      setInAccountId("");
      setInPartnerAccountId("");
      setLegs([emptyLeg("TRY")]);
      setCommissionUsd("");
      setComment("");
      setPlannedAt("");
      setReferral(false);
      setBusy(false);
    }
  }, [open]);

  const partner = useMemo(
    () => activePartners.find((p) => p.name === partnerName) || null,
    [activePartners, partnerName]
  );

  // ─── Per-step validation ────────────────────────────────────────────
  const stepValid = useMemo(() => {
    const v = [false, false, false, false, false];
    v[0] = !!kind;
    v[1] = !!partnerName.trim();
    const amt = numberOrZero(amountIn);
    v[2] =
      !!currencyIn &&
      amt > 0 &&
      (inKind === "ours_now"     ? !!inAccountId :
       inKind === "partner_now"  ? !!inPartnerAccountId :
       true);
    v[3] =
      legs.length > 0 &&
      legs.every((l) =>
        !!l.currency &&
        numberOrZero(l.amount) > 0 &&
        numberOrZero(l.rate) > 0 &&
        (l.outKind === "ours_now"    ? !!l.accountId :
         l.outKind === "partner_now" ? !!l.partnerAccountId :
         true)
      );
    v[4] = v[0] && v[1] && v[2] && v[3];
    return v;
  }, [kind, partnerName, currencyIn, amountIn, inKind, inAccountId, inPartnerAccountId, legs]);

  const canNext = stepValid[stepIdx];
  const canSubmit = stepValid[4];

  // ─── Profit preview ─────────────────────────────────────────────────
  const profitPreview = useMemo(() => {
    if (kind === "broker") {
      return { margin: 0, commission: numberOrZero(commissionUsd), total: numberOrZero(commissionUsd) };
    }
    let margin = 0;
    const amtIn = numberOrZero(amountIn);
    legs.forEach((l) => {
      const rate = numberOrZero(l.rate);
      const amt = numberOrZero(l.amount);
      if (rate <= 0 || amt <= 0) return;
      const market = getRate(currencyIn, l.currency);
      if (!market || market <= 0) return;
      const marginInCurIn = amt / rate - amt / market;
      if (currencyIn === "USD") {
        margin += marginInCurIn;
      } else {
        const r = getRate(currencyIn, "USD");
        if (r > 0) margin += marginInCurIn * r;
      }
    });
    margin = Math.round(margin * 100) / 100;
    const commission = numberOrZero(commissionUsd);
    return { margin, commission, total: margin + commission };
  }, [kind, currencyIn, amountIn, legs, commissionUsd, getRate]);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit || busy || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      // Ensure client (если nickname задан, найдём или создадим)
      let clientId = null;
      if (clientNickname.trim()) {
        try {
          clientId = await ensureClient(clientNickname.trim());
        } catch (e) {
          console.warn("[OtcWizard] ensureClient failed", e);
        }
      }

      const inPayments = (inKind === "ours_now" || inKind === "partner_now")
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
          currency: l.currency,
          amount: numberOrZero(l.amount),
          rate: numberOrZero(l.rate),
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
          officeId: currentOffice.id,
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
          applyMinFee: kind !== "broker", // в broker mode min_fee не применяем
        }),
        {
          success: "OTC сделка создана",
          errorPrefix: "OTC failed",
        }
      );

      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${kind} · ${partnerName} · ${fmt(numberOrZero(amountIn), currencyIn)} ${currencyIn} → ${legs.map((l) => `${l.amount} ${l.currency}`).join(" + ")}`,
        });
        onCreated?.(res.result);
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (stepIdx < STEPS.length - 1 && canNext) setStepIdx((i) => i + 1);
  };
  const back = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="OTC сделка"
      subtitle="Сделка с участием партнёра — все сценарии IN/OUT"
      width="3xl"
    >
      <Stepper currentIdx={stepIdx} steps={STEPS} stepValid={stepValid} onStepClick={setStepIdx} />

      <div className="px-5 py-4 min-h-[380px]">
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
            amountIn={amountIn} setAmountIn={setAmountIn}
            inKind={inKind} setInKind={setInKind}
            inAccountId={inAccountId} setInAccountId={setInAccountId}
            inPartnerAccountId={inPartnerAccountId} setInPartnerAccountId={setInPartnerAccountId}
            activeAccounts={activeAccounts}
            currencyCodes={currencyCodes}
          />
        )}
        {stepIdx === 3 && (
          <StepOut
            legs={legs} setLegs={setLegs}
            currencyIn={currencyIn} amountIn={amountIn}
            activeAccounts={activeAccounts}
            currencyCodes={currencyCodes}
            getRate={getRate}
          />
        )}
        {stepIdx === 4 && (
          <StepConfirm
            kind={kind} partnerName={partnerName} clientNickname={clientNickname}
            currencyIn={currencyIn} amountIn={amountIn} inKind={inKind}
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
            {busy ? "Создание…" : "Создать сделку"}
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
      <div className="flex items-center gap-2">
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
                className={`flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[11.5px] font-bold transition-colors ${
                  isCurrent
                    ? "bg-slate-900 text-white"
                    : isPast
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      : "bg-white text-slate-400 border border-slate-200"
                } ${!isAccessible ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              >
                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  isCurrent ? "bg-white text-slate-900" : isPast ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                }`}>
                  {isPast ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : i + 1}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
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
      <SectionTitle icon={Coins} text="Тип сделки" hint="От этого зависит, как считается прибыль." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KindCard
          selected={kind === "otc"}
          onClick={() => setKind("otc")}
          tone="indigo"
          title="OTC обмен"
          hint="Обмен валюты с участием партнёра. Прибыль = маржа курса + комиссия. Поддерживает все 16 IN/OUT сценариев."
          example="Пример: клиент → партнёр USDT, партнёр → клиент TRY, мы свели."
        />
        <KindCard
          selected={kind === "broker"}
          onClick={() => setKind("broker")}
          tone="amber"
          title="Брокеридж"
          hint="Чистое сведение без маржи. Прибыль = только комиссия. Min-fee не применяется."
          example="Пример: партнёр A → партнёр B, мы получаем фиксированную комиссию за организацию."
        />
      </div>
    </div>
  );
}

function KindCard({ selected, onClick, tone, title, hint, example }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-4 rounded-[14px] border-2 transition-all ${
        selected ? `${TONE_CLS[tone]} ring-2 ring-offset-1 ring-${tone}-300` : "border-slate-200 hover:border-slate-300 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-2 h-2 rounded-full ${TONE_DOT[tone]}`} />
        <div className="text-[13px] font-bold text-slate-900">{title}</div>
        {selected && <Check className="w-3.5 h-3.5 text-emerald-600 ml-auto" strokeWidth={3} />}
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

      <SectionTitle icon={Banknote} text={kind === "broker" ? "Клиент (опционально)" : "Клиент"} hint={kind === "broker" ? "Для брокериджа клиент часто не нужен." : "Конечный получатель сделки."} />
      <input
        type="text"
        value={clientNickname}
        onChange={(e) => setClientNickname(e.target.value)}
        placeholder="Ник или имя клиента (опционально)"
        className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[13px] outline-none"
      />
    </div>
  );
}

// ─── Step 3: IN ─────────────────────────────────────────────────────────

function StepIn({
  currencyIn, setCurrencyIn, amountIn, setAmountIn,
  inKind, setInKind,
  inAccountId, setInAccountId,
  inPartnerAccountId, setInPartnerAccountId,
  activeAccounts, currencyCodes,
}) {
  const filteredOurAccs = useMemo(
    () => activeAccounts.filter((a) => a.currency === currencyIn),
    [activeAccounts, currencyIn]
  );

  // При смене kind очищаем неприменимый счёт
  React.useEffect(() => {
    if (inKind !== "ours_now") setInAccountId("");
    if (inKind !== "partner_now") setInPartnerAccountId("");
  }, [inKind, setInAccountId, setInPartnerAccountId]);

  return (
    <div className="space-y-4">
      <SectionTitle icon={ArrowDown} text="Что отдаёт клиент" hint="Валюта, сумма и куда поступает." />

      {/* Currency + Amount */}
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
        <CurrencyPicker value={currencyIn} onChange={setCurrencyIn} codes={currencyCodes} />
        <div className="relative flex items-baseline gap-2 bg-rose-50/60 rounded-[12px] border-2 border-rose-200 px-4 py-3">
          <span className="text-rose-500 text-[18px] font-semibold">{curSymbol(currencyIn)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amountIn}
            onChange={(e) => setAmountIn(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[20px] font-bold tracking-tight min-w-0"
          />
          <span className="text-rose-500 text-[12px] font-bold tracking-wider">{currencyIn}</span>
        </div>
      </div>

      {/* IN kind */}
      <div>
        <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-2">Способ получения</div>
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

      {/* Account selector */}
      {inKind === "ours_now" && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-1.5">Наш счёт зачисления</div>
          <GroupedAccountSelect
            accounts={filteredOurAccs}
            value={inAccountId}
            onChange={setInAccountId}
            placeholder={`Выбрать счёт в ${currencyIn}`}
          />
        </div>
      )}
      {inKind === "partner_now" && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase mb-1.5">Счёт партнёра</div>
          <PartnerAccountSelect
            currency={currencyIn}
            value={inPartnerAccountId}
            onChange={setInPartnerAccountId}
            placeholder="Выбрать счёт партнёра"
          />
        </div>
      )}
      {(inKind === "ours_later" || inKind === "partner_later") && (
        <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Денег пока нет — фиксируем как обязательство. Платёж добавите позже из карточки сделки.
        </div>
      )}
    </div>
  );
}

// ─── Step 4: OUT (legs) ────────────────────────────────────────────────

function StepOut({ legs, setLegs, currencyIn, amountIn, activeAccounts, currencyCodes, getRate }) {
  const updateLeg = (id, patch) => setLegs((arr) => arr.map((l) => l.id === id ? { ...l, ...patch } : l));
  const addLeg = () => setLegs((arr) => [...arr, emptyLeg(arr[arr.length - 1]?.currency || "TRY")]);
  const removeLeg = (id) => setLegs((arr) => arr.length > 1 ? arr.filter((l) => l.id !== id) : arr);

  return (
    <div className="space-y-3">
      <SectionTitle icon={ArrowDown} text="Что получает клиент" hint="Одна или несколько leg — каждая со своей валютой и курсом." />

      {legs.map((leg, idx) => (
        <LegCard
          key={leg.id}
          leg={leg}
          idx={idx}
          canRemove={legs.length > 1}
          onRemove={() => removeLeg(leg.id)}
          onChange={(patch) => updateLeg(leg.id, patch)}
          currencyIn={currencyIn}
          amountIn={amountIn}
          activeAccounts={activeAccounts}
          currencyCodes={currencyCodes}
          getRate={getRate}
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
  );
}

function LegCard({ leg, idx, canRemove, onRemove, onChange, currencyIn, amountIn, activeAccounts, currencyCodes, getRate }) {
  const filteredOurAccs = useMemo(
    () => activeAccounts.filter((a) => a.currency === leg.currency),
    [activeAccounts, leg.currency]
  );

  // При смене outKind очищаем неприменимый счёт
  React.useEffect(() => {
    if (leg.outKind !== "ours_now" && leg.accountId) onChange({ accountId: "" });
    if (leg.outKind !== "partner_now" && leg.partnerAccountId) onChange({ partnerAccountId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.outKind]);

  // Auto-fill rate из market на mount/смена валюты
  React.useEffect(() => {
    if (!leg.rate && currencyIn && leg.currency && currencyIn !== leg.currency) {
      const r = getRate(currencyIn, leg.currency);
      if (r > 0) onChange({ rate: String(r) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg.currency, currencyIn]);

  // Auto-fill amount из rate × amountIn если пусто
  const tryFillAmount = () => {
    const amtIn = numberOrZero(amountIn);
    const rate = numberOrZero(leg.rate);
    if (amtIn > 0 && rate > 0 && !leg.amount) {
      onChange({ amount: String(multiplyAmount(amtIn, rate, 2)) });
    }
  };

  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-slate-500 tracking-wide uppercase">Leg {idx + 1}</div>
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

      {/* Currency + Amount + Rate */}
      <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_1fr] gap-2">
        <CurrencyPicker
          value={leg.currency}
          onChange={(c) => onChange({ currency: c, accountId: "", partnerAccountId: "" })}
          codes={currencyCodes}
        />
        <div className="flex items-baseline gap-2 bg-emerald-50/60 rounded-[12px] border-2 border-emerald-200 px-3 py-2.5">
          <span className="text-emerald-600 text-[14px] font-semibold">{curSymbol(leg.currency)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={leg.amount}
            onBlur={tryFillAmount}
            onChange={(e) => onChange({ amount: e.target.value.replace(/[^\d.,]/g, "").replace(",", ".") })}
            placeholder="Сумма"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[14px] font-bold min-w-0"
          />
        </div>
        <div className="flex items-baseline gap-2 bg-slate-50 rounded-[12px] border border-slate-200 px-3 py-2.5">
          <span className="text-slate-400 text-[10px] font-bold tracking-wider uppercase">Курс</span>
          <input
            type="text"
            inputMode="decimal"
            value={leg.rate}
            onChange={(e) => onChange({ rate: e.target.value.replace(/[^\d.,]/g, "").replace(",", ".") })}
            placeholder="0.0000"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[13px] font-semibold min-w-0"
          />
        </div>
      </div>

      {/* OUT kind */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {OUT_KIND_OPTIONS.map((opt) => (
          <KindOption
            key={opt.id}
            selected={leg.outKind === opt.id}
            onClick={() => onChange({ outKind: opt.id })}
            {...opt}
          />
        ))}
      </div>

      {/* Account selector */}
      {leg.outKind === "ours_now" && (
        <GroupedAccountSelect
          accounts={filteredOurAccs}
          value={leg.accountId}
          onChange={(v) => onChange({ accountId: v })}
          placeholder={`Выбрать счёт в ${leg.currency}`}
        />
      )}
      {leg.outKind === "partner_now" && (
        <PartnerAccountSelect
          currency={leg.currency}
          value={leg.partnerAccountId}
          onChange={(v) => onChange({ partnerAccountId: v })}
          placeholder="Выбрать счёт партнёра"
        />
      )}
      {(leg.outKind === "ours_later" || leg.outKind === "partner_later") && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[8px] px-2.5 py-2 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          Без движения — фиксируем как обязательство.
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Confirm ────────────────────────────────────────────────────

function StepConfirm({
  kind, partnerName, clientNickname, currencyIn, amountIn, inKind, legs,
  commissionUsd, setCommissionUsd, comment, setComment,
  plannedAt, setPlannedAt, referral, setReferral,
  profitPreview,
}) {
  return (
    <div className="space-y-4">
      <SectionTitle icon={Calculator} text="Условия и подтверждение" hint="Комиссия, дата, комментарий — затем создаём." />

      {/* Summary card */}
      <div className="rounded-[14px] border-2 border-slate-200 bg-slate-50/40 p-3.5 space-y-2">
        <Row label="Тип" value={kind === "broker" ? "Брокеридж (только комиссия)" : "OTC обмен"} />
        <Row label="Партнёр" value={partnerName || "—"} />
        {clientNickname && <Row label="Клиент" value={clientNickname} />}
        <hr className="border-slate-200" />
        <Row label="Клиент отдаёт" value={`${fmt(numberOrZero(amountIn), currencyIn)} ${currencyIn}`} sub={kindLabelIn(inKind)} />
        {legs.map((l, i) => (
          <Row
            key={l.id}
            label={`Leg ${i + 1}`}
            value={`${fmt(numberOrZero(l.amount), l.currency)} ${l.currency} @ ${l.rate}`}
            sub={kindLabelOut(l.outKind)}
          />
        ))}
      </div>

      {/* Commission */}
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
              onChange={(e) => setCommissionUsd(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
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

      {/* Profit preview */}
      <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/50 p-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Маржа" value={`$${profitPreview.margin.toFixed(2)}`} tone="slate" />
        <Stat label="Комиссия" value={`$${profitPreview.commission.toFixed(2)}`} tone="indigo" />
        <Stat label="Прибыль" value={`$${profitPreview.total.toFixed(2)}`} tone="emerald" />
      </div>

      {/* Comment */}
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2.5 rounded-[10px] border-2 transition-all ${
        selected ? `${TONE_CLS[tone]} ring-1 ring-${tone}-300` : "border-slate-200 hover:border-slate-300 bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
        <div className="text-[12px] font-bold text-slate-900">{title}</div>
        {selected && <Check className="w-3 h-3 text-emerald-600 ml-auto" strokeWidth={3} />}
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
  }[tone] || "text-slate-700";
  return (
    <div>
      <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase mb-0.5">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function kindLabelIn(k) {
  return IN_KIND_OPTIONS.find((o) => o.id === k)?.title || k;
}
function kindLabelOut(k) {
  return OUT_KIND_OPTIONS.find((o) => o.id === k)?.title || k;
}
