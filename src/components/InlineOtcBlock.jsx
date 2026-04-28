// src/components/InlineOtcBlock.jsx
// Inline OTC сделка — встраивается ВНУТРЬ ExchangeForm после IN section.
// Сценарий: кассир принял RUB у клиента, тут же оформляет OTC обмен с
// партнёром (RUB → USDT через партнёра), затем выдача USDT клиенту.
//
// "Отдаём" auto-filled из IN section (что только что приняли от клиента).
// Юзер вводит только: партнёр + получаем (счёт + сумма).

import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Calendar,
  AlertCircle,
} from "lucide-react";
import GroupedAccountSelect from "./GroupedAccountSelect.jsx";
import PartnerSelect from "./PartnerSelect.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { useAudit } from "../store/audit.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateOtcDeal, withToast } from "../lib/supabaseWrite.js";

export default function InlineOtcBlock({
  // From IN section: что приняли от клиента — это и есть "отдаём партнёру"
  fromAccountId,
  fromAmount,
  fromCurrency,
  // Callback после успешного создания OTC — ExchangeForm пишет в state и
  // показывает options в outputs ("это OTC-сделка").
  onCreated,
  // Уже созданная OTC (после submit) — для свернутого вида с инфой
  existing,
  // Сброс existing — если юзер хочет пересоздать
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

  // Сбрасываем форму когда блок свернут.
  useEffect(() => {
    if (!open) {
      setToId("");
      setToAmount("");
      setCounterparty("");
      setNote("");
      setOccurredAt("");
    }
  }, [open]);

  const fromAcc = activeAccounts.find((a) => a.id === fromAccountId);
  const fromAmtNum = parseFloat(String(fromAmount).replace(",", ".")) || 0;
  const fromBalance = fromAcc ? balanceOf(fromAcc.id) : 0;
  const insufficient = fromAcc && fromAmtNum > fromBalance;
  const fromReady = fromAcc && fromAmtNum > 0;

  const toAcc = activeAccounts.find((a) => a.id === toId);
  const toAmt = parseFloat(String(toAmount).replace(",", ".")) || 0;

  // Курс вычисляется автоматически из сумм.
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
          }),
        {
          success: occurredIso ? "OTC оформлена задним числом" : "OTC создана",
          errorPrefix: "OTC failed",
        }
      );
      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${counterparty.trim()}: ${fmt(fromAmtNum, fromAcc.currency)} ${fromAcc.currency} → ${fmt(toAmt, toAcc.currency)} ${toAcc.currency}${occurredIso ? " (бэкдейт)" : ""}`,
        });
        // Передаём результат наверх — ExchangeForm применит к outputs.
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
        });
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // Свернутый вид + есть existing — показываем краткую инфу.
  if (existing && !open) {
    return (
      <div className="my-3 bg-emerald-50/40 border border-emerald-200 rounded-[12px] px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-bold text-emerald-900 inline-flex items-center gap-2 flex-wrap">
            <span>OTC #{existing.dealId} создана</span>
            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
              {existing.partnerName}
            </span>
          </div>
          <div className="text-[11px] text-emerald-800/80 inline-flex items-center gap-1.5 flex-wrap mt-0.5 tabular-nums">
            <span>
              {curSymbol(existing.fromCurrency)}
              {fmt(existing.fromAmount, existing.fromCurrency)} {existing.fromCurrency}
            </span>
            <ArrowLeftRight className="w-3 h-3" />
            <span className="font-semibold">
              {curSymbol(existing.toCurrency)}
              {fmt(existing.toAmount, existing.toCurrency)} {existing.toCurrency}
            </span>
            <span className="text-emerald-600">·</span>
            <span>курс {existing.rate.toFixed(4)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[10.5px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
        >
          Сбросить
        </button>
      </div>
    );
  }

  // Свернутый без existing — кнопка раскрытия.
  if (!open) {
    return (
      <div className="my-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!fromReady}
          className={`w-full inline-flex items-center justify-between gap-3 px-4 py-2.5 rounded-[10px] border transition-colors ${
            fromReady
              ? "bg-indigo-50/60 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300"
              : "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
          }`}
          title={
            fromReady
              ? "Оформить OTC обмен через партнёра"
              : "Заполните 'Принимаем' выше — сначала укажите счёт и сумму, которые приняли от клиента"
          }
        >
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" />
            <span className="text-[12.5px] font-bold">
              Сделка с контрагентом (OTC)
            </span>
            <span className="text-[10.5px] font-normal opacity-80">
              {fromReady
                ? `· обменять ${fmt(fromAmtNum, fromAcc.currency)} ${fromAcc.currency} через партнёра`
                : "· сначала заполните «Принимаем»"}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Раскрытый вид формы.
  return (
    <div className="my-3 bg-indigo-50/40 border-2 border-indigo-200 rounded-[12px] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-indigo-700" />
          <span className="text-[13px] font-bold text-indigo-900">
            OTC с контрагентом
          </span>
          <span className="text-[10px] text-indigo-700/70 uppercase tracking-wider">
            обмен через партнёра
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-indigo-600 hover:text-indigo-900 text-[11px] font-semibold inline-flex items-center gap-1"
        >
          <ChevronUp className="w-3 h-3" />
          Свернуть
        </button>
      </div>

      <div className="space-y-2.5">
        {/* Контрагент */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1 tracking-wide uppercase">
            Контрагент / Партнёр
          </label>
          <PartnerSelect value={counterparty} onChange={setCounterparty} />
        </div>

        {/* Отдаём (auto from IN) + Получаем */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {/* Отдаём — read-only display из IN section */}
          <div>
            <label className="block text-[10px] font-bold text-rose-700 mb-1 tracking-wide uppercase">
              Отдаём партнёру
            </label>
            <div className="bg-white border-2 border-rose-200 rounded-[8px] px-2.5 py-1.5">
              <div className="text-[11px] text-slate-500 truncate">
                {fromAcc ? `${officeName(fromAcc.officeId)} · ${fromAcc.name}` : "—"}
              </div>
              <div className="text-[15px] font-bold tabular-nums text-slate-900">
                {curSymbol(fromAcc?.currency)}
                {fmt(fromAmtNum, fromAcc?.currency)} {fromAcc?.currency}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                из «Принимаем» — то что приняли от клиента
              </div>
            </div>
            {insufficient && (
              <div className="mt-1 text-[10px] font-medium text-amber-700 inline-flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" />
                Недостаточно средств · в наличии {fmt(fromBalance, fromAcc?.currency)}
              </div>
            )}
          </div>

          {/* Получаем — input */}
          <div>
            <label className="block text-[10px] font-bold text-emerald-700 mb-1 tracking-wide uppercase">
              Получаем от партнёра
            </label>
            <GroupedAccountSelect
              accounts={activeAccounts.filter((a) => a.id !== fromAccountId)}
              value={toId}
              onChange={setToId}
              placeholder="Счёт зачисления"
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
                className="mt-1.5 w-full bg-white border-2 border-emerald-200 focus:border-emerald-400 rounded-[8px] px-2.5 py-1.5 text-[15px] font-bold tabular-nums outline-none"
              />
            )}
          </div>
        </div>

        {/* Эфф. курс */}
        {fromAcc && toAcc && fromAmtNum > 0 && toAmt > 0 && fromAcc.currency !== toAcc.currency && (
          <div className="bg-white border border-slate-200 rounded-[8px] px-2.5 py-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Эфф. курс
            </span>
            <span className="text-[11.5px] font-bold tabular-nums text-slate-800">
              1 {fromAcc.currency} = {computedRate.toFixed(6)} {toAcc.currency}
            </span>
          </div>
        )}

        {/* Backdate + note */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div>
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-500 mb-1 tracking-wide uppercase">
              <Calendar className="w-3 h-3" />
              Задним числом (опц.)
            </label>
            <input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[8px] px-2.5 py-1.5 text-[12px] tabular-nums outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1 tracking-wide uppercase">
              Заметка
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="—"
              className="w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 rounded-[8px] px-2.5 py-1.5 text-[12px] outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded-[8px] bg-white border border-slate-200 text-slate-700 text-[11.5px] font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
            className={`px-3 py-1.5 rounded-[8px] text-[11.5px] font-bold transition-colors ${
              canSubmit && !busy
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {busy
              ? "Создание…"
              : occurredAt
              ? "Создать (задним числом)"
              : "Создать OTC"}
          </button>
        </div>
      </div>
    </div>
  );
}
