// src/components/InlineOtcBlock.jsx
// Inline OTC сделка — встраивается ВНУТРЬ ExchangeForm после IN section.
// Apple-style polish: gradient panels, мягкие тени, segmented control,
// чёткая визуальная иерархия. Цвета: indigo (primary) / emerald (in) /
// rose (out) / amber (partner-pays) / cyan (deferred).

import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Handshake,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
} from "lucide-react";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import PartnerSelect from "./PartnerSelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAudit } from "../store/audit.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateOtcDeal, withToast } from "../lib/supabaseWrite.js";

// Палитра режимов. Tailwind JIT требует статичные classnames — поэтому
// храним полные строки, а не интерполируем.
const MODE_THEME = {
  self: {
    label: "Зачислил нам",
    sub: "Валюта уже на нашем счёте — выдаём клиенту со своего",
    icon: ArrowDownToLine,
    // success-bar
    successWrap: "bg-gradient-to-br from-indigo-50/60 to-white border-indigo-200/80",
    successIconWrap: "bg-indigo-100 ring-1 ring-indigo-200/60",
    successIcon: "text-indigo-700",
    successTitle: "text-indigo-900",
    successChip: "bg-indigo-100 text-indigo-800",
    successSubChip: "bg-indigo-200/70 text-indigo-900",
    successBody: "text-indigo-800/85",
    successBtn: "text-indigo-700 hover:text-indigo-900",
    // mode card active
    cardActive: "bg-gradient-to-br from-indigo-50 to-white border-indigo-300",
    cardIconActive: "bg-indigo-100 text-indigo-700",
  },
  partner_pays_client: {
    label: "Выдаёт клиенту",
    sub: "Партнёр передаёт валюту клиенту напрямую — у нас IN нет",
    icon: ArrowUpFromLine,
    successWrap: "bg-gradient-to-br from-amber-50/60 to-white border-amber-200/80",
    successIconWrap: "bg-amber-100 ring-1 ring-amber-200/60",
    successIcon: "text-amber-700",
    successTitle: "text-amber-900",
    successChip: "bg-amber-100 text-amber-800",
    successSubChip: "bg-amber-200/70 text-amber-900",
    successBody: "text-amber-800/85",
    successBtn: "text-amber-700 hover:text-amber-900",
    cardActive: "bg-gradient-to-br from-amber-50 to-white border-amber-300",
    cardIconActive: "bg-amber-100 text-amber-700",
  },
  partner_deferred: {
    label: "Зачислит позже",
    sub: "Партнёр должен зачислить позже — создастся долг",
    icon: Handshake,
    successWrap: "bg-gradient-to-br from-cyan-50/60 to-white border-cyan-200/80",
    successIconWrap: "bg-cyan-100 ring-1 ring-cyan-200/60",
    successIcon: "text-cyan-700",
    successTitle: "text-cyan-900",
    successChip: "bg-cyan-100 text-cyan-800",
    successSubChip: "bg-cyan-200/70 text-cyan-900",
    successBody: "text-cyan-800/85",
    successBtn: "text-cyan-700 hover:text-cyan-900",
    cardActive: "bg-gradient-to-br from-cyan-50 to-white border-cyan-300",
    cardIconActive: "bg-cyan-100 text-cyan-700",
  },
};

export default function InlineOtcBlock({
  fromAccountId,
  fromAmount,
  fromCurrency,
  onCreated,
  existing,
  onClear,
}) {
  const { accounts, balanceOf } = useAccounts();
  const { addEntry: logAudit } = useAudit();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("self");

  useEffect(() => {
    if (!open) {
      setToId("");
      setToAmount("");
      setCounterparty("");
      setNote("");
      setOccurredAt("");
      setMode("self");
    }
  }, [open]);

  const fromAcc = activeAccounts.find((a) => a.id === fromAccountId);
  const fromAmtNum = parseFloat(String(fromAmount).replace(",", ".")) || 0;
  const fromBalance = fromAcc ? balanceOf(fromAcc.id) : 0;
  const insufficient = fromAcc && fromAmtNum > fromBalance;
  const fromReady = fromAcc && fromAmtNum > 0;

  const toAcc = activeAccounts.find((a) => a.id === toId);
  const toAmt = parseFloat(String(toAmount).replace(",", ".")) || 0;

  const computedRate = useMemo(() => {
    if (!fromAcc || !toAcc) return 0;
    if (fromAcc.currency === toAcc.currency) return 1;
    if (fromAmtNum > 0 && toAmt > 0) return toAmt / fromAmtNum;
    return 0;
  }, [fromAcc, toAcc, fromAmtNum, toAmt]);

  const canSubmit =
    fromReady &&
    toAcc &&
    fromAcc.id !== toAcc.id &&
    toAmt > 0 &&
    computedRate > 0 &&
    counterparty.trim().length > 0;

  const theme = MODE_THEME[mode];

  const handleSubmit = async () => {
    if (!canSubmit || busy || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      const occurredIso = occurredAt ? new Date(occurredAt).toISOString() : null;
      const res = await withToast(
        () =>
          rpcCreateOtcDeal({
            officeId: fromAcc.officeId,
            fromAccountId: fromAcc.id,
            fromAmount: fromAmtNum,
            toAccountId: toAcc.id,
            toAmount: toAmt,
            rate: computedRate,
            counterparty: counterparty.trim(),
            note: note.trim(),
            occurredAt: occurredIso,
            partnerPaysClient: mode === "partner_pays_client",
            partnerDeferred: mode === "partner_deferred",
          }),
        {
          success:
            mode === "partner_pays_client"
              ? "OTC создана · партнёр выдаёт клиенту"
              : mode === "partner_deferred"
              ? "OTC создана · долг зафиксирован"
              : occurredIso
              ? "OTC оформлена задним числом"
              : "OTC создана",
          errorPrefix: "OTC failed",
        }
      );
      if (res.ok) {
        const modeLabel =
          mode === "partner_pays_client"
            ? " · partner pays client"
            : mode === "partner_deferred"
            ? " · partner deferred"
            : "";
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${counterparty.trim()}: ${fmt(fromAmtNum, fromAcc.currency)} ${fromAcc.currency} → ${fmt(toAmt, toAcc.currency)} ${toAcc.currency}${modeLabel}${occurredIso ? " (бэкдейт)" : ""}`,
        });
        onCreated?.({
          dealId: res.result,
          partnerName: counterparty.trim(),
          fromAccountId: fromAcc.id,
          fromAmount: fromAmtNum,
          fromCurrency: fromAcc.currency,
          toAccountId: toAcc.id,
          toAmount: toAmt,
          toCurrency: toAcc.currency,
          rate: computedRate,
          occurredAt: occurredIso,
          partnerPaysClient: mode === "partner_pays_client",
          partnerDeferred: mode === "partner_deferred",
        });
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // SUCCESS BAR (свернуто, после создания OTC)
  // ─────────────────────────────────────────────────────────────────
  if (existing && !open) {
    const exMode = existing.partnerPaysClient
      ? "partner_pays_client"
      : existing.partnerDeferred
      ? "partner_deferred"
      : "self";
    const exTheme = MODE_THEME[exMode];
    return (
      <div
        className={`my-3 rounded-[14px] overflow-hidden border shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.04)] ${exTheme.successWrap}`}
      >
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${exTheme.successIconWrap}`}>
            <CheckCircle2 className={`w-4 h-4 ${exTheme.successIcon}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[13px] font-bold tracking-tight ${exTheme.successTitle}`}>
                OTC #{existing.dealId}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full ${exTheme.successChip}`}>
                {existing.partnerName}
              </span>
              {exMode !== "self" && (
                <span className={`text-[9.5px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full ${exTheme.successSubChip}`}>
                  {exTheme.label}
                </span>
              )}
            </div>
            <div className={`text-[11.5px] mt-1 inline-flex items-center gap-1.5 flex-wrap tabular-nums ${exTheme.successBody}`}>
              <span className="font-medium">
                {curSymbol(existing.fromCurrency)}
                {fmt(existing.fromAmount, existing.fromCurrency)}{" "}
                <span className="opacity-60">{existing.fromCurrency}</span>
              </span>
              <ArrowLeftRight className="w-3 h-3 opacity-50" />
              <span className="font-bold">
                {curSymbol(existing.toCurrency)}
                {fmt(existing.toAmount, existing.toCurrency)}{" "}
                <span className="opacity-60">{existing.toCurrency}</span>
              </span>
              <span className="opacity-40">·</span>
              <span className="opacity-80">@ {existing.rate.toFixed(4)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className={`text-[10.5px] font-semibold tracking-tight px-2.5 py-1.5 rounded-full bg-white/60 hover:bg-white transition-colors ${exTheme.successBtn}`}
          >
            Сбросить
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // COLLAPSED CTA (нет existing) — apple-style call-to-action card
  // ─────────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <div className="my-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!fromReady}
          className={`group w-full flex items-center justify-between gap-3 px-4 py-3 rounded-[14px] border transition-all ${
            fromReady
              ? "bg-gradient-to-br from-indigo-50/70 via-white to-white border-indigo-200/80 hover:border-indigo-300 hover:from-indigo-50 hover:shadow-[0_1px_2px_rgba(79,70,229,0.06),0_8px_24px_-12px_rgba(79,70,229,0.18)]"
              : "bg-slate-50/60 border-slate-200/70 cursor-not-allowed"
          }`}
          title={
            fromReady
              ? "Оформить OTC обмен через партнёра"
              : "Заполните «Принимаем» выше — счёт и сумму, которые приняли от клиента"
          }
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                fromReady
                  ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200/60"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              <Handshake className="w-4 h-4" />
            </div>
            <div className="text-left min-w-0">
              <div
                className={`text-[13px] font-bold tracking-tight ${
                  fromReady ? "text-slate-900" : "text-slate-400"
                }`}
              >
                Сделка с контрагентом
              </div>
              <div
                className={`text-[11px] mt-0.5 truncate ${
                  fromReady ? "text-slate-500" : "text-slate-400"
                }`}
              >
                {fromReady
                  ? `Обменять ${fmt(fromAmtNum, fromAcc.currency)} ${fromAcc.currency} через партнёра`
                  : "Сначала заполните «Принимаем»"}
              </div>
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 transition-transform group-hover:translate-y-0.5 ${
              fromReady ? "text-indigo-500" : "text-slate-300"
            }`}
          />
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // EXPANDED FORM
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="my-3 rounded-[16px] overflow-hidden border border-slate-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-slate-200/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-indigo-100 ring-1 ring-indigo-200/60 flex items-center justify-center">
            <Handshake className="w-4 h-4 text-indigo-700" />
          </div>
          <div>
            <div className="text-[14px] font-bold text-slate-900 tracking-tight">
              Сделка с контрагентом
            </div>
            <div className="text-[10.5px] text-slate-500 mt-0.5">
              OTC обмен через партнёра
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 px-2 py-1 rounded-[8px] hover:bg-slate-100/80 transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
          Свернуть
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Партнёр */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
            Партнёр
          </label>
          <PartnerSelect value={counterparty} onChange={setCounterparty} />
        </div>

        {/* Mode segmented control — iOS style */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
            Расчёт
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(MODE_THEME).map(([id, t]) => {
              const Icon = t.icon;
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`text-left p-3 rounded-[12px] border transition-all ${
                    active
                      ? `${t.cardActive} shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_8px_-4px_rgba(15,23,42,0.08)]`
                      : "bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                        active ? t.cardIconActive : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span
                      className={`text-[12px] font-bold tracking-tight ${
                        active ? "text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {t.label}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-slate-500 leading-snug">
                    {t.sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* From + To carded layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
          {/* Отдаём */}
          <div className="rounded-[14px] bg-gradient-to-br from-rose-50/40 to-white border border-rose-200/70 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowUpFromLine className="w-3 h-3 text-rose-600" />
              <span className="text-[9.5px] font-bold text-rose-700 tracking-[0.1em] uppercase">
                Отдаём партнёру
              </span>
            </div>
            <div className="text-[10.5px] text-slate-500 truncate">
              {fromAcc ? `${officeName(fromAcc.officeId)} · ${fromAcc.name}` : "—"}
            </div>
            <div className="text-[20px] font-bold tabular-nums tracking-tight text-slate-900 mt-0.5 leading-none">
              {curSymbol(fromAcc?.currency)}
              {fmt(fromAmtNum, fromAcc?.currency)}
              <span className="text-[11px] text-slate-400 font-medium ml-1">
                {fromAcc?.currency}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              из «Принимаем» — что приняли от клиента
            </div>
            {insufficient && (
              <div className="mt-1.5 text-[10px] text-amber-700 inline-flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" />
                Недостаточно — есть {fmt(fromBalance, fromAcc?.currency)}
              </div>
            )}
          </div>

          {/* Center arrow */}
          <div className="hidden md:flex items-center justify-center px-1">
            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center">
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
            </div>
          </div>

          {/* Получаем */}
          <div
            className={`rounded-[14px] bg-gradient-to-br to-white border p-3 ${
              mode === "partner_pays_client"
                ? "from-amber-50/40 border-amber-200/70"
                : mode === "partner_deferred"
                ? "from-cyan-50/40 border-cyan-200/70"
                : "from-emerald-50/40 border-emerald-200/70"
            }`}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <ArrowDownToLine
                className={`w-3 h-3 ${
                  mode === "partner_pays_client"
                    ? "text-amber-600"
                    : mode === "partner_deferred"
                    ? "text-cyan-600"
                    : "text-emerald-600"
                }`}
              />
              <span
                className={`text-[9.5px] font-bold tracking-[0.1em] uppercase ${
                  mode === "partner_pays_client"
                    ? "text-amber-700"
                    : mode === "partner_deferred"
                    ? "text-cyan-700"
                    : "text-emerald-700"
                }`}
              >
                {mode === "partner_pays_client"
                  ? "Партнёр выдаёт клиенту"
                  : mode === "partner_deferred"
                  ? "Должен зачислить"
                  : "Получаем от партнёра"}
              </span>
            </div>
            <GroupedAccountSelect
              accounts={activeAccounts.filter((a) => a.id !== fromAccountId)}
              value={toId}
              onChange={setToId}
              placeholder={mode === "self" ? "Счёт зачисления" : "Валюта (учёт)"}
            />
            {toAcc && (
              <input
                type="text"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) =>
                  setToAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder={`0 ${toAcc.currency}`}
                className={`mt-2 w-full bg-white border rounded-[10px] px-3 py-2 text-[16px] font-bold tabular-nums tracking-tight outline-none transition-colors ${
                  mode === "partner_pays_client"
                    ? "border-amber-200 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/15"
                    : mode === "partner_deferred"
                    ? "border-cyan-200 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/15"
                    : "border-emerald-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15"
                }`}
              />
            )}
          </div>
        </div>

        {/* Эфф. курс — appears smoothly */}
        {fromAcc && toAcc && fromAmtNum > 0 && toAmt > 0 && fromAcc.currency !== toAcc.currency && (
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/70 border border-slate-200/70 rounded-[12px]">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-slate-400" />
              <span className="text-[10.5px] font-bold text-slate-500 tracking-[0.1em] uppercase">
                Эфф. курс
              </span>
            </div>
            <span className="text-[13px] font-bold tabular-nums tracking-tight text-slate-900">
              1 {fromAcc.currency} ={" "}
              <span className="text-indigo-700">{computedRate.toFixed(6)}</span>{" "}
              <span className="text-slate-400 font-medium">{toAcc.currency}</span>
            </span>
          </div>
        )}

        {/* Hints — apple-like info row */}
        {mode === "partner_pays_client" && toAcc && (
          <div className="px-3 py-2 rounded-[10px] bg-amber-50/60 border border-amber-200/60 text-[11px] text-amber-800 inline-flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              На наш счёт зачисления не будет — партнёр передаёт{" "}
              <strong>{toAcc.currency}</strong> клиенту напрямую.
            </span>
          </div>
        )}
        {mode === "partner_deferred" && toAcc && (
          <div className="px-3 py-2 rounded-[10px] bg-cyan-50/60 border border-cyan-200/60 text-[11px] text-cyan-800 inline-flex items-start gap-1.5">
            <Handshake className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Зачисления нет — создастся долг. Партнёр должен нам{" "}
              <strong>{toAcc.currency}</strong>. Виден в Obligations → they_owe.
            </span>
          </div>
        )}

        {/* Backdate + note */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              <Calendar className="w-3 h-3" />
              Задним числом
            </label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 rounded-[10px] px-3 py-2 text-[12.5px] tabular-nums outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 tracking-[0.1em] uppercase">
              Заметка
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="—"
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 rounded-[10px] px-3 py-2 text-[12.5px] outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3.5 border-t border-slate-200/60 bg-slate-50/40 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-white border border-slate-200 text-slate-700 text-[12.5px] font-semibold hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 transition-colors"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className={`px-4 py-2 rounded-[10px] text-[12.5px] font-bold tracking-tight transition-all ${
            canSubmit && !busy
              ? "bg-slate-900 text-white hover:bg-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.18),0_4px_12px_-4px_rgba(15,23,42,0.18)] hover:shadow-[0_2px_4px_rgba(15,23,42,0.2),0_8px_20px_-6px_rgba(15,23,42,0.24)]"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Создание…" : occurredAt ? "Создать (задним числом)" : "Создать OTC"}
        </button>
      </div>
    </div>
  );
}
