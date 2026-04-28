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

import React, { useState, useEffect, useMemo, useRef } from "react";
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
  Clock,
  ChevronUp,
  SlidersHorizontal,
} from "lucide-react";
import CurrencyTabs from "./ui/CurrencyTabs.jsx";
import Select from "./ui/Select.jsx";
import CounterpartySelect from "./CounterpartySelect.jsx";
import AccountSelect from "./AccountSelect.jsx";
import DealTemplatesBar from "./DealTemplatesBar.jsx";
import { recordDealUsage } from "../utils/dealTemplates.js";
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

  // Восстанавливаем pending-флаги для edit-mode, чтобы edit pending/partial
  // сделки не сбрасывал её состояние.
  const outs = tx.outputs || [];
  const allDeferred = outs.length > 0 && outs.every(
    (o) => (o.actualAmount ?? 0) === 0 && (o.plannedAmount ?? o.amount) > 0
  );
  const anyPartial = outs.some(
    (o) =>
      (o.actualAmount ?? 0) > 0 &&
      (o.actualAmount ?? 0) < (o.plannedAmount ?? o.amount)
  );
  const partialPayNow = {};
  if (anyPartial) {
    outs.forEach((o, i) => {
      partialPayNow[`o_init_${i}`] = String(o.actualAmount ?? 0);
    });
  }

  // Plannedat в datetime-local формате (YYYY-MM-DDTHH:MM)
  let plannedLocal = "";
  if (tx.inPlannedAt) {
    try {
      const d = new Date(tx.inPlannedAt);
      const pad = (n) => String(n).padStart(2, "0");
      plannedLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {}
  }

  return {
    curIn: tx.curIn,
    amtIn: String(tx.amtIn),
    outputs,
    counterparty: tx.counterparty || "",
    referral: !!tx.referral,
    comment: tx.comment || "",
    inTxHash: tx.inTxHash || "",
    // pending/partial restoration
    deferredIn: (tx.inActualAmount ?? 0) === 0 && tx.status === "pending" && !tx.accountId,
    deferredOut: allDeferred && !anyPartial,
    partialMode: anyPartial,
    partialPayNow,
    plannedLocal,
    // applyMinFee: явно сохранённый флаг → используем; иначе true
    // (исторический default — все старые сделки создавались с min cap).
    applyMinFee: typeof tx.applyMinFee === "boolean" ? tx.applyMinFee : true,
  };
}

export default function ExchangeForm({
  mode = "create",
  currentOffice,
  initialData = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const { t } = useTranslation();
  const { getRate: getRateRaw } = useRates();
  // Оборачиваем getRate так, чтобы использовался office override (0021).
  // Если есть override для (currentOffice, from, to) — берём его, иначе global.
  const getRate = React.useCallback(
    (from, to) => getRateRaw(from, to, currentOffice),
    [getRateRaw, currentOffice]
  );
  const { currentUser, settings } = useAuth();
  const { addCounterparty, counterparties } = useTransactions();
  const { accountsByOffice, balanceOf, accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { upsertWallet, findWallet } = useWallets();
  const { snapshots: rateSnapshots } = useRateHistory();
  const { addObligation, openWeOweByOfficeCurrency } = useObligations();
  const { findOffice, activeOffices } = useOffices();

  // Балансы всех офисов для suggestion "в другом офисе есть нужная валюта".
  // Map<"officeId_currency", balance>. Считается из active + currency accounts.
  const officeBalancesByCurrency = useMemo(() => {
    const m = new Map();
    accounts.forEach((a) => {
      if (!a.active) return;
      const key = `${a.officeId}_${a.currency}`;
      m.set(key, (m.get(key) || 0) + balanceOf(a.id));
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, balanceOf]);

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
  // В create mode пытаемся восстановить draft из sessionStorage — это
  // позволяет форме переживать переходы на другие вкладки (Clients/Capital).
  // В edit mode приоритет у initialData (мы редактируем конкретную сделку).
  const DRAFT_KEY = "coinplata.exchangeDraft";
  const draft = useMemo(() => {
    if (mode !== "create" || initialData) return null;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }, [mode, initialData]);

  const starter = useMemo(() => initFromTx(initialData), [initialData]);
  const [curIn, setCurIn] = useState(starter?.curIn || draft?.curIn || "USDT");
  const [amtIn, setAmtIn] = useState(starter?.amtIn || draft?.amtIn || "");
  const [outputs, setOutputs] = useState(
    starter?.outputs || draft?.outputs || [emptyOutput("TRY")]
  );
  const [counterparty, setCounterparty] = useState(
    starter?.counterparty || draft?.counterparty || ""
  );
  const [referral, setReferral] = useState(
    starter?.referral ?? draft?.referral ?? false
  );
  const [comment, setComment] = useState(starter?.comment || draft?.comment || "");
  const [accountId, setAccountId] = useState(
    initialData?.accountId || draft?.accountId || ""
  );
  const [isPending, setIsPending] = useState(
    initialData?.status === "pending" || draft?.isPending || false
  );
  const [flash, setFlash] = useState(false);
  const [inTxHash, setInTxHash] = useState(
    starter?.inTxHash || draft?.inTxHash || ""
  );
  // Deferred IN = "клиент заплатит позже" — создаёт they_owe obligation.
  // В edit-mode читается из starter (по initialData), иначе из draft.
  const [deferredIn, setDeferredIn] = useState(
    starter?.deferredIn ?? draft?.deferredIn ?? false
  );
  const [deferredOut, setDeferredOut] = useState(
    starter?.deferredOut ?? draft?.deferredOut ?? false
  );
  const [partialMode, setPartialMode] = useState(
    starter?.partialMode ?? draft?.partialMode ?? false
  );
  const [partialPayNow, setPartialPayNow] = useState(
    starter?.partialPayNow || draft?.partialPayNow || {}
  );
  const [plannedLocal, setPlannedLocal] = useState(
    starter?.plannedLocal || draft?.plannedLocal || ""
  );
  // applyMinFee: галочка "применить min fee офиса" (по умолчанию on).
  // Когда off — fee = profitFromRates (только spread-маржа), без cap.
  // Это нужно для маленьких сделок где менеджер хочет уступить min fee
  // клиенту, например по договорённости.
  const [applyMinFee, setApplyMinFee] = useState(
    starter?.applyMinFee ?? draft?.applyMinFee ?? true
  );
  // Conditions block — collapsable. По умолчанию свернут, при mount
  // раскрывается если в starter/draft уже есть активные условия (edit
  // существующей pending сделки или resume draft с заданным planned date).
  const [conditionsOpen, setConditionsOpen] = useState(() => {
    const src = starter || draft || {};
    return !!(
      src.deferredIn ||
      src.deferredOut ||
      src.partialMode ||
      src.referral ||
      src.isPending ||
      src.plannedLocal
    );
  });

  // Сохраняем draft в sessionStorage на каждое изменение ключевых полей.
  // Только для create mode — в edit draft не нужен.
  useEffect(() => {
    if (mode !== "create") return;
    try {
      // Проверяем есть ли хоть какой-то пользовательский ввод — нет смысла
      // писать пустой draft. Это предотвращает "пустой resume" при повторных
      // mount'ах без ввода.
      const hasInput =
        amtIn || counterparty || comment || inTxHash ||
        (outputs && outputs.some((o) => o.amount || o.rate || o.address));
      if (!hasInput) {
        sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      const payload = {
        curIn,
        amtIn,
        outputs,
        counterparty,
        referral,
        comment,
        accountId,
        isPending,
        inTxHash,
        deferredIn,
        deferredOut,
        partialMode,
        partialPayNow,
        plannedLocal,
        applyMinFee,
        savedAt: Date.now(),
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch {
      // quota exceeded / disabled — silent fail
    }
  }, [mode, curIn, amtIn, outputs, counterparty, referral, comment, accountId, isPending, inTxHash, deferredIn, deferredOut, partialMode, partialPayNow, plannedLocal, applyMinFee]);

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

  // При смене IN currency — пара меняется, user-pick chip'а становится
  // неактуален. Сбрасываем ratePinned у всех outputs до того как main
  // effect ниже подхватит новые autoRate. useEffect'ы внутри одного
  // коммита React обрабатывает в порядке объявления.
  useEffect(() => {
    setOutputs((prev) =>
      prev.map((o) => ({ ...o, ratePinned: false, rateSource: "auto" }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curIn]);

  // --- auto-fill rates / amounts ---
  // ВАЖНО: первый output теперь заполняется как NET (gross − feeOut),
  // где feeUsd = office.minFeeUsd (per-office). "You receive" показывает финальную
  // сумму с учётом комиссии. computeRemaining ниже использует тот же fee baseline,
  // поэтому remaining = 0 и "exceeds_remaining" не ложно срабатывает.
  //
  // rateSource (новая модель, заменяет ratePinned):
  //   "auto"               — следуем за getRate(currentOffice). Default.
  //   "global"             — фиксированный global pair (без office override).
  //   "office:<UUID>"      — фиксированный rate другого офиса (other-office chip).
  //   undefined / "auto"   — то же что auto.
  // manualRate=true — отдельный путь (юзер вводит руками), rateSource игнорируется.
  //
  // Раньше ratePinned=true замораживал rate — chips показывали актуальные значения,
  // а сам input "застревал" на момент клика. Теперь pinned-источник тоже
  // следует за обновлениями системы (юзер кликнул Global → когда global pair
  // меняется в Settings, rate автоматически синхронизируется).
  // Hard-coded "разумные диапазоны" для известных пар. Hard guard от
  // инвертированных rate в БД — не зависит от состояния других pairs
  // (USD-triangulation может сломаться если USD↔X тоже кривые).
  // Если actual rate вне диапазона, и инверсия попадает в диапазон —
  // используем инверсию. Курсы примерные, запас широкий.
  const correctRate = React.useCallback((rawRate, from, to) => {
    if (!Number.isFinite(rawRate) || rawRate <= 0) return rawRate;
    if (from === to) return rawRate;
    const RANGES = {
      USDT_USD: [0.9, 1.1], USD_USDT: [0.9, 1.1],
      USDT_EUR: [0.7, 1.1], EUR_USDT: [0.9, 1.4],
      USDT_GBP: [0.6, 1.0], GBP_USDT: [1.0, 1.7],
      USDT_CHF: [0.7, 1.1], CHF_USDT: [0.9, 1.4],
      USDT_TRY: [20, 80],   TRY_USDT: [0.012, 0.05],
      USDT_RUB: [50, 150],  RUB_USDT: [0.006, 0.02],
      USD_EUR: [0.7, 1.1],  EUR_USD: [0.9, 1.4],
      USD_GBP: [0.6, 1.0],  GBP_USD: [1.0, 1.7],
      USD_CHF: [0.7, 1.1],  CHF_USD: [0.9, 1.4],
      USD_TRY: [20, 80],    TRY_USD: [0.012, 0.05],
      USD_RUB: [50, 150],   RUB_USD: [0.006, 0.02],
      EUR_TRY: [25, 90],    TRY_EUR: [0.011, 0.04],
      EUR_GBP: [0.7, 1.0],  GBP_EUR: [1.0, 1.4],
      EUR_CHF: [0.85, 1.1], CHF_EUR: [0.9, 1.2],
    };
    const range = RANGES[`${from}_${to}`];
    if (!range) return rawRate;
    const [min, max] = range;
    if (rawRate >= min && rawRate <= max) return rawRate;
    const inverted = 1 / rawRate;
    if (inverted >= min && inverted <= max) return inverted;
    return rawRate;
  }, []);

  // Corrected getRate — оборачивает обычный getRate авто-инверсией.
  // Используется для всех расчётов (auto-fill, profitFromRates,
  // computeNetOutput) — гарантирует что бизнес-логика работает с
  // правильным rate даже когда в БД лежит инвертированное значение.
  const correctedGetRate = React.useCallback(
    (from, to) => correctRate(getRate(from, to), from, to),
    [getRate, correctRate]
  );

  const resolveAutoRate = React.useCallback(
    (output) => {
      const src = output.rateSource;
      let raw;
      if (src === "global") {
        raw = getRateRaw(curIn, output.currency, null);
      } else if (typeof src === "string" && src.startsWith("office:")) {
        const oid = src.slice(7);
        raw = getRateRaw(curIn, output.currency, oid);
      } else {
        raw = getRate(curIn, output.currency); // auto = текущий office
      }
      // Применяем runtime correction — защита от кривых rate в БД.
      return correctRate(raw, curIn, output.currency);
    },
    [getRate, getRateRaw, curIn, correctRate]
  );
  useEffect(() => {
    setOutputs((prev) =>
      prev.map((o, idx) => {
        if (o.manualRate) return o;
        const autoRate = resolveAutoRate(o);
        const nextRate =
          autoRate !== undefined && Number.isFinite(autoRate)
            ? String(autoRate)
            : o.rate;
        // Пересчёт amount: либо output не touched, либо rate реально
        // изменился (auto-обновление курса в системе) — в обоих случаях
        // amount должен соответствовать новому rate.
        const rateChanged = nextRate !== o.rate;
        let nextAmount = o.amount;
        let nextTouched = o.touched;
        if (!o.touched || rateChanged) {
          const a = parseFloat(amtIn);
          const r = parseFloat(nextRate);
          if (!isNaN(a) && !isNaN(r) && a > 0 && r > 0) {
            let computed;
            if (idx === 0) {
              computed = computeNetOutput({
                amtIn: a,
                rate: r,
                feeUsd: applyMinFee ? minFeeUsd : 0,
                outputCurrency: o.currency,
                getRate: correctedGetRate,
              });
            } else {
              computed = multiplyAmount(a, r, o.currency === "TRY" ? 0 : 2);
            }
            nextAmount = String(computed);
            // После авто-пересчёта снимаем touched чтобы amtIn-изменения
            // снова пересчитывали amount автоматически.
            if (rateChanged) nextTouched = false;
          } else if (!o.touched) {
            nextAmount = "";
          }
        }
        return { ...o, rate: nextRate, amount: nextAmount, touched: nextTouched };
      })
    );
  }, [curIn, amtIn, getRate, getRateRaw, minFeeUsd, applyMinFee, resolveAutoRate, correctedGetRate]);

  // FORCE recompute output[0] amount + rate при ЛЮБОМ изменении.
  // Минует блокировки touched. manualRate=true — оставляем (там юзер
  // ввёл свой rate, не трогаем).
  //
  // КЛЮЧЕВОЕ: rate ТОЖЕ пересчитываем через correctedGetRate.
  // Раньше использовали o.rate из state — там мог сидеть raw 1.18
  // (из draft / предыдущей сессии) → 1000 × 1.18 = 1180 даже после
  // всех auto-corrections. Теперь rate всегда свежий и corrected.
  useEffect(() => {
    setOutputs((prev) =>
      prev.map((o, idx) => {
        if (idx !== 0) return o;
        if (o.manualRate) return o;
        const a = parseFloat(amtIn);
        if (!Number.isFinite(a) || a <= 0) return o;
        // Rate берём ИЗ get-rate-функции, корректируем через correctRate.
        // Не доверяем o.rate — он может быть stale из draft.
        const freshRaw = getRate(curIn, o.currency);
        const freshCorrected = correctRate(freshRaw, curIn, o.currency);
        if (!Number.isFinite(freshCorrected) || freshCorrected <= 0) return o;
        const computed = computeNetOutput({
          amtIn: a,
          rate: freshCorrected,
          feeUsd: applyMinFee ? minFeeUsd : 0,
          outputCurrency: o.currency,
          getRate: correctedGetRate,
        });
        const computedStr = String(computed);
        const rateStr = String(freshCorrected);
        if (computedStr === o.amount && rateStr === o.rate) return o;
        return { ...o, amount: computedStr, rate: rateStr, touched: false };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyMinFee, amtIn, minFeeUsd, curIn]);

  // --- derived: авто-расчёт прибыли от разницы между rate менеджера и рыночным ---
  // profitFromRates — маржа которую офис "зарабатывает" за счёт того что rate
  // на output хуже рыночного (в пользу офиса). Считается в USD.
  // ВАЖНО: используем correctedGetRate (объявлен выше) — иначе если в БД
  // rate инвертирован (1.175 вместо 0.85), margin вычисляется как разница
  // 1.175 vs 0.85 → фиктивная комиссия 225$.
  const profitFromRates = useMemo(() => {
    if (!amtIn) return 0;
    return computeProfitFromRates({
      amtIn,
      curIn,
      outputs,
      getRate: correctedGetRate,
    });
  }, [amtIn, curIn, outputs, correctedGetRate]);

  // effectiveFee:
  //   applyMinFee=true  → max(profitFromRates, minFeeUsd) — min cap офиса
  //   applyMinFee=false → max(profitFromRates, 0)         — только spread-маржа
  // Когда галочка off — комиссия может быть < минималки или 0
  // (если spread не покрыл и пользователь решил не брать min).
  const effectiveFee = useMemo(() => {
    if (!amtIn || parseFloat(amtIn) <= 0) return 0;
    if (applyMinFee) return Math.max(profitFromRates, minFeeUsd);
    return Math.max(profitFromRates, 0);
  }, [profitFromRates, minFeeUsd, amtIn, applyMinFee]);

  // Показать ли пометку (min) — только если cap реально сработала
  // (применяем min И margin меньше неё).
  const minFeeApplied = useMemo(() => {
    if (!amtIn || parseFloat(amtIn) <= 0) return false;
    if (!applyMinFee) return false;
    return profitFromRates < minFeeUsd;
  }, [profitFromRates, minFeeUsd, amtIn, applyMinFee]);

  // --- handlers для outputs ---
  // updateOutput: при изменении rate (manual input ИЛИ chip-click) пересчитываем
  // amount даже если output был "touched" — пользователь явно дал понять что
  // курс изменился, значит сумма должна обновиться. Это не ломает дробные
  // сделки: ручной ввод amount оставляет touched=true, и пока юзер не
  // тронет rate этого output — amount не перезапишется.
  const updateOutput = (id, patch) =>
    setOutputs((prev) => {
      return prev.map((o, idx) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        // Триггер пересчёта amount: rate в патче явно меняется, а amount —
        // нет. Покрывает manual input rate и chip-clicks (Global/Office/specific).
        const rateInPatch = "rate" in patch && patch.rate !== o.rate;
        const amountInPatch = "amount" in patch;
        if (rateInPatch && !amountInPatch) {
          const a = parseFloat(amtIn);
          const r = parseFloat(next.rate);
          if (!isNaN(a) && !isNaN(r) && a > 0 && r > 0) {
            // idx=0 — net (минус fee если applyMinFee). Остальные — gross
            // (для дробной сделки юзер потом перераспределит вручную).
            const computed = idx === 0
              ? computeNetOutput({
                  amtIn: a,
                  rate: r,
                  feeUsd: applyMinFee ? minFeeUsd : 0,
                  outputCurrency: next.currency,
                  getRate,
                })
              : multiplyAmount(a, r, next.currency === "TRY" ? 0 : 2);
            next.amount = String(computed);
            next.touched = false;
          } else if (!a || !r) {
            // rate пуст / amtIn пуст → amount тоже сбрасываем (touched=false
            // чтобы при возврате rate авто-расчёт заработал).
            next.amount = "";
            next.touched = false;
          }
        }
        return next;
      });
    });

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
          // Возвращаемся к авто — сбрасываем touched + ratePinned и берём курс из системы
          const autoRate = getRate(curIn, o.currency);
          return {
            ...o,
            manualRate: false,
            touched: false,
            ratePinned: false,
            rateSource: "auto",
            rate: autoRate !== undefined ? String(autoRate) : o.rate,
          };
        }
        return { ...o, manualRate: true };
      })
    );
  };

  // --- remaining amount (в валюте curIn) ---
  // Используем тот же fee-baseline что применяется в auto-fill первого output.
  // Когда applyMinFee=off — fee=0 → remaining не вычитает min (auto-fill тоже
  // не вычитает), поэтому "exceeds_remaining" не ложно срабатывает.
  const remainingFeeUsd = applyMinFee ? minFeeUsd : 0;
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
    const outputsClean = outputs.map((o, idx) => {
      const addr = (o.address || "").trim();
      const plannedAmount = parseFloat(o.amount) || 0;
      // payNow: если deferredOut → 0 (не платим); если partialMode → из input;
      // иначе undefined → auto-logic.
      let payNow;
      if (deferredOut) {
        payNow = 0;
      } else if (partialMode) {
        const raw = partialPayNow[o.id] ?? partialPayNow[idx];
        const n = parseFloat(raw);
        payNow = Number.isFinite(n) ? n : undefined;
      }
      const base = {
        currency: o.currency,
        amount: plannedAmount,
        plannedAmount,
        actualAmount: 0,
        plannedAt: nowIso,
        completedAt: null,
        rate: parseFloat(o.rate) || 0,
        accountId: o.accountId || "",
        address: addr,
        ...(payNow !== undefined ? { payNow } : {}),
      };
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
      // Сохраняем выбор галочки чтобы edit-режим восстановил её корректно
      // и backend (RPC) знал применять ли min cap.
      applyMinFee,
      profit: Math.round(profit * 100) / 100,
      manager: currentUser.name,
      managerId: currentUser.id,
      counterparty,
      counterpartyId: clientId || null,
      referral,
      comment,
      accountId,
      status,
      createdAtMs: Date.now(),
      rateSnapshotId: rateSnapshots[0]?.id || null,
      inPlannedAmount: parseFloat(amtIn) || 0,
      inActualAmount: 0,
      inPlannedAt: nowIso,
      inCompletedAt: null,
      // TIER-1 поля для pending tracking:
      //   deferredIn — клиент заплатит IN позже, создать they_owe obligation
      //   plannedAt — "ожидается к" (ISO), применяется ко всем legs и deal
      deferredIn,
      plannedAt: plannedLocal ? new Date(plannedLocal).toISOString() : null,
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
    // Usage counter для quick-templates — ловим main target currency (первый output)
    if (mode === "create" && outputs[0]?.currency) {
      recordDealUsage(curIn, outputs[0].currency);
    }
    onSubmit?.(tx);
    if (mode === "create") {
      // reset + clear draft
      setAmtIn("");
      setOutputs([emptyOutput("TRY")]);
      setCounterparty("");
      setReferral(false);
      setComment("");
      setInTxHash("");
      try {
        sessionStorage.removeItem("coinplata.exchangeDraft");
      } catch {}
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
  //
  // Курс берём из системы (getRate) — это РЕАЛЬНЫЙ обратный pair (например
  // TRY→USD это другой row в pairs со своим spread, не математический 1/x).
  // Это и есть «sell vs buy»: одна пара = sell-курс офиса, обратная =
  // buy-курс. Если в системе нет обратной пары — fallback на 1/rate как
  // последний шанс (с warning через manualRate=true).
  //
  // Amount пересчитывается от нового amtIn × нового rate, а не копируется
  // старый. Если applyMinFee=on и idx=0 — учитываем net fee. Это даёт
  // консистентность: amtIn × rate = amount (с поправкой на fee).
  const handleReverse = () => {
    const first = outputs[0];
    if (!first) return;
    const newCurIn = first.currency;
    const newAmtIn = first.amount || "";
    const newOutCurrency = curIn;
    const autoRate = getRate(newCurIn, newOutCurrency);
    const fallbackRate =
      first.rate && parseFloat(first.rate) > 0 ? 1 / parseFloat(first.rate) : null;
    const finalRate = autoRate !== undefined ? autoRate : fallbackRate;

    // Пересчёт amount от нового amtIn × нового rate (с учётом min fee
    // для idx=0). Если данных не хватает — оставляем пустой (юзер
    // увидит inputs и сам введёт).
    let newOutAmount = "";
    const aNum = parseFloat(newAmtIn);
    const rNum = finalRate ? Number(finalRate) : NaN;
    if (Number.isFinite(aNum) && aNum > 0 && Number.isFinite(rNum) && rNum > 0) {
      const computed = computeNetOutput({
        amtIn: aNum,
        rate: rNum,
        feeUsd: applyMinFee ? minFeeUsd : 0,
        outputCurrency: newOutCurrency,
        getRate,
      });
      newOutAmount = String(computed);
    }

    setCurIn(newCurIn);
    setAmtIn(newAmtIn);
    setOutputs([
      {
        id: `o_rev_${Date.now()}`,
        currency: newOutCurrency,
        amount: newOutAmount,
        rate: finalRate != null ? String(finalRate) : "",
        // Если получили rate из системы → auto. Если только fallback 1/x —
        // помечаем manual чтобы юзер мог проверить и поправить.
        manualRate: autoRate === undefined,
        touched: false,
        accountId: "",
        address: "",
        networkId: "",
      },
    ]);
  };

  // Quick-templates apply: меняет curIn → template.from и пересоздаёт единый
  // output с template.to. Суммы очищаются — пользователь заполнит после.
  const handleApplyTemplate = (tpl) => {
    if (!tpl?.from || !tpl?.to || tpl.from === tpl.to) return;
    setCurIn(tpl.from);
    setAmtIn("");
    const autoRate = getRate(tpl.from, tpl.to);
    setOutputs([
      {
        id: `o_tpl_${Date.now()}`,
        currency: tpl.to,
        amount: "",
        rate: autoRate !== undefined ? String(autoRate) : "",
        manualRate: autoRate === undefined,
        touched: false,
        accountId: "",
        address: "",
        networkId: "",
      },
    ]);
  };

  const isEdit = mode === "edit";

  // Keyboard-first flow: auto-focus на IN amount при mount в create-режиме,
  // Enter в IN → первый OUT amount, Enter в OUT → submit, Shift+Enter → addOutput
  const amtInRef = useRef(null);
  useEffect(() => {
    if (mode === "create") {
      // небольшая задержка чтобы успел прорендериться
      const t = setTimeout(() => amtInRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode]);

  const focusFirstOutputAmount = () => {
    const el = document.querySelector('[data-kbd="out-amount"]');
    if (el) el.focus();
  };

  const handleKbdIn = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      focusFirstOutputAmount();
    }
  };

  const handleKbdOut = (e, isLast) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isLast) {
        // Submit если валидно, иначе ничего
        if (canSubmit) handleSubmit();
      } else {
        // Focus на следующий output
        const next = e.currentTarget.closest('[data-output-row]')?.nextElementSibling;
        const nextInput = next?.querySelector('[data-kbd="out-amount"]');
        if (nextInput) nextInput.focus();
      }
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      addOutput();
      // После следующего рендера focus на новый output
      setTimeout(() => {
        const all = document.querySelectorAll('[data-kbd="out-amount"]');
        const last = all[all.length - 1];
        if (last) last.focus();
      }, 50);
    }
  };

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

      {/* Quick templates — показываем только в create-режиме */}
      {!isEdit && (
        <DealTemplatesBar
          onApply={handleApplyTemplate}
          currentFrom={curIn}
          currentTo={outputs[0]?.currency}
        />
      )}

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
            ref={amtInRef}
            type="text"
            inputMode="decimal"
            value={amtIn}
            onChange={(e) => setAmtIn(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
            onKeyDown={handleKbdIn}
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

        {/* Deposit to account — searchable dropdown с заметной рамкой состояния.
            Всегда виден — если нет подходящих счетов, AccountSelect показывает
            empty-state. Раньше прятался через length>0 → селект исчезал
            когда в офисе не было аккаунта с нужной валютой. */}
        {!deferredIn && (
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
            {availableAccounts.length === 0 && (
              <div className="mt-1.5 text-[11px] text-amber-700">
                {t("no_account_for_currency").replace("{cur}", curIn)}
              </div>
            )}
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
              isLast={idx === outputs.length - 1}
              onUpdate={(patch) => updateOutput(o.id, patch)}
              onRemove={() => removeOutput(o.id)}
              onToggleManual={() => toggleManualRate(o.id)}
              onAmountKeyDown={handleKbdOut}
              curIn={curIn}
              remainingIn={remainingIn}
              availableInCurrency={officeCurrencyBalance(o.currency)}
              currentOffice={currentOffice}
              counterpartyId={resolveClientId(counterparty)}
              officeBalancesByCurrency={officeBalancesByCurrency}
              offices={activeOffices}
            />
          ))}
        </div>

        {/* SUMMARY block — курс + checkbox комиссии в ОДНОЙ строке + итог.
            Структура:
              ┌─────────────────────────────────────────────────┐
              │ КУРС  0.85    [✓] комиссия (мин)  $10           │
              ├─────────────────────────────────────────────────┤
              │ ИТОГ КЛИЕНТУ              850 EUR  (16px bold)  │
              │ 1000 × 0.850000 = 850 (breakdown математики)    │
              └─────────────────────────────────────────────────┘
            Размещён ВЫШЕ Conditions — это центр принятия решения.
            Conditions ниже — свернутые "дополнительные условия". */}
        {amtIn && outputs[0]?.amount && outputs[0]?.rate && (
          <div className="mt-5 px-5 py-4 rounded-[14px] border border-slate-200 bg-slate-50/60 space-y-2">
            {/* Rate + Fee toggle + Fee value — single row */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              {outputs.length === 1 ? (
                <div className="inline-flex items-baseline gap-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                    {t("summary_rate")}
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-slate-800">
                    {parseFloat(outputs[0].rate).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </span>
                </div>
              ) : (
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">
                  Спред-маржа
                </span>
              )}
              <div className="inline-flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={applyMinFee}
                    onChange={(e) => setApplyMinFee(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-emerald-600 focus:ring-1 focus:ring-emerald-500/40 cursor-pointer"
                  />
                  <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.08em] group-hover:text-slate-900">
                    Комиссия
                    {minFeeUsd > 0 && (
                      <span className="ml-1 text-slate-400 normal-case font-medium tracking-normal lowercase">
                        мин ${fmt(minFeeUsd)}
                      </span>
                    )}
                  </span>
                </label>
                <span className="inline-flex items-center gap-1 text-[13px] font-bold tabular-nums text-amber-700">
                  ${fmt(effectiveFee)}
                  {minFeeApplied && (
                    <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1 py-0.5 rounded">
                      {t("summary_min_label")}
                    </span>
                  )}
                  {!applyMinFee && (
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1 py-0.5 rounded">
                      без мин
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="border-t border-slate-200/70 my-1.5" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                {t("summary_you_receive")}
              </span>
              <span className="text-[16px] font-bold tabular-nums text-slate-900">
                {outputs
                  .map((o) => `${fmt(parseFloat(o.amount) || 0, o.currency)} ${o.currency}`)
                  .join(" + ")}
              </span>
            </div>
            {outputs.length === 1 && parseFloat(outputs[0].rate) > 0 && (
              <div className="text-[10px] text-slate-400 tabular-nums text-right font-mono">
                {fmt(parseFloat(amtIn), curIn)} × {parseFloat(outputs[0].rate).toFixed(6)}
                {!applyMinFee || effectiveFee === 0 ? null : (
                  <>
                    {" "}− ${fmt(effectiveFee)} fee
                  </>
                )}
                {" "}= {fmt(parseFloat(outputs[0].amount) || 0, outputs[0].currency)}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            CONDITIONS block — collapsable. Header-кнопка показывает counter
            активных условий и chevron. Body показывается только когда
            раскрыто (или есть активные условия — раскрывается автоматически
            при mount).
            ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          const conditionsActiveCount =
            (deferredIn ? 1 : 0) +
            (deferredOut ? 1 : 0) +
            (partialMode ? 1 : 0) +
            (referral ? 1 : 0) +
            (isPending ? 1 : 0) +
            (plannedLocal ? 1 : 0);
          return (
        <section
          className={`mt-5 rounded-[14px] overflow-hidden border-l-4 transition-all ${
            conditionsActiveCount > 0
              ? "bg-emerald-50/40 border-emerald-500 border-y border-r border-y-emerald-200 border-r-emerald-200 shadow-[0_2px_8px_-2px_rgba(16,185,129,0.15)]"
              : "bg-slate-50/60 border-l-slate-300 border-y border-r border-y-slate-200 border-r-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          }`}
        >
          <button
            type="button"
            onClick={() => setConditionsOpen((v) => !v)}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3 transition-colors ${
              conditionsActiveCount > 0 ? "hover:bg-emerald-50" : "hover:bg-slate-100/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-[8px] flex items-center justify-center transition-colors ${
                  conditionsActiveCount > 0
                    ? "bg-emerald-500 text-white shadow-[0_2px_6px_-2px_rgba(16,185,129,0.5)]"
                    : "bg-slate-200 text-slate-500"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={2.5} />
              </div>
              <div className="flex flex-col items-start">
                <h3
                  className={`text-[12px] font-bold tracking-tight ${
                    conditionsActiveCount > 0 ? "text-emerald-900" : "text-slate-700"
                  }`}
                >
                  {t("xf_conditions")}
                </h3>
                <span className="text-[10px] text-slate-500 leading-tight">
                  {conditionsActiveCount > 0
                    ? `${conditionsActiveCount} активн${conditionsActiveCount === 1 ? "о" : conditionsActiveCount < 5 ? "ы" : "ых"} — особые условия применяются`
                    : t("xf_optional")}
                </span>
              </div>
              {conditionsActiveCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold tabular-nums shadow-[0_1px_3px_rgba(16,185,129,0.4)]">
                  {conditionsActiveCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {conditionsOpen ? (
                <ChevronUp
                  className={`w-4 h-4 ${conditionsActiveCount > 0 ? "text-emerald-600" : "text-slate-400"}`}
                />
              ) : (
                <ChevronDown
                  className={`w-4 h-4 ${conditionsActiveCount > 0 ? "text-emerald-600" : "text-slate-400"}`}
                />
              )}
            </div>
          </button>

          {conditionsOpen && (
          <div className="px-4 pb-4 animate-[cIn_160ms_ease-out]">
          <div className="space-y-2">
            <Toggle
              active={deferredIn}
              onChange={setDeferredIn}
              icon="↓"
              label={t("xf_client_pays_later")}
              sub={t("xf_client_pays_later_sub")}
              tone="sky"
            />
            <Toggle
              active={deferredOut}
              onChange={(v) => {
                setDeferredOut(v);
                if (v) setPartialMode(false); // mutually exclusive
              }}
              icon="↑"
              label={t("xf_we_pay_later")}
              sub={t("xf_we_pay_later_sub")}
              tone="amber"
            />
            <Toggle
              active={partialMode}
              onChange={(v) => {
                setPartialMode(v);
                if (v) setDeferredOut(false);
              }}
              icon="½"
              label={t("xf_partial_payout")}
              sub={t("xf_partial_payout_sub")}
              tone="violet"
            />
            <Toggle
              active={referral}
              onChange={setReferral}
              icon={<UserPlus className="w-3 h-3" />}
              label={t("referral_client")}
              sub={`Deduct ${settings.referralPct}% from profit`}
              tone="indigo"
              suffix={referral ? `-${settings.referralPct}%` : null}
            />
            <Toggle
              active={isPending}
              onChange={setIsPending}
              icon={<Clock className="w-3 h-3" />}
              label={t("create_as_pending")}
              sub={t("pending_hint")}
              tone="slate"
            />
          </div>

          {/* Partial per-output amounts — inline под conditions */}
          {partialMode && outputs.length > 0 && (
            <div className="mt-3 p-3 rounded-[12px] bg-violet-50/40 border border-violet-200/60 animate-[cIn_160ms_ease-out]">
              <div className="text-[10px] font-bold text-violet-700 uppercase tracking-[0.12em] mb-2">
                {t("xf_partial_title")}
              </div>
              <div className="space-y-2">
                {outputs.map((o, idx) => {
                  const planned = parseFloat(o.amount) || 0;
                  const now = parseFloat(partialPayNow[o.id] ?? "0") || 0;
                  const remaining = Math.max(0, planned - now);
                  return (
                    <div key={o.id} className="flex items-center gap-2 text-[12px]">
                      <span className="text-[10px] font-bold text-slate-400 tabular-nums w-6">
                        #{idx + 1}
                      </span>
                      <span className="text-slate-600 min-w-[60px]">
                        {o.currency}
                      </span>
                      <span className="text-slate-400">{t("xf_pay_now")}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={partialPayNow[o.id] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          const clean = e.target.value.replace(/[^\d.,]/g, "").replace(",", ".");
                          setPartialPayNow((prev) => ({ ...prev, [o.id]: clean }));
                        }}
                        className="flex-1 bg-white border border-violet-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20 rounded-[8px] px-2 py-1 text-[12px] font-semibold tabular-nums outline-none"
                      />
                      {/* "Весь" кнопка — одним кликом выставить pay_now=planned
                          (выдать полностью, без obligation). Показывается пока
                          now < planned. */}
                      {planned > 0 && remaining > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPartialPayNow((prev) => ({
                              ...prev,
                              [o.id]: String(planned),
                            }))
                          }
                          className="px-1.5 py-1 rounded-[6px] text-[10px] font-bold text-violet-700 bg-white border border-violet-200 hover:bg-violet-100 hover:border-violet-300 transition-colors whitespace-nowrap"
                          title={`Вставить весь остаток: ${fmt(remaining, o.currency)} ${o.currency}`}
                        >
                          {t("xf_pay_all") || "Весь"}
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 whitespace-nowrap tabular-nums">
                        / {fmt(planned, o.currency)}
                      </span>
                      {remaining > 0 && (
                        <span className="text-[10px] font-bold text-violet-700 tabular-nums whitespace-nowrap">
                          {t("xf_owe")} {fmt(remaining, o.currency)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Planned completion date */}
          <div className="mt-3">
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.12em] uppercase">
              Expected completion
            </label>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={plannedLocal}
                onChange={(e) => setPlannedLocal(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] tabular-nums outline-none transition-colors"
              />
              {plannedLocal && (
                <button
                  type="button"
                  onClick={() => setPlannedLocal("")}
                  className="px-2.5 py-2 rounded-[10px] text-[11px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  title="Clear planned date"
                >
                Clear
              </button>
            )}
          </div>
          {plannedLocal && (
            <p className="text-[10px] text-slate-500 mt-1">
              Deal will be marked <span className="font-semibold">pending</span> until this date.
            </p>
          )}
          </div>

          {/* Комментарий — внутри "Дополнительно" (Conditions block).
              Редко нужен → свернут вместе с conditions по умолчанию. */}
          <div className="mt-3">
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.12em] uppercase">
              {t("comment") || "Комментарий"}
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("comment_placeholder")}
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-slate-400"
            />
          </div>
          </div>
          )}
        </section>
          );
        })()}
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
          <SubmitCTA
            canSubmit={canSubmit}
            submitting={submitting}
            isEdit={isEdit}
            onSubmit={handleSubmit}
            onSubmitPending={() => {
              setIsPending(true);
              setTimeout(handleSubmit, 0);
            }}
            onSubmitDeferredOut={() => {
              setDeferredOut(true);
              setPartialMode(false);
              setTimeout(handleSubmit, 0);
            }}
            onEnablePartial={() => {
              setPartialMode(true);
              setDeferredOut(false);
            }}
            t={t}
          />
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
// SubmitCTA — основная кнопка + dropdown с пресетами (Create / Pending / Partial)
// ----------------------------------------
function SubmitCTA({
  canSubmit,
  submitting,
  isEdit,
  onSubmit,
  onSubmitPending,
  onSubmitDeferredOut,
  onEnablePartial,
  t,
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const disabled = !canSubmit || submitting;

  return (
    <div ref={ref} className="relative flex-1 flex">
      {/* Основная кнопка — default create */}
      <button
        onClick={onSubmit}
        disabled={disabled}
        className={`group flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-l-[12px] text-[15px] font-bold tracking-tight transition-all ${
          !disabled
            ? "bg-slate-900 text-white hover:bg-slate-800 shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45)] active:scale-[0.995]"
            : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        }`}
      >
        <Zap className={`w-4 h-4 ${!disabled ? "text-emerald-400" : "opacity-40"}`} />
        <span>
          {submitting
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
            ? t("save_changes")
            : t("create_transaction")}
        </span>
      </button>

      {/* Chevron — открывает dropdown (не в edit mode) */}
      {!isEdit && (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-label="More options"
          className={`px-3 py-3.5 rounded-r-[12px] border-l border-black/10 transition-all ${
            !disabled
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-100 text-slate-400 cursor-not-allowed border-y border-r border-slate-200"
          }`}
        >
          <ChevronUp
            className={`w-4 h-4 transition-transform ${open ? "rotate-0" : "rotate-180"}`}
          />
        </button>
      )}

      {/* Dropdown menu */}
      {open && !isEdit && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-white border border-slate-200 rounded-[12px] shadow-[0_16px_40px_-12px_rgba(15,23,42,0.25)] overflow-hidden animate-[cIn_120ms_ease-out] z-20">
          <MenuItem
            icon={<Zap className="w-3.5 h-3.5 text-emerald-500" />}
            label="Create deal"
            sub="Complete now with current balance"
            onClick={() => {
              setOpen(false);
              onSubmit();
            }}
            disabled={disabled}
          />
          <div className="h-px bg-slate-100" />
          <MenuItem
            icon={<Clock className="w-3.5 h-3.5 text-amber-500" />}
            label="Create pending"
            sub="We pay later (we-owe for all outs)"
            onClick={() => {
              setOpen(false);
              onSubmitDeferredOut();
            }}
            disabled={disabled}
          />
          <MenuItem
            icon={<span className="inline-block text-[12px] font-bold text-violet-600">½</span>}
            label="Create partial"
            sub="Pay part now, remainder as we-owe"
            onClick={() => {
              setOpen(false);
              onEnablePartial();
            }}
            disabled={disabled}
          />
        </div>
      )}

      <style>{`
        @keyframes cIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function MenuItem({ icon, label, sub, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <div className="text-[10px] text-slate-500">{sub}</div>
      </div>
    </button>
  );
}

// ----------------------------------------
// Toggle — iOS-style переключатель для Conditions блока
// ----------------------------------------
function Toggle({ active, onChange, icon, label, sub, tone = "slate", suffix }) {
  const tones = {
    sky: { on: "bg-sky-500", ring: "ring-sky-200", text: "text-sky-700", iconBg: "bg-sky-100 text-sky-700" },
    amber: { on: "bg-amber-500", ring: "ring-amber-200", text: "text-amber-700", iconBg: "bg-amber-100 text-amber-700" },
    violet: { on: "bg-violet-500", ring: "ring-violet-200", text: "text-violet-700", iconBg: "bg-violet-100 text-violet-700" },
    indigo: { on: "bg-indigo-500", ring: "ring-indigo-200", text: "text-indigo-700", iconBg: "bg-indigo-100 text-indigo-700" },
    slate: { on: "bg-slate-700", ring: "ring-slate-200", text: "text-slate-700", iconBg: "bg-slate-100 text-slate-600" },
  };
  const c = tones[tone] || tones.slate;
  return (
    <label
      className={`flex items-center gap-3 cursor-pointer select-none rounded-[10px] px-3 py-2 transition-all ${
        active ? `bg-slate-50 ring-1 ${c.ring}` : "bg-slate-50/40 hover:bg-slate-50"
      }`}
    >
      <div
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ${c.iconBg}`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold tracking-tight ${active ? c.text : "text-slate-700"}`}>
          {label}
        </div>
        {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
      </div>
      {suffix && (
        <span className={`text-[10px] font-bold tabular-nums ${c.text}`}>{suffix}</span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={active}
        onClick={(e) => {
          e.preventDefault();
          onChange(!active);
        }}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          active ? c.on : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            active ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

// ----------------------------------------
// OutputRow — одна строка "выдать в валюте"
// ----------------------------------------
function OutputRow({
  output,
  index,
  canRemove,
  isLast,
  onUpdate,
  onRemove,
  onToggleManual,
  onAmountKeyDown,
  curIn,
  remainingIn,
  availableInCurrency,
  currentOffice,
  counterpartyId,
  officeBalancesByCurrency, // Map<"officeId_currency", balance> across all offices
  offices,
}) {
  const { t } = useTranslation();
  const { getRate: getRateRaw, getOfficeOverride } = useRates();
  // OutputRow: getRate тоже учитывает currentOffice override
  const getRate = React.useCallback(
    (from, to) => getRateRaw(from, to, currentOffice),
    [getRateRaw, currentOffice]
  );
  const { accountsByOffice, accounts } = useAccounts();
  const { codes: CURRENCIES, dict: currencyDict } = useCurrencies();
  const { findWallet } = useWallets();
  const { counterparties } = useTransactions();
  const o = output;
  const isCrypto = currencyDict[o.currency]?.type === "crypto";
  // Triangulation через USD (для sanity check + auto-correction).
  const expectedRateViaUsd = (() => {
    if (curIn === o.currency) return null;
    if (curIn === "USD") return getRateRaw("USD", o.currency, currentOffice);
    if (o.currency === "USD") return getRateRaw(curIn, "USD", currentOffice);
    const inToUsd = getRateRaw(curIn, "USD", currentOffice);
    const outToUsd = getRateRaw(o.currency, "USD", currentOffice);
    if (!Number.isFinite(inToUsd) || !Number.isFinite(outToUsd) || outToUsd === 0) return null;
    return inToUsd / outToUsd;
  })();

  // Auto-correct rate через hardcoded reasonable ranges (hard guard).
  // То же что correctRate в ExchangeForm — дублируем чтобы chips
  // показывали corrected значения.
  const fixIfInverted = (raw) => {
    if (!Number.isFinite(raw) || raw <= 0) return raw;
    const RANGES = {
      USDT_USD: [0.9, 1.1], USD_USDT: [0.9, 1.1],
      USDT_EUR: [0.7, 1.1], EUR_USDT: [0.9, 1.4],
      USDT_GBP: [0.6, 1.0], GBP_USDT: [1.0, 1.7],
      USDT_CHF: [0.7, 1.1], CHF_USDT: [0.9, 1.4],
      USDT_TRY: [20, 80],   TRY_USDT: [0.012, 0.05],
      USDT_RUB: [50, 150],  RUB_USDT: [0.006, 0.02],
      USD_EUR: [0.7, 1.1],  EUR_USD: [0.9, 1.4],
      USD_GBP: [0.6, 1.0],  GBP_USD: [1.0, 1.7],
      USD_CHF: [0.7, 1.1],  CHF_USD: [0.9, 1.4],
      USD_TRY: [20, 80],    TRY_USD: [0.012, 0.05],
      USD_RUB: [50, 150],   RUB_USD: [0.006, 0.02],
      EUR_TRY: [25, 90],    TRY_EUR: [0.011, 0.04],
      EUR_GBP: [0.7, 1.0],  GBP_EUR: [1.0, 1.4],
      EUR_CHF: [0.85, 1.1], CHF_EUR: [0.9, 1.2],
    };
    const range = RANGES[`${curIn}_${o.currency}`];
    if (!range) return raw;
    const [min, max] = range;
    if (raw >= min && raw <= max) return raw;
    const inverted = 1 / raw;
    if (inverted >= min && inverted <= max) return inverted;
    return raw;
  };

  // Global rate (без override) и эффективный rate текущего офиса —
  // обоих прогоняем через fix-inverted чтобы chips показывали
  // правильные значения даже при кривых данных в БД.
  const globalRate = fixIfInverted(getRateRaw(curIn, o.currency, null));
  const officeRate = fixIfInverted(getRateRaw(curIn, o.currency, currentOffice));
  const hasOfficeOverride =
    !!getOfficeOverride?.(currentOffice, curIn, o.currency) &&
    Number.isFinite(globalRate) &&
    Number.isFinite(officeRate) &&
    Math.abs(globalRate - officeRate) > 1e-9;

  const actualRate = parseFloat(o.rate);
  const rateLooksWrong = (() => {
    if (!Number.isFinite(actualRate) || actualRate <= 0) return false;
    if (!Number.isFinite(expectedRateViaUsd) || expectedRateViaUsd <= 0) return false;
    const ratio = actualRate / expectedRateViaUsd;
    return ratio > 1.4 || ratio < 0.7;
  })();

  // Per-office rate chips: current office + ВСЕ другие активные офисы.
  // Админ/owner видит полный срез (где override, где = global).
  // Chip цвет:
  //   • indigo — текущий офис
  //   • sky — другой офис с override, отличающимся от global
  //   • slate — другой офис без override (курс = global, чип info-only)
  const currentOfficeObj = (offices || []).find((off) => off.id === currentOffice);
  const currentOfficeChip =
    currentOfficeObj && Number.isFinite(officeRate)
      ? {
          id: currentOfficeObj.id,
          name: currentOfficeObj.name || "Office",
          rate: officeRate,
          hasOverride: hasOfficeOverride,
        }
      : null;
  const otherOfficeChips = (offices || [])
    .filter((off) => off.id !== currentOffice)
    .map((off) => {
      // Эффективный курс офиса = override если есть, иначе global fallback.
      // Прогоняем через fixIfInverted — chip покажет corrected значение.
      const rate = fixIfInverted(getRateRaw(curIn, o.currency, off.id));
      if (!Number.isFinite(rate)) return null;
      const ovr = getOfficeOverride?.(off.id, curIn, o.currency);
      const hasOverride =
        !!ovr &&
        Number.isFinite(ovr.rate) &&
        (!Number.isFinite(globalRate) || Math.abs(ovr.rate - globalRate) > 1e-9);
      return {
        id: off.id,
        name: off.name || "Office",
        rate,
        hasOverride,
      };
    })
    .filter(Boolean);

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

  // Suggest офисы when insufficient — top-3 по балансу (могут покрыть сумму)
  const otherOfficesWithBalance = useMemo(() => {
    if (!insufficient || !officeBalancesByCurrency || !offices) return [];
    return offices
      .filter((off) => off.id !== currentOffice)
      .map((off) => ({
        id: off.id,
        name: off.name,
        balance: officeBalancesByCurrency.get(`${off.id}_${o.currency}`) || 0,
      }))
      .filter((off) => off.balance >= outAmount)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3);
  }, [insufficient, officeBalancesByCurrency, offices, currentOffice, o.currency, outAmount]);

  // Availability в других офисах — показываем всегда (informational), когда
  // current office мало/нет этой валюты. Помогает кассиру до ввода суммы
  // увидеть "у других офисов Mark:5000, Terra:2000" и спланировать сделку.
  const otherOfficesInline = useMemo(() => {
    if (!officeBalancesByCurrency || !offices) return [];
    return offices
      .filter((off) => off.id !== currentOffice)
      .map((off) => ({
        id: off.id,
        name: off.name,
        balance: officeBalancesByCurrency.get(`${off.id}_${o.currency}`) || 0,
      }))
      .filter((off) => off.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3);
  }, [officeBalancesByCurrency, offices, currentOffice, o.currency]);

  const handleUseRemaining = () => {
    if (!canUseRemaining) return;
    // Округляем до точности валюты (TRY=0, всё остальное=2)
    const precision = o.currency === "TRY" ? 0 : 2;
    const rounded = Math.floor(suggestedAmount * Math.pow(10, precision)) / Math.pow(10, precision);
    onUpdate({ amount: String(rounded), touched: true });
  };

  return (
    <div data-output-row className="bg-slate-50/60 rounded-[14px] border border-slate-200 p-3">
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
                  // ratePinned/rateSource сбрасываем — chip-pick был для прежней пары.
                  const patch = {
                    currency: c,
                    touched: false,
                    ratePinned: false,
                    rateSource: "auto",
                  };
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
          data-kbd="out-amount"
          value={o.amount}
          onChange={(e) =>
            onUpdate({
              amount: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."),
              touched: true,
            })
          }
          onKeyDown={(e) => onAmountKeyDown?.(e, isLast)}
          placeholder="0"
          className="flex-1 bg-transparent outline-none text-slate-900 placeholder:text-slate-300 tabular-nums text-[22px] font-bold tracking-tight min-w-0 leading-none"
        />
        <span className="text-slate-400 text-[11px] font-bold tracking-wider">{o.currency}</span>
      </div>

      {/* Rate source chips — видны всегда.
            • Global · X.XX — rate без office override
            • <current office name> · X.XX — эффективный курс текущего офиса
              (override или = global). Всегда виден, чтобы кассир видел
              "откуда" берётся цифра.
            • <other office name> · X.XX — для каждого активного офиса, у
              которого есть override, отличающийся от global. Клик → применить
              чужой курс к этой ноге (арбитраж / быстрая проверка).
            • Manual — ручной ввод (разблокирует rate input).
         Активный chip подсвечен; клик = onUpdate({rate, manualRate:false}). */}
      {(Number.isFinite(officeRate) || Number.isFinite(globalRate)) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold text-slate-400 tracking-[0.15em] uppercase">
            {t("xf_rate_source") || "Rate source"}
          </span>

          {/* GLOBAL — всегда */}
          {Number.isFinite(globalRate) && (
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  rate: String(globalRate),
                  manualRate: false,
                  rateSource: "global",
                  ratePinned: true,
                  touched: false,
                })
              }
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold tabular-nums border transition-colors ${
                !o.manualRate && o.rateSource === "global"
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
              title={t("xf_use_global_rate") || "Общий курс (без учёта override офиса)"}
            >
              {t("xf_global_rate") || "Global"} · {Number(globalRate).toFixed(4)}
            </button>
          )}

          {/* CURRENT OFFICE — всегда (с индикатором override если отличается) */}
          {currentOfficeChip && (
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  rate: String(currentOfficeChip.rate),
                  manualRate: false,
                  rateSource: "auto",
                  ratePinned: false,
                  touched: false,
                })
              }
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold tabular-nums border transition-colors ${
                !o.manualRate && (!o.rateSource || o.rateSource === "auto")
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : currentOfficeChip.hasOverride
                  ? "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
              title={
                currentOfficeChip.hasOverride
                  ? `${currentOfficeChip.name} · per-office override`
                  : `${currentOfficeChip.name} · = Global (без override)`
              }
            >
              {currentOfficeChip.name} · {Number(currentOfficeChip.rate).toFixed(4)}
            </button>
          )}

          {/* OTHER OFFICES — все активные офисы (sky если override, slate если =global) */}
          {otherOfficeChips.map((row) => {
            const sourceKey = `office:${row.id}`;
            const active = !o.manualRate && o.rateSource === sourceKey;
            const baseCls = row.hasOverride
              ? active
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white text-sky-700 border-sky-200 hover:bg-sky-50"
              : active
              ? "bg-slate-600 text-white border-slate-600"
              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50";
            return (
              <button
                key={row.id}
                type="button"
                onClick={() =>
                  onUpdate({
                    rate: String(row.rate),
                    manualRate: false,
                    rateSource: sourceKey,
                    ratePinned: true,
                    touched: false,
                  })
                }
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold tabular-nums border transition-colors ${baseCls}`}
                title={
                  row.hasOverride
                    ? `${row.name} · per-office override`
                    : `${row.name} · курс = Global (нет override)`
                }
              >
                {row.name} · {Number(row.rate).toFixed(4)}
              </button>
            );
          })}

          {/* MANUAL — всегда */}
          <button
            type="button"
            onClick={() => {
              if (!o.manualRate) onToggleManual?.();
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold border transition-colors ${
              o.manualRate
                ? "bg-amber-500 text-white border-amber-500"
                : "bg-white text-amber-700 border-amber-200 hover:bg-amber-50"
            }`}
            title={t("xf_manual_rate_tip") || "Ввести курс вручную — нестандартный для этой сделки"}
          >
            {t("xf_manual_rate") || "Manual"}
          </button>
        </div>
      )}

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

      {/* Sanity warning — курс подозрительно отличается от triangulated
          через USD. Скорее всего в DailyRatesModal введено в обратную
          сторону (например 1.185 как USDT→EUR вместо 0.85). */}
      {rateLooksWrong && Number.isFinite(expectedRateViaUsd) && (
        <div className="mt-1.5 px-2.5 py-1.5 rounded-[8px] bg-amber-50 border border-amber-300 text-[11px] text-amber-900 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0 text-amber-600" />
          <span>
            Курс подозрительный. Ожидаемый по USD-триангуляции:{" "}
            <span className="font-bold tabular-nums">
              ≈{expectedRateViaUsd.toFixed(4)}
            </span>{" "}
            (1 {curIn} = {expectedRateViaUsd.toFixed(4)} {o.currency}).
            Возможно в Quick-rates введено в обратную сторону. Текущий ввод:{" "}
            <span className="font-bold tabular-nums">{actualRate}</span>.
          </span>
        </div>
      )}

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
            className={`inline-flex items-center gap-1 text-[10px] font-medium tabular-nums flex-wrap ${
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
            {/* Inline chips других офисов с положительным балансом —
                informational, всегда видно, помогает планировать до ввода суммы. */}
            {otherOfficesInline.length > 0 && (
              <>
                <span className="text-slate-300 mx-0.5">·</span>
                <span className="text-slate-400 inline-flex items-center gap-1 flex-wrap">
                  {otherOfficesInline.map((off) => (
                    <span
                      key={off.id}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                      title={`${off.name} — available for this currency`}
                    >
                      <span className="font-semibold">{off.name}</span>:{" "}
                      <span className="tabular-nums">
                        {curSymbol(o.currency)}
                        {fmt(off.balance, o.currency)}
                      </span>
                    </span>
                  ))}
                </span>
              </>
            )}
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

      {/* Suggest other offices when insufficient in current */}
      {insufficient && otherOfficesWithBalance.length > 0 && (
        <div className="mt-2 px-3 py-2 rounded-[10px] bg-sky-50 border border-sky-200 text-[11px]">
          <div className="font-bold text-sky-900 mb-1">
            {t("insufficient_suggest_body").replace("{cur}", o.currency)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {otherOfficesWithBalance.map((off) => (
              <span
                key={off.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-sky-200 text-sky-800 tabular-nums"
              >
                <span className="font-bold">{off.name}</span>
                <span className="text-sky-400">·</span>
                <span>{fmt(off.balance, o.currency)} {o.currency}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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
