// src/components/RatesBar.jsx
// Dashboard rates bar + единый modal управления Currency → Channel → Pair.
// Это ЕДИНСТВЕННОЕ место создания currencies / channels / pairs в системе.
// Settings → Currencies — read-only справочник.

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  TrendingUp,
  Pencil,
  RefreshCw,
  Plus,
  Trash2,
  X,
  ChevronLeft,
  Coins,
  Network as NetworkIcon,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useRates, FEATURED_PAIRS, rateKey } from "../store/rates.jsx";
import { useCurrencies } from "../store/currencies.jsx";
import { useAuth } from "../store/auth.jsx";
import { useAudit } from "../store/audit.jsx";
import { useTranslation } from "../i18n/translations.jsx";
import { NETWORKS } from "../store/data.js";
import { getTradingRates } from "../utils/tradingRates.js";
import Modal from "./ui/Modal.jsx";
import {
  computeSpread,
  computeRateFromSpread,
  getMidRate,
  formatSpread,
} from "../utils/spread.js";

// Порядок групп/валют в RatesEditModal. Код не из этого списка — в конец, по алфавиту.
const CURRENCY_ORDER = ["USD", "USDT", "EUR", "TRY", "GBP"];
const curIndex = (code) => {
  const i = CURRENCY_ORDER.indexOf(code);
  return i === -1 ? 999 : i;
};

function formatRate(value) {
  if (!value && value !== 0) return "—";
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// Ярлык канала для отображения в кнопках/рядах
function channelLabel(ch) {
  if (!ch) return "—";
  if (ch.kind === "network") return ch.network || "network";
  if (ch.kind === "cash") return "Cash";
  if (ch.kind === "bank") return "Bank";
  if (ch.kind === "sepa") return "SEPA";
  if (ch.kind === "swift") return "SWIFT";
  return ch.kind;
}

// Каждая пара = один блок с ДВУМЯ направлениями (buy / sell). Кассир сразу
// видит и rate в одну сторону, и в обратную. Dropdown с cross-rates открывается
// только по КЛИКУ (не hover — чтобы случайные движения мышью не раскрывали).
const TRADE_PAIRS = [
  ["USDT", "TRY"],
  ["USDT", "USD"],
  ["USDT", "EUR"],
  ["USDT", "GBP"],
  ["USD", "TRY"],
];

export default function RatesBar() {
  const { getRate, ratesFromBase, lastUpdated } = useRates();
  const { dict: currencyDict } = useCurrencies();
  const { isAdmin } = useAuth();
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);
  const wrapperRef = useRef(null);
  const isCrypto = (code) => currencyDict[code]?.type === "crypto";

  // Закрытие dropdown при клике вне блока.
  useEffect(() => {
    if (activeIdx == null) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setActiveIdx(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeIdx]);

  const activePair = activeIdx != null ? TRADE_PAIRS[activeIdx] : null;
  const expandedBase = activePair ? activePair[0] : null;
  const expandData = expandedBase ? ratesFromBase(expandedBase) : [];
  const crossPairs = expandData.filter((p) => p.to !== expandedBase);

  const handleToggle = (idx) => {
    setActiveIdx((prev) => (prev === idx ? null : idx));
  };

  return (
    <>
      <section className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-[13px] font-bold text-slate-900 tracking-tight">
              {t("rates") || "Rates"}
            </h2>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
              updated {timeAgo(lastUpdated)} ago
            </span>
          </div>
          {isAdmin && (
            <button
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[12px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t("edit_rates") || "Edit"}
            </button>
          )}
        </div>

        <div
          ref={wrapperRef}
          className="bg-white rounded-[16px] border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.06)]"
        >
          {/* Grid из TRADE_PAIRS — каждая карточка содержит ДВА направления. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 p-2 gap-1.5">
            {TRADE_PAIRS.map(([a, b], idx) => {
              // Bid/Ask от market rate (без инверсии 1/x).
              // sell (ask) = market * (1 + spread) → клиент A→B получает по этой цене
              // buy  (bid) = market * (1 - spread) → клиент B→A получает по этой цене
              // Оба в "B per A" единице — нет значений вроде 0.025.
              const { ask: sell, bid: buy, spread } = getTradingRates({
                getRate,
                isCrypto,
                base: a,
                quote: b,
              });
              const spreadPct = spread * 100 * 2; // полный spread = ask-bid относительно mid
              const isActive = activeIdx === idx;
              return (
                <button
                  key={`${a}-${b}`}
                  type="button"
                  onClick={() => handleToggle(idx)}
                  className={`text-left px-3.5 py-3 rounded-[12px] transition-all outline-none border ${
                    isActive
                      ? "bg-slate-900 border-slate-900 text-white shadow-[0_6px_16px_-6px_rgba(15,23,42,0.35)]"
                      : "bg-slate-50 hover:bg-white border-transparent hover:border-slate-200 hover:shadow-[0_2px_8px_-4px_rgba(15,23,42,0.08)]"
                  }`}
                >
                  <div
                    className={`text-[10px] font-bold tracking-[0.12em] mb-2 inline-flex items-center justify-between w-full ${
                      isActive ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>{a}</span>
                      <span className={isActive ? "text-slate-500" : "text-slate-400"}>⇄</span>
                      <span>{b}</span>
                    </span>
                    {Math.abs(spreadPct) >= 0.05 && (
                      <span
                        className={`text-[9px] font-bold tabular-nums px-1 py-0.5 rounded ${
                          isActive
                            ? "bg-slate-700 text-emerald-300"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {spreadPct.toFixed(2)}%
                      </span>
                    )}
                  </div>

                  {/* SELL — клиент отдаёт A, получает B. Крупно. */}
                  <div className="flex items-baseline justify-between mb-1">
                    <span
                      className={`text-[10px] font-semibold inline-flex items-center ${
                        isActive ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {a} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {b}
                    </span>
                    <span
                      className={`text-[18px] font-bold tabular-nums tracking-tight leading-none ${
                        isActive ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {formatRate(sell)}
                    </span>
                  </div>

                  {/* BUY — клиент отдаёт B, получает A. Тот же юнит (B per A). */}
                  <div className="flex items-baseline justify-between">
                    <span
                      className={`text-[10px] font-semibold inline-flex items-center ${
                        isActive ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {b} <ArrowRight className="w-2.5 h-2.5 mx-0.5" /> {a}
                    </span>
                    <span
                      className={`text-[14px] font-bold tabular-nums tracking-tight leading-none ${
                        isActive ? "text-slate-200" : "text-slate-600"
                      }`}
                    >
                      {formatRate(buy)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Dropdown с cross-rates. Открывается по клику, закрывается повторным
              кликом или кликом вне. Scroll внутри если много пар. */}
          <div
            className={`overflow-hidden transition-all ease-out ${
              expandedBase && crossPairs.length > 0
                ? "max-h-[320px] opacity-100 duration-200"
                : "max-h-0 opacity-0 duration-150"
            }`}
          >
            {expandedBase && crossPairs.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3 max-h-[320px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold text-slate-500 tracking-[0.12em] uppercase">
                    All {expandedBase} pairs
                  </div>
                  <div className="text-[10px] text-slate-400 tabular-nums">
                    {crossPairs.length} {crossPairs.length === 1 ? "pair" : "pairs"}
                  </div>
                </div>
                <div className="grid grid-rows-4 grid-flow-col gap-x-4 gap-y-1 auto-cols-[minmax(160px,1fr)]">
                  {crossPairs.map(({ to: t2, rate: r2 }) => (
                    <div
                      key={t2}
                      className="flex items-baseline justify-between px-2.5 py-1.5 rounded-[8px] hover:bg-slate-50 transition-colors"
                    >
                      <span className="text-[12px] font-semibold text-slate-500 tracking-wide">
                        {t2}
                      </span>
                      <span className="text-[14px] font-bold tabular-nums text-slate-900">
                        {formatRate(r2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {editOpen && (
        <RatesEditModal open={editOpen} onClose={() => setEditOpen(false)} canDelete={isAdmin} />
      )}
    </>
  );
}

// =========================================================================
// Rates Edit Modal — список пар + добавление currency / channel / pair
// =========================================================================
function RatesEditModal({ open, onClose, canDelete }) {
  const { t } = useTranslation();
  const [view, setView] = useState("list"); // list | addPair | addCurrency | addChannel

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("edit_rates")}
      subtitle="Currency → Channel → Pair · 1 unit of FROM in TO"
      width="2xl"
    >
      {view === "list" && <ListPanel canDelete={canDelete} onGoto={setView} />}
      {view === "addPair" && <AddPairPanel onBack={() => setView("list")} />}
      {view === "addCurrency" && <AddCurrencyPanel onBack={() => setView("list")} />}
      {view === "addChannel" && <AddChannelPanel onBack={() => setView("list")} />}

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <RefreshCw className="w-3 h-3" /> Auto-saved
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[10px] bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

// =========================================================================
// LIST — группы пар + три "+" кнопки (currency / channel / pair)
// =========================================================================
function ListPanel({ canDelete, onGoto }) {
  const { t } = useTranslation();
  const { rates, setRate, deleteRate, getRate, channels } = useRates();
  const { currencies } = useCurrencies();
  const { addEntry: logAudit } = useAudit();

  const existingPairs = Object.keys(rates).map((k) => {
    const [from, to] = k.split("_");
    return { from, to, key: k };
  });

  const groups = useMemo(() => {
    const byFrom = new Map();
    existingPairs.forEach((p) => {
      if (!byFrom.has(p.from)) byFrom.set(p.from, []);
      byFrom.get(p.from).push(p);
    });
    const froms = [...byFrom.keys()].sort((a, b) => {
      const d = curIndex(a) - curIndex(b);
      return d !== 0 ? d : a.localeCompare(b);
    });
    return froms.map((from) => ({
      from,
      pairs: [...byFrom.get(from)].sort((a, b) => {
        const d = curIndex(a.to) - curIndex(b.to);
        return d !== 0 ? d : a.to.localeCompare(b.to);
      }),
    }));
  }, [existingPairs]);

  const setRateLogged = (from, to, value) => {
    const old = rates[rateKey(from, to)];
    const result = setRate(from, to, value);
    const newVal = parseFloat(value) || 0;
    if (result.ok && old !== undefined && Math.abs(old - newVal) > 0.0001) {
      logAudit({
        action: "update",
        entity: "rate",
        entityId: rateKey(from, to),
        summary: `${from} → ${to}: ${old} → ${newVal}`,
      });
    }
  };

  const deleteRateLogged = (from, to) => {
    deleteRate(from, to);
    logAudit({
      action: "delete",
      entity: "rate",
      entityId: rateKey(from, to),
      summary: `Removed pair ${from} → ${to}`,
    });
  };

  return (
    <div className="p-5 max-h-[60vh] overflow-auto">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          {currencies.length} currencies · {channels.length} channels · {existingPairs.length} pairs
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <HeaderButton icon={Coins} onClick={() => onGoto("addCurrency")}>
            {t("currency_add")}
          </HeaderButton>
          <HeaderButton icon={NetworkIcon} onClick={() => onGoto("addChannel")}>
            {t("channel_add")}
          </HeaderButton>
          <HeaderButton icon={Plus} onClick={() => onGoto("addPair")} primary>
            {t("add_pair")}
          </HeaderButton>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-[13px] text-slate-400 italic py-8 text-center">
          No pairs yet. Add a currency, then channels, then a pair.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.from}>
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 tracking-wider">
                  {g.from}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">{g.pairs.length}</span>
              </div>
              <div className="border border-slate-200/70 rounded-[10px] overflow-hidden divide-y divide-slate-100">
                {g.pairs.map(({ from, to, key }) => (
                  <RateRow
                    key={key}
                    from={from}
                    to={to}
                    value={rates[key]}
                    getRate={getRate}
                    onChange={(v) => setRateLogged(from, to, v)}
                    onDelete={canDelete ? () => deleteRateLogged(from, to) : null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeaderButton({ icon: Icon, children, onClick, primary }) {
  const base =
    "inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] text-[12px] font-semibold transition-colors border";
  const cls = primary
    ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
    : "text-slate-700 hover:text-slate-900 border-slate-200 hover:bg-slate-50";
  return (
    <button onClick={onClick} className={`${base} ${cls}`}>
      <Icon className="w-3 h-3" />
      {children}
    </button>
  );
}

function RateRow({ from, to, value, getRate, onChange, onDelete }) {
  const [confirm, setConfirm] = useState(false);

  // Derived из текущего rate + mid (через triangulation / USD-case).
  const mid = getRate ? getMidRate(from, to, getRate) : null;
  const derivedSpread = getRate ? computeSpread(value, from, to, getRate) : null;

  // Local-state для spread: пока юзер печатает, показываем его ввод, чтобы
  // избежать флика в случаях where midRate совпадает со stored rate (например USD→X),
  // когда derivedSpread после каждого setRate «сбрасывается» к 0.
  const [spreadInput, setSpreadInput] = useState("");
  const [editingSpread, setEditingSpread] = useState(false);
  const displaySpread = editingSpread
    ? spreadInput
    : derivedSpread != null
    ? formatSpread(derivedSpread)
    : "";

  const handleRateChange = (e) => {
    onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."));
  };

  const handleSpreadChange = (e) => {
    // Разрешаем цифры, точку, запятую и знаки +/-. Это явный text-input,
    // а не type="number", чтобы пользователь мог набрать "+0.5" / "-0.25"
    // без того чтобы браузер его обрезал.
    const cleaned = e.target.value.replace(/[^\d.,+-]/g, "").replace(",", ".");
    setSpreadInput(cleaned);
    setEditingSpread(true);
    const newRate = computeRateFromSpread(cleaned, from, to, getRate);
    if (newRate != null && newRate > 0) {
      onChange(String(newRate));
    }
  };

  const spreadDisabled = mid == null;
  const midTitle = mid != null ? `mid ${mid.toFixed(6)}` : "no mid rate available";

  return (
    <div className="group flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 transition-colors">
      <span className="text-[12px] font-semibold text-slate-600 tracking-wide min-w-[90px]">
        {from} <span className="text-slate-400">→</span> {to}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        onChange={handleRateChange}
        placeholder="rate"
        title={midTitle}
        className="flex-1 min-w-0 bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[8px] px-3 py-1.5 text-[14px] font-semibold text-slate-900 tabular-nums outline-none transition-colors"
      />
      <div className="relative w-24 shrink-0">
        <input
          type="text"
          inputMode="decimal"
          value={displaySpread}
          onChange={handleSpreadChange}
          onFocus={() => setEditingSpread(true)}
          onBlur={() => {
            setEditingSpread(false);
            setSpreadInput("");
          }}
          disabled={spreadDisabled}
          placeholder={spreadDisabled ? "—" : "spread"}
          title={midTitle}
          className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[8px] pl-3 pr-5 py-1.5 text-[13px] font-semibold text-slate-700 tabular-nums outline-none transition-colors disabled:text-slate-300 disabled:cursor-not-allowed"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">
          %
        </span>
      </div>
      {onDelete && (
        <button
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
          onBlur={() => setConfirm(false)}
          className={`opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md transition-all ${
            confirm
              ? "bg-rose-500 text-white opacity-100"
              : "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
          }`}
          title={confirm ? "Confirm delete" : "Delete pair"}
        >
          {confirm ? <Trash2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

// Маленький компонент "шапка sub-panel с back-кнопкой"
function SubPanelHeader({ onBack, title }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[12px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 transition-colors"
      >
        <ChevronLeft className="w-3 h-3" />
        Back
      </button>
      <div className="text-[13px] font-semibold text-slate-900">{title}</div>
    </div>
  );
}

// =========================================================================
// ADD CURRENCY — создание валюты. Для fiat — авто cash + bank.
// =========================================================================
function AddCurrencyPanel({ onBack }) {
  const { t } = useTranslation();
  const { addCurrency } = useCurrencies();
  const { addChannel } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [code, setCode] = useState("");
  const [type, setType] = useState("fiat");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const canSubmit = code.trim().length > 0;

  const handleSubmit = () => {
    setError("");
    const upper = code.trim().toUpperCase();
    const res = addCurrency({
      code: upper,
      type,
      symbol: symbol.trim(),
      name: name.trim() || upper,
      decimals: 2,
    });
    if (!res.ok) {
      setError(res.warning);
      return;
    }
    logAudit({
      action: "create",
      entity: "currency",
      entityId: res.currency.code,
      summary: `Added currency ${res.currency.code} (${res.currency.type})`,
    });

    // Для fiat автоматически создаём cash + bank каналы
    if (type === "fiat") {
      const cashId = addChannel({ currencyCode: upper, kind: "cash" });
      const bankId = addChannel({ currencyCode: upper, kind: "bank" });
      logAudit({
        action: "create",
        entity: "channel",
        entityId: `${cashId},${bankId}`,
        summary: `Auto-created channels for ${upper}: cash, bank`,
      });
    }

    onBack();
  };

  return (
    <div className="p-5 max-h-[60vh] overflow-auto">
      <SubPanelHeader onBack={onBack} title={t("currency_add_title")} />

      <div className="space-y-4 max-w-md">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("currency_code")}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="USDC"
              autoFocus
              maxLength={6}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] font-bold outline-none tracking-wider"
            />
          </Field>
          <Field label={t("currency_type")}>
            <div className="inline-flex bg-slate-100 p-0.5 rounded-[10px] w-full">
              <SegBtn active={type === "fiat"} onClick={() => setType("fiat")}>
                {t("currency_type_fiat")}
              </SegBtn>
              <SegBtn active={type === "crypto"} onClick={() => setType("crypto")}>
                {t("currency_type_crypto")}
              </SegBtn>
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("currency_symbol")}>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="$"
              maxLength={3}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </Field>
          <Field label={t("currency_name")}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="USD Coin"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] outline-none"
            />
          </Field>
        </div>

        {type === "fiat" ? (
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            Channels <span className="font-semibold text-slate-700">cash</span> and{" "}
            <span className="font-semibold text-slate-700">bank</span> will be created automatically.
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            Add network channels (TRC20, ERC20, …) after creating the currency.
          </div>
        )}

        {error && (
          <div className="text-[12px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canSubmit
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {t("currency_add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// ADD CHANNEL — привязан к валюте.
//   fiat  → cash | bank
//   crypto → network (TRC20/ERC20/…) + gasFee
// =========================================================================
function AddChannelPanel({ onBack }) {
  const { t } = useTranslation();
  const { currencies, findByCode } = useCurrencies();
  const { addChannel, channels } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [currencyCode, setCurrencyCode] = useState(currencies[0]?.code || "");
  const selectedCurrency = findByCode(currencyCode);
  const isCrypto = selectedCurrency?.type === "crypto";

  const [fiatKind, setFiatKind] = useState("cash"); // cash | bank
  const [network, setNetwork] = useState("TRC20");
  const [networkCustom, setNetworkCustom] = useState("");
  const [gasFee, setGasFee] = useState("");

  // При смене currency ресетим зависящие поля
  React.useEffect(() => {
    setFiatKind("cash");
    setNetwork("TRC20");
    setNetworkCustom("");
    setGasFee("");
  }, [currencyCode]);

  const existingKinds = useMemo(
    () => channels.filter((c) => c.currencyCode === currencyCode),
    [channels, currencyCode]
  );

  const finalNetwork = network === "__custom" ? networkCustom.trim().toUpperCase() : network;
  const duplicate = useMemo(() => {
    if (!selectedCurrency) return false;
    if (isCrypto) {
      return existingKinds.some(
        (c) => c.kind === "network" && (c.network || "").toUpperCase() === finalNetwork
      );
    }
    return existingKinds.some((c) => c.kind === fiatKind);
  }, [existingKinds, isCrypto, fiatKind, finalNetwork, selectedCurrency]);

  const canSubmit = selectedCurrency && !duplicate && (!isCrypto || finalNetwork.length > 0);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = { currencyCode };
    if (isCrypto) {
      payload.kind = "network";
      payload.network = finalNetwork;
      if (gasFee) payload.gasFee = parseFloat(gasFee);
    } else {
      payload.kind = fiatKind;
    }
    const id = addChannel(payload);
    logAudit({
      action: "create",
      entity: "channel",
      entityId: id,
      summary: `Added channel for ${currencyCode}: ${
        isCrypto ? `${finalNetwork}${gasFee ? ` (gas ${gasFee})` : ""}` : fiatKind
      }`,
    });
    onBack();
  };

  return (
    <div className="p-5 max-h-[60vh] overflow-auto">
      <SubPanelHeader onBack={onBack} title={t("channel_add_title")} />

      <div className="space-y-4 max-w-md">
        <Field label="Currency">
          <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap w-full">
            {currencies.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCurrencyCode(c.code)}
                className={`px-3 py-1.5 text-[12px] font-bold rounded-[8px] transition-all ${
                  currencyCode === c.code
                    ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {c.code}
                <span className="ml-1 text-[9px] font-semibold text-slate-400">
                  {c.type === "crypto" ? "crypto" : "fiat"}
                </span>
              </button>
            ))}
          </div>
        </Field>

        {!isCrypto && (
          <Field label={t("channel_kind")}>
            <div className="flex gap-1.5">
              <SegBtn active={fiatKind === "cash"} onClick={() => setFiatKind("cash")}>
                💵 Cash
              </SegBtn>
              <SegBtn active={fiatKind === "bank"} onClick={() => setFiatKind("bank")}>
                🏦 Bank
              </SegBtn>
            </div>
          </Field>
        )}

        {isCrypto && (
          <>
            <Field label={t("channel_network")}>
              <div className="flex flex-wrap gap-1.5">
                {NETWORKS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNetwork(n)}
                    className={`px-3 py-2 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                      network === n
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setNetwork("__custom")}
                  className={`px-3 py-2 rounded-[8px] text-[12px] font-semibold border transition-colors ${
                    network === "__custom"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  Custom…
                </button>
              </div>
              {network === "__custom" && (
                <input
                  type="text"
                  value={networkCustom}
                  onChange={(e) => setNetworkCustom(e.target.value.toUpperCase())}
                  placeholder="POLYGON"
                  className="mt-2 w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2 text-[13px] font-semibold uppercase tracking-wider outline-none"
                />
              )}
            </Field>
            <Field label={t("channel_gas")}>
              <input
                type="text"
                value={gasFee}
                onChange={(e) => setGasFee(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="1.0"
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2.5 text-[14px] tabular-nums outline-none"
              />
            </Field>
          </>
        )}

        {duplicate && (
          <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            This channel already exists on {currencyCode}.
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canSubmit
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {t("channel_add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// ADD PAIR — выбор fromChannel + toChannel + rate.
// =========================================================================
function AddPairPanel({ onBack }) {
  const { t } = useTranslation();
  const { currencies } = useCurrencies();
  const { channels, pairs, addPair, getRate } = useRates();
  const { addEntry: logAudit } = useAudit();

  const [fromCurrency, setFromCurrency] = useState(currencies[0]?.code || "");
  const [toCurrency, setToCurrency] = useState(
    currencies.find((c) => c.code !== (currencies[0]?.code))?.code || ""
  );
  const [fromChannelId, setFromChannelId] = useState("");
  const [toChannelId, setToChannelId] = useState("");
  const [rate, setRate] = useState("");
  const [spreadInput, setSpreadInput] = useState("");
  const [editingSpread, setEditingSpread] = useState(false);

  const mid = getMidRate(fromCurrency, toCurrency, getRate);
  const derivedSpread = computeSpread(rate, fromCurrency, toCurrency, getRate);
  const displaySpread = editingSpread
    ? spreadInput
    : derivedSpread != null
    ? formatSpread(derivedSpread)
    : "";

  const handleRateChange = (e) => {
    setRate(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."));
  };

  const handleSpreadChange = (e) => {
    // Разрешаем цифры, точку, запятую и знаки +/-. Это явный text-input,
    // а не type="number", чтобы пользователь мог набрать "+0.5" / "-0.25"
    // без того чтобы браузер его обрезал.
    const cleaned = e.target.value.replace(/[^\d.,+-]/g, "").replace(",", ".");
    setSpreadInput(cleaned);
    setEditingSpread(true);
    const newRate = computeRateFromSpread(cleaned, fromCurrency, toCurrency, getRate);
    if (newRate != null && newRate > 0) {
      setRate(String(Number(newRate.toFixed(8))));
    }
  };

  const fromChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === fromCurrency),
    [channels, fromCurrency]
  );
  const toChannels = useMemo(
    () => channels.filter((c) => c.currencyCode === toCurrency),
    [channels, toCurrency]
  );

  // Авто-выбор первого канала при смене валюты
  React.useEffect(() => {
    setFromChannelId(fromChannels[0]?.id || "");
  }, [fromCurrency, fromChannels]);
  React.useEffect(() => {
    setToChannelId(toChannels[0]?.id || "");
  }, [toCurrency, toChannels]);

  const sameCurrency = fromCurrency === toCurrency;
  const duplicate = useMemo(
    () => pairs.some((p) => p.fromChannelId === fromChannelId && p.toChannelId === toChannelId),
    [pairs, fromChannelId, toChannelId]
  );
  const noChannels = fromChannels.length === 0 || toChannels.length === 0;

  const canSubmit =
    !sameCurrency &&
    !duplicate &&
    !noChannels &&
    fromChannelId &&
    toChannelId &&
    parseFloat(rate) > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const res = addPair({ fromChannelId, toChannelId, rate, priority: 10 });
    if (!res.ok) return;
    const fromCh = channels.find((c) => c.id === fromChannelId);
    const toCh = channels.find((c) => c.id === toChannelId);
    logAudit({
      action: "create",
      entity: "rate",
      entityId: rateKey(fromCurrency, toCurrency),
      summary: `Added pair ${fromCurrency} (${channelLabel(fromCh)}) → ${toCurrency} (${channelLabel(
        toCh
      )}) @ ${rate}`,
    });
    onBack();
  };

  return (
    <div className="p-5 max-h-[60vh] overflow-auto">
      <SubPanelHeader onBack={onBack} title={t("add_pair")} />

      <div className="space-y-4 max-w-md">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("base_currency") || "From"}>
            <CurrencyPicker
              value={fromCurrency}
              onChange={setFromCurrency}
              currencies={currencies}
            />
            <ChannelPicker
              channels={fromChannels}
              value={fromChannelId}
              onChange={setFromChannelId}
            />
          </Field>
          <Field label={t("quote_currency") || "To"}>
            <CurrencyPicker
              value={toCurrency}
              onChange={setToCurrency}
              currencies={currencies}
            />
            <ChannelPicker
              channels={toChannels}
              value={toChannelId}
              onChange={setToChannelId}
            />
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_7rem] gap-2 items-end">
          <Field label={t("rate") || "Rate"}>
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={handleRateChange}
              placeholder="0.00"
              title={mid != null ? `mid ${mid.toFixed(6)}` : "no mid rate"}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] px-3 py-2.5 text-[16px] font-bold text-slate-900 tabular-nums outline-none transition-colors"
            />
          </Field>
          <Field label="Spread %">
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={displaySpread}
                onChange={handleSpreadChange}
                onFocus={() => setEditingSpread(true)}
                onBlur={() => {
                  setEditingSpread(false);
                  setSpreadInput("");
                }}
                disabled={mid == null}
                placeholder={mid == null ? "—" : "0.00"}
                title={mid != null ? `mid ${mid.toFixed(6)}` : "no mid rate"}
                className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 rounded-[10px] pl-3 pr-6 py-2.5 text-[14px] font-semibold text-slate-700 tabular-nums outline-none transition-colors disabled:text-slate-300 disabled:cursor-not-allowed"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">
                %
              </span>
            </div>
          </Field>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">
          1 {fromCurrency} ={" "}
          <span className="font-bold text-slate-700 tabular-nums">{rate || "?"}</span> {toCurrency}
          {mid != null && (
            <span className="text-slate-400">
              {" · "}mid <span className="tabular-nums">{mid.toFixed(4)}</span>
            </span>
          )}
        </p>

        {sameCurrency && (
          <Warn>Base and quote must differ</Warn>
        )}
        {noChannels && !sameCurrency && (
          <Warn>
            {fromChannels.length === 0 ? fromCurrency : toCurrency} has no channels yet — add one first.
          </Warn>
        )}
        {duplicate && !sameCurrency && !noChannels && (
          <Warn>
            Pair on these channels already exists ({channelLabel(
              channels.find((c) => c.id === fromChannelId)
            )} → {channelLabel(channels.find((c) => c.id === toChannelId))}).
          </Warn>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
              canSubmit
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {t("add_pair")}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Shared UI primitives (панельные)
// =========================================================================
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-[12px] font-semibold rounded-[8px] transition-all ${
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

function Warn({ children }) {
  return (
    <div className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
      {children}
    </div>
  );
}

function CurrencyPicker({ value, onChange, currencies }) {
  return (
    <div className="inline-flex bg-slate-100 p-1 rounded-[10px] gap-0.5 flex-wrap w-full mb-2">
      {currencies.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => onChange(c.code)}
          className={`px-2.5 py-1.5 text-[12px] font-bold rounded-[8px] transition-all ${
            value === c.code
              ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {c.code}
        </button>
      ))}
    </div>
  );
}

function ChannelPicker({ channels, value, onChange }) {
  if (channels.length === 0) {
    return (
      <div className="text-[11px] text-slate-400 italic px-2 py-1">no channels</div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {channels.map((ch) => (
        <button
          key={ch.id}
          type="button"
          onClick={() => onChange(ch.id)}
          className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${
            value === ch.id
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
          }`}
          title={ch.id}
        >
          {channelLabel(ch)}
          {ch.gasFee != null && (
            <span className="ml-1 text-[9px] opacity-70 tabular-nums">gas {ch.gasFee}</span>
          )}
        </button>
      ))}
    </div>
  );
}
