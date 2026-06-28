// src/components/cashier/ledger/DeferredDealModal.jsx
// Оформление ОТЛОЖЕННОЙ сделки (долг). Менеджер указывает: какая сторона
// отложена (клиент должен нам / мы должны клиенту), КОНКРЕТНУЮ дату обязательства
// и комментарий (оба обязательны). Долг ляжет на счёт контрагента в v2.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Clock } from "lucide-react";

const fieldCls =
  "w-full box-border text-[13px] text-ink border border-[#dde0ea] rounded-[8px] px-2.5 py-2 outline-none focus:border-[#5b6cff] focus:shadow-[0_0_0_3px_rgba(91,108,255,.12)]";
const labelCls = "block text-[10px] font-bold text-muted uppercase tracking-wide mb-1";

export default function DeferredDealModal({ summary, onClose, onConfirm }) {
  // summary: { party, inCcy, inAmount, outCcy, outAmount }
  // Одноногая: только приход (клиент занёс → мы должны) ИЛИ только расход
  // (мы выдали → клиент должен). Направление тогда фиксировано.
  const oneLegged = !(summary.inCcy && summary.outCcy);
  const onlyIn = oneLegged && !!summary.inCcy;
  const fixedSide = oneLegged ? (onlyIn ? "out" : "in") : null; // out=мы должны, in=клиент должен

  const [side, setSide] = useState(fixedSide || "out");
  const [dueDate, setDueDate] = useState("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const eff = fixedSide || side;
  const submit = () => {
    if (!dueDate) return setErr("Укажите дату обязательства");
    if (!comment.trim()) return setErr("Добавьте комментарий");
    onConfirm({ side: eff, dueDate, comment: comment.trim() });
  };

  // Что именно отложено и кто кому должен. Для одной ноги — заполненная сторона.
  const owedCcy = oneLegged ? (onlyIn ? summary.inCcy : summary.outCcy) : eff === "in" ? summary.inCcy : summary.outCcy;
  const owedAmt = oneLegged ? (onlyIn ? summary.inAmount : summary.outAmount) : eff === "in" ? summary.inAmount : summary.outAmount;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-[#15172b]/30 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[440px] bg-surface rounded-[16px] border border-[#dde0ea] shadow-[0_24px_60px_-18px_rgba(16,24,40,.4)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 bg-[#fff8e6] border-b border-[#f0e2b8]">
          <Clock className="w-4 h-4 text-[#c9a14a] shrink-0" strokeWidth={2.2} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink truncate">Отложенная сделка (долг)</div>
            <div className="text-[10.5px] text-[#b8923a]">{summary.party || "контрагент"}</div>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {oneLegged ? (
            <div className="rounded-[10px] border border-[#5b6cff] bg-[#eef0ff] px-3 py-2">
              <span className="block text-[12px] font-bold text-ink">
                {eff === "in" ? "Клиент должен нам" : "Мы должны клиенту"}
              </span>
              <span className="block text-[10.5px] text-muted">
                одна нога: {eff === "in" ? "выдали" : "получили"} {owedCcy}, вторую сторону не вносим
              </span>
            </div>
          ) : (
            <div>
              <span className={labelCls}>Что откладываем</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSide("in")}
                  className={`text-left rounded-[10px] border px-3 py-2 transition-colors ${
                    side === "in" ? "border-[#5b6cff] bg-[#eef0ff]" : "border-[#dde0ea] hover:bg-[#f6f7fb]"
                  }`}
                >
                  <span className="block text-[12px] font-bold text-ink">Клиент должен нам</span>
                  <span className="block text-[10.5px] text-muted">приход {summary.inCcy} позже</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSide("out")}
                  className={`text-left rounded-[10px] border px-3 py-2 transition-colors ${
                    side === "out" ? "border-[#5b6cff] bg-[#eef0ff]" : "border-[#dde0ea] hover:bg-[#f6f7fb]"
                  }`}
                >
                  <span className="block text-[12px] font-bold text-ink">Мы должны клиенту</span>
                  <span className="block text-[10.5px] text-muted">расход {summary.outCcy} позже</span>
                </button>
              </div>
            </div>
          )}

          <div className="rounded-[10px] bg-[#f6f7fb] border border-[#e7e9f1] px-3 py-2 text-[12px]">
            <span className="text-muted">Долг: </span>
            <span className="font-bold text-ink font-mono">
              {Number(owedAmt).toLocaleString("ru-RU")} {owedCcy}
            </span>
            <span className="text-muted">{eff === "in" ? " — клиент нам" : " — мы клиенту"}</span>
          </div>

          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
            <label className="block">
              <span className={labelCls}>Дата обязательства *</span>
              <input type="date" className={`${fieldCls} font-mono`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="block">
              <span className={labelCls}>Комментарий *</span>
              <input className={fieldCls} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="о чём договорились" />
            </label>
          </div>

          {err && <div className="text-[11px] font-semibold text-[#cf3b40]">⚠ {err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-[#eef0f4] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-[12px] font-bold text-[#454a66] bg-[#eef0f4] hover:bg-[#e4e7ee] rounded-[8px] px-4 py-2">
            Отмена
          </button>
          <button type="button" onClick={submit} className="text-[12px] font-bold text-white bg-[#159a5d] hover:bg-[#0f8a50] rounded-[8px] px-4 py-2">
            Сохранить долг
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
