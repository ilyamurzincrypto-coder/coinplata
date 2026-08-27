// src/pages/treasury_v2/parts/CapitalPanel.jsx
// Слайс 1.5.d — панель CP PAY «Ностро − Лоро = Капитал ✓» по каждой валюте (строками).
// Знаки ДОСЛОВНО по спеке: Лоро = +raw (клиент держит → +, должник → −), Ностро = +,
// Капитал = Ностро − Лоро. Чекбокс на валюту → выбранные складываются в базе «на глазах».
// Display-слой: dr/cr в journal_entries не трогает (данные из ledger.balances через селектор).
import React, { useMemo, useState } from "react";
import { capitalByCurrency, balanceCheckTotals } from "../../../lib/treasury/v2selectors.js";
import { fmt, curSymbol } from "../../../utils/money.js";
import CurrencyIcon from "../../../components/ui/CurrencyIcon.jsx";

function nat(n, ccy) {
  const v = Number(n) || 0;
  return `${v < 0 ? "−" : ""}${curSymbol(ccy)}${fmt(Math.abs(v), ccy)}`;
}
function usd(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

export default function CapitalPanel({ ctx }) {
  const rows = useMemo(() => capitalByCurrency(ctx), [ctx]);
  const totals = useMemo(() => balanceCheckTotals(ctx, ctx.officeFilter), [ctx]);
  const [unchecked, setUnchecked] = useState(() => new Set()); // по умолчанию все ✓
  const isOn = (c) => !unchecked.has(c);
  const toggle = (c) =>
    setUnchecked((prev) => {
      const n = new Set(prev);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const selSumBase = rows.reduce((s, r) => s + (isOn(r.currency) ? r.capitalBase : 0), 0);
  const allSumBase = rows.reduce((s, r) => s + r.capitalBase, 0);
  const reconciled = Math.abs(allSumBase - totals.equity) < 0.5;

  if (rows.length === 0) return null;

  return (
    <div className="bg-surface rounded-card overflow-hidden">
      <div className="px-card py-2.5 border-b border-border-soft flex items-center justify-between">
        <div className="text-h3 text-ink font-semibold">Капитал по валютам <span className="text-caption text-muted font-normal">Ностро − Лоро</span></div>
        <div
          className={`text-caption font-semibold tabular-nums tabular px-2 py-0.5 rounded-md ${
            reconciled ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
          }`}
          title={reconciled ? "Σ Капитал сходится с учётным капиталом ledger" : "Расхождение с учётным капиталом"}
        >
          Σ ≈ {usd(allSumBase)} {reconciled ? "✓" : `Δ ${usd(allSumBase - totals.equity)}`}
        </div>
      </div>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col className="w-[150px]" />
          <col />
          <col />
          <col />
          <col className="w-[52px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border-soft bg-surface-soft/40">
            <th className="text-left text-caption font-semibold text-muted tracking-wider px-card py-2 border-r border-border-soft">Валюта</th>
            <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2 border-r border-border-soft">Ностро</th>
            <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2 border-r border-border-soft">Лоро</th>
            <th className="text-right text-caption font-semibold text-muted tracking-wider px-card py-2 border-r border-border-soft">Капитал</th>
            <th className="text-center text-caption font-semibold text-muted tracking-wider px-2 py-2">✓</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.currency} className={`border-t border-border-soft transition-colors ${isOn(r.currency) ? "hover:bg-surface-soft" : "opacity-40"}`}>
              <td className="px-card py-1.5 border-r border-border-soft">
                <div className="flex items-center gap-2">
                  <CurrencyIcon ccy={r.currency} size="sm" />
                  <span className="text-body-sm text-ink tracking-wider">{r.currency}</span>
                </div>
              </td>
              <td className="text-right px-card py-1.5 tabular-nums tabular text-body-sm text-ink whitespace-nowrap border-r border-border-soft">{nat(r.nostro, r.currency)}</td>
              <td className="text-right px-card py-1.5 tabular-nums tabular text-body-sm text-ink whitespace-nowrap border-r border-border-soft">{nat(r.loro, r.currency)}</td>
              <td className="text-right px-card py-1.5 tabular-nums tabular text-body-sm font-semibold text-ink whitespace-nowrap border-r border-border-soft">{nat(r.capital, r.currency)}</td>
              <td className="text-center px-2 py-1.5">
                <input type="checkbox" checked={isOn(r.currency)} onChange={() => toggle(r.currency)} title="Учитывать в сумме" />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-surface-sunk">
          <tr className="border-t-2 border-border-soft">
            <td className="px-card py-2 text-body-sm font-bold text-ink uppercase tracking-wider border-r border-border-soft">Σ выбрано</td>
            <td className="border-r border-border-soft" />
            <td className="border-r border-border-soft" />
            <td className="text-right px-card py-2 tabular-nums tabular font-bold text-body-sm text-ink whitespace-nowrap border-r border-border-soft">≈ {usd(selSumBase)}</td>
            <td className="px-2 py-2 text-center text-caption text-muted">{rows.length - unchecked.size}/{rows.length}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
