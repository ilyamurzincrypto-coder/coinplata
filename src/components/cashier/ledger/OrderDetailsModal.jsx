// src/components/cashier/ledger/OrderDetailsModal.jsx
// Заявка — раскрытие И правка. Когда клиент пришёл, по факту может измениться
// многое: суммы, курс, валюты, контакт. Здесь это правится и сохраняется
// (updateOrder). Плюс отмена заявки. «Провести» нет — заявка сама и есть запись.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Hourglass } from "lucide-react";
import { updateOrder, cancelOrder } from "../../../lib/managerOrders.js";
import { BAL_COLUMNS } from "../../balances/currencyMeta.js";

const p2 = (n) => String(n).padStart(2, "0");
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const parseRu = (v) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const fieldCls =
  "w-full box-border text-[13px] text-ink border border-[#dde0ea] rounded-[8px] px-2.5 py-2 outline-none focus:border-[#5b6cff] focus:shadow-[0_0_0_3px_rgba(91,108,255,.12)]";
const labelCls = "block text-[10px] font-bold text-muted uppercase tracking-wide mb-1";

function CcySelect({ value, onChange }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${fieldCls} font-mono`}>
      <option value="">—</option>
      {BAL_COLUMNS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export default function OrderDetailsModal({ order, onClose, onRefetch }) {
  const [f, setF] = useState({
    contact: order.contact || "",
    fromCurrency: order.fromCurrency || "",
    fromAmount: order.fromAmount ? String(order.fromAmount) : "",
    rate: order.rate || "",
    toCurrency: order.toCurrency || "",
    toAmount: order.toAmount ? String(order.toAmount) : "",
    meetingCode: order.meetingCode || "",
    note: order.note || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      await updateOrder(order.id, {
        contact: f.contact,
        fromCurrency: f.fromCurrency,
        fromAmount: f.fromAmount === "" ? null : parseRu(f.fromAmount),
        rate: f.rate,
        toCurrency: f.toCurrency,
        toAmount: f.toAmount === "" ? null : parseRu(f.toAmount),
        meetingCode: f.meetingCode,
        note: f.note,
      });
      await onRefetch?.();
      onClose();
    } catch (e) {
      setErr(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    try {
      await cancelOrder(order.id);
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
        className="w-full max-w-[440px] bg-surface rounded-[16px] border border-[#dde0ea] shadow-[0_24px_60px_-18px_rgba(16,24,40,.4)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 bg-[#fff8e6] border-b border-[#f0e2b8]">
          <Hourglass className="w-4 h-4 text-[#c9a14a] shrink-0" strokeWidth={2.2} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-ink truncate">Заявка</div>
            <div className="text-[10.5px] font-mono text-[#b8923a]">
              {order.meetingCode ? `№ ${order.meetingCode}` : "без кода"}
              {order.arrivedAt ? ` · пришёл ${fmtDateTime(order.arrivedAt)}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink p-1 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="block">
            <span className={labelCls}>Контрагент</span>
            <input className={fieldCls} value={f.contact} onChange={(e) => set("contact", e.target.value)} placeholder="имя / @tg / телефон" />
          </label>

          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="block">
              <span className={labelCls}>Приход</span>
              <input className={`${fieldCls} font-mono text-right`} value={f.fromAmount} onChange={(e) => set("fromAmount", e.target.value)} inputMode="decimal" placeholder="0" />
            </label>
            <label className="block">
              <span className={labelCls}>Валюта</span>
              <CcySelect value={f.fromCurrency} onChange={(v) => set("fromCurrency", v)} />
            </label>
          </div>

          <label className="block">
            <span className={labelCls}>Курс</span>
            <input className={`${fieldCls} font-mono`} value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="—" />
          </label>

          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="block">
              <span className={labelCls}>Расход</span>
              <input className={`${fieldCls} font-mono text-right`} value={f.toAmount} onChange={(e) => set("toAmount", e.target.value)} inputMode="decimal" placeholder="0" />
            </label>
            <label className="block">
              <span className={labelCls}>Валюта</span>
              <CcySelect value={f.toCurrency} onChange={(v) => set("toCurrency", v)} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={labelCls}>Код</span>
              <input className={`${fieldCls} font-mono`} value={f.meetingCode} onChange={(e) => set("meetingCode", e.target.value)} placeholder="CP-…" />
            </label>
            <label className="block">
              <span className={labelCls}>Заметка</span>
              <input className={fieldCls} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="напр. факт ≠ заявка" />
            </label>
          </div>

          {err && <div className="text-[11px] font-semibold text-[#cf3b40]">⚠ {err}</div>}
          <div className="text-[10px] text-muted">Создана {fmtDateTime(order.createdAt)}</div>
        </div>

        <div className="px-5 py-3 border-t border-[#eef0f4] flex justify-between gap-2">
          <button type="button" onClick={onCancel} className="text-[12px] font-bold text-[#cf3b40] hover:bg-[#fdecec] rounded-[8px] px-3 py-2">
            Отменить заявку
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-[12px] font-bold text-[#454a66] bg-[#eef0f4] hover:bg-[#e4e7ee] rounded-[8px] px-4 py-2">
              Закрыть
            </button>
            <button type="button" disabled={busy} onClick={save} className="text-[12px] font-bold text-white bg-[#159a5d] hover:bg-[#0f8a50] rounded-[8px] px-4 py-2 disabled:opacity-50">
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
