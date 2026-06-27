// src/components/balances/BalancesPanel.jsx
// «ОСТАТКИ В КАССЕ» — валюты в строку (колонки), две строки значений: Утро
// (баланс на начало дня) / Текущий. USDT — агрегат по ВСЕМ офисам; наличные —
// по выбранному офису (scope). Клик по валюте → поповер «по офисам». Read-only.
// Числа из movements (balanceOf/deltaOf); «Утро» = текущий − движения с 00:00.

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useAccounts } from "../../store/accounts.jsx";
import { useOffices } from "../../store/offices.jsx";
import { useCurrencies } from "../../store/currencies.jsx";
import { useBaseCurrency } from "../../store/baseCurrency.js";
import { convert } from "../../utils/convert.js";
import { BAL_COLUMNS, ccyMeta, fmtRu, splitParts } from "./currencyMeta.js";
import CurrencyByOfficePopover from "./CurrencyByOfficePopover.jsx";

function Num({ value, dp, className = "" }) {
  const { int, dec } = splitParts(fmtRu(value, dp));
  return (
    <span className={className}>
      {int}
      {dec && <span className="opacity-[0.42]">{dec}</span>}
    </span>
  );
}

const POP_W = 300;

export default function BalancesPanel({ currentOffice, scope }) {
  const { accounts, balanceOf, deltaOf } = useAccounts();
  const { activeOffices } = useOffices();
  const { dict: currencyDict } = useCurrencies();
  const { getRateFx } = useBaseCurrency();

  const cardRef = useRef(null);
  const wrapRef = useRef(null);
  const [sel, setSel] = useState(null); // выбранная валюта (поповер)
  const [pos, setPos] = useState({ left: 14, top: 0, arrow: 40 });

  const dayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const toUsd = useCallback(
    (amount, from) => (from ? convert(amount, from, "USD", getRateFx) : amount || 0),
    [getRateFx]
  );

  // Сумма валюты по фильтру офиса (null = все офисы). {tek, utro}.
  const sumFor = useCallback(
    (ccy, officeId) => {
      let tek = 0;
      let deltaToday = 0;
      accounts.forEach((a) => {
        if (!a.active || a.currency !== ccy) return;
        if (officeId && a.officeId !== officeId) return;
        tek += balanceOf(a.id);
        deltaToday += deltaOf(a.id, dayStartMs);
      });
      return { tek, utro: tek - deltaToday };
    },
    [accounts, balanceOf, deltaOf, dayStartMs]
  );

  const scopeAll = scope === "all";

  // Колонки: USDT — всегда все офисы; наличные — по scope (выбранный офис / все).
  const columns = useMemo(
    () =>
      BAL_COLUMNS.map((ccy) => {
        const crypto = currencyDict[ccy]?.type === "crypto" || ccy === "USDT";
        const data = crypto
          ? sumFor(ccy, null)
          : scopeAll
            ? sumFor(ccy, null)
            : sumFor(ccy, currentOffice);
        return { ccy, ...data, allOffices: crypto };
      }),
    [sumFor, scopeAll, currentOffice, currencyDict]
  );

  // Итог в USD-эквиваленте + дельта за день.
  const { gT, dG } = useMemo(() => {
    let t = 0;
    let u = 0;
    columns.forEach((c) => {
      t += toUsd(c.tek, c.ccy);
      u += toUsd(c.utro, c.ccy);
    });
    return { gT: t, dG: t - u };
  }, [columns, toUsd]);

  // Разбивка выбранной валюты по офисам — для поповера.
  const popView = useMemo(() => {
    if (!sel) return null;
    const offices = (activeOffices || []).map((o) => ({
      name: o.name || o.city || "Office",
      ...sumFor(sel, o.id),
    }));
    const total = offices.reduce((s, o) => s + o.tek, 0);
    return { ccy: sel, dp: ccyMeta(sel).dp, total, offices };
  }, [sel, activeOffices, sumFor]);

  const computePos = useCallback((cellEl) => {
    const card = cardRef.current?.getBoundingClientRect();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!card || !wrap || !cellEl) return { left: 14, top: 0, arrow: 40 };
    const a = cellEl.getBoundingClientRect();
    const pad = 14;
    let left = a.left - card.left;
    left = Math.max(pad, Math.min(left, card.width - POP_W - pad));
    const top = wrap.bottom - card.top + 8;
    const center = a.left + a.width / 2 - card.left;
    const arrow = Math.max(16, Math.min(center - left, POP_W - 16));
    return { left, top, arrow };
  }, []);

  const onCellClick = useCallback(
    (ccy, e) => {
      if (sel === ccy) {
        setSel(null);
        return;
      }
      setPos(computePos(e.currentTarget));
      setSel(ccy);
    },
    [sel, computePos]
  );

  // Закрытие: клик вне / Esc.
  useEffect(() => {
    if (!sel) return undefined;
    const onDoc = (e) => {
      if (e.target.closest?.("[data-bal-pop]")) return;
      if (e.target.closest?.("[data-bal-ccy]")) return;
      setSel(null);
    };
    const onEsc = (e) => e.key === "Escape" && setSel(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [sel]);

  const dCls = dG > 0 ? "text-[#0b8a54]" : dG < 0 ? "text-[#cf3b40]" : "text-muted";
  const dTxt = `${dG >= 0 ? "+$" : "−$"}${fmtRu(Math.abs(Math.round(dG)), 0)}`;

  const thSel = (ccy) => (sel === ccy ? "bg-[#eef0ff]" : "");
  const tdUtroSel = (ccy) => (sel === ccy ? "bg-[#eef0ff]" : "");
  const tdTekSel = (ccy) => (sel === ccy ? "bg-[#e3e7ff]" : "bg-[#f6f7fb]");

  return (
    <section
      ref={cardRef}
      className="relative z-[5] bg-surface border border-[#e7e9f1] rounded-[16px]"
      style={{ boxShadow: "0 1px 2px rgba(16,24,40,.06), 0 14px 34px -16px rgba(16,24,40,.18)" }}
    >
      {/* Шапка */}
      <div className="flex items-center justify-between gap-3 px-[18px] py-[11px] border-b border-[#e7e9f1]">
        <span className="text-[12px] font-extrabold tracking-[1.3px] uppercase text-[#454a66]">
          Остатки в кассе
        </span>
        <span className="font-mono text-[15px] font-bold text-ink tracking-tight whitespace-nowrap">
          ≈ ${fmtRu(Math.round(gT), 0)}
          <span className="font-sans not-italic text-[11.5px] font-semibold text-muted ml-1">
            · за день <span className={dCls}>{dTxt}</span>
          </span>
        </span>
      </div>

      {/* Таблица: валюты в колонки */}
      <div ref={wrapRef} className="overflow-x-auto px-4 pt-2 pb-1">
        <table className="border-collapse w-full">
          <thead>
            <tr>
              <th className="w-[80px] text-left" />
              {columns.map((c) => {
                const m = ccyMeta(c.ccy);
                return (
                  <th
                    key={c.ccy}
                    data-bal-ccy={c.ccy}
                    onClick={(e) => onCellClick(c.ccy, e)}
                    className={`relative px-[13px] pt-[18px] pb-[9px] align-bottom text-center whitespace-nowrap border-l border-[#e7e9f1] cursor-pointer ${thSel(c.ccy)}`}
                  >
                    {c.allOffices && (
                      <span className="absolute top-[3px] inset-x-0 text-center text-[8px] font-extrabold tracking-wide uppercase text-[#0b8a54] whitespace-nowrap">
                        все офисы
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 justify-center">
                      <span
                        className="w-5 h-5 rounded-md grid place-items-center font-extrabold text-[10px] leading-none"
                        style={{ background: m.bg, color: m.fg }}
                      >
                        {m.sym}
                      </span>
                      <span className="text-[12.5px] font-bold text-ink tracking-wide">
                        {c.ccy}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Утро */}
            <tr>
              <td className="w-[80px] text-left uppercase tracking-wide text-[9.5px] font-extrabold text-muted-soft px-[13px] py-[7px] border-t border-[#e7e9f1]">
                Утро
              </td>
              {columns.map((c) => (
                <td
                  key={c.ccy}
                  data-bal-ccy={c.ccy}
                  onClick={(e) => onCellClick(c.ccy, e)}
                  className={`text-center whitespace-nowrap border-l border-t border-[#e7e9f1] px-[13px] py-[7px] font-mono tabular-nums text-[12.5px] font-semibold cursor-pointer ${
                    c.utro === 0 ? "text-[#b6bacb]" : "text-muted"
                  } ${tdUtroSel(c.ccy)}`}
                >
                  <Num value={c.utro} dp={m_dp(c.ccy)} />
                </td>
              ))}
            </tr>
            {/* Текущий */}
            <tr>
              <td className="w-[80px] text-left uppercase tracking-wide text-[10px] font-extrabold text-[#454a66] px-[13px] py-[7px] border-t border-[#e7e9f1]">
                Текущий
              </td>
              {columns.map((c) => (
                <td
                  key={c.ccy}
                  data-bal-ccy={c.ccy}
                  onClick={(e) => onCellClick(c.ccy, e)}
                  className={`text-center whitespace-nowrap border-l border-t border-[#e7e9f1] px-[13px] py-[7px] font-mono tabular-nums text-[16.5px] font-bold cursor-pointer ${
                    c.tek === 0 ? "text-[#b6bacb]" : "text-ink"
                  } ${tdTekSel(c.ccy)}`}
                >
                  <Num value={c.tek} dp={m_dp(c.ccy)} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-[18px] pt-2 pb-3 text-[11px] font-semibold text-muted">
        Нажмите на валюту — <b className="text-[#0b8a54] font-bold">разбивка по всем офисам</b>
      </div>

      {sel && popView && (
        <div data-bal-pop>
          <CurrencyByOfficePopover view={popView} pos={pos} onClose={() => setSel(null)} />
        </div>
      )}
    </section>
  );
}

function m_dp(ccy) {
  return ccyMeta(ccy).dp;
}
