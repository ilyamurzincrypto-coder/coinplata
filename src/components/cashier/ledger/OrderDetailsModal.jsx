// src/components/cashier/ledger/OrderDetailsModal.jsx
// Раскрытие заявки — все подробности в одном окне (контакт, код встречи, время
// визита, приход/расход/курс, заметка, статус «пришёл»). Read-only + «отменить».
// «Провести» нет: менеджер сам проставляет суммы прямо в строке заявки.

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Hourglass, CheckCircle2 } from "lucide-react";
import { cancelOrder } from "../../../lib/managerOrders.js";
import { fmtRu, ccyMeta } from "../../balances/currencyMeta.js";

const p2 = (n) => String(n).padStart(2, "0");
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const amt = (v, ccy) => (v && ccy ? `${fmtRu(v, ccyMeta(ccy).dp)} ${ccy}` : "—");

function Row({ label, children, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px] border-b border-[#eef0f4] last:border-0">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted shrink-0">{label}</span>
      <span className={`text-[13px] text-ink text-right ${mono ? "font-mono tabular-nums" : "font-medium"}`}>
        {children}
      </span>
    </div>
  );
}

export default function OrderDetailsModal({ order, onClose, onRefetch }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const o = order;
  const onCancel = async () => {
    try {
      await cancelOrder(o.id);
      await onRefetch?.();
      onClose();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[orders] cancel failed", e);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-[#15172b]/30 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[420px] bg-surface rounded-[16px] border border-[#dde0ea] shadow-[0_24px_60px_-18px_rgba(16,24,40,.4)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 bg-[#fff8e6] border-b border-[#f0e2b8]">
          <Hourglass className="w-4 h-4 text-[#c9a14a] shrink-0" strokeWidth={2.2} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink truncate">{o.contact || "Заявка"}</div>
            <div className="text-[10.5px] font-mono text-[#b8923a]">
              {o.meetingCode ? `№ ${o.meetingCode}` : "без кода"}
            </div>
          </div>
          <span className="text-[9.5px] font-bold uppercase tracking-wide text-[#9a6b00] bg-[#fde9b8] rounded-[6px] px-2 py-1 shrink-0">
            заявка
          </span>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3">
          <Row label="Пришёл">
            {o.arrivedAt ? (
              <span className="inline-flex items-center gap-1 text-[#0b8a54] font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> {fmtDateTime(o.arrivedAt)}
              </span>
            ) : (
              <span className="text-muted">ещё нет</span>
            )}
          </Row>
          <Row label="Время визита" mono>{fmtDateTime(o.meetingAt)}</Row>
          <Row label="Тип">{o.kind === "visit" ? "визит" : "обмен"}</Row>
          <Row label="Приход" mono>{amt(o.fromAmount, o.fromCurrency)}</Row>
          <Row label="Курс" mono>{o.rate || "—"}</Row>
          <Row label="Расход" mono>{amt(o.toAmount, o.toCurrency)}</Row>
          {o.note && <Row label="Заметка">{o.note}</Row>}
          <Row label="Создана" mono>{fmtDateTime(o.createdAt)}</Row>
        </div>

        <div className="px-5 py-3 border-t border-[#eef0f4] flex justify-between gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] font-bold text-[#cf3b40] hover:bg-[#fdecec] rounded-[8px] px-3 py-2"
          >
            Отменить заявку
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-bold text-[#454a66] bg-[#eef0f4] hover:bg-[#e4e7ee] rounded-[8px] px-4 py-2"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
