// src/components/rates/PasteRatesModal.jsx
// Модалка «Вставить курсы»: textarea (их формат) → diff-превью → Применить.

import React, { useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import { parseRatesPaste } from "../../utils/ratesPasteParser.js";
import { formatRateValue } from "../../utils/ratesFormat.js";

const STATUS_STYLE = {
  new: "text-success",
  updated: "text-accent",
  unchanged: "text-muted-soft",
  error: "text-danger",
};

export default function PasteRatesModal({ open, onClose, getRate, onApply, known }) {
  const [text, setText] = useState("");
  const rows = useMemo(
    () => parseRatesPaste(text, { known, currentRate: (f, t) => Number(getRate?.(f, t)) }),
    [text, known, getRate]
  );
  const applicable = rows.filter((r) => r.status === "updated" || r.status === "new");

  return (
    <Modal open={open} onClose={onClose} title="Вставить курсы">
      <div className="space-y-3 p-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"USDT -> USD  -1,00%\nUSDT -> TRY 45,10\nTRY -> USDT 46\nUSDT -> EUR 1,177"}
          className="w-full font-mono text-body-sm border border-border rounded-[8px] p-2 outline-none focus:border-accent"
        />
        {rows.length > 0 && (
          <div className="max-h-[240px] overflow-auto rounded-[8px] border border-border-soft divide-y divide-border-soft">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-1.5 text-body-sm">
                <span className="font-mono">{r.from ? `${r.from} → ${r.to}` : r.raw}</span>
                <span className={`font-mono ${STATUS_STYLE[r.status]}`}>
                  {r.status === "error"
                    ? `ошибка: ${r.error}`
                    : `${Number.isFinite(r.prev) ? formatRateValue(r.from, r.to, r.prev) + " → " : ""}${formatRateValue(r.from, r.to, r.rate)}`}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-caption text-muted">К применению: {applicable.length}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-[8px] text-muted hover:bg-surface-soft">Отмена</button>
            <button
              onClick={() => { onApply?.(applicable); onClose?.(); }}
              disabled={applicable.length === 0}
              className="px-3 py-1.5 rounded-[8px] bg-ink text-white disabled:opacity-40"
            >
              Применить {applicable.length}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
