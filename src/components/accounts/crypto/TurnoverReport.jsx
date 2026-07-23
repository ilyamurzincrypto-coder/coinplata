// src/components/accounts/crypto/TurnoverReport.jsx
// Оборотно-сальдовая ведомость ОН-ЧЕЙН за период по выбранным крипто-счетам.
// Выбор кошельков (галочки) + период → таблица: сальдо нач / поступило / списано /
// сальдо кон / опер. Источник: TRON — из блокчейна (точно), EVM — AEGIS (best-effort).
import React, { useMemo, useState } from "react";
import { X, FileSpreadsheet, Loader2 } from "lucide-react";
import { fetchTurnover } from "../../../lib/aegisMonitoring.js";

const usd = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthStartIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function TurnoverReport({ accounts = [], onClose }) {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [selected, setSelected] = useState(() => new Set(accounts.map((a) => a.id)));
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const allOn = selected.size === accounts.length && accounts.length > 0;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(accounts.map((a) => a.id)));

  const run = async () => {
    if (!selected.size || state.loading) return;
    setState({ loading: true, error: null, data: null });
    try {
      const d = await fetchTurnover([...selected], from, to);
      setState({ loading: false, error: null, data: d });
    } catch (e) {
      setState({ loading: false, error: e?.message || "Ошибка", data: null });
    }
  };

  const totals = useMemo(() => {
    const rows = state.data?.rows || [];
    return rows.reduce(
      (a, r) => ({
        opening: a.opening + (Number(r.opening) || 0),
        turnoverIn: a.turnoverIn + (Number(r.turnoverIn) || 0),
        turnoverOut: a.turnoverOut + (Number(r.turnoverOut) || 0),
        closing: a.closing + (Number(r.closing) || 0),
      }),
      { opening: 0, turnoverIn: 0, turnoverOut: 0, closing: 0 }
    );
  }, [state.data]);

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex md:items-center md:justify-center" onClick={onClose}>
      <div className="bg-bg w-full h-full md:h-auto md:max-h-[92vh] md:w-[900px] md:rounded-[18px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bg/95 backdrop-blur border-b-[0.5px] border-border flex items-center gap-2 px-4 h-12">
          <FileSpreadsheet className="w-4 h-4 text-emerald" />
          <span className="text-[15px] font-semibold text-ink flex-1">Оборотка · он-чейн</span>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Период + кнопка */}
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">с</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-[9px] border-[0.5px] border-border bg-surface px-2.5 py-1.5 text-[13px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">по</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-[9px] border-[0.5px] border-border bg-surface px-2.5 py-1.5 text-[13px]" />
            </label>
            <button type="button" onClick={run} disabled={state.loading || !selected.size} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-ink text-white text-[13px] font-semibold hover:opacity-90 disabled:opacity-50">
              {state.loading && <Loader2 className="w-4 h-4 animate-spin" />} Сформировать
            </button>
          </div>

          {/* Выбор кошельков */}
          <div>
            <button type="button" onClick={toggleAll} className="text-[12px] text-emerald font-medium mb-1.5">{allOn ? "Снять все" : "Выбрать все"} ({selected.size}/{accounts.length})</button>
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((a) => (
                <button key={a.id} type="button" onClick={() => toggle(a.id)} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[12px] border-[0.5px] ${selected.has(a.id) ? "bg-ink text-white border-ink" : "bg-surface text-ink-soft border-border"}`}>
                  <span className="truncate max-w-[160px]">{a.name}</span>
                  <span className="text-[9px] opacity-70">{a.network}</span>
                </button>
              ))}
            </div>
          </div>

          {state.error && <div className="text-[13px] text-danger">{state.error}</div>}

          {/* Таблица */}
          {state.data && (
            <div className="border-[0.5px] border-border rounded-[12px] overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse min-w-[720px]">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-wide text-muted border-b-[0.5px] border-border">
                    <th className="text-left px-3 py-2">Кошелёк</th>
                    <th className="text-left px-2 py-2">Сеть</th>
                    <th className="text-right px-2 py-2">Сальдо нач</th>
                    <th className="text-right px-2 py-2">Поступило</th>
                    <th className="text-right px-2 py-2">Списано</th>
                    <th className="text-right px-3 py-2">Сальдо кон</th>
                    <th className="text-right px-2 py-2">Опер.</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {state.data.rows.map((r) => (
                    <tr key={r.id} className="border-t-[0.5px] border-border-soft">
                      <td className="px-3 py-2 font-sans text-ink truncate max-w-[200px]" title={r.note || r.name}>{r.name}{r.note && <span className="block text-[10px] text-muted font-sans">{r.note}</span>}</td>
                      <td className="px-2 py-2 font-sans text-muted">{r.network}</td>
                      <td className="text-right px-2 py-2 text-ink-soft">{usd(r.opening)}</td>
                      <td className="text-right px-2 py-2 text-success">{r.turnoverIn != null ? `+${usd(r.turnoverIn).slice(1)}` : "—"}</td>
                      <td className="text-right px-2 py-2 text-muted">{r.turnoverOut != null ? `−${usd(r.turnoverOut).slice(1)}` : "—"}</td>
                      <td className="text-right px-3 py-2 font-semibold text-ink">{usd(r.closing)}</td>
                      <td className="text-right px-2 py-2 text-muted">{r.count ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-[0.5px] border-border font-mono tabular-nums bg-surface-soft">
                    <td className="px-3 py-2 font-sans font-bold text-ink" colSpan={2}>Итого</td>
                    <td className="text-right px-2 py-2 text-ink">{usd(totals.opening)}</td>
                    <td className="text-right px-2 py-2 text-success font-semibold">+{usd(totals.turnoverIn).slice(1)}</td>
                    <td className="text-right px-2 py-2 text-ink">−{usd(totals.turnoverOut).slice(1)}</td>
                    <td className="text-right px-3 py-2 font-bold text-ink">{usd(totals.closing)}</td>
                    <td className="px-2 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="text-[11px] text-muted-soft leading-snug">
            TRON (TRC20) — точно из блокчейна. EVM (ERC20/BEP20) — по данным AEGIS (best-effort). Сальдо кон = сальдо нач + поступило − списано.
          </div>
        </div>
      </div>
    </div>
  );
}
