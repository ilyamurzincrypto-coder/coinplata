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
  ArrowUpDown,
  Zap,
  Plus,
  Trash2,
  Lock,
  Unlock,
  UserPlus,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  Search,
  Wallet,
  Check,
} from "lucide-react";
import CurrencyTabs from "./ui/CurrencyTabs.jsx";
import Select from "./ui/Select.jsx";
import CounterpartySelect from "./CounterpartySelect.jsx";
import AccountSelect from "./AccountSelect.jsx";
import { officeName } from "../store/data.js";
import { useCurrencies } from "../store/currencies.jsx";
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
  computeRemaining,
  computeProfitFromRates,
  computeNetOutput,
} from "../utils/money.js";
import { useWallets } from "../store/wallets.jsx";
import { useRateHistory } from "../store/rateHistory.jsx";
import { useObligations } from "../store/obligations.jsx";
import { useOffices } from "../store/offices.jsx";
import {
  resolveTxHash,
  detectNetworkFromAddress,
  detectNetworkFromAccountName,
} from "../utils/resolveCrypto.js";

// Создать пустой output
const emptyOutput = (currency = "TRY") => ({
  id: `o_${Math.random().toString(36).slice(2, 8)}`,
  currency,
  amount: "",
  rate: "",
  manualRate: false,
  touched: false,
  accountId: "", // выбирается менеджером отдельно
  address: "",   // crypto recipient; используется только для crypto-валют
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
  const outputs = tx.outputs && tx.outputs.length
    ? tx.outputs.map((o, i) => ({
        id: `o_init_${i}`,
        currency: o.currency,
        amount: String(o.amount),
        rate: String(o.rate),
        manualRate: true,
        touched: true,
        accountId: o.accountId || "",
        address: o.address || "",
      }))
    : [
        {
          id: "o_init_0",
          currency: tx.curOut,
          amount: String(tx.amtOut),
          rate: String(tx.rate),
          manualRate: true,
          touched: true,
          accountId: tx.outAccountId || "",
          address: "",
        },
      ];
  return {
    curIn: tx.curIn,
    amtIn: String(tx.amtIn),
    outputs,
    counterparty: tx.counterparty || "",
    referral: !!tx.referral,
    comment: tx.comment || "",
    inTxHash: tx.inTxHash || "",
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
  const { addCounterparty, counterparties } = useTransactions();
  const { accountsByOffice, balanceOf, accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { upsertWallet, findWallet } = useWallets();
  const { snapshots: rateSnapshots } = useRateHistory();
  const { addObligation, openWeOweByOfficeCurrency } = useObligations();
  const { findOffice } = useOffices();

  // Fee-настройки per-office. Глобальный settings.minFeeUsd больше НЕ читается.
  // Если офис по какой-то причине не найден — безопасный фолбэк 10 USD.
  const office = findOffice(currentOffice);
  const minFeeUsd = Number.isFinite(Number(office?.minFeeUsd))
    ? Number(office.minFeeUsd)
    : 10;

  const isCryptoCode = (code) => currencyDict[code]?.type === "crypto";

  // Резолвим counterparty string → id, чтобы проверять принадлежность кошелька.
  // Для нового (несуществующего) имени вернём null — wallet conflict-проверка пропускается.
  const resolveClientId = (nickname) => {
    const nk = (nickname || "").trim().toLowerCase();
    if (!nk) return null;
    return counterparties.find((c) => c.nickname.toLowerCase() === nk)?.id || null;
  };

  // --- state ---
  const starter = useMemo(() => initFromTx(initialData), [initialData]);
  const [curIn, setCurIn] = useState(starter?.curIn || "USDT");
  const [amtIn, setAmtIn] = useState(starter?.amtIn || "");
  const [outputs, setOutputs] = useState(starter?.outputs || [emptyOutput("TRY")]);
  const [counterparty, setCounterparty] = useState(starter?.counterparty || "");
  const [referral, setReferral] = useState(starter?.referral || false);
  const [comment, setComment] = useState(starter?.comment || "");
  const [accountId, setAccountId] = useState(initialData?.accountId || "");
  const [isPending, setIsPending] = useState(initialData?.status === "pending");
  const [flash, setFlash] = useState(false);
  const [inTxHash, setInTxHash] = useState(starter?.inTxHash || "");

  // Wallet-конфликт для incoming (curIn crypto + txHash задан).
  const inWalletCheck = useMemo(() => {
    if (!isCryptoCode(curIn) || !inTxHash.trim()) return null;
    const resolved = resolveTxHash(inTxHash.trim());
    if (!resolved) return { status: "invalid_hash" };
    const existing = findWallet(resolved.from_address, resolved.network);
    const clientId = resolveClientId(counterparty);
    if (existing && clientId && existing.clientId !== clientId) {
      return { status: "conflict", resolved, existing };
    }
    if (existing && clientId && existing.clientId === clientId) {
      return { status: "known", resolved, existing };
    }
    return { status: "new", resolved };
  }, [curIn, inTxHash, counterparty, counterparties, findWallet]);

  // Список доступных счетов для IN currency.
  // ВСЕ офисы — current рендерится первой секцией, остальные — отмечаются как
  // interoffice transfer в AccountSelect. Картирован по active + currency.
  const availableAccounts = useMemo(
    () => accounts.filter((a) => a.active && a.currency === curIn),
    [accounts, curIn]
  );

  // Computed: суммарный баланс всех active аккаунтов офиса в заданной валюте.
  // Используется для "Current balance" (RECEIVED) и "Available" (OUTPUT).
  const officeCurrencyBalance = (currency) => {
    return accounts
      .filter((a) => a.officeId === currentOffice && a.currency === currency && a.active)
      .reduce((sum, a) => sum + balanceOf(a.id), 0);
  };

  // При смене валюты/офиса сбрасываем выбор если текущий account не подходит
  useEffect(() => {
    if (accountId && !availableAccounts.some((a) => a.id === accountId)) {
      setAccountId("");
    }
  }, [availableAccounts, accountId]);

  // --- auto-fill rates / amounts ---
  // ВАЖНО: первый output теперь заполняется как NET (gross − feeOut),
  // где feeUsd = office.minFeeUsd (per-office). "You receive" показывает финальную
  // сумму с учётом комиссии. computeRemaining ниже использует тот же fee baseline,
  // поэтому remaining = 0 и "exceeds_remaining" не ложно срабатывает.
  useEffect(() => {
    setOutputs((prev) =>
      prev.map((o, idx) => {
        if (o.manualRate) return o;
        const autoRate = getRate(curIn, o.currency);
        const nextRate = autoRate !== undefined ? String(autoRate) : o.rate;
        let nextAmount = o.amount;
        if (!o.touched) {
          const a = parseFloat(amtIn);
          const r = parseFloat(nextRate);
          if (!isNaN(a) && !isNaN(r) && a > 0 && r > 0) {
            // Первый output — net (минус fee). Остальные — gross (manager разделит
            // через Use remaining / manual input).
            let computed;
            if (idx === 0) {
              computed = computeNetOutput({
                amtIn: a,
                rate: r,
                feeUsd: minFeeUsd,
                outputCurrency: o.currency,
                getRate,
              });
            } else {
              computed = multiplyAmount(a, r, o.currency === "TRY" ? 0 : 2);
            }
            nextAmount = String(computed);
          } else {
            nextAmount = "";
          }
        }
        return { ...o, rate: nextRate, amount: nextAmount };
      })
    );
  }, [curIn, amtIn, getRate, minFeeUsd]);

  // --- derived: авто-расчёт прибыли от разницы между rate менеджера и рыночным ---
  // profitFromRates — маржа которую офис "зарабатывает" за счёт того что rate
  // на output хуже рыночного (в пользу офиса). Считается в USD.
  const profitFromRates = useMemo(() => {
    if (!amtIn) return 0;
    return computeProfitFromRates({
      amtIn,
      curIn,
      outputs,
      getRate,
    });
  }, [amtIn, curIn, outputs, getRate]);

  // effectiveFee = max(profitFromRates, minFeeUsd)  — minFeeUsd из офиса.
  // Если rate-margin меньше минималки (или отрицательная) — берём минималку.
  const effectiveFee = useMemo(() => {
    if (!amtIn || parseFloat(amtIn) <= 0) return 0;
    return Math.max(profitFromRates, minFeeUsd);
  }, [profitFromRates, minFeeUsd, amtIn]);

  // Показать ли пометку (min) — когда минималка победила rate-margin
  const minFeeApplied = useMemo(() => {
    if (!amtIn || parseFloat(amtIn) <= 0) return false;
    return profitFromRates < minFeeUsd;
  }, [profitFromRates, minFeeUsd, amtIn]);

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
  // Используем тот же fee-baseline (office.minFeeUsd), что применяется в auto-fill
  // для первого output. Это даёт remaining = 0 в стандартном сценарии
  // и устраняет ложное "exceeds_remaining".
  const remainingFeeUsd = minFeeUsd;
  const { remaining: remainingIn, feeInCurIn, exceedsInput } = useMemo(
    () =>
      computeRemaining({
        amtIn,
        curIn,
        outputs,
        fee: remainingFeeUsd,
        feeType: "USD",
        getRate,
      }),
    [amtIn, curIn, outputs, remainingFeeUsd, getRate]
  );
  const EPS = 0.01;

  // --- validation ---
  const hasAllRates = outputs.every((o) => o.rate && parseFloat(o.rate) > 0);
  const hasAllAmounts = outputs.every((o) => o.amount && parseFloat(o.amount) > 0);
  const noSameCurrency = outputs.every((o) => o.currency !== curIn);
  const hasClient = counterparty.trim().length > 0;
  const canSubmit =
    amtIn && hasAllRates && hasAllAmounts && noSameCurrency && !exceedsInput && hasClient;

  // --- account warnings (non-blocking) ---
  // Список объектов {kind, label} для рендера под Submit.
  const accountWarnings = useMemo(() => {
    const warnings = [];
    if (!accountId) {
      warnings.push({ kind: "in", label: t("account_missing_in") });
    }
    outputs.forEach((o, idx) => {
      if (!o.accountId) {
        warnings.push({
          kind: "out",
          label: t("account_missing_out")
            .replace("{n}", String(idx + 1))
            .replace("{cur}", o.currency),
        });
      }
    });
    return warnings;
  }, [accountId, outputs, t]);

  // --- submit ---
  const buildTx = (clientId) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    const nowIso = new Date().toISOString();
    const outputsClean = outputs.map((o) => {
      const addr = (o.address || "").trim();
      const plannedAmount = parseFloat(o.amount) || 0;
      const base = {
        currency: o.currency,
        amount: plannedAmount, // legacy, равно plannedAmount
        plannedAmount,
        actualAmount: 0, // будет заполнено в CashierPage.handleCreate по правилу
        plannedAt: nowIso,
        completedAt: null,
        rate: parseFloat(o.rate) || 0,
        accountId: o.accountId || "",
        address: addr,
      };
      // Crypto OUT с адресом → включаем send lifecycle.
      if (isCryptoCode(o.currency) && addr) {
        base.sendStatus = "pending_send";
        base.sendTxHash = "";
        const acc = accounts.find((a) => a.id === o.accountId);
        base.network = acc?.network || null;
      }
      return base;
    });

    // Профит: по умолчанию = эффективная комиссия в USD.
    // Минус реферальный бонус если referral=true.
    let profit = effectiveFee;
    if (referral) {
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn) || 0
          : multiplyAmount(parseFloat(amtIn) || 0, getRate(curIn, "USD") ?? 0, 2);
      const refBonus = percentOf(inUsd, settings.referralPct, 2);
      profit = Math.round((profit - refBonus) * 100) / 100;
    }

    // Status:
    //   — isPending checkbox → "pending" (manual pending, менеджер сам завершит)
    //   — crypto curIn без ручного TX hash → "checking" (polling auto-confirm)
    //   — иначе → "completed" (fiat или crypto с manual override)
    const status = isPending
      ? "pending"
      : isCryptoCode(curIn) && !inTxHash.trim()
      ? "checking"
      : "completed";

    const base = {
      time: `${hh}:${mm}`,
      date: "Apr 20",
      officeId: currentOffice,
      type: "EXCHANGE",
      curIn,
      amtIn: parseFloat(amtIn),
      outputs: outputsClean,
      curOut: outputsClean[0].currency,
      amtOut: outputsClean[0].amount,
      rate: outputsClean[0].rate,
      fee: Math.round(effectiveFee * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      manager: currentUser.name,
      managerId: currentUser.id,
      counterparty,
      counterpartyId: clientId || null, // для polling-матчинга + wallet ownership
      referral,
      comment,
      accountId,
      status,
      createdAtMs: Date.now(),
      rateSnapshotId: rateSnapshots[0]?.id || null,
      // IN side — planned / actual / completed даты для multi-day tracking.
      inPlannedAmount: parseFloat(amtIn) || 0,
      inActualAmount: 0, // заполнится в CashierPage по правилу
      inPlannedAt: nowIso,
      inCompletedAt: null,
    };

    if (mode === "edit" && initialData) {
      // Edit: сохраняем лайф-цикл полей per-leg (actualAmount / completedAt /
      // plannedAt / sendStatus / sendTxHash) и IN-стороны — они не в UI.
      // Иначе edit ранее полностью сбрасывал прогресс completed сделок.
      const preservedOuts = (base.outputs || []).map((newLeg, i) => {
        const oldLeg = (initialData.outputs || [])[i];
        if (!oldLeg) return newLeg;
        return {
          ...newLeg,
          actualAmount: oldLeg.actualAmount ?? newLeg.actualAmount,
          completedAt: oldLeg.completedAt ?? newLeg.completedAt,
          plannedAt: oldLeg.plannedAt ?? newLeg.plannedAt,
          sendStatus: oldLeg.sendStatus ?? newLeg.sendStatus,
          sendTxHash: oldLeg.sendTxHash ?? newLeg.sendTxHash,
        };
      });
      return {
        ...initialData,
        ...base,
        outputs: preservedOuts,
        inActualAmount: initialData.inActualAmount ?? base.inActualAmount,
        inCompletedAt: initialData.inCompletedAt ?? base.inCompletedAt,
        inPlannedAt: initialData.inPlannedAt ?? base.inPlannedAt,
      };
    }
    return { ...base, id: Date.now() };
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    // СНАЧАЛА resolve/create counterparty — нужен clientId для tx (monitoring будет
    // использовать tx.counterpartyId при auto-confirm для привязки wallet).
    const cp = addCounterparty(counterparty);
    const clientId = cp?.id || null;

    const tx = buildTx(clientId);

    // Auto-detect wallets. upsertWallet сам справляется с дублями и конфликтами —
    // в случае conflict (другой клиент) ничего не пишется, UI уже показал warning.
    if (clientId) {
      // INCOMING: из txHash → from_address + network (stub-резолвер).
      if (isCryptoCode(curIn) && inTxHash.trim()) {
        const resolved = resolveTxHash(inTxHash.trim());
        if (resolved) {
          upsertWallet({
            address: resolved.from_address,
            network: resolved.network,
            clientId,
          });
        }
      }
      // OUTGOING: per-output recipient address.
      outputs.forEach((o) => {
        if (!isCryptoCode(o.currency)) return;
        const addr = (o.address || "").trim();
        if (!addr) return;
        let net = detectNetworkFromAddress(addr);
        if (!net && o.accountId) {
          const acc = accounts.find((a) => a.id === o.accountId);
          if (acc) net = detectNetworkFromAccountName(acc.name);
        }
        if (!net) return;
        upsertWallet({ address: addr, network: net, clientId });
      });
    }

    setFlash(true);
    setTimeout(() => setFlash(false), 600);
    onSubmit?.(tx);
    if (mode === "create") {
      // reset
      setAmtIn("");
      setOutputs([emptyOutput("TRY")]);
      setCounterparty("");
      setReferral(false);
      setComment("");
      setInTxHash("");
    }
  };

  // --- live profit (для summary) ---
  const liveProfit = useMemo(() => {
    if (!amtIn || !effectiveFee) return 0;
    let p = effectiveFee;
    if (referral) {
      const inUsd =
        curIn === "USD"
          ? parseFloat(amtIn) || 0
          : multiplyAmount(parseFloat(amtIn) || 0, getRate(curIn, "USD") ?? 0, 2);
      p -= percentOf(inUsd, settings.referralPct, 2);
    }
    return Math.round(p * 100) / 100;
  }, [effectiveFee, referral, amtIn, curIn, getRate, settings.referralPct]);

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

      {/* CLIENT — обязательное поле, всегда первое */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center">
            <UserPlus className="w-3 h-3 text-white" />
          </div>
          <span className="text-[11px] font-bold tracking-[0.15em] text-indigo-700 uppercase">
            Client
          </span>
          <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider">
            required
          </span>
        </div>
        <div
          className={`rounded-[12px] border-2 transition-colors ${
            counterparty.trim()
              ? "border-indigo-200 bg-indigo-50/30"
              : "border-amber-300 bg-amber-50/40"
          } p-2`}
        >
          <CounterpartySelect value={counterparty} onChange={setCounterparty} />
        </div>
      </div>

      {/* RECEIVED */}
      <div className="px-5 pt-5">
        <div className="flex items-center mb-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <ArrowDown className="w-3 h-3 text-white" />
            </div>
            <span className="text-[11px] font-bold tracking-[0.15em] text-emerald-700 uppercase">
              {t("you_received")}
            </span>
          </div>
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
          <span className="text-[11px] text-slate-400">{t("current_balance")}</span>
          <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
            {curSymbol(curIn)}
            {fmt(officeCurrencyBalance(curIn), curIn)} {curIn}
          </span>
        </div>

        {/* Deposit to account — searchable dropdown с заметной рамкой состояния */}
        {availableAccounts.length > 0 && (
          <div
            className={`mt-3 p-2.5 rounded-[12px] border-2 transition-colors ${
              accountId
                ? "bg-emerald-50/50 border-emerald-300"
                : "bg-amber-50/40 border-amber-300"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-bold text-slate-600 tracking-[0.15em] uppercase">
                {t("deposit_to")}
              </div>
              {accountId ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700">
                  <Check className="w-2.5 h-2.5" />
                  {t("account_selected")}
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-amber-700">
                  {t("select_account_warning")}
                </span>
              )}
            </div>
            <AccountSelect
              accounts={availableAccounts}
              value={accountId}
              onChange={setAccountId}
              placeholder={t("select_account")}
              currentOfficeId={currentOffice}
            />
          </div>
        )}

        {/* Incoming crypto — manual TX hash override.
            НЕ обязателен: blockchain monitoring сам найдёт входящую tx и подтвердит сделку.
            Ввод хеша = быстрый ручной confirm (минует status=checking). */}
        {isCryptoCode(curIn) && (
          <details className="mt-3 group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-slate-500 tracking-[0.15em] uppercase select-none hover:text-slate-700">
              <ChevronDown className="w-3 h-3 transition-transform group-open:-rotate-180" />
              Manual TX hash · optional
            </summary>
            <div className="mt-2">
              <input
                type="text"
                value={inTxHash}
                onChange={(e) => setInTxHash(e.target.value.trim())}
                placeholder="0x… or TRON 64-hex"
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[12px] font-mono text-slate-700 tracking-tight outline-none transition-colors placeholder:text-slate-400"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Leave empty — polling will auto-confirm the deal when the incoming tx arrives.
              </p>
              {inWalletCheck && (
                <WalletHint
                  status={inWalletCheck.status}
                  address={inWalletCheck.resolved?.from_address}
                  network={inWalletCheck.resolved?.network}
                  conflict={inWalletCheck.existing}
                  counterparties={counterparties}
                />
              )}
            </div>
          </details>
        )}
      </div>

      {/* Reverse rates button (swaps RECEIVED ↔ first ISSUED).
          Текстовая кнопка вместо непонятной иконки — действие должно читаться. */}
      <div className="flex justify-center my-3 relative z-10">
        {(() => {
          const disabled = !amtIn || !outputs[0]?.amount || outputs.length > 1;
          const title =
            outputs.length > 1
              ? "Unavailable when there are multiple outputs"
              : !amtIn || !outputs[0]?.amount
              ? "Enter amounts first"
              : "Swap received and issued";
          return (
            <button
              type="button"
              onClick={handleReverse}
              disabled={disabled}
              title={title}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition-colors ${
                disabled
                  ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-white border-slate-300 text-slate-700 hover:border-slate-900 hover:text-slate-900"
              }`}
            >
              <ArrowUpDown className="w-3 h-3" />
              Reverse rates
            </button>
          );
        })()}
      </div>
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
              remainingIn={remainingIn}
              availableInCurrency={officeCurrencyBalance(o.currency)}
              currentOffice={currentOffice}
              counterpartyId={resolveClientId(counterparty)}
            />
          ))}
        </div>

        {/* Referral toggle (counterparty вынесен в верх формы) */}
        <label className="mt-4 flex items-center gap-2 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-[10px] px-3 py-2 hover:border-slate-300 transition-colors">
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

        {/* Pending toggle */}
        <label
          className={`mt-3 flex items-center gap-2 cursor-pointer select-none rounded-[10px] px-3 py-2 border transition-colors ${
            isPending
              ? "bg-amber-50 border-amber-300"
              : "bg-slate-50 border-slate-200 hover:border-slate-300"
          }`}
        >
          <input
            type="checkbox"
            checked={isPending}
            onChange={(e) => setIsPending(e.target.checked)}
            className="w-4 h-4 rounded-[4px] accent-amber-600"
          />
          <span className={`text-[13px] font-medium ${isPending ? "text-amber-800" : "text-slate-700"}`}>
            {t("create_as_pending")}
          </span>
          {isPending && (
            <span className="ml-auto text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
              {t("pending_hint")}
            </span>
          )}
        </label>

        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("comment_placeholder")}
          className="mt-3 w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-slate-400"
        />
      </div>

      {/* SUMMARY: You will receive / Rate / Our fee */}
      {amtIn && outputs[0]?.amount && outputs[0]?.rate && (
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              {t("summary_you_receive")}
            </span>
            <span className="text-[13px] font-bold tabular-nums text-slate-900">
              {outputs
                .map((o) => `${fmt(parseFloat(o.amount) || 0, o.currency)} ${o.currency}`)
                .join(" + ")}
            </span>
          </div>
          {outputs.length === 1 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                {t("summary_rate")}
              </span>
              <span className="text-[13px] font-semibold tabular-nums text-slate-700">
                {parseFloat(outputs[0].rate).toLocaleString("en-US", { maximumFractionDigits: 6 })}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              {t("summary_our_fee")}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold tabular-nums text-amber-700">
              ${fmt(effectiveFee)}
              {minFeeApplied && (
                <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
                  {t("summary_min_label")}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

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
            {!hasClient
              ? "Select a client to continue"
              : !amtIn
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

        {/* Account warnings — не блокируют submit, но заметны */}
        {accountWarnings.length > 0 && (
          <div className="mt-3 p-2.5 rounded-[10px] bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 mb-1.5">
              <AlertCircle className="w-3 h-3" />
              {t("account_warning_count").replace("{n}", String(accountWarnings.length))}
            </div>
            <ul className="space-y-0.5 ml-4">
              {accountWarnings.map((w, i) => (
                <li key={i} className="text-[11px] text-amber-700 list-disc">
                  {w.label}
                </li>
              ))}
            </ul>
            <div className="mt-1.5 text-[10px] text-amber-600 italic">
              Balances won't be updated for missing accounts.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// OutputRow — одна строка "выдать в валюте"
// ----------------------------------------
function OutputRow({
  output,
  index,
  canRemove,
  onUpdate,
  onRemove,
  onToggleManual,
  curIn,
  remainingIn,
  availableInCurrency,
  currentOffice,
  counterpartyId,
}) {
  const { t } = useTranslation();
  const { getRate } = useRates();
  const { accountsByOffice, accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { findWallet } = useWallets();
  const { counterparties } = useTransactions();
  const o = output;
  const isCrypto = currencyDict[o.currency]?.type === "crypto";

  // Check wallet status for current address + detected network
  const walletCheck = useMemo(() => {
    if (!isCrypto) return null;
    const addr = (o.address || "").trim();
    if (!addr) return null;
    let net = detectNetworkFromAddress(addr);
    if (!net && o.accountId) {
      const acc = accounts.find((a) => a.id === o.accountId);
      if (acc) net = detectNetworkFromAccountName(acc.name);
    }
    if (!net) return { status: "unknown_network", address: addr };
    const existing = findWallet(addr, net);
    if (existing && counterpartyId && existing.clientId !== counterpartyId) {
      return { status: "conflict", address: addr, network: net, existing };
    }
    if (existing && counterpartyId && existing.clientId === counterpartyId) {
      return { status: "known", address: addr, network: net, existing };
    }
    return { status: "new", address: addr, network: net };
  }, [isCrypto, o.address, o.accountId, accounts, findWallet, counterpartyId]);

  const otherCurrencies = CURRENCIES.filter((c) => c !== curIn);

  // Список счетов для валюты output'а — из ВСЕХ офисов. Current office сверху,
  // остальные помечаются как interoffice transfer внутри AccountSelect.
  const outAccounts = useMemo(
    () => accounts.filter((a) => a.active && a.currency === o.currency),
    [accounts, o.currency]
  );

  // При смене валюты output — сбрасываем accountId если он больше не подходит
  useEffect(() => {
    if (o.accountId && !outAccounts.some((a) => a.id === o.accountId)) {
      onUpdate({ accountId: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.currency, outAccounts.length]);

  // Available warning: если сумма вывода больше, чем суммарный баланс аккаунтов офиса в этой валюте
  const outAmount = parseFloat(o.amount) || 0;
  const insufficient =
    availableInCurrency !== undefined && outAmount > 0 && outAmount > availableInCurrency;

  // "Use remaining" — подставить остаток (remainingIn в curIn) через текущий курс output'а
  const canUseRemaining =
    index > 0 &&
    remainingIn > 0.01 &&
    parseFloat(o.rate) > 0;

  const suggestedAmount =
    canUseRemaining ? remainingIn * parseFloat(o.rate) : 0;

  const handleUseRemaining = () => {
    if (!canUseRemaining) return;
    // Округляем до точности валюты (TRY=0, всё остальное=2)
    const precision = o.currency === "TRY" ? 0 : 2;
    const rounded = Math.floor(suggestedAmount * Math.pow(10, precision)) / Math.pow(10, precision);
    onUpdate({ amount: String(rounded), touched: true });
  };

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

      {/* Account selector for this output */}
      <div className="mt-2">
        <div className="text-[9px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-1">
          {t("deposit_from")}
        </div>
        {outAccounts.length === 0 ? (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {t("no_accounts_currency")} {o.currency}
          </div>
        ) : (
          <AccountSelect
            accounts={outAccounts}
            value={o.accountId || ""}
            onChange={(id) => onUpdate({ accountId: id })}
            placeholder={t("select_account")}
            currentOfficeId={currentOffice}
          />
        )}
      </div>

      {/* Recipient address — только для crypto */}
      {isCrypto && (
        <div className="mt-2">
          <div className="text-[9px] font-bold text-slate-500 tracking-[0.15em] uppercase mb-1">
            Recipient address
          </div>
          <input
            type="text"
            value={o.address || ""}
            onChange={(e) => onUpdate({ address: e.target.value.trim() })}
            placeholder="0x… or TRON address"
            className="w-full bg-white border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[12px] font-mono text-slate-700 tracking-tight outline-none transition-colors placeholder:text-slate-400"
          />
          {walletCheck && (
            <WalletHint
              status={walletCheck.status}
              address={walletCheck.address}
              network={walletCheck.network}
              conflict={walletCheck.existing}
              counterparties={counterparties}
            />
          )}
        </div>
      )}

      {/* Footer line: available warning + use-remaining button */}
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        {availableInCurrency !== undefined ? (
          <div
            className={`inline-flex items-center gap-1 text-[10px] font-medium tabular-nums ${
              insufficient ? "text-amber-700" : "text-slate-500"
            }`}
          >
            {insufficient && <AlertCircle className="w-3 h-3" />}
            <span>
              {t("available")}:{" "}
              <span className="font-bold">
                {curSymbol(o.currency)}
                {fmt(availableInCurrency, o.currency)} {o.currency}
              </span>
            </span>
          </div>
        ) : (
          <div />
        )}

        {canUseRemaining && (
          <button
            type="button"
            onClick={handleUseRemaining}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-[8px] px-2 py-1 transition-colors"
            title="Convert remaining amount here"
          >
            <Zap className="w-3 h-3" />
            {t("use_remaining")} · {curSymbol(o.currency)}
            {fmt(suggestedAmount, o.currency)}
          </button>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------
// WalletHint — подсказка под crypto-address input.
// ----------------------------------------
//   new             — новый кошелёк, будет записан
//   known           — уже есть у этого клиента; usage++
//   conflict        — уже принадлежит другому клиенту (не тронем)
//   unknown_network — не смогли определить network (не запишем)
//   invalid_hash    — txHash не распознан
function WalletHint({ status, address, network, conflict, counterparties }) {
  if (status === "invalid_hash") {
    return (
      <div className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        Could not parse tx hash
      </div>
    );
  }
  if (status === "unknown_network") {
    return (
      <div className="mt-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
        Network not detected — wallet won't be saved
      </div>
    );
  }
  if (status === "conflict") {
    const other = counterparties?.find((c) => c.id === conflict?.clientId);
    return (
      <div className="mt-1.5 text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-2 py-1 inline-flex items-center gap-1">
        <AlertCircle className="w-3 h-3" />
        <span>
          Wallet used by another client
          {other ? <> · <span className="font-semibold">{other.nickname}</span></> : null}
        </span>
      </div>
    );
  }
  if (status === "known") {
    return (
      <div className="mt-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 inline-flex items-center gap-1">
        <Check className="w-3 h-3" />
        Known wallet · {network}
      </div>
    );
  }
  // new
  return (
    <div className="mt-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
      New wallet · {network} — will be linked on submit
    </div>
  );
}
