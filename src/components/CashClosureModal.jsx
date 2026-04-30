// src/components/CashClosureModal.jsx
//
// Закрытие кассы (end-of-day) — менеджерский UI.
//
// Что делает:
//   - показывает все НАШИ счета текущего офиса с системным остатком
//   - менеджер вписывает фактический остаток per-currency
//   - система считает diff
//   - сохраняет в public.cash_closures (0087) — потом бухгалтер видит
//     это в AccountingTab и может approve/reject
//
// НЕ создаёт автоматических корректировок. Если разница реальна и нужно
// поправить баланс — это отдельная операция через Accounts → ⚖.

import React, { useEffect, useMemo, useState } from "react";
import {
  Scale, Building2, AlertCircle, CheckCircle2, Calendar, MessageSquare,
} from "lucide-react";
import Modal from "./ui/Modal.jsx";
import { useAccounts } from "../store/accounts.jsx";
import { fmt, curSymbol } from "../utils/money.js";
import { officeName } from "../store/data.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { rpcCreateCashClosure, withToast } from "../lib/supabaseWrite.js";

const numberOrZero = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export default function CashClosureModal({ open, currentOffice, onClose, onCreated }) {
  const { accounts, balanceOf } = useAccounts();
  const officeId = typeof currentOffice === "string" ? currentOffice : currentOffice?.id;

  // Группируем активные счета офиса по валюте, считаем системный итог.
  const byCurrency = useMemo(() => {
    const m = new Map();
    accounts
      .filter((a) => a.active && a.officeId === officeId)
      .forEach((a) => {
        const cur = a.currency;
        if (!m.has(cur)) m.set(cur, { currency: cur, systemTotal: 0, accounts: [] });
        const entry = m.get(cur);
        const bal = balanceOf(a.id) || 0;
        entry.systemTotal += bal;
        entry.accounts.push({ id: a.id, name: a.name, balance: bal });
      });
    return [...m.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }, [accounts, officeId, balanceOf]);

  const [closureDate, setClosureDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [actualMap, setActualMap] = useState({}); // { currency: amountStr }
  const [noteMap, setNoteMap] = useState({});     // { currency: noteStr }
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setClosureDate(new Date().toISOString().slice(0, 10));
      // Префилл фактического = системного (юзер только подтверждает или меняет)
      const m = {};
      byCurrency.forEach((c) => { m[c.currency] = String(c.systemTotal); });
      setActualMap(m);
      setNoteMap({});
      setComment("");
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalDiffByCurrency = useMemo(() => {
    return byCurrency.map((c) => {
      const actual = numberOrZero(actualMap[c.currency]);
      return { ...c, actual, diff: actual - c.systemTotal };
    });
  }, [byCurrency, actualMap]);

  const hasDiscrepancy = totalDiffByCurrency.some((c) => Math.abs(c.diff) > 0.00000001);
  const canSubmit = byCurrency.length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit || !isSupabaseConfigured) return;
    setBusy(true);
    try {
      const details = totalDiffByCurrency.map((c) => ({
        currency: c.currency,
        systemTotal: c.systemTotal,
        actualTotal: c.actual,
        note: noteMap[c.currency] || null,
      }));
      const res = await withToast(
        () => rpcCreateCashClosure({
          officeId,
          closureDate,
          details,
          comment,
        }),
        { success: "Закрытие кассы записано", errorPrefix: "Cash closure failed" }
      );
      if (res.ok) {
        onCreated?.(res.result);
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Закрытие кассы"
      subtitle={`${officeName(officeId) || "—"} · сверка системного и фактического остатка`}
      width="2xl"
    >
      <div className="p-5 space-y-4">
        {/* Date + comment */}
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              <Calendar className="w-3 h-3 inline mr-1" />
              Дата закрытия
            </label>
            <input
              type="date"
              value={closureDate}
              onChange={(e) => setClosureDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2 text-[13px] outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              <MessageSquare className="w-3 h-3 inline mr-1" />
              Комментарий менеджера (опционально)
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: смена Мурата, всё проверено"
              className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[10px] px-3 py-2 text-[13px] outline-none"
            />
          </div>
        </div>

        {/* Per-currency breakdown */}
        {byCurrency.length === 0 ? (
          <div className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            В этом офисе нет активных счетов.
          </div>
        ) : (
          <div className="rounded-[12px] border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 tracking-wider uppercase border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">Валюта</th>
                  <th className="px-3 py-2 text-right">Система</th>
                  <th className="px-3 py-2 text-right">Факт</th>
                  <th className="px-3 py-2 text-right">Разница</th>
                  <th className="px-3 py-2 text-left">Комментарий к разнице</th>
                </tr>
              </thead>
              <tbody>
                {totalDiffByCurrency.map((c) => {
                  const sym = curSymbol(c.currency);
                  const isMatch = Math.abs(c.diff) < 0.00000001;
                  const isPlus = c.diff > 0;
                  return (
                    <tr key={c.currency} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2.5">
                        <div className="font-bold text-slate-900">{c.currency}</div>
                        <div className="text-[10px] text-slate-400">
                          {c.accounts.length} счёт(а)
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700 font-semibold">
                        {sym}{fmt(c.systemTotal, c.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={actualMap[c.currency] || ""}
                          onChange={(e) => setActualMap((m) => ({
                            ...m,
                            [c.currency]: e.target.value.replace(/[^\d.,\-]/g, "").replace(",", "."),
                          }))}
                          className="w-32 text-right bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[6px] px-2 py-1 text-[13px] tabular-nums font-bold outline-none"
                        />
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap ${
                        isMatch ? "text-emerald-700" : isPlus ? "text-emerald-700" : "text-rose-700"
                      }`}>
                        {isMatch ? (
                          <span className="inline-flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                            0
                          </span>
                        ) : (
                          <>
                            {isPlus ? "+" : ""}
                            {sym}{fmt(c.diff, c.currency)}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={noteMap[c.currency] || ""}
                          onChange={(e) => setNoteMap((m) => ({ ...m, [c.currency]: e.target.value }))}
                          placeholder={isMatch ? "—" : "Объясни разницу"}
                          disabled={isMatch}
                          className={`w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-slate-400 rounded-[6px] px-2 py-1 text-[12px] outline-none ${
                            isMatch ? "opacity-50" : ""
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Hint */}
        <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-[11.5px] text-slate-600 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
          <div>
            Закрытие кассы НЕ изменяет балансы. Это отчёт для бухгалтера —
            он сверит и подтвердит в Capital → Бухгалтерский репорт.
            <br />
            {hasDiscrepancy && <>
              ⚠ Если разница реальная — бухгалтер оформит корректировку
              через Accounts → ⚖ отдельно.
            </>}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-[10px] bg-slate-100 text-slate-700 text-[13px] font-semibold hover:bg-slate-200 disabled:opacity-60"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors ${
            canSubmit
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
        >
          {busy ? "Сохранение…" : "Закрыть кассу"}
        </button>
      </div>
    </Modal>
  );
}
