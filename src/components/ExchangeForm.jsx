// src/components/ExchangeForm.jsx
// Универсальная форма сделки. Поддерживает два режима:
//   mode="create" — создание новой транзакции
//   mode="edit"   — редактирование существующей (initialData обязательно)
//
// Фичи:
//   — multi-output (массив outputs: currency, amount, rate)
//   — auto-rate из системы курсов + toggle "manual rate" на каждый output
//   — minimum fee ($10 по умолчанию, берётся из settings)
//   — referral checkbox
//   — counterparty (select или свободный ввод)
//   — точная математика через utils/money

import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowLeftRight,
  Zap,
  Plus,
  Trash2,
  Lock,
  Unlock,
  UserPlus,
  RefreshCw,
} from "lucide-react";
import CurrencyTabs from "./ui/CurrencyTabs.jsx";
import Select from "./ui/Select.jsx";
import CounterpartySelect from "./CounterpartySelect.jsx";
import { CURRENCIES, BALANCES_BY_OFFICE, officeName } from "../store/data.js";
import { useRates } from "../store/rates.jsx";
import { useAuth } from "../store/auth.jsx";
import { useTransactions } from "../store/transactions.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import {
  multiplyAmount,
  percentOf,
  applyMinFee,
  fmt,
  curSymbol,
} from "../utils/money.js";

// Создать пустой output
const emptyOutput = (currency = "TRY") => ({
  id: `o_${Math.random().toString(36).slice(2, 8)}`,
  currency,
  amount: "",
  rate: "",
  manualRate: false,
  touched: false,
});

// Иконки для типов счетов (дублирует data.js ACCOUNT_TYPES.icon, но здесь локально для UI скорости)
const ACCOUNT_TYPE_ICONS = {
  bank: "🏦",
  cash: "💵",
  crypto: "🪙",
  exchange: "📈",
};

// Нормализация initialData в state формы
function initFromTx(tx) {
  if (!tx) return null;
  // tx.outputs — массив; если его нет (старый формат), делаем один output
  const outputs = tx.outputs && tx.outputs.length
    ? tx.outputs.map((o, i) => ({
        id: `o_init_${i}`,
        currency: o.currency,
        amount: String(o.amount),
        rate: String(o.rate),
        manualRate: true, // в edit режиме по умолчанию ручной, чтобы не переписались
        touched: true,
      }))
    : [
        {
          id: "o_init_0",
          currency: tx.curOut,
          amount: String(tx.amtOut),
          rate: String(tx.rate),
          manualRate: true,
          touched: true,
        },
      ];
  return {
    curIn: tx.curIn,
    amtIn: String(tx.amtIn),
    feeType: "USD",
    fee: String(tx.fee ?? ""),
    outputs,
    counterparty: tx.counterparty || "",
    referral: !!tx.referral,
    comment: tx.comment || "",
  };
}

export default function ExchangeForm({
  mode = "create",
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
}) {
  const { t } = useTranslation();
  const { getRate } = useRates();
  const { currentUser, settings } = useAuth();
  const { addCounterparty } = useTransactions();
  const { accountsByOffice } = useAccounts();

  // --- state ---
  const starter = useMemo(() => initFromTx(initialData), [initialData]);
  const [curIn, setCurIn] = useState(starter?.curIn || "USDT");
  const [amtIn, setAmtIn] = useState(starter?.amtIn || "");
  const [feeType, setFeeType] = useState(starter?.feeType || "USD");
  const [fee, setFee] = useState(starter?.fee || "");
  const [outputs, setOutputs] = useState(starter?.outputs || [emptyOutput("TRY")]);
  const [counterparty, setCounterparty] = useState(starter?.counterparty || "");
  const [referral, setReferral] = useState(starter?.referral || false);
  const [comment, setComment] = useState(starter?.comment || "");
  const [accountId, setAccountId] = useState(initialData?.accountId || "");
  const [flash, setFlash] = useState(false);

  // Список доступных счетов для пары (office, curIn)
  const availableAccounts = useMemo(
    () => accountsByOffice(currentOffice, { currency: curIn }),
    [accountsByOffice, currentOffice, curIn]
  );

  // При смене валюты/офиса сбрасываем выбор если текущий account не подходит
  useEffect(() => {
    if (accountId && !availableAccounts.some((a) => a.id === accountId)) {
      setAccountId("");
    }
  }, [availableAccounts, accountId]);

  // --- auto-fill rates / amounts ---
  useEffect(() => {
    setOutputs((prev) =>
      prev.map((o) => {
        // Если manual rate — не трогаем
        if (o.manualRate) return o;
        const autoRate = getRate(curIn, o.currency);
        const nextRate = autoRate !== undefined ? String(autoRate) : o.rate;
        // Пересчёт amount только если пользователь его не трогал
        let nextAmount = o.amount;
        if (!o.touched) {
          const a = parseFloat(amtIn);
          const r = parseFloat(nextRate);
          if (!isNaN(a) && !isNaN(r) && a > 0 && r > 0) {
            const computed = multiplyAmount(a, r, o.currency === "TRY" ? 0 : 2);
            nextAmount = String(computed);
          } else {
            nextAmount = "";
          }
        }
        return { ...o, rate: nextRate, amount: nextAmount };
      })
    );
  }, [curIn, amtIn, getRate]);

  // --- derived: эффективная комиссия в USD (с учётом минимума) ---
  const effectiveFee = useMemo(() => {
    if (!amtIn) return 0;
    const feeNum = parseFloat(fee) || 0;
    // Если fee = 0 и не введено — показываем 0 (не применяем минимум в UI до попытки submit)
    if (!fee) return 0;

    let feeUsd;
    if (feeType === "%") {
      // Переводим amtIn в USD (если нужно), считаем процент
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn)
          : multiplyAmount(parseFloat(amtIn), getRate(curIn, "USD") ?? 0, 2);
      feeUsd = percentOf(inUsd, feeNum, 2);
    } else {
      feeUsd = feeNum;
    }
    return applyMinFee(feeUsd, settings.minFeeUsd);
  }, [fee, feeType, amtIn, curIn, getRate, settings.minFeeUsd]);

  // Показать ли предупреждение о минимуме
  const minFeeApplied = useMemo(() => {
    const feeNum = parseFloat(fee) || 0;
    if (!feeNum) return false;
    if (feeType === "%") {
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn)
          : multiplyAmount(parseFloat(amtIn) || 0, getRate(curIn, "USD") ?? 0, 2);
      const rawUsd = percentOf(inUsd, feeNum, 2);
      return rawUsd < settings.minFeeUsd;
    }
    return feeNum < settings.minFeeUsd;
  }, [fee, feeType, amtIn, curIn, getRate, settings.minFeeUsd]);

  // --- handlers для outputs ---
  const updateOutput = (id, patch) =>
    setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));

  const addOutput = () => {
    const existing = outputs.map((o) => o.currency);
    const next = CURRENCIES.find((c) => c !== curIn && !existing.includes(c)) || "USD";
    setOutputs((prev) => [...prev, emptyOutput(next)]);
  };

  const removeOutput = (id) => {
    setOutputs((prev) => (prev.length > 1 ? prev.filter((o) => o.id !== id) : prev));
  };

  const toggleManualRate = (id) => {
    setOutputs((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const nextManual = !o.manualRate;
        if (!nextManual) {
          // Возвращаемся к авто — сбрасываем touched и берём курс из системы
          const autoRate = getRate(curIn, o.currency);
          return {
            ...o,
            manualRate: false,
            touched: false,
            rate: autoRate !== undefined ? String(autoRate) : o.rate,
          };
        }
        return { ...o, manualRate: true };
      })
    );
  };

  // --- remaining amount (в валюте curIn) ---
  // Каждый output конвертируем обратно в curIn через его rate:
  //   amount_in_curIn = output.amount / output.rate
  // remaining = amtIn - sum(всех output'ов в curIn)
  const remainingIn = useMemo(() => {
    const inNum = parseFloat(amtIn) || 0;
    if (inNum <= 0) return 0;
    const consumed = outputs.reduce((sum, o) => {
      const amt = parseFloat(o.amount) || 0;
      const r = parseFloat(o.rate) || 0;
      if (amt <= 0 || r <= 0) return sum;
      // Идём в обратную сторону: сколько curIn соответствует данному output'у.
      return sum + amt / r;
    }, 0);
    return inNum - consumed;
  }, [amtIn, outputs]);

  // Порог для float-ошибок
  const EPS = 0.01;
  const exceedsInput = remainingIn < -EPS;

  // --- validation ---
  const hasAllRates = outputs.every((o) => o.rate && parseFloat(o.rate) > 0);
  const hasAllAmounts = outputs.every((o) => o.amount && parseFloat(o.amount) > 0);
  const noSameCurrency = outputs.every((o) => o.currency !== curIn);
  const canSubmit = amtIn && hasAllRates && hasAllAmounts && noSameCurrency && !exceedsInput;

  // --- submit ---
  const buildTx = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    const outputsClean = outputs.map((o) => ({
      currency: o.currency,
      amount: parseFloat(o.amount) || 0,
      rate: parseFloat(o.rate) || 0,
    }));

    // Профит: по умолчанию = эффективная комиссия в USD.
    // Минус реферальный бонус если referral=true.
    let profit = effectiveFee;
    if (referral) {
      // Рефералка считается от оборота в USD
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn) || 0
          : multiplyAmount(parseFloat(amtIn) || 0, getRate(curIn, "USD") ?? 0, 2);
      const refBonus = percentOf(inUsd, settings.referralPct, 2);
      profit = Math.round((profit - refBonus) * 100) / 100;
    }

    const base = {
      time: `${hh}:${mm}`,
      date: "Apr 20",
      officeId: currentOffice,
      type: "EXCHANGE",
      curIn,
      amtIn: parseFloat(amtIn),
      outputs: outputsClean,
      // Для обратной совместимости — первый output дублируется в плоские поля
      curOut: outputsClean[0].currency,
      amtOut: outputsClean[0].amount,
      rate: outputsClean[0].rate,
      fee: Math.round(effectiveFee * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      manager: currentUser.name,
      managerId: currentUser.id,
      counterparty,
      referral,
      comment,
      accountId,
    };

    if (mode === "edit" && initialData) {
      return { ...initialData, ...base };
    }
    return { ...base, id: Date.now() };
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const tx = buildTx();
    if (counterparty) addCounterparty(counterparty);
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
    onSubmit?.(tx);
    if (mode === "create") {
      // reset
      setAmtIn("");
      setFee("");
      setOutputs([emptyOutput("TRY")]);
      setCounterparty("");
      setReferral(false);
      setComment("");
    }
  };

  // --- live profit (для summary) ---
  const liveProfit = useMemo(() => {
    if (!amtIn || !fee) return 0;
    let p = effectiveFee;
    if (referral) {
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn) || 0
          : multiplyAmount(parseFloat(amtIn) || 0, getRate(curIn, "USD") ?? 0, 2);
      p -= percentOf(inUsd, settings.referralPct, 2);
    }
    return Math.round(p * 100) / 100;
  }, [effectiveFee, referral, amtIn, curIn, getRate, settings.referralPct, fee]);

  // Reverse: меняет местами in и первый output. Используется в одно-выходном случае.
  // При множественных outputs берём только первый (обратимость многостороннего обмена неоднозначна).
  const handleReverse = () => {
    const first = outputs[0];
    if (!first) return;
    const newCurIn = first.currency;
    const newAmtIn = first.amount || "";
    const newOutCurrency = curIn;
    const newOutAmount = amtIn || "";
    const autoRate = getRate(newCurIn, newOutCurrency);
    setCurIn(newCurIn);
    setAmtIn(newAmtIn);
    setOutputs([
      {
        id: `o_rev_${Date.now()}`,
        currency: newOutCurrency,
        amount: newOutAmount,
        rate: autoRate !== undefined ? String(autoRate) : (first.rate ? String(1 / parseFloat(first.rate)) : ""),
        manualRate: autoRate === undefined,
        touched: !!newOutAmount,
      },
    ]);
  };

  const isEdit = mode === "edit";

  return (
    <div
      className={`relative bg-white rounded-[18px] border border-slate-200 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.02)] overflow-hidden transition-all ${
        flash ? "ring-4 ring-emerald-400/50" : ""
      }`}
    >
      {/* Header (only for create — modal has its own) */}
      {!isEdit && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-sm">
              <ArrowLeftRight className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight text-slate-900 leading-none">
                {t("new_exchange")}
              </h2>
              <p className="text-[11px] text-slate-500 mt-1">
                {officeName(currentOffice)} · {currentUser.name}
              </p>
            </div>
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
            ⌘ K
          </kbd>
        </div>
      )}

      {/* RECEIVED */}
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <ArrowDown className="w-3 h-3 text-white" />
            </div>
            <span className="text-[11px] font-bold tracking-[0.15em] text-emerald-700 uppercase">
              {t("you_received")}
            </span>
          </div>
          <button
            type="button"
            onClick={handleReverse}
            disabled={!amtIn || !outputs[0]?.amount}
            title={t("reverse")}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed rounded-[8px] px-2 py-1 border border-transparent hover:border-slate-200 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t("reverse")}
          </button>
        </div>
        <CurrencyTabs value={curIn} onChange={setCurIn} accent="emerald" />
        <div
          className={`relative flex items-baseline gap-2 bg-white rounded-[14px] border-2 transition-all px-4 py-4 mt-3 ${
            amtIn
              ? "border-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.08)]"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <span className="text-slate-400 text-[22px] font-semibold">{curSymbol(curIn)}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amtIn}
            onChange={(e) => setAmtIn(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[30px] font-bold tracking-tight min-w-0 leading-none"
          />
          <span className="text-slate-400 text-[12px] font-bold tracking-wider">{curIn}</span>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[11px] text-slate-400">{t("available")}</span>
          <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
            {curSymbol(curIn)}
            {fmt(BALANCES_BY_OFFICE[currentOffice]?.[curIn]?.amount || 0, curIn)} {curIn}
          </span>
        </div>

        {/* Deposit to account — выбор конкретного счёта/кошелька */}
        {availableAccounts.length > 0 && (
          <div className="mt-2.5">
            <div className="text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-1.5">
              Deposit to
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableAccounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountId(a.id === accountId ? "" : a.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-all ${
                    a.id === accountId
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="text-[13px]">{ACCOUNT_TYPE_ICONS[a.type] || "•"}</span>
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Connector */}
      <div className="flex justify-center my-3">
        <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
          <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>

      {/* COMMISSION */}
      <div className="px-5 pb-1">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-white text-[10px] font-bold">
              %
            </div>
            <span className="text-[11px] font-bold tracking-[0.15em] text-amber-700 uppercase">
              {t("commission")}
            </span>
          </div>
          <div className="inline-flex bg-slate-100 p-0.5 rounded-[9px] gap-0.5">
            {["USD", "%"].map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => setFeeType(ty)}
                className={`px-2.5 py-0.5 text-[11px] font-bold rounded-[7px] transition-all ${
                  feeType === ty
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {ty}
              </button>
            ))}
          </div>
        </div>
        <div
          className={`relative flex items-baseline gap-2 bg-white rounded-[14px] border-2 transition-all px-4 py-3 ${
            fee ? "border-amber-400" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <span className="text-slate-400 text-[18px] font-semibold">{feeType === "%" ? "%" : "$"}</span>
          <input
            type="text"
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            placeholder="0"
            className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0"
          />
        </div>
        {minFeeApplied && (
          <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
            ⚠ {t("min_fee_notice")} · applied: ${fmt(effectiveFee)}
          </div>
        )}
      </div>

      {/* Connector */}
      <div className="flex justify-center my-3">
        <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
          <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
        </div>
      </div>

      {/* ISSUED — multi-output */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center">
              <ArrowRight className="w-3 h-3 text-white" />
            </div>
            <span className="text-[11px] font-bold tracking-[0.15em] text-slate-700 uppercase">
              {t("you_gave")}
            </span>
            {outputs.length > 1 && (
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5">
                {outputs.length}
              </span>
            )}
          </div>
          <button
            onClick={addOutput}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-[8px] px-2 py-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            {t("add_output")}
          </button>
        </div>

        {/* Remaining indicator — показываем только когда есть amtIn и outputs с суммами */}
        {amtIn && outputs.some((o) => o.amount) && (
          <div
            className={`mb-3 flex items-center justify-between px-3 py-2 rounded-[10px] border text-[12px] tabular-nums transition-colors ${
              exceedsInput
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : Math.abs(remainingIn) < EPS
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-slate-50 border-slate-200 text-slate-700"
            }`}
          >
            <span className="font-semibold">
              {exceedsInput ? `⚠ ${t("exceeds_remaining")}` : t("remaining")}
            </span>
            <span className="font-bold">
              {curSymbol(curIn)}
              {fmt(Math.abs(remainingIn), curIn)} {curIn}
              {exceedsInput && " over"}
            </span>
          </div>
        )}

        <div className="space-y-3">
          {outputs.map((o, idx) => (
            <OutputRow
              key={o.id}
              output={o}
              index={idx}
              canRemove={outputs.length > 1}
              onUpdate={(patch) => updateOutput(o.id, patch)}
              onRemove={() => removeOutput(o.id)}
              onToggleManual={() => toggleManualRate(o.id)}
              curIn={curIn}
            />
          ))}
        </div>

        {/* Counterparty + referral */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 tracking-wide">
              {t("counterparty")}
            </label>
            <CounterpartySelect value={counterparty} onChange={setCounterparty} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 hover:border-slate-300 transition-colors self-end">
            <input
              type="checkbox"
              checked={referral}
              onChange={(e) => setReferral(e.target.checked)}
              className="w-4 h-4 rounded-[4px] accent-slate-900"
            />
            <UserPlus className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[13px] font-medium text-slate-700">{t("referral_client")}</span>
            {referral && (
              <span className="ml-auto text-[11px] font-bold text-indigo-600">
                -{settings.referralPct}%
              </span>
            )}
          </label>
        </div>

        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("comment_placeholder")}
          className="mt-3 w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-slate-400"
        />
      </div>

      {/* CTA */}
      <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4">
        {amtIn && outputs[0]?.amount && (
          <div className="mb-3 flex items-center justify-between text-[12px] px-1 flex-wrap gap-2">
            <div className="flex items-center gap-1.5 tabular-nums font-semibold text-slate-700 flex-wrap">
              <span>
                {fmt(parseFloat(amtIn), curIn)} {curIn}
              </span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span>
                {outputs
                  .map((o) => `${fmt(parseFloat(o.amount) || 0, o.currency)} ${o.currency}`)
                  .join(" + ")}
              </span>
            </div>
            {liveProfit !== 0 && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-bold text-[11px] tabular-nums ${
                  liveProfit >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                }`}
              >
                {liveProfit >= 0 ? "+" : ""}${fmt(liveProfit)}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {isEdit && (
            <button
              onClick={onCancel}
              className="px-4 py-3.5 rounded-[12px] bg-slate-100 text-slate-700 text-[14px] font-semibold hover:bg-slate-200 transition-colors"
            >
              {t("cancel")}
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`group relative flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-[12px] text-[15px] font-bold tracking-tight transition-all overflow-hidden ${
              canSubmit
                ? "bg-slate-900 text-white hover:bg-slate-800 shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45)] active:scale-[0.995]"
                : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
            }`}
          >
            <Zap className={`w-4 h-4 ${canSubmit ? "text-emerald-400" : "opacity-40"}`} />
            <span>{isEdit ? t("save_changes") : t("create_transaction")}</span>
            <span
              className={`ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border ${
                canSubmit
                  ? "bg-white/10 border-white/15 text-white/70"
                  : "bg-slate-200 border-slate-300 text-slate-400"
              }`}
            >
              ⌘ ↵
            </span>
          </button>
        </div>
        {!canSubmit && (
          <p className="text-[11px] text-slate-400 text-center mt-2">
            {!amtIn
              ? t("enter_amount_received")
              : !hasAllRates
              ? t("enter_exchange_rate")
              : !noSameCurrency
              ? t("currencies_must_differ")
              : exceedsInput
              ? t("exceeds_remaining")
              : t("complete_the_form")}
          </p>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// OutputRow — одна строка "выдать в валюте"
// ----------------------------------------
function OutputRow({ output, index, canRemove, onUpdate, onRemove, onToggleManual, curIn }) {
  const { t } = useTranslation();
  const { getRate } = useRates();
  const o = output;

  const otherCurrencies = CURRENCIES.filter((c) => c !== curIn);

  return (
    <div className="bg-slate-50/60 rounded-[14px] border border-slate-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-md px-1.5 py-0.5">
            #{index + 1}
          </span>
          <div className="inline-flex bg-slate-100 p-0.5 rounded-[8px] gap-0.5">
            {otherCurrencies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  // Если output на auto-rate — сразу подтягиваем курс для новой пары.
                  // Это нужно потому что useEffect зависит от [curIn, amtIn], но не от outputs,
                  // поэтому смена output.currency сама по себе не триггерит пересчёт.
                  const patch = { currency: c, touched: false };
                  if (!o.manualRate) {
                    const next = getRate(curIn, c);
                    if (next !== undefined) patch.rate = String(next);
                  }
                  onUpdate(patch);
                }}
                className={`px-2 py-0.5 text-[11px] font-bold rounded-[6px] transition-all ${
                  o.currency === c
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            aria-label={t("remove")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div
        className={`relative flex items-baseline gap-2 bg-white rounded-[12px] border-2 transition-all px-3 py-2.5 ${
          o.amount ? "border-slate-400" : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <span className="text-slate-400 text-[16px] font-semibold">{curSymbol(o.currency)}</span>
        <input
          type="text"
          inputMode="decimal"
          value={o.amount}
          onChange={(e) =>
            onUpdate({
              amount: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."),
              touched: true,
            })
          }
          placeholder="0"
          className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0 leading-none"
        />
        <span className="text-slate-400 text-[11px] font-bold tracking-wider">{o.currency}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div
          className={`flex-1 flex items-center rounded-[10px] border transition-all px-3 py-1.5 ${
            o.manualRate ? "bg-white border-slate-300" : "bg-slate-100 border-slate-200"
          }`}
        >
          <span className="text-[9px] font-bold text-slate-400 tracking-[0.15em] mr-2">{t("rate")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={o.rate}
            disabled={!o.manualRate}
            onChange={(e) =>
              onUpdate({
                rate: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."),
                touched: false,
              })
            }
            placeholder="0.00"
            className="flex-1 bg-transparent outline-none text-[13px] font-bold text-slate-900 placeholder:text-slate-300 tabular-nums disabled:text-slate-600 min-w-0"
          />
        </div>
        <button
          onClick={onToggleManual}
          className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-[11px] font-semibold border transition-colors ${
            o.manualRate
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300"
          }`}
          title={o.manualRate ? t("manual_rate") : t("auto_rate")}
        >
          {o.manualRate ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {o.manualRate ? "Manual" : "Auto"}
        </button>
      </div>
    </div>
  );
}
