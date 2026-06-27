// src/components/cashier/ledger/DealsLedger.jsx
// Зона C — «Сделки за день». Широкая таблица: Контрагент | ПРИХОД [валюты] |
// Курс | РАСХОД [валюты]. Заполненная валютная ячейка — зелёная (как в их Excel).
// Снизу инлайн-строка: печатаешь сумму прямо в валютную ячейку → Enter/blur →
// create_deal (no-false-green: зелёнка только после подтверждения БД). Валютные
// колонки — динамически из справочника валют. Без колонки прибыли и без строки
// оборотов (убрано намеренно). Realtime на deals/deal_legs.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase.js";
import { loadCashierDeals } from "../../../lib/cashierDealsReader.js";
import { useAccounts } from "../../../store/accounts.jsx";
import { createDeal } from "../../../lib/dealOperations.js";
import { BAL_COLUMNS, ccyMeta, fmtRu, splitParts } from "../../balances/currencyMeta.js";

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function parseRu(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function Amt({ value, ccy }) {
  const { int, dec } = splitParts(fmtRu(value, ccyMeta(ccy).dp));
  return (
    <>
      {int}
      {dec && <span className="opacity-[0.42]">{dec}</span>}
    </>
  );
}

export default function DealsLedger({ officeId }) {
  const { accounts } = useAccounts();
  // Тот же набор валют, что и в «Остатках» (а не все активные из справочника).
  const cols = BAL_COLUMNS;
  const fromIso = useMemo(() => todayStartIso(), []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const r = await loadCashierDeals({ officeId, fromIso });
      setRows(r);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [officeId, fromIso]);

  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  // Realtime: любое изменение deals/deal_legs → перезагрузка.
  useEffect(() => {
    if (!supabase) return undefined;
    const ch = supabase
      .channel("cashier-deals-ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "deal_legs" }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refetch]);

  // ── Инлайн-ввод ──
  const rowRef = useRef(null);
  const [draft, setDraft] = useState({ party: "", rate: "", in: {}, out: {} });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const acctFor = useCallback(
    (ccy) => accounts.find((a) => a.active && a.officeId === officeId && a.currency === ccy),
    [accounts, officeId]
  );

  const resetDraft = () => setDraft({ party: "", rate: "", in: {}, out: {} });

  const commit = useCallback(async () => {
    if (saving) return;
    const inCcy = cols.find((c) => parseRu(draft.in[c]) > 0);
    const outCcy = cols.find((c) => parseRu(draft.out[c]) > 0);
    if (!inCcy || !outCcy) return; // нечего коммитить
    setErr("");
    const inAcc = acctFor(inCcy);
    const outAcc = acctFor(outCcy);
    if (!inAcc) return setErr(`Нет счёта ${inCcy} в этом офисе`);
    if (!outAcc) return setErr(`Нет счёта ${outCcy} в этом офисе`);

    setSaving(true);
    try {
      await createDeal({
        officeId,
        clientNickname: draft.party.trim() || "cash",
        currencyIn: inCcy,
        amountIn: parseRu(draft.in[inCcy]),
        inAccountId: inAcc.id,
        outputs: [
          {
            currency: outCcy,
            amount: parseRu(draft.out[outCcy]),
            accountId: outAcc.id,
            rate: parseRu(draft.rate) || undefined,
          },
        ],
      });
      // Успех подтверждён БД → чистим строку; realtime подтянет новую сделку.
      resetDraft();
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[deals] create failed", e);
      setErr(e?.message || "Не удалось сохранить сделку");
    } finally {
      setSaving(false);
    }
  }, [saving, cols, draft, acctFor, officeId, refetch]);

  const onRowBlur = (e) => {
    // Коммит когда фокус ушёл из всей строки (Enter обрабатывается отдельно).
    if (rowRef.current && !rowRef.current.contains(e.relatedTarget)) commit();
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  const setIn = (c, v) => setDraft((d) => ({ ...d, in: { ...d.in, [c]: v } }));
  const setOut = (c, v) => setDraft((d) => ({ ...d, out: { ...d.out, [c]: v } }));

  const cell =
    "text-right whitespace-nowrap border-l border-[#e7e9f1] px-2.5 py-1.5 font-mono tabular-nums text-[13px]";
  const cellHas = "bg-[#e7f6ee] text-[#0b8a54] font-semibold";
  const cellEmpty = "text-[#b6bacb]";
  const inputCls =
    "w-full bg-transparent text-right font-mono tabular-nums text-[13px] outline-none placeholder:text-[#cdd1de]";

  return (
    <div className="bg-surface border border-[#e7e9f1] rounded-[16px] overflow-hidden">
      <div className="px-[18px] py-[11px] border-b border-[#e7e9f1] flex items-center justify-between gap-3">
        <span className="text-[12px] font-extrabold tracking-[1.3px] uppercase text-[#454a66]">
          Сделки за день
        </span>
        <span className="text-[11.5px] font-semibold text-muted">
          {rows.length} сделок · приход слева, расход справа
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse w-full min-w-[760px] select-none">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="text-left align-middle bg-[#f6f7fb] text-[#454a66] font-bold text-[11.5px] px-3 py-2 border-b border-[#e7e9f1]"
              >
                Контрагент
              </th>
              <th
                colSpan={cols.length}
                className="text-center bg-[#159a5d] text-white font-extrabold text-[11.5px] tracking-wide px-2 py-1.5"
              >
                ПРИХОД
              </th>
              <th
                rowSpan={2}
                className="text-center align-middle bg-[#eef0f4] text-[#454a66] font-extrabold text-[11px] px-2 py-1.5 border-b border-[#e7e9f1] leading-tight"
              >
                Курс /<br />цена
              </th>
              <th
                colSpan={cols.length}
                className="text-center bg-[#e24a4f] text-white font-extrabold text-[11.5px] tracking-wide px-2 py-1.5"
              >
                РАСХОД
              </th>
            </tr>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={`in_${c}`}
                  className={`text-right text-[10.5px] font-bold text-muted tracking-wide bg-[#fbfcfe] px-2.5 py-1.5 border-b border-[#e7e9f1] ${
                    i === 0 ? "shadow-[inset_3px_0_0_#daf0e4]" : ""
                  }`}
                >
                  {c}
                </th>
              ))}
              {cols.map((c) => (
                <th
                  key={`out_${c}`}
                  className="text-right text-[10.5px] font-bold text-muted tracking-wide bg-[#fbfcfe] px-2.5 py-1.5 border-b border-[#e7e9f1] border-l"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((d) => {
              const outByCcy = {};
              d.outs.forEach((o) => {
                outByCcy[o.ccy] = (outByCcy[o.ccy] || 0) + o.amount;
              });
              return (
                <tr key={d.id} className="hover:bg-[#fafbff]">
                  <td className="bg-[#f6f7fb] text-left px-3 py-1.5 border-t border-[#e7e9f1]">
                    <span className="text-[12.5px] font-bold text-ink">{d.party}</span>
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`i_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        d.inCcy === c ? cellHas : cellEmpty
                      }`}
                    >
                      {d.inCcy === c ? <Amt value={d.inAmount} ccy={c} /> : ""}
                    </td>
                  ))}
                  <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] text-[#454a66] font-semibold font-mono text-[12.5px] px-2 py-1.5">
                    {d.rate != null ? fmtRu(d.rate) : ""}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={`o_${d.id}_${c}`}
                      className={`${cell} border-t border-[#e7e9f1] ${
                        outByCcy[c] ? cellHas : cellEmpty
                      }`}
                    >
                      {outByCcy[c] ? <Amt value={outByCcy[c]} ccy={c} /> : ""}
                    </td>
                  ))}
                </tr>
              );
            })}

            {/* Инлайн-ввод новой сделки */}
            <tr ref={rowRef} onBlur={onRowBlur} className="bg-white">
              <td className="bg-[#f6f7fb] text-left px-3 py-1.5 border-t border-[#e7e9f1]">
                <input
                  value={draft.party}
                  onChange={(e) => setDraft((d) => ({ ...d, party: e.target.value }))}
                  onKeyDown={onKeyDown}
                  placeholder="контрагент"
                  className="w-full bg-transparent text-[12.5px] font-semibold text-ink outline-none placeholder:text-[#cdd1de] placeholder:font-normal"
                />
              </td>
              {cols.map((c) => {
                const v = draft.in[c] || "";
                return (
                  <td
                    key={`ein_${c}`}
                    className={`${cell.replace("font-mono", "")} border-t border-[#e7e9f1] ${
                      parseRu(v) > 0 ? "bg-[#e7f6ee]" : ""
                    }`}
                  >
                    <input
                      value={v}
                      onChange={(e) => setIn(c, e.target.value.replace(/[^\d\s.,]/g, ""))}
                      onKeyDown={onKeyDown}
                      inputMode="decimal"
                      placeholder="·"
                      className={`${inputCls} ${parseRu(v) > 0 ? "text-[#0b8a54] font-semibold" : ""}`}
                    />
                  </td>
                );
              })}
              <td className="text-center border-l border-t border-[#e7e9f1] bg-[#f7f8fb] px-2 py-1.5">
                <input
                  value={draft.rate}
                  onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value.replace(/[^\d.,]/g, "") }))}
                  onKeyDown={onKeyDown}
                  inputMode="decimal"
                  placeholder="курс"
                  className="w-full bg-transparent text-center font-mono text-[12.5px] text-[#454a66] outline-none placeholder:text-[#cdd1de]"
                />
              </td>
              {cols.map((c) => {
                const v = draft.out[c] || "";
                return (
                  <td
                    key={`eout_${c}`}
                    className={`${cell.replace("font-mono", "")} border-t border-[#e7e9f1] ${
                      parseRu(v) > 0 ? "bg-[#e7f6ee]" : ""
                    }`}
                  >
                    <input
                      value={v}
                      onChange={(e) => setOut(c, e.target.value.replace(/[^\d\s.,]/g, ""))}
                      onKeyDown={onKeyDown}
                      inputMode="decimal"
                      placeholder="·"
                      className={`${inputCls} ${parseRu(v) > 0 ? "text-[#0b8a54] font-semibold" : ""}`}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-[18px] py-2 flex items-center gap-3 min-h-[34px]">
        {err ? (
          <span className="text-[11.5px] font-semibold text-[#cf3b40]">⚠ {err}</span>
        ) : saving ? (
          <span className="text-[11.5px] font-semibold text-muted">Сохранение…</span>
        ) : (
          <span className="text-[11px] text-muted">
            Впишите суммы в ячейки прихода и расхода + курс, затем Enter — сделка сохранится
          </span>
        )}
      </div>
    </div>
  );
}
