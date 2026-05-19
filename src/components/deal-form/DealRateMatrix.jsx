// src/components/deal-form/DealRateMatrix.jsx
//
// Матрица курсов N×M для multi-IN × multi-OUT сделки. Показываем рынок
// для каждой пары (in_i × out_j), оператор может одним кликом применить
// курс к OUT-ноге (rate выставится из ячейки, manualRate=false).
//
// Когда показывать: inputs.length + outputs.length >= 3 (≥1 IN × ≥2 OUT
// или ≥2 IN × ≥1 OUT). При 1×1 — обычная rate-капсула достаточно.
//
// Attribution «какой IN фундит какой OUT» здесь не решается — это чисто
// справочный/быстрый-pick инструмент. Submit-payload идёт как раньше
// (каждый OUT хранит свой rate).

import React from "react";
import { displayRate, formatRate } from "../../lib/rates.js";

export default function DealRateMatrix({ inputs, outputs, getRate, onApplyRate }) {
  if (!inputs || !outputs) return null;
  const ins = inputs.filter((i) => i?.currency);
  const outs = outputs.filter((o) => o?.currency);
  // 1×1 покрывается основной DealRateBlock — матрицу не показываем.
  if (ins.length + outs.length < 3) return null;
  // Пустые ноги без валюты тоже скрываем.
  if (ins.length === 0 || outs.length === 0) return null;

  return (
    <div className="mx-6 my-3 bg-surface-soft/40 rounded-card border border-border-soft">
      <div className="px-card py-2 flex items-center justify-between border-b border-border-soft">
        <span className="text-micro text-muted uppercase font-semibold">
          Матрица курсов · {ins.length}×{outs.length}
        </span>
        <span className="text-tiny text-muted-soft">клик по ячейке — применить курс к ноге</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-caption">
          <thead>
            <tr className="text-micro text-muted-soft uppercase tracking-wider">
              <th className="text-left py-1.5 px-card font-bold w-16">IN \ OUT</th>
              {outs.map((o, j) => (
                <th key={o.id || j} className="text-right py-1.5 px-2 font-bold font-mono">
                  {o.currency}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ins.map((iLeg, i) => (
              <tr key={iLeg.id || i} className="border-t border-border-soft">
                <td className="py-1.5 px-card font-mono text-tiny text-muted">
                  {iLeg.currency}
                </td>
                {outs.map((o, j) => {
                  const sameCcy = iLeg.currency === o.currency;
                  const raw = sameCcy ? null : getRate(iLeg.currency, o.currency);
                  const ok = Number.isFinite(raw) && raw > 0;
                  const display = ok ? displayRate(raw, iLeg.currency, o.currency) : null;
                  const displayValue = display?.rate ? formatRate(display.rate) : null;
                  // Применяем по rate как на input (string)
                  const handleApply = () => {
                    if (!ok || !displayValue) return;
                    onApplyRate?.(j, displayValue);
                  };
                  return (
                    <td
                      key={o.id || j}
                      onClick={ok ? handleApply : undefined}
                      className={`py-1.5 px-2 text-right font-mono tabular whitespace-nowrap ${
                        sameCcy
                          ? "text-muted-soft"
                          : ok
                            ? "text-ink cursor-pointer hover:bg-accent-bg hover:text-accent transition-colors"
                            : "text-muted-soft"
                      }`}
                      title={
                        sameCcy
                          ? "Одинаковая валюта"
                          : ok
                            ? `${displayValue} ${display.from}→${display.to} · клик чтобы применить`
                            : "Нет курса"
                      }
                    >
                      {sameCcy ? "—" : ok ? displayValue : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
