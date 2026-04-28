// src/components/InlineOtcBlock.jsx
// Inline OTC сделка с контрагентом — встраивается ВНУТРЬ ExchangeForm
// после IN section. Сценарий: кассир принял RUB у клиента, тут же
// оформляет OTC обмен с партнёром (RUB → USDT через партнёра), затем
// продолжает основную сделку (выдаёт USDT клиенту).
//
// Collapsible. Submit пишет отдельный deal через rpcCreateOtcDeal —
// независимо от основной сделки. После создания блок схлопывается с
// success badge.

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
import { useRates } from "../store/rates.jsx";
import { fmt, curSymbol, multiplyAmount } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateOtcDeal, withToast } from "../lib/supabaseWrite.js";

export default function InlineOtcBlock() {
  const { accounts, balanceOf } = useAccounts();
  const { addEntry: logAudit } = useAudit();
  const { getRate } = useRates();

  const activeAccounts = useMemo(() => accounts.filter((a) => a.active), [accounts]);

  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState(null);

  const reset = () => {
    setFromId("");
    setToId("");
    setFromAmount("");
    setToAmount("");
    setCounterparty("");
    setNote("");
    setOccurredAt("");
  };

  const from = activeAccounts.find((a) => a.id === fromId);
  const to = activeAccounts.find((a) => a.id === toId);
  const fromBalance = from ? balanceOf(from.id) : 0;
  const fromAmt = parseFloat(String(fromAmount).replace(",", ".")) || 0;
  const toAmt = parseFloat(String(toAmount).replace(",", ".")) || 0;
  const insufficient = from && fromAmt > fromBalance;
  const sameAccount = fromId && toId && fromId === toId;

  const computedRate = useMemo(() => {
    if (!from || !to) return 0;
    if (from.currency === to.currency) return 1;
    if (fromAmt > 0 && toAmt > 0) return toAmt / fromAmt;
    return 0;
  }, [from, to, fromAmt, toAmt]);

  // Auto-fill toAmount по market rate как подсказка
  useEffect(() => {
    if (fromAmt > 0 && !toAmount && from && to && from.currency !== to.currency) {
      const r = getRate(from.currency, to.currency);
      if (r && Number.isFinite(r) && r > 0) {
        setToAmount(String(multiplyAmount(fromAmt, r, 2)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromAmt, from, to]);

  const canSubmit =
    from &&
    to &&
    !sameAccount &&
    fromAmt > 0 &&
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
            officeId: from.officeId,
            fromAccountId: from.id,
            fromAmount: fromAmt,
            toAccountId: to.id,
            toAmount: toAmt,
            rate: computedRate,
            counterparty: counterparty.trim(),
            note: note.trim(),
            occurredAt: occurredIso,
          }),
        {
          success: occurredIso ? "OTC оформлена задним числом" : "OTC сделка создана",
          errorPrefix: "OTC failed",
        }
      );
      if (res.ok) {
        logAudit({
          action: "create",
          entity: "transaction",
          entityId: String(res.result || ""),
          summary: `OTC ${counterparty.trim()}: ${fmt(fromAmt, from.currency)} ${from.currency} → ${fmt(toAmt, to.currency)} ${to.currency}${occurredIso ? ` (бэкдейт)` : ""}`,
        });
        setLastCreatedId(res.result);
        reset();
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="my-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setLastCreatedId(null);
          }}
          className="w-full inline-flex items-center justify-between gap-3 px-4 py-2.5 rounded-[10px] bg-indigo-50/60 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
          title="OTC обмен с партнёром: например приняли RUB → партнёр прислал USDT. Без fee, можно задним числом."
        >
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" />
            <span className="text-[12.5px] font-bold">
              Сделка с контрагентом (OTC)
            </span>
            <span className="text-[10.5px] font-normal text-indigo-600/80">
              · обмен через партнёра, можно задним числом
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastCreatedId && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5">
                <CheckCircle2 className="w-2.5 h-2.5" />
                #{lastCreatedId} создана
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5" />
          </div>
        </button>
      </div>
    );
  }

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
        {/* Counterparty — селектор с поиском и созданием inline */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 mb-1 tracking-wide uppercase">
            Контрагент / Партнёр
          </label>
          <PartnerSelect value={counterparty} onChange={setCounterparty} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {/* From */}
          <div>
            <label className="block text-[10px] font-bold text-rose-700 mb-1 tracking-wide uppercase">
              Отдаём
            </label>
            <GroupedAccountSelect
              accounts={activeAccounts}
              value={fromId}
              onChange={setFromId}
              placeholder="Счёт списания"
            />
            {from && (
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) =>
                  setFromAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder={`0 ${from.currency}`}
                className={`mt-1.5 w-full bg-white border-2 rounded-[8px] px-2.5 py-1.5 text-[14px] font-bold tabular-nums outline-none ${
                  insufficient ? "border-amber-400" : "border-rose-200 focus:border-rose-400"
                }`}
              />
            )}
            {from && (
              <div className="mt-1 text-[10px] text-slate-500 tabular-nums">
                {officeName(from.officeId)} · {curSymbol(from.currency)}
                {fmt(fromBalance, from.currency)} в наличии
              </div>
            )}
            {insufficient && (
              <div className="mt-1 text-[10px] font-medium text-amber-700 inline-flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" />
                Недостаточно средств
              </div>
            )}
          </div>

          {/* To */}
          <div>
            <label className="block text-[10px] font-bold text-emerald-700 mb-1 tracking-wide uppercase">
              Получаем
            </label>
            <GroupedAccountSelect
              accounts={activeAccounts.filter((a) => a.id !== fromId)}
              value={toId}
              onChange={setToId}
              placeholder="Счёт зачисления"
            />
            {to && (
              <input
                type="text"
                inputMode="decimal"
                value={toAmount}
                onChange={(e) =>
                  setToAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                }
                placeholder={`0 ${to.currency}`}
                className="mt-1.5 w-full bg-white border-2 border-emerald-200 focus:border-emerald-400 rounded-[8px] px-2.5 py-1.5 text-[14px] font-bold tabular-nums outline-none"
              />
            )}
          </div>
        </div>

        {/* Computed rate */}
        {from && to && fromAmt > 0 && toAmt > 0 && from.currency !== to.currency && (
          <div className="bg-white border border-slate-200 rounded-[8px] px-2.5 py-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Эфф. курс
            </span>
            <span className="text-[11.5px] font-bold tabular-nums text-slate-800">
              1 {from.currency} = {computedRate.toFixed(6)} {to.currency}
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

        {/* Submit */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded-[8px] bg-white border border-slate-200 text-slate-700 text-[11.5px] font-semibold hover:bg-slate-50 transition-colors disabled:opacity-60"
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
              : "Создать OTC сделку"}
          </button>
        </div>
      </div>
    </div>
  );
}
